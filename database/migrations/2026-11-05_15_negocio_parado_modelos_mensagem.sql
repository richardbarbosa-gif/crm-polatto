-- =====================================================================
-- CRM POLATTO — MIGRATION 15: SAÚDE DO FUNIL E MODELOS DE MENSAGEM
--
-- Pacote "ultra profissional" (itens 1 a 4, aprovado pelo Richard):
--
--   1. Negócio parado (rotting, como no Pipedrive)
--      - pipeline_stages.dias_para_parado (nulo = etapa não monitorada).
--        Defaults sensatos SÓ na primeira execução (quando a coluna nasce)
--        e para etapas novas (default da coluna). Reexecutar nunca
--        sobrescreve o que o gerente configurou.
--      - tarefas.concluido_em (carimbado por trigger ao concluir).
--      - view vw_negocios_saude (security_invoker): última atividade,
--        dias parado, próxima tarefa e "sem próximo passo", calculados no
--        banco, por negócio, sem baixar tudo para o navegador.
--   2. Sem próximo passo: mesma view (negócio aberto sem tarefa aberta).
--   3. Temperatura: toda mudança vai para a timeline do lead (trigger em
--      negocios, vale para tela, importação e API) + ordem de temperatura
--      na view (quente > morno > frio) para o Kanban ordenar no servidor.
--   4. modelos_mensagem (WhatsApp/e-mail) por tenant: leitura para o
--      tenant, escrita só gerente (RLS). 3 modelos padrão em PT-BR por
--      tenant, inclusive os já existentes, uma única vez por tenant
--      (crm_seeds_aplicados): se o gerente apagar um modelo padrão, ele
--      não volta quando a migration roda de novo.
--
-- Isolamento: tenant_id preenchido no servidor (fn_set_tenant_id) e
-- imutável, RLS com tenant_filter() e WITH CHECK, nada para anon, view
-- com security_invoker. SECURITY DEFINER só no trigger da timeline e no
-- provisionamento (search_path fixo, sem EXECUTE para a API).
--
-- Testes: database/tests/10_teste_saude_modelos.sql (Suíte 10).
-- IDEMPOTENTE. ORDEM: depois da 13 (rodar de novo após reexecutar a 01).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. PRÉ-REQUISITOS
-- ---------------------------------------------------------------------
do $$
begin
    if to_regprocedure('public.fn_set_tenant_id()') is null
       or to_regprocedure('public.tenant_filter(uuid)') is null
       or to_regprocedure('public.eh_admin_do_tenant(uuid)') is null
       or to_regprocedure('public.requisicao_api_publica()') is null
       or to_regprocedure('public.tem_coluna(text,text)') is null
       or to_regclass('public.negocios') is null
       or to_regclass('public.pipeline_stages') is null
       or to_regclass('public.tarefas') is null
       or to_regclass('public.atividades_lead') is null then
        raise exception 'Migration 15 exige as migrations 00 a 13 aplicadas antes.';
    end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. PRAZO DE "PARADO" POR ETAPA
-- ---------------------------------------------------------------------
do $$
begin
    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'pipeline_stages' and column_name = 'dias_para_parado'
    ) then
        alter table public.pipeline_stages add column dias_para_parado integer;

        -- Primeira execução: prazo sugerido pelo nome da etapa. Etapas de
        -- ganho/perda ficam nulas (nunca ficam paradas).
        update public.pipeline_stages ps
        set dias_para_parado = case
            when lower(coalesce(ps.nome, '')) ~ '(novo|entrada|lead)' then 3
            when lower(coalesce(ps.nome, '')) ~ '(contato|qualifica)' then 5
            when lower(coalesce(ps.nome, '')) ~ '(visita|proposta|orcamento|orçamento)' then 7
            when lower(coalesce(ps.nome, '')) ~ '(negocia|contrato)' then 10
            else 14
        end
        where coalesce(ps.ganho, false) = false
          and coalesce(ps.perdido, false) = false
          and lower(coalesce(ps.nome, '')) !~ '(fechad|ganh|perdid)';
    end if;
end $$;

-- Etapa criada sem informar o prazo nasce monitorada (7 dias). Quem envia
-- null explicitamente (gerente desligou o alerta) fica com null.
alter table public.pipeline_stages alter column dias_para_parado set default 7;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'pipeline_stages_dias_para_parado_ck' and conrelid = 'public.pipeline_stages'::regclass
    ) then
        alter table public.pipeline_stages
            add constraint pipeline_stages_dias_para_parado_ck
            check (dias_para_parado is null or dias_para_parado between 1 and 365) not valid;
        begin
            alter table public.pipeline_stages validate constraint pipeline_stages_dias_para_parado_ck;
        exception when others then
            raise warning 'dias_para_parado fora de 1..365 em linhas antigas: corrigir e validar depois (%).', sqlerrm;
        end;
    end if;
