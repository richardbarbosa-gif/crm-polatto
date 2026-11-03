-- =====================================================================
-- CRM POLATTO — MIGRATION 13: ORÇAMENTOS / PROPOSTAS EM PDF
--
-- Cria o módulo de orçamento com a identidade visual de cada empresa:
--
--   1. empresa_identidade  — logo, dados, cores e textos padrão da proposta
--                            (1 linha por tenant; leitura para o tenant,
--                            escrita só para gerente/admin)
--   2. produtos            — catálogo de produtos/serviços do tenant
--                            (leitura para o tenant, escrita gerente/admin)
--   3. orcamentos          — proposta ligada ao negócio, numeração por
--                            tenant e ano (2026-0001), status, validade,
--                            desconto, soft delete com regra no banco
--   4. orcamento_itens     — itens do catálogo ou livres; totais
--                            recalculados no banco (fonte da verdade)
--   5. orcamento_contadores— contador por tenant/ano (sem acesso pela API)
--   6. Bucket empresa-assets (logo): privado, só PNG/JPEG/WEBP, 2 MB,
--      prefixo <tenant_id>/, escrita só gerente/admin. SVG proibido.
--
-- Isolamento entre tenants em TRÊS camadas:
--   - tenant_id preenchido no servidor (fn_set_tenant_id, migration 10) e
--     imutável depois (trigger);
--   - RLS por tenant_filter() com WITH CHECK, nada para anon;
--   - chaves estrangeiras COMPOSTAS (tenant_id, id): um item não aponta
--     para orçamento de outro tenant, um orçamento não aponta para negócio
--     de outro tenant, um item não usa produto de outro tenant — garantido
--     pelo próprio Postgres, sem depender de trigger.
--
-- Papel: usa public.eh_admin_do_tenant() (migration 10, estendida para
-- "gerente" na 12). Esta migration só USA a função, não a altera.
--
-- Testes: database/tests/07_teste_orcamentos.sql (Suíte 7 do runner).
--
-- IDEMPOTENTE: só CREATE ... IF NOT EXISTS / CREATE OR REPLACE / ALTER
-- guardado / DROP POLICY|TRIGGER IF EXISTS. Não apaga dado.
-- ORDEM: depois da 10 (precisa de fn_set_tenant_id fail-closed,
-- requisicao_api_publica() e eh_admin_do_tenant()).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. PRÉ-REQUISITOS — falha cedo, com mensagem clara
-- ---------------------------------------------------------------------
do $$
begin
    if to_regprocedure('public.fn_set_tenant_id()') is null
       or to_regprocedure('public.tenant_filter(uuid)') is null
       or to_regprocedure('public.eh_admin_do_tenant(uuid)') is null
       or to_regprocedure('public.requisicao_api_publica()') is null
       or to_regclass('public.negocios') is null then
        raise exception 'Migration 13 exige as migrations 00 a 10 aplicadas antes (fn_set_tenant_id, tenant_filter, eh_admin_do_tenant, requisicao_api_publica, negocios).';
    end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. HELPERS
-- ---------------------------------------------------------------------

