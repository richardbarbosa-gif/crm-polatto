-- =====================================================================
-- CRM POLATTO — MIGRATION 14: PROPOSTA TRAVADA DEPOIS DE ENVIADA
--
-- Padrão PandaDoc/Pipedrive: o que o cliente recebeu não muda mais.
--
--   1. Só RASCUNHO é editável. Enviado, aceito, recusado, expirado e
--      substituído recusam qualquer mudança no conteúdo comercial
--      (cabeçalho e itens) com errcode 42501 e a mensagem
--      "Proposta já enviada não pode ser alterada. Use “Nova versão” para revisar."
--      Continuam permitidos: a mudança de status pelas transições válidas,
--      o soft delete/restauração (regras da 13) e as colunas técnicas que
--      os triggers mantêm (updated_at/updated_by, enviado_em/decidido_em e
--      os totais recalculados). O DELETE em cascata dos itens, quando o
--      gerente apaga o orçamento de vez, continua liberado.
--   2. Transições de status válidas (qualquer outra é recusada):
--        rascunho -> enviado
--        enviado  -> aceito | recusado | expirado
--        enviado | expirado -> substituido (só pelo banco, ver item 4)
--      aceito, recusado, expirado e substituido são finais.
--   3. Nova versão (revisão): versao_de (FK composta, mesmo tenant),
--      revisao (1 na original, +1 a cada versão) e numero_original
--      (número da primeira proposta da cadeia, para mostrar
--      "Revisão 3 de 2026-0003" sem consulta extra). A RPC
--      nova_versao_orcamento() cria um RASCUNHO com número novo da
--      sequência normal e copia cabeçalho e itens. Duplicar continua
--      igual (cópia solta, sem vínculo).
--   4. Status "substituido" (decisão de produto, 2026-11-04): a versão
--      anterior vira "substituída" quando a REVISÃO É ENVIADA, não quando o
--      rascunho é criado. Motivo: enquanto a revisão é rascunho, o cliente
--      só conhece a anterior e pode aceitá-la — ela precisa continuar
--      "enviada" e aceitável; e se o rascunho for descartado, nada precisa
--      ser desfeito. Só enviado/expirado viram substituído; aceito e
--      recusado ficam como estão. O banco aceita "-> substituido" apenas
--      quando existe uma revisão já enviada daquela proposta.
--   5. Contexto administrativo (SQL Editor, cron, service_role:
--      requisicao_api_publica() = false) fica isento, como nos demais
--      triggers do projeto.
--
-- Cadeia linear: cada proposta tem no máximo UMA revisão ativa (índice
-- único parcial). "Nova versão" de novo sobre a mesma proposta devolve o
-- rascunho que já existe (clique duplo não duplica número).
--
-- Testes: database/tests/09_teste_orcamento_travado.sql (Suíte 9).
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS, constraints guardadas, CREATE OR
-- REPLACE, DROP TRIGGER IF EXISTS. Não apaga dado.
-- ORDEM: depois da 13. Não altera as funções da 13 (só acrescenta
-- triggers que rodam DEPOIS dos dela): reaplicar a 13 não desfaz a 14.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. PRÉ-REQUISITOS
-- ---------------------------------------------------------------------
do $$
begin
    if to_regclass('public.orcamentos') is null
       or to_regclass('public.orcamento_itens') is null
       or to_regprocedure('public.fn_orcamentos_preparar()') is null
       or to_regprocedure('public.fn_orcamento_itens_preparar()') is null
       or to_regprocedure('public.requisicao_api_publica()') is null then
        raise exception 'Migration 14 exige a migration 13 (orçamentos) aplicada antes.';
    end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. COLUNAS DE VERSÃO
-- ---------------------------------------------------------------------
alter table public.orcamentos add column if not exists versao_de uuid;
alter table public.orcamentos add column if not exists revisao integer not null default 1;
alter table public.orcamentos add column if not exists numero_original text;

-- Status ganha "substituido". A 13 só cria a constraint se o nome não
-- existir, então reaplicar a 13 depois da 14 mantém esta definição.
do $$
begin
    if exists (
        select 1 from pg_constraint
        where conname = 'orcamentos_status_ck'
          and conrelid = 'public.orcamentos'::regclass
          and pg_get_constraintdef(oid) not like '%substituido%'
    ) then
        alter table public.orcamentos drop constraint orcamentos_status_ck;
    end if;
end $$;

do $$
declare
    r record;
