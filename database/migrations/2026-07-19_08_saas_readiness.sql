-- =====================================================================
-- CRM POLATTO — MIGRATION 08: SAAS READINESS
--
-- Itens da seção 4 do escopo:
--   - Provisionamento automático de tenant (empresa + vínculo do admin +
--     pipeline default + motivos + tipos de atividade + plano inicial)
--   - Onboarding self-service (RPC chamada pelo frontend quando o usuário
--     autenticado ainda não tem vínculo com nenhuma empresa)
--   - Limites por plano (usuários, leads, storage) com enforcement por trigger
--   - View agregada do dashboard (seção 8: paginação/carga)
--
-- IDEMPOTENTE. Executar após 01 e 02.
-- =====================================================================

-- ---------------------------------------------------------------------
-- EMPRESAS (tabela de tenants). Em produção já existe — os add column
-- garantem o contrato mínimo usado pelas funções abaixo.
-- ---------------------------------------------------------------------
create table if not exists public.empresas (
    id uuid primary key default gen_random_uuid(),
    nome text not null,
    segmento text default 'energia_solar',
    created_at timestamptz not null default now()
);

alter table public.empresas add column if not exists nome text;
alter table public.empresas add column if not exists segmento text default 'energia_solar';
alter table public.empresas add column if not exists created_at timestamptz default now();

-- ---------------------------------------------------------------------
-- PLANOS E LIMITES
-- Sem plano vinculado = sem trava (fail-open) para não travar tenants
-- existentes; o enforcement só atua quando o tenant tem plano ativo.
-- ---------------------------------------------------------------------
create table if not exists public.planos (
    id uuid primary key default gen_random_uuid(),
    nome text unique not null,
    max_usuarios integer,           -- null = ilimitado
    max_leads integer,
    max_storage_mb integer,
    preco_mensal numeric(10,2) not null default 0,
    ativo boolean not null default true,
    created_at timestamptz not null default now()
);

create table if not exists public.tenant_planos (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid unique not null,
    plano_id uuid not null references public.planos(id),
    ativo_desde timestamptz not null default now(),
    created_at timestamptz not null default now()
);

insert into public.planos (nome, max_usuarios, max_leads, max_storage_mb, preco_mensal)
select p.nome, p.max_usuarios, p.max_leads, p.max_storage_mb, p.preco
from (values
    ('Starter', 3, 1000, 512, 97.00),
    ('Pro', 10, 10000, 4096, 297.00),
    ('Enterprise', null::integer, null::integer, null::integer, 997.00)
) as p(nome, max_usuarios, max_leads, max_storage_mb, preco)
where not exists (select 1 from public.planos pl where pl.nome = p.nome);

alter table public.planos enable row level security;
drop policy if exists planos_leitura on public.planos;
create policy planos_leitura on public.planos
    for select to authenticated using (true);   -- catálogo público de planos

alter table public.tenant_planos enable row level security;
drop policy if exists tenant_planos_leitura on public.tenant_planos;
create policy tenant_planos_leitura on public.tenant_planos
    for select to authenticated
    using (public.tenant_filter(tenant_id));
-- Escrita de tenant_planos: apenas service_role/superadmin via SQL.