-- CNPJ pelos dígitos verificadores. Aceita o formato numérico e o
-- alfanumérico da Receita (vigente desde jul/2026: cada caractere vale
-- ASCII - 48, os dois verificadores continuam numéricos). Pontuação é
-- ignorada; a coluna guarda só [0-9A-Z].
create or replace function public.identidade_cnpj_valido(p_cnpj text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
    v text := upper(regexp_replace(coalesce(p_cnpj, ''), '[^0-9A-Za-z]', '', 'g'));
    v_pesos1 int[] := array[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    v_pesos2 int[] := array[6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    v_soma int;
    v_resto int;
    i int;
begin
    if v !~ '^[0-9A-Z]{12}[0-9]{2}$' or v ~ '^(.)\1{13}$' then
        return false;
    end if;

    v_soma := 0;
    for i in 1..12 loop
        v_soma := v_soma + (ascii(substr(v, i, 1)) - 48) * v_pesos1[i];
    end loop;
    v_resto := v_soma % 11;
    if (case when v_resto < 2 then 0 else 11 - v_resto end) <> substr(v, 13, 1)::int then
        return false;
    end if;

    v_soma := 0;
    for i in 1..13 loop
        v_soma := v_soma + (ascii(substr(v, i, 1)) - 48) * v_pesos2[i];
    end loop;
    v_resto := v_soma % 11;
    return (case when v_resto < 2 then 0 else 11 - v_resto end) = substr(v, 14, 1)::int;
end;
$$;

comment on function public.identidade_cnpj_valido(text) is 'CNPJ válido pelos dígitos verificadores (numérico ou alfanumérico). Usado no CHECK de empresa_identidade.';

-- tenant_id nunca muda depois do insert; updated_at sempre do servidor.
-- Sem esta trava, um superadmin (único que passa no WITH CHECK para outro
-- tenant) poderia "mover" registro entre empresas por engano.
create or replace function public.fn_orc_proteger_tenant()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.tenant_id is distinct from old.tenant_id then
        raise exception 'tenant_id é imutável em %.', tg_table_name using errcode = '42501';
    end if;
    new.updated_at := now();
    return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. NEGOCIOS: chave (tenant_id, id) para a FK composta de orcamentos.
-- id já é PK; a unique composta só existe para a FK provar, no banco,
-- que o negócio é do MESMO tenant do orçamento.
-- ---------------------------------------------------------------------
do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'negocios_tenant_id_id_uk' and conrelid = 'public.negocios'::regclass
    ) then
        alter table public.negocios add constraint negocios_tenant_id_id_uk unique (tenant_id, id);
    end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. EMPRESA_IDENTIDADE — uma linha por tenant
-- ---------------------------------------------------------------------
create table if not exists public.empresa_identidade (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    logo_path text,
    nome_fantasia text,
    razao_social text,
    cnpj text,
    endereco text,
    telefone text,
    email text,
    site text,
    cor_primaria text not null default '#0F4C81',
    cor_secundaria text not null default '#F2A900',
    condicoes_pagamento text,
    validade_dias integer not null default 15,
    observacoes_padrao text,
    rodape text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

do $$
declare
    r record;
begin
    for r in
        select * from (values
            ('empresa_identidade_tenant_uk', 'unique (tenant_id)'),
            ('empresa_identidade_cor_primaria_ck', $c$check (cor_primaria ~ '^#[0-9A-Fa-f]{6}$')$c$),
            ('empresa_identidade_cor_secundaria_ck', $c$check (cor_secundaria ~ '^#[0-9A-Fa-f]{6}$')$c$),
            ('empresa_identidade_cnpj_ck', $c$check (cnpj is null or (cnpj ~ '^[0-9A-Z]{14}$' and public.identidade_cnpj_valido(cnpj)))$c$),
            ('empresa_identidade_validade_ck', 'check (validade_dias between 1 and 365)'),
            ('empresa_identidade_email_ck', $c$check (email is null or (length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'))$c$),
            ('empresa_identidade_site_ck', $c$check (site is null or (length(site) <= 200 and site ~* '^(https?://)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{2,5})?(/[^\s]*)?$'))$c$),
            -- logo só no prefixo do próprio tenant e só raster (SVG proibido: XSS e o jsPDF não renderiza)
            ('empresa_identidade_logo_ck', $c$check (logo_path is null or (split_part(logo_path, '/', 1) = tenant_id::text and logo_path ~* '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}\.(png|jpe?g|webp)$'))$c$),
            ('empresa_identidade_tamanhos_ck', $c$check (
                coalesce(length(nome_fantasia), 0) <= 120 and coalesce(length(razao_social), 0) <= 160
                and coalesce(length(endereco), 0) <= 300 and coalesce(length(telefone), 0) <= 40
                and coalesce(length(condicoes_pagamento), 0) <= 2000
                and coalesce(length(observacoes_padrao), 0) <= 2000
                and coalesce(length(rodape), 0) <= 300)$c$)
        ) as t(nome, definicao)
    loop
        if not exists (
            select 1 from pg_constraint
            where conname = r.nome and conrelid = 'public.empresa_identidade'::regclass
        ) then
            execute format('alter table public.empresa_identidade add constraint %I %s', r.nome, r.definicao);
        end if;
    end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. PRODUTOS — catálogo
-- ---------------------------------------------------------------------
create table if not exists public.produtos (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    nome text not null,
    descricao text,
    unidade text not null default 'un',
    preco_padrao numeric(14,2) not null default 0,
    ativo boolean not null default true,
    created_by uuid default auth.uid(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

do $$
declare
    r record;
begin
    for r in
        select * from (values
            ('produtos_tenant_id_uk', 'unique (tenant_id, id)'),
            ('produtos_nome_ck', 'check (length(btrim(nome)) between 1 and 200)'),
            ('produtos_descricao_ck', 'check (descricao is null or length(descricao) <= 2000)'),
            ('produtos_unidade_ck', 'check (length(btrim(unidade)) between 1 and 20)'),
            ('produtos_preco_ck', 'check (preco_padrao >= 0)')
        ) as t(nome, definicao)
    loop
        if not exists (
            select 1 from pg_constraint
            where conname = r.nome and conrelid = 'public.produtos'::regclass
        ) then
            execute format('alter table public.produtos add constraint %I %s', r.nome, r.definicao);
        end if;
    end loop;
end $$;

create index if not exists idx_produtos_tenant_nome on public.produtos (tenant_id, lower(nome));

-- ---------------------------------------------------------------------
-- 5. ORCAMENTOS
-- ---------------------------------------------------------------------
create table if not exists public.orcamentos (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    negocio_id uuid not null,
    numero text not null,
    numero_ano integer not null,
    numero_seq integer not null,
    titulo text,
    status text not null default 'rascunho',
    data_emissao date not null default ((now() at time zone 'America/Sao_Paulo')::date),
    valido_ate date not null,
    desconto_tipo text not null default 'valor',
    desconto_valor numeric(14,2) not null default 0,
    subtotal numeric(14,2) not null default 0,
    desconto_total numeric(14,2) not null default 0,
    total numeric(14,2) not null default 0,
    condicoes_pagamento text,
    observacoes text,
    responsavel_id uuid default auth.uid(),
    responsavel_nome text,
    responsavel_email text,
    responsavel_telefone text,
    enviado_em timestamptz,
    decidido_em timestamptz,
    created_by uuid not null default auth.uid(),
    created_at timestamptz not null default now(),
    updated_by uuid,
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    deleted_by uuid
);

do $$
declare
    r record;
begin
    for r in
        select * from (values
            ('orcamentos_tenant_id_uk', 'unique (tenant_id, id)'),
            ('orcamentos_numero_uk', 'unique (tenant_id, numero)'),
            ('orcamentos_numero_seq_uk', 'unique (tenant_id, numero_ano, numero_seq)'),
            -- FK composta: o negócio precisa ser do MESMO tenant do orçamento
            ('orcamentos_negocio_fk', 'foreign key (tenant_id, negocio_id) references public.negocios (tenant_id, id) on delete cascade'),
            ('orcamentos_status_ck', $c$check (status in ('rascunho', 'enviado', 'aceito', 'recusado', 'expirado'))$c$),
            ('orcamentos_desconto_tipo_ck', $c$check (desconto_tipo in ('percentual', 'valor'))$c$),
            ('orcamentos_desconto_ck', $c$check (desconto_valor >= 0 and (desconto_tipo <> 'percentual' or desconto_valor <= 100))$c$),
            ('orcamentos_totais_ck', 'check (subtotal >= 0 and desconto_total >= 0 and total >= 0)'),
            ('orcamentos_validade_ck', 'check (valido_ate >= data_emissao)'),
            ('orcamentos_tamanhos_ck', $c$check (
                coalesce(length(titulo), 0) <= 200
                and coalesce(length(condicoes_pagamento), 0) <= 4000
                and coalesce(length(observacoes), 0) <= 4000
                and coalesce(length(responsavel_nome), 0) <= 120
                and coalesce(length(responsavel_email), 0) <= 254
                and coalesce(length(responsavel_telefone), 0) <= 40)$c$)
        ) as t(nome, definicao)
    loop
        if not exists (
            select 1 from pg_constraint
            where conname = r.nome and conrelid = 'public.orcamentos'::regclass
        ) then
            execute format('alter table public.orcamentos add constraint %I %s', r.nome, r.definicao);
        end if;
    end loop;
end $$;

create index if not exists idx_orcamentos_negocio on public.orcamentos (tenant_id, negocio_id) where deleted_at is null;
create index if not exists idx_orcamentos_lista on public.orcamentos (tenant_id, created_at desc) where deleted_at is null;
create index if not exists idx_orcamentos_status on public.orcamentos (tenant_id, status) where deleted_at is null;

-- ---------------------------------------------------------------------
-- 6. ORCAMENTO_ITENS
-- ---------------------------------------------------------------------
create table if not exists public.orcamento_itens (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    orcamento_id uuid not null,
    produto_id uuid,
    descricao text not null,
    detalhes text,
    unidade text not null default 'un',
    quantidade numeric(14,3) not null default 1,
    valor_unitario numeric(14,2) not null default 0,
    desconto_tipo text not null default 'valor',
    desconto_valor numeric(14,2) not null default 0,
    total numeric(14,2) not null default 0,
    ordem integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

do $$
declare
    r record;
begin
    for r in
        select * from (values
            -- FKs compostas: item, orçamento e produto sempre do mesmo tenant
            ('orcamento_itens_orcamento_fk', 'foreign key (tenant_id, orcamento_id) references public.orcamentos (tenant_id, id) on delete cascade'),
            ('orcamento_itens_produto_fk', 'foreign key (tenant_id, produto_id) references public.produtos (tenant_id, id) on delete set null (produto_id)'),
            ('orcamento_itens_quantidade_ck', 'check (quantidade > 0)'),
            ('orcamento_itens_valor_ck', 'check (valor_unitario >= 0)'),
            ('orcamento_itens_desconto_tipo_ck', $c$check (desconto_tipo in ('percentual', 'valor'))$c$),
            ('orcamento_itens_desconto_ck', $c$check (desconto_valor >= 0 and (desconto_tipo <> 'percentual' or desconto_valor <= 100))$c$),
            ('orcamento_itens_total_ck', 'check (total >= 0)'),
            ('orcamento_itens_descricao_ck', 'check (length(btrim(descricao)) between 1 and 500)'),
            ('orcamento_itens_tamanhos_ck', 'check (coalesce(length(detalhes), 0) <= 2000 and length(btrim(unidade)) between 1 and 20)')
        ) as t(nome, definicao)
    loop
        if not exists (
            select 1 from pg_constraint
            where conname = r.nome and conrelid = 'public.orcamento_itens'::regclass
        ) then
            execute format('alter table public.orcamento_itens add constraint %I %s', r.nome, r.definicao);
        end if;
    end loop;
end $$;

create index if not exists idx_orcamento_itens_orcamento on public.orcamento_itens (orcamento_id, ordem);
create index if not exists idx_orcamento_itens_produto on public.orcamento_itens (tenant_id, produto_id) where produto_id is not null;

-- ---------------------------------------------------------------------
-- 7. CONTADOR DA NUMERAÇÃO — por tenant e ano, sem acesso pela API
-- ---------------------------------------------------------------------
create table if not exists public.orcamento_contadores (
    tenant_id uuid not null,
    ano integer not null,
    ultimo integer not null default 0,
    atualizado_em timestamptz not null default now(),
    primary key (tenant_id, ano)
);

-- Numeração segura sob concorrência: o INSERT ... ON CONFLICT DO UPDATE
-- trava a linha do contador até o fim da transação. Duas propostas
-- simultâneas do mesmo tenant esperam uma pela outra (sem duplicata) e,
-- se a transação falhar, o incremento volta junto (sem buraco).
-- SECURITY DEFINER porque o contador não tem policy nem GRANT para a API;
-- valida que o tenant é o do usuário antes de tocar no contador.
create or replace function public.fn_orcamentos_numerar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ano integer;
    v_seq integer;
begin
    if new.tenant_id is null then
        raise exception 'Orçamento sem tenant_id.' using errcode = '42501';
    end if;
    if public.requisicao_api_publica() and not public.tenant_filter(new.tenant_id) then
        raise exception 'Tenant inválido para numerar o orçamento.' using errcode = '42501';
    end if;

    v_ano := extract(year from (now() at time zone 'America/Sao_Paulo'))::integer;

    insert into public.orcamento_contadores as c (tenant_id, ano, ultimo)
    values (new.tenant_id, v_ano, 1)
    on conflict (tenant_id, ano)
    do update set ultimo = c.ultimo + 1, atualizado_em = now()
    returning c.ultimo into v_seq;

    new.numero_ano := v_ano;
    new.numero_seq := v_seq;
    -- greatest(): a partir de 10000 o número cresce em vez de ser truncado
    new.numero := v_ano::text || '-' || lpad(v_seq::text, greatest(4, length(v_seq::text)), '0');
    return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. REGRAS DO ORÇAMENTO (invoker: roda com a RLS do usuário)
--   - created_by vem do servidor e nunca muda (é ele que dá direito de excluir)
--   - número, negócio e tenant imutáveis
--   - excluir (soft delete) ou restaurar: só gerente/admin OU quem criou
--   - registro na lixeira não se edita
--   - totais SEMPRE recalculados aqui a partir dos itens
-- ---------------------------------------------------------------------
create or replace function public.fn_orcamentos_preparar()
returns trigger
language plpgsql
set search_path = public
as $$
declare
    v_api boolean := public.requisicao_api_publica();
    v_validade integer;
    v_condicoes text;
    v_observacoes text;
    v_subtotal numeric(14,2);
    v_desconto numeric(14,2);
begin
    if tg_op = 'INSERT' then
        if v_api then
            new.created_by := auth.uid();
            new.responsavel_id := coalesce(new.responsavel_id, auth.uid());
        else
            new.created_by := coalesce(new.created_by, auth.uid());
        end if;
        new.created_at := now();
        new.updated_by := null;
        new.deleted_at := null;
        new.deleted_by := null;
        new.enviado_em := case when new.status = 'enviado' then now() end;
        new.decidido_em := case when new.status in ('aceito', 'recusado') then now() end;
        new.data_emissao := coalesce(new.data_emissao, (now() at time zone 'America/Sao_Paulo')::date);

        select ei.validade_dias, ei.condicoes_pagamento, ei.observacoes_padrao
        into v_validade, v_condicoes, v_observacoes
        from public.empresa_identidade ei
        where ei.tenant_id = new.tenant_id;

        new.valido_ate := coalesce(new.valido_ate, new.data_emissao + coalesce(v_validade, 15));
        new.condicoes_pagamento := coalesce(new.condicoes_pagamento, v_condicoes);
        new.observacoes := coalesce(new.observacoes, v_observacoes);
    else
        if new.tenant_id is distinct from old.tenant_id then
            raise exception 'tenant_id é imutável em orcamentos.' using errcode = '42501';
        end if;
        if new.created_by is distinct from old.created_by then
            raise exception 'O criador do orçamento não pode ser alterado.' using errcode = '42501';
        end if;
        if new.numero is distinct from old.numero
           or new.numero_ano is distinct from old.numero_ano
           or new.numero_seq is distinct from old.numero_seq then
            raise exception 'O número do orçamento não pode ser alterado.' using errcode = '42501';
        end if;
        if new.negocio_id is distinct from old.negocio_id then
            raise exception 'O orçamento não pode ser movido para outro negócio. Duplique-o no negócio desejado.' using errcode = '42501';
        end if;
        new.created_at := old.created_at;

        if (old.deleted_at is null) <> (new.deleted_at is null) then
            if v_api and not (public.eh_admin_do_tenant(old.tenant_id) or old.created_by = auth.uid()) then
                raise exception 'Somente quem criou o orçamento ou um gerente/admin pode excluí-lo ou restaurá-lo.'
                    using errcode = '42501';
            end if;
            if new.deleted_at is not null then
                new.deleted_at := now();
                new.deleted_by := auth.uid();
            else
                new.deleted_by := null;
            end if;
        elsif old.deleted_at is not null then
            raise exception 'Orçamento excluído: restaure-o antes de editar.' using errcode = '55000';
        else
            new.deleted_at := old.deleted_at;
            new.deleted_by := old.deleted_by;
        end if;

        if new.status is distinct from old.status then
            if new.status = 'enviado' then
                new.enviado_em := coalesce(old.enviado_em, now());
            end if;
            new.decidido_em := case when new.status in ('aceito', 'recusado') then now() end;
        else
            new.enviado_em := old.enviado_em;
            new.decidido_em := old.decidido_em;
        end if;

        new.updated_at := now();
        new.updated_by := auth.uid();
    end if;

    -- Totais: o banco é a fonte da verdade. O que vier do cliente é ignorado.
    select coalesce(sum(i.total), 0)
    into v_subtotal
    from public.orcamento_itens i
    where i.orcamento_id = new.id;

    v_desconto := case
        when new.desconto_tipo = 'percentual' then round(v_subtotal * new.desconto_valor / 100, 2)
        else new.desconto_valor
    end;
    v_desconto := least(v_desconto, v_subtotal);

    new.subtotal := v_subtotal;
    new.desconto_total := v_desconto;
    new.total := v_subtotal - v_desconto;
    return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 9. REGRAS DO ITEM
-- ---------------------------------------------------------------------
create or replace function public.fn_orcamento_itens_preparar()
returns trigger
language plpgsql
set search_path = public
as $$
declare
    v_excluido timestamptz;
    v_bruto numeric(14,2);
    v_desconto numeric(14,2);
    v_produto record;
begin
    if tg_op = 'UPDATE' then
        if new.tenant_id is distinct from old.tenant_id then
            raise exception 'tenant_id é imutável em orcamento_itens.' using errcode = '42501';
        end if;
        if new.orcamento_id is distinct from old.orcamento_id then
            raise exception 'O item não pode ser movido para outro orçamento.' using errcode = '42501';
        end if;
        new.created_at := old.created_at;
    end if;

    select o.deleted_at into v_excluido
    from public.orcamentos o
    where o.id = new.orcamento_id and o.tenant_id = new.tenant_id;
    if v_excluido is not null then
        raise exception 'Orçamento excluído: restaure-o antes de editar os itens.' using errcode = '55000';
    end if;

    -- Item do catálogo sem descrição/unidade: herda do produto (do mesmo
    -- tenant — a FK composta já garante isso).
    if new.produto_id is not null and (nullif(btrim(coalesce(new.descricao, '')), '') is null) then
        select p.nome, p.unidade into v_produto
        from public.produtos p
        where p.id = new.produto_id and p.tenant_id = new.tenant_id;
        if found then
            new.descricao := v_produto.nome;
            new.unidade := coalesce(nullif(btrim(coalesce(new.unidade, '')), ''), v_produto.unidade);
        end if;
    end if;

    v_bruto := round(new.quantidade * new.valor_unitario, 2);
    v_desconto := case
        when new.desconto_tipo = 'percentual' then round(v_bruto * new.desconto_valor / 100, 2)
        else new.desconto_valor
    end;
    new.total := v_bruto - least(v_desconto, v_bruto);
    new.updated_at := now();
    return new;
end;
$$;

-- Depois de mexer nos itens, "toca" o orçamento: o trigger dele recalcula
-- subtotal/desconto/total. Roda com a RLS do usuário (mesmo tenant).
create or replace function public.fn_orcamento_itens_recalcular()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if tg_op in ('INSERT', 'UPDATE') then
        update public.orcamentos set updated_at = now()
        where id = new.orcamento_id and deleted_at is null;
    end if;
    if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.orcamento_id is distinct from new.orcamento_id) then
        update public.orcamentos set updated_at = now()
        where id = old.orcamento_id and deleted_at is null;
    end if;
    return null;
end;
$$;

-- ---------------------------------------------------------------------
-- 10. TRIGGERS — a ordem importa: o Postgres dispara os BEFORE em ordem
-- alfabética. "set_tenant_id" (s) roda antes de "trg_*" (t), então o
-- número e as regras já enxergam o tenant resolvido no servidor.
-- ---------------------------------------------------------------------
do $$
declare
    v_tabela text;
begin
    foreach v_tabela in array array['empresa_identidade', 'produtos', 'orcamentos', 'orcamento_itens'] loop
        execute format('drop trigger if exists set_tenant_id on public.%I', v_tabela);
        execute format(
            'create trigger set_tenant_id before insert on public.%I for each row execute function public.fn_set_tenant_id()',
            v_tabela
        );
    end loop;

    foreach v_tabela in array array['empresa_identidade', 'produtos'] loop
        execute format('drop trigger if exists trg_proteger_tenant on public.%I', v_tabela);
        execute format(
            'create trigger trg_proteger_tenant before update on public.%I for each row execute function public.fn_orc_proteger_tenant()',
            v_tabela
        );
    end loop;
end $$;

drop trigger if exists trg_orcamentos_1_numerar on public.orcamentos;
create trigger trg_orcamentos_1_numerar
    before insert on public.orcamentos
    for each row execute function public.fn_orcamentos_numerar();

drop trigger if exists trg_orcamentos_2_preparar on public.orcamentos;
create trigger trg_orcamentos_2_preparar
    before insert or update on public.orcamentos
    for each row execute function public.fn_orcamentos_preparar();

drop trigger if exists trg_orcamento_itens_1_preparar on public.orcamento_itens;
create trigger trg_orcamento_itens_1_preparar
    before insert or update on public.orcamento_itens
    for each row execute function public.fn_orcamento_itens_preparar();

drop trigger if exists trg_orcamento_itens_9_recalcular on public.orcamento_itens;
create trigger trg_orcamento_itens_9_recalcular
    after insert or update or delete on public.orcamento_itens
    for each row execute function public.fn_orcamento_itens_recalcular();

-- Auditoria (migration 04), quando existir.
do $$
declare
    v_tabela text;
begin
    if to_regprocedure('public.fn_audit_trigger()') is null then
        return;
    end if;
    foreach v_tabela in array array['empresa_identidade', 'produtos', 'orcamentos'] loop
        execute format('drop trigger if exists audit_changes on public.%I', v_tabela);
        execute format(
            'create trigger audit_changes after insert or update or delete on public.%I for each row execute function public.fn_audit_trigger()',
            v_tabela
        );
    end loop;
end $$;

-- ---------------------------------------------------------------------
-- 11. RLS — padrão do modelo novo, sempre com WITH CHECK, nada para anon
-- ---------------------------------------------------------------------
alter table public.empresa_identidade enable row level security;
alter table public.produtos enable row level security;
alter table public.orcamentos enable row level security;
alter table public.orcamento_itens enable row level security;
alter table public.orcamento_contadores enable row level security;

-- Identidade e catálogo: todo o tenant lê; só gerente/admin escreve.
do $$
declare
    v_tabela text;
begin
    foreach v_tabela in array array['empresa_identidade', 'produtos'] loop
        execute format('drop policy if exists %I on public.%I', v_tabela || '_leitura', v_tabela);
        execute format(
            'create policy %I on public.%I for select to authenticated using (public.tenant_filter(tenant_id))',
            v_tabela || '_leitura', v_tabela
        );
        execute format('drop policy if exists %I on public.%I', v_tabela || '_escrita_admin', v_tabela);
        execute format(
            'create policy %I on public.%I for all to authenticated '
            'using (public.tenant_filter(tenant_id) and public.eh_admin_do_tenant(tenant_id)) '
            'with check (public.tenant_filter(tenant_id) and public.eh_admin_do_tenant(tenant_id))',
            v_tabela || '_escrita_admin', v_tabela
        );
    end loop;
end $$;

-- Orçamentos: o tenant inteiro cria, lê e edita. Exclusão lógica: regra no
-- trigger (criador OU gerente/admin). DELETE físico: só gerente/admin.
drop policy if exists orcamentos_tenant_select on public.orcamentos;
create policy orcamentos_tenant_select on public.orcamentos
    for select to authenticated
    using (public.tenant_filter(tenant_id));

drop policy if exists orcamentos_tenant_insert on public.orcamentos;
create policy orcamentos_tenant_insert on public.orcamentos
    for insert to authenticated
    with check (public.tenant_filter(tenant_id));

drop policy if exists orcamentos_tenant_update on public.orcamentos;
create policy orcamentos_tenant_update on public.orcamentos
    for update to authenticated
    using (public.tenant_filter(tenant_id))
    with check (public.tenant_filter(tenant_id));

drop policy if exists orcamentos_admin_delete on public.orcamentos;
create policy orcamentos_admin_delete on public.orcamentos
    for delete to authenticated
    using (public.tenant_filter(tenant_id) and public.eh_admin_do_tenant(tenant_id));

drop policy if exists orcamento_itens_tenant_isolation on public.orcamento_itens;
create policy orcamento_itens_tenant_isolation on public.orcamento_itens
    for all to authenticated
    using (public.tenant_filter(tenant_id))
    with check (public.tenant_filter(tenant_id));

-- orcamento_contadores: RLS ligada e NENHUMA policy — só o trigger
-- SECURITY DEFINER acessa.

-- ---------------------------------------------------------------------
-- 12. GRANTS — o Supabase dá tudo a anon em tabela nova; aqui não.
-- ---------------------------------------------------------------------
do $$
declare
    v_tabela text;
    v_anon boolean := exists (select 1 from pg_roles where rolname = 'anon');
    v_auth boolean := exists (select 1 from pg_roles where rolname = 'authenticated');
    v_service boolean := exists (select 1 from pg_roles where rolname = 'service_role');
begin
    foreach v_tabela in array array['empresa_identidade', 'produtos', 'orcamentos', 'orcamento_itens', 'orcamento_contadores'] loop
        execute format('revoke all on public.%I from public', v_tabela);
        if v_anon then
            execute format('revoke all on public.%I from anon', v_tabela);
        end if;
        if v_auth then
            if v_tabela = 'orcamento_contadores' then
                execute format('revoke all on public.%I from authenticated', v_tabela);
            else
                execute format('grant select, insert, update, delete on public.%I to authenticated', v_tabela);
            end if;
        end if;
        if v_service then
            execute format('grant all on public.%I to service_role', v_tabela);
        end if;
    end loop;
end $$;

-- Funções: trigger não precisa de EXECUTE do usuário para disparar.
-- identidade_cnpj_valido é usada no CHECK, então authenticated executa.
do $$
declare
    r record;
    v_anon boolean := exists (select 1 from pg_roles where rolname = 'anon');
    v_auth boolean := exists (select 1 from pg_roles where rolname = 'authenticated');
begin
    for r in
        select p.oid::regprocedure as fn, p.proname::text as nome
        from pg_proc p
        join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public'
          and p.proname in (
              'identidade_cnpj_valido', 'fn_orc_proteger_tenant', 'fn_orcamentos_numerar',
              'fn_orcamentos_preparar', 'fn_orcamento_itens_preparar', 'fn_orcamento_itens_recalcular'
          )
    loop
        execute format('revoke execute on function %s from public', r.fn);
        if v_anon then
            execute format('revoke execute on function %s from anon', r.fn);
        end if;
        if v_auth then
            if r.nome = 'identidade_cnpj_valido' then
                execute format('grant execute on function %s to authenticated', r.fn);
            else
                execute format('revoke execute on function %s from authenticated', r.fn);
            end if;
        end if;
    end loop;
end $$;

-- ---------------------------------------------------------------------
-- 13. STORAGE empresa-assets — logo da empresa
-- Caminho: <tenant_id>/logo-<timestamp>.<png|jpg|jpeg|webp>
-- Leitura: qualquer membro do tenant (o PDF de todo vendedor leva o logo).
-- Escrita: só gerente/admin do tenant. Extensão conferida na policy (além
-- do allowed_mime_types do bucket) para que .svg não entre nem se alguém
-- afrouxar a configuração do bucket no painel.
-- ---------------------------------------------------------------------
do $$
begin
    if to_regclass('storage.buckets') is not null then
        insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        values ('empresa-assets', 'empresa-assets', false, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
        on conflict (id) do update set
            public = false,
            file_size_limit = 2097152,
            allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];
    end if;
exception when others then
    raise warning 'storage.buckets não ajustado (%): no painel, crie o bucket empresa-assets PRIVADO, 2 MB, apenas image/png, image/jpeg e image/webp.', sqlerrm;
end $$;

do $$
begin
    drop policy if exists empresa_assets_tenant_select on storage.objects;
    create policy empresa_assets_tenant_select on storage.objects
        for select to authenticated
        using (
            bucket_id = 'empresa-assets'
            and (
                (storage.foldername(name))[1] = public.current_tenant_id()::text
                or public.is_system_admin()
            )
        );

    drop policy if exists empresa_assets_admin_insert on storage.objects;
    create policy empresa_assets_admin_insert on storage.objects
        for insert to authenticated
        with check (
            bucket_id = 'empresa-assets'
            and (storage.foldername(name))[1] = public.current_tenant_id()::text
            and public.eh_admin_do_tenant()
            and name ~* '\.(png|jpe?g|webp)$'
        );

    drop policy if exists empresa_assets_admin_update on storage.objects;
    create policy empresa_assets_admin_update on storage.objects
        for update to authenticated
        using (
            bucket_id = 'empresa-assets'
            and (storage.foldername(name))[1] = public.current_tenant_id()::text
            and public.eh_admin_do_tenant()
        )
        with check (
            bucket_id = 'empresa-assets'
            and (storage.foldername(name))[1] = public.current_tenant_id()::text
            and public.eh_admin_do_tenant()
            and name ~* '\.(png|jpe?g|webp)$'
        );

    drop policy if exists empresa_assets_admin_delete on storage.objects;
    create policy empresa_assets_admin_delete on storage.objects
        for delete to authenticated
        using (
            bucket_id = 'empresa-assets'
            and (storage.foldername(name))[1] = public.current_tenant_id()::text
            and public.eh_admin_do_tenant()
        );
exception when insufficient_privilege then
    raise warning 'Sem permissão para criar as policies de storage via SQL: replique no painel (Storage > empresa-assets > Policies) as regras empresa_assets_* desta migration.';
end $$;

comment on table public.empresa_identidade is 'Identidade visual e textos padrão da proposta, 1 linha por tenant. Leitura: tenant. Escrita: gerente/admin (eh_admin_do_tenant).';
comment on table public.produtos is 'Catálogo de produtos/serviços do tenant. Leitura: tenant. Escrita: gerente/admin.';
comment on table public.orcamentos is 'Orçamento/proposta ligado a negocios. Número por tenant e ano (fn_orcamentos_numerar). Totais recalculados no banco. Soft delete: criador ou gerente/admin; DELETE físico: gerente/admin.';
comment on table public.orcamento_itens is 'Itens do orçamento (catálogo ou livres). total do item e do orçamento calculados por trigger.';
comment on table public.orcamento_contadores is 'Último número de orçamento por tenant e ano. Sem policy: só o trigger SECURITY DEFINER escreve.';