end $$;

comment on column public.pipeline_stages.dias_para_parado is
    'Dias sem atividade até o negócio desta etapa ser considerado PARADO. Nulo = não monitora. Etapas de ganho/perda nunca ficam paradas.';

-- ---------------------------------------------------------------------
-- 2. QUANDO A TAREFA FOI CONCLUÍDA
-- ---------------------------------------------------------------------
alter table public.tarefas add column if not exists concluido_em timestamptz;

create or replace function public.fn_tarefas_concluido_em()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if coalesce(new.concluido, false) then
        if tg_op = 'INSERT' or not coalesce(old.concluido, false) then
            new.concluido_em := coalesce(new.concluido_em, now());
        end if;
    else
        new.concluido_em := null;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_tarefas_concluido_em on public.tarefas;
create trigger trg_tarefas_concluido_em
    before insert or update of concluido on public.tarefas
    for each row execute function public.fn_tarefas_concluido_em();

-- Colunas que a view lê na timeline (bases antigas acumularam variações)
alter table public.atividades_lead add column if not exists cliente_id text;
alter table public.atividades_lead add column if not exists tipo text;
alter table public.atividades_lead add column if not exists activity_type text;
alter table public.atividades_lead add column if not exists created_at timestamptz default now();

-- Índices das subconsultas da view (por negócio, só linhas vivas)
create index if not exists idx_tarefas_negocio
    on public.tarefas (tenant_id, cliente_id)
    where deleted_at is null;
create index if not exists idx_tarefas_negocio_abertas
    on public.tarefas (tenant_id, cliente_id, data_vencimento)
    where deleted_at is null and concluido is not true;
create index if not exists idx_atividades_lead_negocio
    on public.atividades_lead (tenant_id, cliente_id, created_at desc);
create index if not exists idx_negocios_temperatura
    on public.negocios (tenant_id, stage_id, temperatura)
    where deleted_at is null;

-- ---------------------------------------------------------------------
-- 3. VIEW DE SAÚDE DO NEGÓCIO
-- Uma linha por negócio vivo, com os campos do card do Kanban (mesmos
-- nomes da view clientes) e os indicadores calculados no banco:
--   ultima_atividade_em  mais recente entre: criação/edição do negócio
--                        (mudança de etapa e de temperatura incluídas),
--                        tarefa criada ou concluída e registro na timeline
--   ultimo_contato_em    tarefa concluída ou nota/ligação na timeline
--                        (mudanças automáticas não contam como contato)
--   parado               aberto, etapa monitorada e sem atividade há mais
--                        de dias_para_parado dias
--   sem_proximo_passo    aberto e sem tarefa aberta (atrasada conta como
--                        próximo passo: aparece em vermelho no card)
-- security_invoker: a RLS de negocios/tarefas/timeline do usuário vale.
-- DROP + CREATE: a 16 acrescenta colunas; reexecutar a 15 depois da 16
-- recria esta versão e a 16 (que sempre roda depois) recria a dela.
-- ---------------------------------------------------------------------
drop view if exists public.vw_negocios_saude;
create view public.vw_negocios_saude
with (security_invoker = on)
as
select
    n.id,
    n.tenant_id,
    coalesce(p.nome, o.nome_fantasia, o.razao_social, n.titulo) as nome,
    n.titulo,
    p.telefone,
    coalesce(p.ddi, '+55') as ddi,
    p.email,
    n.dados_extras ->> 'endereco_instalacao' as endereco_instalacao,
    public.to_numeric_seguro(n.dados_extras ->> 'conta_energia_media') as conta_energia_media,
    n.valor,
    n.status,
    n.stage_id,
    n.pipeline_id,
    ps.nome as etapa_nome,
    n.temperatura,
    case lower(btrim(coalesce(n.temperatura, '')))
        when 'quente' then 3
        when 'morno' then 2
        when 'frio' then 1
        else 0
    end as temperatura_ordem,
    n.responsavel,
    n.responsavel_id,
    n.motivo_perda,
    n.created_by,
    n.created_at,
    n.updated_at,
    calc.aberto,
    calc.ultima_atividade_em,
    calc.ultimo_contato_em,
    floor(extract(epoch from (now() - calc.ultima_atividade_em)) / 86400)::integer as dias_sem_atividade,
    floor(extract(epoch from (now() - calc.ultimo_contato_em)) / 86400)::integer as dias_sem_contato,
    case when calc.aberto then ps.dias_para_parado end as dias_para_parado,
    (
        calc.aberto
        and ps.dias_para_parado is not null
        and calc.ultima_atividade_em < now() - make_interval(days => ps.dias_para_parado)
    ) as parado,
    prox.data_vencimento as proxima_tarefa_em,
    prox.titulo as proxima_tarefa_titulo,
    prox.tipo as proxima_tarefa_tipo,
    (prox.data_vencimento is not null and prox.data_vencimento < now()) as proxima_tarefa_atrasada,
    (calc.aberto and prox.tem_tarefa is null) as sem_proximo_passo