create or replace function public.uso_do_tenant(p_tenant_id uuid)
returns table(recurso text, usado bigint, limite integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_plano record;
begin
    if not public.tenant_filter(p_tenant_id) then
        raise exception 'Sem acesso a este tenant.';
    end if;

    select pl.* into v_plano
    from public.tenant_planos tp
    join public.planos pl on pl.id = tp.plano_id
    where tp.tenant_id = p_tenant_id;

    recurso := 'usuarios';
    select count(*) into usado from public.funcionarios f
    where f.tenant_id = p_tenant_id and coalesce(f.ativo, true) and f.deleted_at is null;
    limite := v_plano.max_usuarios;
    return next;

    recurso := 'leads';
    select count(*) into usado from public.negocios n
    where n.tenant_id = p_tenant_id and n.deleted_at is null;
    limite := v_plano.max_leads;
    return next;

    recurso := 'storage_mb';
    select coalesce(sum(d.tamanho_bytes), 0) / (1024 * 1024) into usado
    from public.documentos_lead d
    where d.tenant_id = p_tenant_id and d.deleted_at is null;
    limite := v_plano.max_storage_mb;
    return next;
end;
$$;

create or replace function public.fn_enforce_limite_leads()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant uuid;
    v_limite integer;
    v_usado bigint;
begin
    -- O tenant pode ainda não estar em new se a ordem de triggers mudar
    v_tenant := coalesce(new.tenant_id, public.current_tenant_id());
    if v_tenant is null then
        return new;
    end if;

    select pl.max_leads into v_limite
    from public.tenant_planos tp
    join public.planos pl on pl.id = tp.plano_id
    where tp.tenant_id = v_tenant;

    if v_limite is null then
        return new; -- sem plano vinculado ou plano ilimitado
    end if;

    select count(*) into v_usado from public.negocios n
    where n.tenant_id = v_tenant and n.deleted_at is null;

    if v_usado >= v_limite then
        raise exception 'Limite de % leads do seu plano foi atingido. Faça upgrade para continuar.', v_limite
            using errcode = 'P0001';
    end if;

    return new;
end;
$$;

-- ATENÇÃO À ORDEM: o Postgres dispara triggers BEFORE em ordem ALFABÉTICA.
-- O prefixo "z_" garante que a checagem de limite rode DEPOIS de
-- set_tenant_id — caso contrário new.tenant_id ainda estaria nulo e o
-- limite do plano nunca seria aplicado.
drop trigger if exists enforce_limite_leads on public.negocios;
drop trigger if exists z_enforce_limite_leads on public.negocios;
create trigger z_enforce_limite_leads
before insert on public.negocios
for each row execute function public.fn_enforce_limite_leads();

create or replace function public.fn_enforce_limite_usuarios()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant uuid;
    v_limite integer;
    v_usado bigint;
begin
    v_tenant := coalesce(new.tenant_id, public.current_tenant_id());
    if v_tenant is null then
        return new;
    end if;

    select pl.max_usuarios into v_limite
    from public.tenant_planos tp
    join public.planos pl on pl.id = tp.plano_id
    where tp.tenant_id = v_tenant;

    if v_limite is null then
        return new;
    end if;

    select count(*) into v_usado from public.funcionarios f
    where f.tenant_id = v_tenant and coalesce(f.ativo, true) and f.deleted_at is null;

    if v_usado >= v_limite then
        raise exception 'Limite de % usuários do seu plano foi atingido. Faça upgrade para continuar.', v_limite
            using errcode = 'P0001';
    end if;

    return new;
end;
$$;

-- Mesmo cuidado com a ordem alfabética dos triggers BEFORE (ver acima)
drop trigger if exists enforce_limite_usuarios on public.funcionarios;
drop trigger if exists z_enforce_limite_usuarios on public.funcionarios;
create trigger z_enforce_limite_usuarios
before insert on public.funcionarios
for each row execute function public.fn_enforce_limite_usuarios();

-- ---------------------------------------------------------------------
-- PROVISIONAMENTO AUTOMÁTICO DE TENANT (onboarding self-service)
-- Chamada pelo frontend quando o usuário autenticado não tem vínculo:
--   select public.provisionar_tenant('Minha Empresa', 'energia_solar');
-- Cria: empresa → vínculo admin do usuário → pipeline/motivos/tipos
-- default → plano Starter. Rate-limited e idempotente por usuário.
-- ---------------------------------------------------------------------
create or replace function public.provisionar_tenant(
    p_nome_empresa text,
    p_segmento text default 'energia_solar'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid;
    v_email text;
    v_tenant uuid;
    v_col text;
    v_role_col text;
    v_nome text;
    v_pipeline_id uuid;
begin
    v_user := auth.uid();
    if v_user is null then
        raise exception 'Usuário não autenticado.';
    end if;

    v_nome := trim(coalesce(p_nome_empresa, ''));
    if v_nome = '' then
        raise exception 'Informe o nome da empresa.';
    end if;

    -- Idempotência: usuário já vinculado não cria outra empresa
    v_tenant := public.current_tenant_id();
    if v_tenant is not null then
        return v_tenant;
    end if;

    perform public.enforce_rate_limit('provisionar_tenant', 3, interval '1 day');

    v_email := coalesce(auth.jwt() ->> 'email', '');

    insert into public.empresas (nome, segmento)
    values (v_nome, coalesce(nullif(trim(p_segmento), ''), 'energia_solar'))
    returning id into v_tenant;

    -- Vínculo do usuário como admin (coluna de tenant detectada dinamicamente)
    select column_name into v_col
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'utilizadores_empresas'
      and column_name in ('empresa_id', 'tenant_id', 'company_id', 'id_empresa')
    order by array_position(array['empresa_id', 'tenant_id', 'company_id', 'id_empresa'], column_name)
    limit 1;

    if v_col is null then
        raise exception 'Tabela utilizadores_empresas sem coluna de tenant reconhecida.';
    end if;

    select column_name into v_role_col
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'utilizadores_empresas'
      and column_name in ('role', 'perfil', 'cargo', 'tipo')
    order by array_position(array['role', 'perfil', 'cargo', 'tipo'], column_name)
    limit 1;

    if v_role_col is null then
        execute format(
            'insert into public.utilizadores_empresas (auth_uid, %I) values ($1, $2)',
            v_col
        ) using v_user, v_tenant;
    else
        execute format(
            'insert into public.utilizadores_empresas (auth_uid, %I, %I) values ($1, $2, $3)',
            v_col, v_role_col
        ) using v_user, v_tenant, 'admin';
    end if;

    -- Primeiro funcionário (admin) do tenant
    if to_regclass('public.funcionarios') is not null then
        begin
            insert into public.funcionarios (user_id, tenant_id, nome, email, cargo, ativo)
            values (
                v_user, v_tenant,
                coalesce(nullif(split_part(v_email, '@', 1), ''), 'Administrador'),
                v_email, 'admin', true
            )
            on conflict (email) do update set tenant_id = excluded.tenant_id;
        exception when others then
            null; -- funcionário é conveniência; o vínculo acima é o que importa
        end;
    end if;

    -- Defaults do CRM (pipeline Vendas, etapas, motivos, tipos de atividade)
    perform public.provisionar_defaults_tenant(v_tenant);

    -- Etapas default do pipeline (se o tenant não herdou nenhuma).
    -- O pipeline alvo é resolvido explicitamente: um cross join com LIMIT
    -- daria resultado dependente da ordenação se houvesse mais de um funil.
    if not exists (
        select 1 from public.pipeline_stages ps where ps.tenant_id = v_tenant
    ) then
        select id into v_pipeline_id
        from public.pipelines
        where tenant_id = v_tenant
        order by ordem, created_at
        limit 1;

        if v_pipeline_id is not null then
            insert into public.pipeline_stages (tenant_id, pipeline_id, nome, cor, ordem, probabilidade, ganho, perdido)
            select v_tenant, v_pipeline_id, s.nome, s.cor, s.ordem, s.prob, s.ganho, s.perdido
            from (values
                     ('Novo Lead', '#5d9cec', 1, 10, false, false),
                     ('Contato Feito', '#8b5cf6', 2, 25, false, false),
                     ('Proposta Enviada', '#ed8936', 3, 50, false, false),
                     ('Em Negociação', '#3182ce', 4, 70, false, false),
                     ('Fechado', '#82cf6e', 5, 100, true, false),
                     ('Perdido', '#f56565', 6, 0, false, true)
                 ) as s(nome, cor, ordem, prob, ganho, perdido);
        end if;
    end if;

    -- Plano inicial: Starter
    insert into public.tenant_planos (tenant_id, plano_id)
    select v_tenant, pl.id from public.planos pl where pl.nome = 'Starter'
    on conflict (tenant_id) do nothing;

    return v_tenant;
end;
$$;

-- ---------------------------------------------------------------------
-- VIEWS AGREGADAS DE KPI (seção 8 — evita carregar todos os leads)
--
-- vw_kanban_kpis é a view CANÔNICA: é o nome que o frontend consome em
-- src/pages/clientes/list.tsx. Antes a migration criava apenas
-- vw_dashboard_kpis, e em qualquer banco criado do zero pelas migrations o
-- Kanban só exibia erro. vw_dashboard_kpis permanece como alias para não
-- quebrar quem já a referencia.
--
-- security_invoker: respeita a RLS do usuário logado.
-- Expõe stage_id e pipeline_id para permitir filtrar os KPIs por funil.
-- ---------------------------------------------------------------------
do $$
begin
    execute $view$
        create or replace view public.vw_kanban_kpis as
        select
            n.tenant_id,
            coalesce(ps.nome, n.status, 'Sem etapa') as status,
            n.stage_id,
            coalesce(n.pipeline_id, ps.pipeline_id) as pipeline_id,
            n.responsavel,
            n.temperatura,
            count(*)::bigint as total_leads,
            coalesce(sum(coalesce(n.valor, public.to_numeric_seguro(n.dados_extras->>'conta_energia_media'))), 0)::numeric as valor_total,
            coalesce(sum(
                coalesce(n.valor, public.to_numeric_seguro(n.dados_extras->>'conta_energia_media'))
                * coalesce(ps.probabilidade, 0) / 100.0
            ), 0)::numeric as valor_ponderado
        from public.negocios n
        left join public.pipeline_stages ps on ps.id = n.stage_id
        where n.deleted_at is null
        group by
            n.tenant_id,
            coalesce(ps.nome, n.status, 'Sem etapa'),
            n.stage_id,
            coalesce(n.pipeline_id, ps.pipeline_id),
            n.responsavel,
            n.temperatura
    $view$;
    execute 'alter view public.vw_kanban_kpis set (security_invoker = on)';

    -- Alias: mesmo conteúdo, nome usado na documentação do dashboard
    execute 'create or replace view public.vw_dashboard_kpis as select * from public.vw_kanban_kpis';
    execute 'alter view public.vw_dashboard_kpis set (security_invoker = on)';

    execute 'grant select on public.vw_kanban_kpis, public.vw_dashboard_kpis to authenticated';
exception when others then
    raise notice 'views de KPI não criadas (negocios ausente?): %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- SEGMENTO DO TENANT
-- O frontend (useTenantSegmento) chama esta RPC para decidir quais campos
-- específicos do ramo exibir. Ela não existia: a chamada falhava, o hook
-- caía no fallback e TODO tenant era tratado como energia solar — o que
-- anulava a proposta de servir a qualquer segmento.
-- ---------------------------------------------------------------------
create or replace function public.get_tenant_segmento(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(
        (select e.segmento from public.empresas e
          where e.id = p_tenant_id
            and (public.tenant_filter(p_tenant_id) or public.is_system_admin())),
        'energia_solar'
    );
$$;

grant execute on function public.get_tenant_segmento(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- VW_PERFORMANCE_VENDEDORES
-- Consumida pela tela de Metas para comparar meta x realizado. Não existia,
-- então o quadro de desempenho aparecia sempre zerado.
--
-- "Realizado" = negócios em etapa de ganho, agrupados pelo mês do
-- fechamento. security_invoker para respeitar a RLS do usuário.
-- ---------------------------------------------------------------------
do $$
begin
    execute $view$
        create or replace view public.vw_performance_vendedores as
        select
            n.tenant_id,
            f.id as funcionario_id,
            date_trunc('month', coalesce(n.fechado_em, n.updated_at, n.created_at))::date as mes_referencia,
            count(*)::bigint as vendas_qtd,
            coalesce(sum(
                coalesce(n.valor, public.to_numeric_seguro(n.dados_extras->>'conta_energia_media'))
            ), 0)::numeric as vendas_valor
        from public.negocios n
        join public.funcionarios f
          on f.tenant_id = n.tenant_id
         and (
             f.id = n.responsavel_id
             or lower(btrim(f.nome)) = lower(btrim(coalesce(n.responsavel, '')))
         )
        left join public.pipeline_stages ps on ps.id = n.stage_id
        where n.deleted_at is null
          and coalesce(ps.ganho, false) = true
        group by
            n.tenant_id,
            f.id,
            date_trunc('month', coalesce(n.fechado_em, n.updated_at, n.created_at))::date
    $view$;
    execute 'alter view public.vw_performance_vendedores set (security_invoker = on)';
    execute 'grant select on public.vw_performance_vendedores to authenticated';
exception when others then
    raise notice 'vw_performance_vendedores não criada: %', sqlerrm;
end $$;