begin
    for r in
        select * from (values
            ('orcamentos_status_ck', $c$check (status in ('rascunho', 'enviado', 'aceito', 'recusado', 'expirado', 'substituido'))$c$),
            -- FK composta: a versão anterior é sempre do MESMO tenant. Sem
            -- ON DELETE: a original não some por baixo das revisões (o
            -- histórico fica inteiro); apagar o negócio leva a cadeia toda.
            ('orcamentos_versao_de_fk', 'foreign key (tenant_id, versao_de) references public.orcamentos (tenant_id, id)'),
            ('orcamentos_versao_de_ck', 'check (versao_de is null or versao_de <> id)'),
            ('orcamentos_revisao_ck', 'check (revisao between 1 and 9999)'),
            ('orcamentos_numero_original_ck', 'check (numero_original is null or length(numero_original) <= 20)')
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

-- Índice da FK (o Postgres não cria sozinho) e a regra da cadeia linear:
-- no máximo uma revisão ATIVA por proposta. É o freio de concorrência por
-- baixo da checagem amigável do trigger.
create index if not exists idx_orcamentos_versao_de
    on public.orcamentos (tenant_id, versao_de) where versao_de is not null;
create unique index if not exists orcamentos_revisao_ativa_uk
    on public.orcamentos (tenant_id, versao_de) where versao_de is not null and deleted_at is null;

comment on column public.orcamentos.versao_de is 'Proposta que esta revisão substitui (mesmo tenant, FK composta). Preenchida por nova_versao_orcamento(); imutável pela API.';
comment on column public.orcamentos.revisao is '1 na proposta original; versão anterior + 1 em cada revisão. Calculada pelo banco.';
comment on column public.orcamentos.numero_original is 'Número da primeira proposta da cadeia de revisões ("Revisão 3 de 2026-0003"). Calculado pelo banco; nulo na original.';

-- ---------------------------------------------------------------------
-- 2. TRAVA DO CABEÇALHO, TRANSIÇÕES E VÍNCULO DE VERSÃO
-- Roda DEPOIS de trg_orcamentos_1_numerar e trg_orcamentos_2_preparar
-- (ordem alfabética), então as regras da 13 respondem primeiro (tenant,
-- criador, número, negócio, lixeira 55000) e os totais já estão
-- recalculados quando a comparação acontece.
-- SECURITY INVOKER: as consultas daqui passam pela RLS do usuário.
-- ---------------------------------------------------------------------
create or replace function public.fn_orcamentos_travar()
returns trigger
language plpgsql
set search_path = public
as $$
declare
    v_api boolean := public.requisicao_api_publica();
    -- Colunas que o banco mantém mesmo com a proposta travada. Qualquer
    -- outra coluna (inclusive as que vierem a ser criadas) fica travada.
    v_tecnicas constant text[] := array[
        'status', 'enviado_em', 'decidido_em', 'updated_at', 'updated_by',
        'deleted_at', 'deleted_by', 'subtotal', 'desconto_total', 'total'
    ];
    v_finais constant text[] := array['aceito', 'recusado', 'expirado', 'substituido'];
    v_anterior record;
    v_tem_anterior boolean := false;
    v_outra record;
    v_rotulo_de text;
    v_rotulo_para text;
begin
    if tg_op = 'INSERT' then
        -- Revisão e número original sempre do banco (o que vier do cliente é ignorado).
        new.revisao := 1;
        new.numero_original := null;
        if new.versao_de is not null then
            select o.id, o.negocio_id, o.status, o.revisao, o.numero, o.numero_original, o.deleted_at
            into v_anterior
            from public.orcamentos o
            where o.id = new.versao_de and o.tenant_id = new.tenant_id;
            v_tem_anterior := found;
            -- Não encontrada: outro tenant ou inexistente — a FK composta recusa (23503).
            if v_tem_anterior then
                new.revisao := v_anterior.revisao + 1;
                new.numero_original := coalesce(v_anterior.numero_original, v_anterior.numero);
            end if;
        end if;

        if not v_api then
            return new;
        end if;

        if new.status is distinct from 'rascunho' then
            raise exception 'Orçamento novo nasce como rascunho: salve e depois marque como enviado.'
                using errcode = '42501';
        end if;

        if v_tem_anterior then
            if v_anterior.deleted_at is not null then
                raise exception 'Proposta excluída: restaure-a antes de criar uma nova versão.' using errcode = '55000';
            end if;
            if v_anterior.status = 'rascunho' then
                raise exception 'Rascunho ainda pode ser editado: não precisa de nova versão.' using errcode = '55000';
            end if;
            if v_anterior.status = 'substituido' then
                raise exception 'Esta proposta já foi substituída por uma revisão mais nova: crie a nova versão a partir da mais recente.'
                    using errcode = '55000';
            end if;
            if new.negocio_id is distinct from v_anterior.negocio_id then
                raise exception 'A nova versão fica no mesmo negócio da proposta original.' using errcode = '42501';
            end if;
            select o.numero, o.revisao into v_outra
            from public.orcamentos o
            where o.tenant_id = new.tenant_id and o.versao_de = new.versao_de and o.deleted_at is null
            limit 1;
            if found then
                raise exception 'Esta proposta já tem a revisão % (%): continue por ela.', v_outra.revisao, v_outra.numero
                    using errcode = '55000';
            end if;
        end if;
        return new;
    end if;

    -- UPDATE ------------------------------------------------------------
    if not v_api then
        return new;
    end if;

    if new.versao_de is distinct from old.versao_de
       or new.revisao is distinct from old.revisao
       or new.numero_original is distinct from old.numero_original then
        raise exception 'O vínculo entre as versões da proposta não pode ser alterado.' using errcode = '42501';
    end if;

    -- Restaurar uma revisão quando outra revisão da mesma proposta já está
    -- ativa quebraria a cadeia linear: avisa antes do índice único.
    if old.deleted_at is not null and new.deleted_at is null and new.versao_de is not null then
        select o.numero, o.revisao into v_outra
        from public.orcamentos o
        where o.tenant_id = new.tenant_id and o.versao_de = new.versao_de
          and o.deleted_at is null and o.id <> new.id
        limit 1;
        if found then
            raise exception 'Já existe a revisão % (%) ativa desta proposta: exclua-a antes de restaurar esta.', v_outra.revisao, v_outra.numero
                using errcode = '55000';
        end if;
    end if;

    -- Transições. Status fora da lista não é tratado aqui: o CHECK da
    -- tabela responde (23514), como antes.
    if new.status is distinct from old.status
       and new.status in ('rascunho', 'enviado', 'aceito', 'recusado', 'expirado', 'substituido') then
        if new.status = 'substituido' then
            if old.status not in ('enviado', 'expirado')
               or not exists (
                   select 1 from public.orcamentos s
                   where s.tenant_id = old.tenant_id and s.versao_de = old.id
                     and s.status <> 'rascunho' and s.deleted_at is null
               ) then
                raise exception 'Só uma revisão já enviada substitui a proposta: use “Nova versão” e envie a revisão.'
                    using errcode = '42501';
            end if;
        elsif not (
            (old.status = 'rascunho' and new.status = 'enviado')
            or (old.status = 'enviado' and new.status in ('aceito', 'recusado', 'expirado'))
        ) then
            v_rotulo_de := case old.status
                when 'rascunho' then 'Rascunho' when 'enviado' then 'Enviado' when 'aceito' then 'Aceito'
                when 'recusado' then 'Recusado' when 'expirado' then 'Expirado' when 'substituido' then 'Substituído'
                else old.status end;
            v_rotulo_para := case new.status
                when 'rascunho' then 'Rascunho' when 'enviado' then 'Enviado' when 'aceito' then 'Aceito'
                when 'recusado' then 'Recusado' when 'expirado' then 'Expirado' when 'substituido' then 'Substituído'
                else new.status end;
            if old.status = any (v_finais) then
                raise exception 'Proposta "%" é final: o status não muda mais. Use “Nova versão” para revisar.', v_rotulo_de
                    using errcode = '42501';
            elsif old.status = 'rascunho' then
                raise exception 'Mudança de status não permitida: de "%" para "%". Marque a proposta como enviada primeiro.', v_rotulo_de, v_rotulo_para
                    using errcode = '42501';
            else
                raise exception 'Mudança de status não permitida: de "%" para "%". Para revisar, use “Nova versão”.', v_rotulo_de, v_rotulo_para
                    using errcode = '42501';
            end if;
        end if;
    end if;

    -- A trava: fora do rascunho, só as colunas técnicas mudam.
    if old.status <> 'rascunho'
       and (to_jsonb(new) - v_tecnicas) is distinct from (to_jsonb(old) - v_tecnicas) then
        raise exception 'Proposta já enviada não pode ser alterada. Use “Nova versão” para revisar.'
            using errcode = '42501';
    end if;

    return new;
end;
$$;

comment on function public.fn_orcamentos_travar() is 'Só rascunho é editável; transições de status válidas; vínculo de versão calculado e imutável. Isento em contexto administrativo. Migration 14.';

-- ---------------------------------------------------------------------
-- 3. TRAVA DOS ITENS
-- Roda depois de trg_orcamento_itens_1_preparar (tenant imutável e
-- lixeira 55000 respondem primeiro). No DELETE, se o orçamento pai não
-- existe mais é o DELETE em cascata do gerente: libera. Pai invisível
-- (outro tenant) num INSERT também passa daqui: a FK composta recusa.
-- ---------------------------------------------------------------------
create or replace function public.fn_orcamento_itens_travar()
returns trigger
language plpgsql
set search_path = public
as $$
declare
    v_orcamento_id uuid;
    v_status text;
begin
    if tg_op = 'DELETE' then
        v_orcamento_id := old.orcamento_id;
    else
        v_orcamento_id := new.orcamento_id;
    end if;

    -- FOR NO KEY UPDATE: o mesmo lock que o recálculo do total pega logo
    -- depois. Sem ele, um item gravado no exato momento em que outra sessão
    -- marca a proposta como enviada entraria depois do envio (a leitura
    -- veria o rascunho antigo). Com ele, quem chega depois espera e lê o
    -- status já confirmado; e dois itens simultâneos na mesma proposta se
    -- enfileiram em vez de travar um ao outro (deadlock).
    if public.requisicao_api_publica() then
        select o.status into v_status
        from public.orcamentos o
        where o.id = v_orcamento_id
        for no key update;
    end if;

    if v_status is not null and v_status <> 'rascunho' then
        raise exception 'Proposta já enviada não pode ser alterada. Use “Nova versão” para revisar.'
            using errcode = '42501';
    end if;

    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;

comment on function public.fn_orcamento_itens_travar() is 'Itens só mudam em orçamento rascunho. DELETE em cascata (pai já apagado) liberado. Isento em contexto administrativo. Migration 14.';

-- ---------------------------------------------------------------------
-- 4. REVISÃO ENVIADA SUBSTITUI A ANTERIOR
-- Quando uma revisão passa de rascunho para enviado, a versão anterior
-- (se ainda estiver enviada ou expirada) vira "substituido". Roda como o
-- usuário (RLS e triggers dele); o trigger de trava da anterior confere
-- que a revisão enviada existe.
-- ---------------------------------------------------------------------
create or replace function public.fn_orcamentos_substituir_anterior()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    update public.orcamentos
    set status = 'substituido'
    where id = new.versao_de
      and tenant_id = new.tenant_id
      and status in ('enviado', 'expirado')
      and deleted_at is null;
    return null;
end;
$$;

comment on function public.fn_orcamentos_substituir_anterior() is 'Revisão enviada marca a versão anterior (enviada/expirada) como substituída. Migration 14.';

drop trigger if exists trg_orcamentos_3_travar on public.orcamentos;
create trigger trg_orcamentos_3_travar
    before insert or update on public.orcamentos
    for each row execute function public.fn_orcamentos_travar();

drop trigger if exists trg_orcamento_itens_2_travar on public.orcamento_itens;
create trigger trg_orcamento_itens_2_travar
    before insert or update or delete on public.orcamento_itens
    for each row execute function public.fn_orcamento_itens_travar();

drop trigger if exists trg_orcamentos_9_substituir_anterior on public.orcamentos;
create trigger trg_orcamentos_9_substituir_anterior
    after update on public.orcamentos
    for each row
    when (new.versao_de is not null and old.status = 'rascunho' and new.status = 'enviado')
    execute function public.fn_orcamentos_substituir_anterior();

-- ---------------------------------------------------------------------
-- 5. NOVA VERSÃO
-- SECURITY INVOKER: vale a RLS e os triggers do usuário (numeração,
-- tenant do servidor, trava, FK composta). Não abre nada que a API já não
-- permitisse; só faz numa transação o que levaria 2+ requisições.
-- ---------------------------------------------------------------------
create or replace function public.nova_versao_orcamento(p_orcamento_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_orig public.orcamentos%rowtype;
    v_existente record;
    v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
    v_id uuid;
begin
    if auth.uid() is null then
        raise exception 'Sessão expirada: entre novamente.' using errcode = '42501';
    end if;
    if p_orcamento_id is null then
        raise exception 'Informe o orçamento.' using errcode = '22023';
    end if;

    -- Trava a original até o fim da transação: duas "Nova versão"
    -- simultâneas na mesma proposta viram uma só (a segunda vê a primeira).
    select * into v_orig
    from public.orcamentos
    where id = p_orcamento_id
    for update;
    if not found then
        raise exception 'Orçamento não encontrado.' using errcode = 'P0002';
    end if;

    if v_orig.deleted_at is not null then
        raise exception 'Proposta excluída: restaure-a antes de criar uma nova versão.' using errcode = '55000';
    end if;
    if v_orig.status = 'rascunho' then
        raise exception 'Rascunho ainda pode ser editado: não precisa de nova versão.' using errcode = '55000';
    end if;
    if v_orig.status = 'substituido' then
        raise exception 'Esta proposta já foi substituída por uma revisão mais nova: crie a nova versão a partir da mais recente.'
            using errcode = '55000';
    end if;

    -- Já existe revisão ativa: rascunho é devolvido (clique duplo não gasta
    -- número); revisão já enviada é o caminho a seguir.
    select o.id, o.numero, o.revisao, o.status into v_existente
    from public.orcamentos o
    where o.tenant_id = v_orig.tenant_id and o.versao_de = v_orig.id and o.deleted_at is null
    limit 1;
    if found then
        if v_existente.status = 'rascunho' then
            return v_existente.id;
        end if;
        raise exception 'Esta proposta já tem a revisão % (%): crie a nova versão a partir dela.', v_existente.revisao, v_existente.numero
            using errcode = '55000';
    end if;

    -- Cabeçalho: mesmo conteúdo, emitida hoje, mesma janela de validade.
    insert into public.orcamentos (
        negocio_id, titulo, status, data_emissao, valido_ate, desconto_tipo, desconto_valor,
        condicoes_pagamento, observacoes, responsavel_id, responsavel_nome, responsavel_email,
        responsavel_telefone, versao_de
    ) values (
        v_orig.negocio_id, v_orig.titulo, 'rascunho', v_hoje,
        v_hoje + greatest(v_orig.valido_ate - v_orig.data_emissao, 0),
        v_orig.desconto_tipo, v_orig.desconto_valor, v_orig.condicoes_pagamento, v_orig.observacoes,
        v_orig.responsavel_id, v_orig.responsavel_nome, v_orig.responsavel_email,
        v_orig.responsavel_telefone, v_orig.id
    )
    returning id into v_id;

    insert into public.orcamento_itens (
        orcamento_id, produto_id, descricao, detalhes, unidade, quantidade,
        valor_unitario, desconto_tipo, desconto_valor, ordem
    )
    select v_id, i.produto_id, i.descricao, i.detalhes, i.unidade, i.quantidade,
           i.valor_unitario, i.desconto_tipo, i.desconto_valor, i.ordem
    from public.orcamento_itens i
    where i.orcamento_id = v_orig.id
    order by i.ordem, i.created_at;

    return v_id;
end;
$$;

comment on function public.nova_versao_orcamento(uuid) is 'Cria a revisão (rascunho, número novo) de uma proposta enviada/decidida/expirada, copiando cabeçalho e itens. SECURITY INVOKER. Migration 14.';

-- ---------------------------------------------------------------------
-- 6. PRIVILÉGIOS — trigger dispara sem EXECUTE do usuário; a RPC só para
-- authenticated.
-- ---------------------------------------------------------------------
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
              'fn_orcamentos_travar', 'fn_orcamento_itens_travar',
              'fn_orcamentos_substituir_anterior', 'nova_versao_orcamento'
          )
    loop
        execute format('revoke execute on function %s from public', r.fn);
        if v_anon then
            execute format('revoke execute on function %s from anon', r.fn);
        end if;
        if v_auth then
            if r.nome = 'nova_versao_orcamento' then
                execute format('grant execute on function %s to authenticated', r.fn);
            else
                execute format('revoke execute on function %s from authenticated', r.fn);
            end if;
        end if;
    end loop;
end $$;

comment on table public.orcamentos is 'Orçamento/proposta ligado a negocios. Número por tenant e ano (fn_orcamentos_numerar). Totais recalculados no banco. Só rascunho é editável; transições e versões na migration 14. Soft delete: criador ou gerente/admin; DELETE físico: gerente/admin.';