from public.negocios n
left join public.pessoas p on p.id = n.pessoa_contato_principal_id
left join public.organizacoes o on o.id = n.organizacao_id
left join public.pipeline_stages ps on ps.id = n.stage_id
left join lateral (
    select
        max(greatest(t.created_at, t.concluido_em)) as ultima_tarefa_em,
        max(coalesce(t.concluido_em, t.created_at)) filter (where t.concluido is true) as ultima_conclusao_em
    from public.tarefas t
    where t.tenant_id = n.tenant_id
      and t.cliente_id = n.id::text
      and t.deleted_at is null
) tt on true
left join lateral (
    select
        max(a.created_at) as ultimo_registro_em,
        max(a.created_at) filter (
            where lower(coalesce(a.tipo, a.activity_type, '')) not in ('status', 'temperatura', 'perda', 'upload', 'arquivo')
        ) as ultimo_contato_registro_em
    from public.atividades_lead a
    where a.tenant_id = n.tenant_id
      and a.cliente_id = n.id::text
) aa on true
left join lateral (
    select true as tem_tarefa, t.data_vencimento, t.titulo, t.tipo
    from public.tarefas t
    where t.tenant_id = n.tenant_id
      and t.cliente_id = n.id::text
      and t.deleted_at is null
      and t.concluido is not true
    order by t.data_vencimento asc nulls last, t.id asc
    limit 1
) prox on true
cross join lateral (
    select
        not (
            coalesce(ps.ganho, false)
            or coalesce(ps.perdido, false)
            or lower(coalesce(ps.nome, n.status, '')) ~ '(fechad|ganh|perdid)'
        ) as aberto,
        greatest(n.created_at, n.updated_at, tt.ultima_tarefa_em, aa.ultimo_registro_em) as ultima_atividade_em,
        greatest(n.created_at, tt.ultima_conclusao_em, aa.ultimo_contato_registro_em) as ultimo_contato_em
) calc
where n.deleted_at is null;

comment on view public.vw_negocios_saude is
    'Saúde de cada negócio vivo (parado, sem próximo passo, última atividade/contato, ordem de temperatura). security_invoker: respeita a RLS do usuário.';

do $$
begin
    revoke all on public.vw_negocios_saude from public;
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on public.vw_negocios_saude from anon;
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
        revoke all on public.vw_negocios_saude from authenticated;
        grant select on public.vw_negocios_saude to authenticated;
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
        grant select on public.vw_negocios_saude to service_role;
    end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. TEMPERATURA NA TIMELINE ("Morno → Quente, por Fulano")
-- Trigger no banco: vale para o drawer do lead, a edição, a importação e
-- a API direta. SECURITY DEFINER pelo mesmo motivo da timeline de etapa
-- (migration 04): grava em atividades_lead e lê o nome do funcionário.
-- Nunca impede a gravação do negócio.
-- ---------------------------------------------------------------------
create or replace function public.rotulo_temperatura(p_valor text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
    select case lower(btrim(coalesce(p_valor, '')))
        when 'quente' then 'Quente'
        when 'morno' then 'Morno'
        when 'frio' then 'Frio'
        when '' then 'Sem temperatura'
        else initcap(btrim(p_valor))
    end;
$$;

create or replace function public.fn_registrar_mudanca_temperatura()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_de text := public.rotulo_temperatura(old.temperatura);
    v_para text := public.rotulo_temperatura(new.temperatura);
    v_autor text;
    v_titulo text;
    v_descricao text;
    v_payload jsonb;
    v_cols text;
    v_vals text;
begin
    if old.temperatura is not distinct from new.temperatura or v_de = v_para then
        return new;
    end if;

    select f.nome into v_autor
    from public.funcionarios f
    where auth.uid() is not null
      and (f.user_id = auth.uid() or f.id = auth.uid())
      and f.deleted_at is null
    order by (f.tenant_id = new.tenant_id) desc nulls last
    limit 1;
    v_autor := coalesce(nullif(btrim(v_autor), ''), nullif(auth.jwt() ->> 'email', ''), 'sistema');

    v_titulo := format('Temperatura: %s → %s', v_de, v_para);
    v_descricao := format('%s → %s, por %s', v_de, v_para, v_autor);

    v_payload := jsonb_strip_nulls(jsonb_build_object(
        'cliente_id',    new.id::text,
        'tenant_id',     new.tenant_id::text,
        'activity_type', 'temperatura',
        'tipo',          'temperatura',
        'titulo',        v_titulo,
        'title',         v_titulo,
        'descricao',     v_descricao,
        'notes',         v_descricao,
        'criado_por',    v_autor,
        'author',        v_autor
    ));

    select string_agg(quote_ident(k), ', '), string_agg(quote_literal(v), ', ')
    into v_cols, v_vals
    from jsonb_each_text(v_payload) as e(k, v)
    where public.tem_coluna('atividades_lead', k);

    if v_cols is not null then
        if public.tem_coluna('atividades_lead', 'metadados') then
            v_cols := v_cols || ', metadados';
            v_vals := v_vals || ', ' || quote_literal(jsonb_build_object(
                'de', old.temperatura, 'para', new.temperatura)::text) || '::jsonb';
        end if;
        if public.tem_coluna('atividades_lead', 'data_atividade') then
            v_cols := v_cols || ', data_atividade';
            v_vals := v_vals || ', now()';
        end if;
        execute format('insert into public.atividades_lead (%s) values (%s)', v_cols, v_vals);
    end if;

    return new;
exception when others then
    -- A timeline nunca pode impedir a mudança de temperatura
    raise warning 'Timeline de temperatura não registrada: %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists registrar_mudanca_temperatura on public.negocios;
create trigger registrar_mudanca_temperatura
    after update of temperatura on public.negocios
    for each row
    when (old.temperatura is distinct from new.temperatura)
    execute function public.fn_registrar_mudanca_temperatura();

-- ---------------------------------------------------------------------
-- 5. MODELOS DE MENSAGEM (WhatsApp / e-mail)
-- ---------------------------------------------------------------------
create table if not exists public.modelos_mensagem (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    nome text not null,
    canal text not null default 'whatsapp',
    assunto text,
    texto text not null,
    ativo boolean not null default true,
    ordem integer not null default 1,
    padrao boolean not null default false,
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
            ('modelos_mensagem_canal_ck', $c$check (canal in ('whatsapp', 'email'))$c$),
            ('modelos_mensagem_nome_ck', $c$check (length(btrim(nome)) between 1 and 80)$c$),
            ('modelos_mensagem_texto_ck', $c$check (length(btrim(texto)) between 1 and 4000)$c$),
            ('modelos_mensagem_assunto_ck', $c$check (assunto is null or length(assunto) <= 200)$c$),
            ('modelos_mensagem_ordem_ck', $c$check (ordem between 0 and 9999)$c$),
            ('modelos_mensagem_nome_uk', 'unique (tenant_id, canal, nome)')
        ) as t(nome, definicao)
    loop
        if not exists (
            select 1 from pg_constraint
            where conname = r.nome and conrelid = 'public.modelos_mensagem'::regclass
        ) then
            execute format('alter table public.modelos_mensagem add constraint %I %s', r.nome, r.definicao);
        end if;
    end loop;
end $$;

create index if not exists idx_modelos_mensagem_tenant
    on public.modelos_mensagem (tenant_id, canal, ordem);

-- tenant_id imutável e updated_at do servidor (padrão da migration 13)
create or replace function public.fn_proteger_tenant_e_carimbar()
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

drop trigger if exists set_tenant_id on public.modelos_mensagem;
create trigger set_tenant_id
    before insert on public.modelos_mensagem
    for each row execute function public.fn_set_tenant_id();

drop trigger if exists trg_proteger_tenant on public.modelos_mensagem;
create trigger trg_proteger_tenant
    before update on public.modelos_mensagem
    for each row execute function public.fn_proteger_tenant_e_carimbar();

do $$
begin
    if to_regprocedure('public.fn_audit_trigger()') is not null then
        drop trigger if exists audit_changes on public.modelos_mensagem;
        create trigger audit_changes
            after insert or update or delete on public.modelos_mensagem
            for each row execute function public.fn_audit_trigger();
    end if;
end $$;

alter table public.modelos_mensagem enable row level security;

drop policy if exists modelos_mensagem_leitura on public.modelos_mensagem;
create policy modelos_mensagem_leitura on public.modelos_mensagem
    for select to authenticated
    using (public.tenant_filter(tenant_id));

drop policy if exists modelos_mensagem_escrita_gerente on public.modelos_mensagem;
create policy modelos_mensagem_escrita_gerente on public.modelos_mensagem
    for all to authenticated
    using (public.tenant_filter(tenant_id) and public.eh_admin_do_tenant(tenant_id))
    with check (public.tenant_filter(tenant_id) and public.eh_admin_do_tenant(tenant_id));

comment on table public.modelos_mensagem is
    'Modelos de mensagem (WhatsApp/e-mail) com variáveis {nome}, {primeiro_nome}, {empresa}, {vendedor}, {valor}, {proposta_numero}, {validade}. Leitura: tenant; escrita: gerente.';

-- ---------------------------------------------------------------------
-- 6. SEEDS POR TENANT — uma única vez por tenant e por pacote
-- ---------------------------------------------------------------------
create table if not exists public.crm_seeds_aplicados (
    tenant_id uuid not null,
    chave text not null,
    aplicado_em timestamptz not null default now(),
    primary key (tenant_id, chave)
);

-- Sem policy: só as funções de provisionamento (SECURITY DEFINER) usam.
alter table public.crm_seeds_aplicados enable row level security;

create or replace function public.provisionar_modelos_mensagem(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if p_tenant_id is null then
        return;
    end if;

    -- Marca primeiro; se já estava marcado, não semeia de novo.
    insert into public.crm_seeds_aplicados (tenant_id, chave)
    values (p_tenant_id, 'modelos_mensagem_v1')
    on conflict do nothing;
    if not found then
        return;
    end if;

    insert into public.modelos_mensagem (tenant_id, nome, canal, assunto, texto, ordem, padrao)
    select p_tenant_id, m.nome, m.canal, m.assunto, m.texto, m.ordem, true
    from (values
        (
            'Primeiro contato', 'whatsapp', null::text,
            'Olá, {primeiro_nome}! Aqui é {vendedor}, da {empresa}. Recebemos seu interesse em energia solar '
            || 'e quero montar um projeto sob medida para você. Pode me enviar uma foto da sua última conta de luz? '
            || 'Com ela eu calculo a sua economia e o tamanho ideal do sistema.',
            1
        ),
        (
            'Envio da proposta', 'whatsapp', null::text,
            'Olá, {primeiro_nome}! Segue a proposta {proposta_numero} do seu sistema de energia solar, '
            || 'no valor de {valor}, válida até {validade}. Posso te ligar para mostrar a economia mês a mês '
            || 'e as opções de financiamento?',
            2
        ),
        (
            'Retorno da proposta', 'email', 'Sua proposta de energia solar - {empresa}',
            'Olá, {primeiro_nome},' || chr(10) || chr(10)
            || 'Tudo bem? Passando para saber se você conseguiu analisar a proposta {proposta_numero}, '
            || 'no valor de {valor}, válida até {validade}.' || chr(10) || chr(10)
            || 'Se quiser, marcamos uma conversa rápida para tirar dúvidas sobre economia, financiamento '
            || 'e prazo de instalação.' || chr(10) || chr(10)
            || 'Um abraço,' || chr(10) || '{vendedor}' || chr(10) || '{empresa}',
            3
        )
    ) as m(nome, canal, assunto, texto, ordem)
    where not exists (
        select 1 from public.modelos_mensagem mm
        where mm.tenant_id = p_tenant_id and mm.canal = m.canal and mm.nome = m.nome
    );
end;
$$;

comment on function public.provisionar_modelos_mensagem(uuid) is
    'Semeia os 3 modelos de mensagem padrão do tenant uma única vez (crm_seeds_aplicados). Administrativa: sem EXECUTE para a API.';

-- Gancho único de provisionamento dos pacotes novos (a 16 estende).
create or replace function public.provisionar_defaults_pacote(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.provisionar_modelos_mensagem(p_tenant_id);
end;
$$;

-- provisionar_defaults_tenant (migration 01) + gancho dos pacotes novos.
-- Corpo da 01 preservado; só a última linha é nova. Tenant criado pelo
-- app (provisionar_tenant) já nasce com os modelos.
create or replace function public.provisionar_defaults_tenant(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_pipeline_id uuid;
begin
    -- Pipeline default "Vendas"
    select id into v_pipeline_id
    from public.pipelines
    where tenant_id = p_tenant_id
    order by ordem
    limit 1;

    if v_pipeline_id is null then
        insert into public.pipelines (tenant_id, nome, ordem, ativo)
        values (p_tenant_id, 'Vendas', 1, true)
        returning id into v_pipeline_id;
    end if;

    -- Vincula ao funil default apenas as etapas QUE JÁ SÃO DESTE TENANT.
    update public.pipeline_stages
    set pipeline_id = v_pipeline_id
    where pipeline_id is null
      and tenant_id = p_tenant_id;

    -- Motivos de perda default
    insert into public.motivos_perda (tenant_id, nome, ordem)
    select p_tenant_id, m.nome, m.ordem
    from (values
        ('Preço', 1),
        ('Escolheu concorrente', 2),
        ('Sem orçamento', 3),
        ('Sem resposta / esfriou', 4),
        ('Fora do perfil', 5),
        ('Outro', 6)
    ) as m(nome, ordem)
    where not exists (
        select 1 from public.motivos_perda mp
        where mp.tenant_id = p_tenant_id and mp.nome = m.nome
    );

    -- Tipos de atividade default
    insert into public.tipos_atividade (tenant_id, nome, icone, ordem)
    select p_tenant_id, t.nome, t.icone, t.ordem
    from (values
        ('Ligação', 'phone', 1),
        ('Reunião', 'team', 2),
        ('E-mail', 'mail', 3),
        ('Tarefa', 'check-square', 4),
        ('Visita', 'environment', 5),
        ('Follow-up', 'clock-circle', 6)
    ) as t(nome, icone, ordem)
    where not exists (
        select 1 from public.tipos_atividade ta
        where ta.tenant_id = p_tenant_id and ta.nome = t.nome
    );

    -- Pacotes novos (migrations 15+): modelos de mensagem, canais etc.
    perform public.provisionar_defaults_pacote(p_tenant_id);
end;
$$;

-- Tenants que já existem recebem os modelos agora (uma vez só).
do $$
declare
    r record;
begin
    if to_regclass('public.empresas') is null then
        return;
    end if;
    for r in select e.id from public.empresas e loop
        perform public.provisionar_defaults_pacote(r.id);
    end loop;
end $$;

-- ---------------------------------------------------------------------
-- 7. GRANTS
-- ---------------------------------------------------------------------
do $$
declare
    v_anon boolean := exists (select 1 from pg_roles where rolname = 'anon');
    v_auth boolean := exists (select 1 from pg_roles where rolname = 'authenticated');
    v_service boolean := exists (select 1 from pg_roles where rolname = 'service_role');
    r record;
begin
    revoke all on public.modelos_mensagem from public;
    revoke all on public.crm_seeds_aplicados from public;
    if v_anon then
        revoke all on public.modelos_mensagem from anon;
        revoke all on public.crm_seeds_aplicados from anon;
    end if;
    if v_auth then
        grant select, insert, update, delete on public.modelos_mensagem to authenticated;
        revoke all on public.crm_seeds_aplicados from authenticated;
    end if;
    if v_service then
        grant all on public.modelos_mensagem to service_role;
        grant all on public.crm_seeds_aplicados to service_role;
    end if;

    -- Funções: triggers e provisionamento sem EXECUTE para a API.
    -- rotulo_temperatura é pura (sem dado); fica para authenticated.
    for r in
        select p.oid::regprocedure as fn, p.proname::text as nome
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public'
          and p.proname in (
              'fn_tarefas_concluido_em', 'fn_registrar_mudanca_temperatura', 'fn_proteger_tenant_e_carimbar',
              'provisionar_modelos_mensagem', 'provisionar_defaults_pacote', 'provisionar_defaults_tenant',
              'rotulo_temperatura'
          )
    loop
        execute format('revoke execute on function %s from public', r.fn);
        if v_anon then
            execute format('revoke execute on function %s from anon', r.fn);
        end if;
        if v_auth then
            if r.nome = 'rotulo_temperatura' then
                execute format('grant execute on function %s to authenticated', r.fn);
            else
                execute format('revoke execute on function %s from authenticated', r.fn);
            end if;
        end if;
        if v_service then
            execute format('grant execute on function %s to service_role', r.fn);
        end if;
    end loop;
end $$;
