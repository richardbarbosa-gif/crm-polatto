-- =====================================================================
-- CRM POLATTO — MIGRATION 16: ORIGEM DO LEAD, PRIMEIRO ACESSO E PERFIL
--
-- Pacote "ultra profissional" (itens 5, 7 e 8; o item 6, "Meu dia", só
-- usa a view vw_negocios_saude da migration 15 e as tarefas):
--
--   5. canais_origem (Instagram, Google, Indicação, Site, Feira, Outro)
--      configurável por tenant (leitura do tenant, escrita só gerente).
--      A origem do negócio fica em negocios.dados_extras
--      ({"origem_id": "<uuid>", "origem": "<nome>"}): a view clientes
--      já grava dados_extras, então NADA muda nela nem nos triggers dela.
--      vw_vendas_por_origem (security_invoker) agrega no banco por
--      origem, etapa, status e mês de cadastro para o relatório.
--   7. onboarding_empresa: dispensa do checklist de primeiro acesso,
--      por empresa, no banco. status_primeiro_acesso() devolve só
--      booleanos do tenant ATIVO, medidos nos dados reais.
--   8. funcionarios.telefone + atualizar_meu_perfil(nome, telefone):
--      o usuário altera SOMENTE nome e telefone da PRÓPRIA linha. Nunca
--      cargo, papel, ativo, e-mail nem tenant. Exceção bem delimitada no
--      trigger somente_gerente (migration 12): só vale dentro da RPC, só
--      para a própria linha e só se nada além de nome/telefone mudou.
--
-- Isolamento: tenant_id no servidor (fn_set_tenant_id) e imutável, RLS
-- com tenant_filter() e WITH CHECK, nada para anon, views com
-- security_invoker, SECURITY DEFINER só onde indispensável (search_path
-- fixo, EXECUTE revogado de public/anon).
--
-- Testes: database/tests/11_teste_origem_perfil.sql (Suíte 11).
-- IDEMPOTENTE. ORDEM: depois da 15.
-- =====================================================================

do $$
begin
    if to_regprocedure('public.provisionar_defaults_pacote(uuid)') is null
       or to_regprocedure('public.fn_proteger_tenant_e_carimbar()') is null
       or to_regclass('public.crm_seeds_aplicados') is null
       or to_regclass('public.empresa_identidade') is null
       or to_regclass('public.produtos') is null then
        raise exception 'Migration 16 exige as migrations 13 e 15 aplicadas antes.';
    end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. CANAIS DE ORIGEM
-- ---------------------------------------------------------------------
create table if not exists public.canais_origem (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    nome text not null,
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
            ('canais_origem_nome_ck', $c$check (length(btrim(nome)) between 1 and 60)$c$),
            ('canais_origem_ordem_ck', $c$check (ordem between 0 and 9999)$c$),
            ('canais_origem_nome_uk', 'unique (tenant_id, nome)')
        ) as t(nome, definicao)
    loop
        if not exists (
            select 1 from pg_constraint
            where conname = r.nome and conrelid = 'public.canais_origem'::regclass
        ) then
            execute format('alter table public.canais_origem add constraint %I %s', r.nome, r.definicao);
        end if;
    end loop;
end $$;

drop trigger if exists set_tenant_id on public.canais_origem;
create trigger set_tenant_id
    before insert on public.canais_origem
    for each row execute function public.fn_set_tenant_id();

drop trigger if exists trg_proteger_tenant on public.canais_origem;
create trigger trg_proteger_tenant
    before update on public.canais_origem
    for each row execute function public.fn_proteger_tenant_e_carimbar();

do $$
begin
    if to_regprocedure('public.fn_audit_trigger()') is not null then
        drop trigger if exists audit_changes on public.canais_origem;
        create trigger audit_changes
            after insert or update or delete on public.canais_origem
            for each row execute function public.fn_audit_trigger();
    end if;
end $$;

alter table public.canais_origem enable row level security;

drop policy if exists canais_origem_leitura on public.canais_origem;
create policy canais_origem_leitura on public.canais_origem
    for select to authenticated
    using (public.tenant_filter(tenant_id));

drop policy if exists canais_origem_escrita_gerente on public.canais_origem;
create policy canais_origem_escrita_gerente on public.canais_origem
    for all to authenticated
    using (public.tenant_filter(tenant_id) and public.eh_admin_do_tenant(tenant_id))
    with check (public.tenant_filter(tenant_id) and public.eh_admin_do_tenant(tenant_id));

comment on table public.canais_origem is
    'Canais de origem do lead (Instagram, Google, Indicação...). O negócio guarda origem_id/origem em dados_extras. Leitura: tenant; escrita: gerente.';

create or replace function public.provisionar_canais_origem(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if p_tenant_id is null then
        return;
    end if;
    insert into public.crm_seeds_aplicados (tenant_id, chave)
    values (p_tenant_id, 'canais_origem_v1')
    on conflict do nothing;
    if not found then
        return;
    end if;

    insert into public.canais_origem (tenant_id, nome, ordem, padrao)
    select p_tenant_id, c.nome, c.ordem, true
    from (values
        ('Instagram', 1), ('Google', 2), ('Indicação', 3), ('Site', 4), ('Feira', 5), ('Outro', 6)
    ) as c(nome, ordem)
    where not exists (
        select 1 from public.canais_origem co
        where co.tenant_id = p_tenant_id and co.nome = c.nome
    );
end;
$$;

-- Gancho dos pacotes (migration 15) agora cobre os canais também.
create or replace function public.provisionar_defaults_pacote(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.provisionar_modelos_mensagem(p_tenant_id);
    perform public.provisionar_canais_origem(p_tenant_id);
end;
$$;

do $$
declare
    r record;
begin
    for r in select e.id from public.empresas e loop
        perform public.provisionar_canais_origem(r.id);
    end loop;
end $$;

-- Relatório "Vendas por origem": agregado no banco, sem baixar negócios.
-- Coorte por mês de CADASTRO: dos leads que entraram no período, quantos
-- foram ganhos/perdidos (a tela classifica pela etapa e usa
-- taxaDeConversao, a regra oficial).
create or replace view public.vw_vendas_por_origem
with (security_invoker = on)
as
select
    n.tenant_id,
    coalesce(co.nome, nullif(btrim(n.dados_extras ->> 'origem'), ''), 'Não informado') as origem,
    n.stage_id,
    coalesce(ps.nome, n.status) as status,
    n.responsavel,
    date_trunc('month', n.created_at)::date as mes_cadastro,
    count(*)::bigint as total_leads,
    coalesce(sum(coalesce(nullif(n.valor, 0), public.to_numeric_seguro(n.dados_extras ->> 'conta_energia_media'))), 0)::numeric as valor_total
from public.negocios n
left join public.canais_origem co
    on co.tenant_id = n.tenant_id and co.id::text = n.dados_extras ->> 'origem_id'
left join public.pipeline_stages ps on ps.id = n.stage_id
where n.deleted_at is null
group by 1, 2, 3, 4, 5, 6;

comment on view public.vw_vendas_por_origem is
    'Leads por origem, etapa, status, responsável e mês de cadastro (security_invoker). Base do relatório Vendas por origem.';

create index if not exists idx_negocios_origem
    on public.negocios (tenant_id, (dados_extras ->> 'origem_id'))
    where deleted_at is null;

-- ---------------------------------------------------------------------
-- 7. PRIMEIRO ACESSO GUIADO
-- ---------------------------------------------------------------------
create table if not exists public.onboarding_empresa (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    dispensado_em timestamptz,
    dispensado_por uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'onboarding_empresa_tenant_uk' and conrelid = 'public.onboarding_empresa'::regclass
    ) then
        alter table public.onboarding_empresa add constraint onboarding_empresa_tenant_uk unique (tenant_id);
    end if;
end $$;

-- Quem dispensou é sempre o usuário da requisição (não o payload)
create or replace function public.fn_onboarding_carimbar()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.dispensado_em is not null
       and (tg_op = 'INSERT' or old.dispensado_em is null) then
        new.dispensado_em := now();
        new.dispensado_por := auth.uid();
    elsif new.dispensado_em is null then
        new.dispensado_por := null;
    else
        new.dispensado_em := old.dispensado_em;
        new.dispensado_por := old.dispensado_por;
    end if;
    return new;
end;
$$;

drop trigger if exists set_tenant_id on public.onboarding_empresa;
create trigger set_tenant_id
    before insert on public.onboarding_empresa
    for each row execute function public.fn_set_tenant_id();

drop trigger if exists trg_proteger_tenant on public.onboarding_empresa;
create trigger trg_proteger_tenant
    before update on public.onboarding_empresa
    for each row execute function public.fn_proteger_tenant_e_carimbar();

drop trigger if exists trg_onboarding_carimbar on public.onboarding_empresa;
create trigger trg_onboarding_carimbar
    before insert or update on public.onboarding_empresa
    for each row execute function public.fn_onboarding_carimbar();

alter table public.onboarding_empresa enable row level security;

drop policy if exists onboarding_empresa_leitura on public.onboarding_empresa;
create policy onboarding_empresa_leitura on public.onboarding_empresa
    for select to authenticated
    using (public.tenant_filter(tenant_id));

drop policy if exists onboarding_empresa_escrita_gerente on public.onboarding_empresa;
create policy onboarding_empresa_escrita_gerente on public.onboarding_empresa
    for all to authenticated
    using (public.tenant_filter(tenant_id) and public.eh_admin_do_tenant(tenant_id))
    with check (public.tenant_filter(tenant_id) and public.eh_admin_do_tenant(tenant_id));

-- Estado real dos dados do tenant ATIVO. SECURITY DEFINER porque lê o
-- audit_log (sem acesso direto) e a contagem da equipe; devolve só
-- booleanos, nunca linhas, e só do próprio tenant.
create or replace function public.status_primeiro_acesso()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_primeiro_registro timestamptz;
begin
    if auth.uid() is null or v_tenant is null then
        return null;
    end if;

    select min(a.criado_em) into v_primeiro_registro
    from public.audit_log a
    where a.tenant_id = v_tenant and a.tabela in ('pipelines', 'pipeline_stages');

    return jsonb_build_object(
        'identidade', exists (
            select 1 from public.empresa_identidade ei
            where ei.tenant_id = v_tenant
              and (ei.logo_path is not null or nullif(btrim(coalesce(ei.nome_fantasia, '')), '') is not null)
        ),
        'produtos', exists (
            select 1 from public.produtos p where p.tenant_id = v_tenant and p.ativo
        ),
        'equipe', (
            select count(*) from public.utilizadores_empresas ue where ue.empresa_id = v_tenant
        ) > 1 or (
            select count(*) from public.funcionarios f
            where f.tenant_id = v_tenant and f.deleted_at is null and coalesce(f.ativo, true)
        ) > 1,
        -- Revisou o funil: alguém da empresa alterou/excluiu etapa ou funil,
        -- ou criou uma etapa depois do provisionamento inicial.
        'funil', exists (
            select 1 from public.audit_log a
            where a.tenant_id = v_tenant
              and a.tabela in ('pipelines', 'pipeline_stages')
              and a.executado_por is not null
              and (a.operacao <> 'INSERT' or a.criado_em > v_primeiro_registro + interval '10 minutes')
        ),
        'primeiro_lead', exists (
            select 1 from public.negocios n where n.tenant_id = v_tenant and n.deleted_at is null
        ),
        'dispensado', exists (
            select 1 from public.onboarding_empresa o
            where o.tenant_id = v_tenant and o.dispensado_em is not null
        )
    );
end;
$$;

comment on function public.status_primeiro_acesso() is
    'Checklist de primeiro acesso do tenant ativo (só booleanos): identidade, produtos, equipe, funil revisado, primeiro lead e dispensa.';

-- ---------------------------------------------------------------------
-- 8. MEU PERFIL — nome e telefone do próprio funcionário
-- ---------------------------------------------------------------------
alter table public.funcionarios add column if not exists telefone text;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'funcionarios_telefone_ck' and conrelid = 'public.funcionarios'::regclass
    ) then
        alter table public.funcionarios
            add constraint funcionarios_telefone_ck
            check (telefone is null or (length(telefone) <= 30 and telefone ~ '^[0-9 ()+.-]+$')) not valid;
    end if;
end $$;

comment on column public.funcionarios.telefone is
    'Telefone do funcionário (Meu perfil). Pode alimentar o rodapé da proposta (orcamentos.responsavel_telefone).';

-- fn_somente_gerente (migration 12) + UMA exceção: a própria linha em
-- funcionarios, dentro de atualizar_meu_perfil, mudando só nome/telefone.
create or replace function public.fn_somente_gerente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if public.requisicao_api_publica() and not public.eh_admin_do_tenant() then
        if tg_table_name = 'funcionarios'
           and tg_op = 'UPDATE'
           and current_setting('crm.meu_perfil', true) = 'on'
           and auth.uid() is not null
           and (to_jsonb(old) ->> 'user_id' = auth.uid()::text or to_jsonb(old) ->> 'id' = auth.uid()::text)
           and (to_jsonb(new) - array['nome', 'telefone', 'updated_at'])
               = (to_jsonb(old) - array['nome', 'telefone', 'updated_at']) then
            return new;
        end if;
        raise exception 'Somente o gerente pode alterar % (configuração da empresa).', tg_table_name
            using errcode = '42501';
    end if;
    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;

create or replace function public.atualizar_meu_perfil(p_nome text, p_telefone text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid uuid := auth.uid();
    v_tenant uuid := public.current_tenant_id();
    v_nome text := btrim(coalesce(p_nome, ''));
    v_telefone text := nullif(btrim(coalesce(p_telefone, '')), '');
    v_afetados integer;
begin
    if v_uid is null or v_tenant is null then
        return jsonb_build_object('success', false, 'error', 'Faça login para continuar.');
    end if;
    perform public.enforce_rate_limit('atualizar_meu_perfil', 30, interval '1 hour');

    if length(v_nome) < 2 or length(v_nome) > 120 then
        return jsonb_build_object('success', false, 'error', 'Informe um nome entre 2 e 120 caracteres.');
    end if;
    if v_telefone is not null and (
        length(v_telefone) > 30
        or v_telefone !~ '^[0-9 ()+.-]+$'
        or length(regexp_replace(v_telefone, '\D', '', 'g')) not between 8 and 15
    ) then
        return jsonb_build_object('success', false, 'error', 'Telefone inválido: use só números, espaço, parênteses, + ou -.');
    end if;

    perform set_config('crm.meu_perfil', 'on', true);
    update public.funcionarios f
    set nome = v_nome, telefone = v_telefone
    where (f.user_id = v_uid or f.id = v_uid)
      and f.tenant_id = v_tenant
      and f.deleted_at is null;
    get diagnostics v_afetados = row_count;
    perform set_config('crm.meu_perfil', 'off', true);

    if v_afetados = 0 then
        return jsonb_build_object('success', false, 'error', 'Seu cadastro de funcionário não foi encontrado nesta empresa. Fale com o gerente.');
    end if;
    return jsonb_build_object('success', true, 'message', 'Perfil atualizado.');
end;
$$;

comment on function public.atualizar_meu_perfil(text, text) is
    'O usuário logado altera SOMENTE nome e telefone da própria linha em funcionarios (empresa ativa). Nunca cargo, papel, ativo, e-mail ou tenant.';

-- ---------------------------------------------------------------------
-- GRANTS
-- ---------------------------------------------------------------------
do $$
declare
    v_anon boolean := exists (select 1 from pg_roles where rolname = 'anon');
    v_auth boolean := exists (select 1 from pg_roles where rolname = 'authenticated');
    v_service boolean := exists (select 1 from pg_roles where rolname = 'service_role');
    t text;
    r record;
begin
    foreach t in array array['canais_origem', 'onboarding_empresa'] loop
        execute format('revoke all on public.%I from public', t);
        if v_anon then
            execute format('revoke all on public.%I from anon', t);
        end if;
        if v_auth then
            execute format('grant select, insert, update, delete on public.%I to authenticated', t);
        end if;
        if v_service then
            execute format('grant all on public.%I to service_role', t);
        end if;
    end loop;

    revoke all on public.vw_vendas_por_origem from public;
    if v_anon then
        revoke all on public.vw_vendas_por_origem from anon;
    end if;
    if v_auth then
        revoke all on public.vw_vendas_por_origem from authenticated;
        grant select on public.vw_vendas_por_origem to authenticated;
    end if;
    if v_service then
        grant select on public.vw_vendas_por_origem to service_role;
    end if;

    for r in
        select p.oid::regprocedure as fn, p.proname::text as nome
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public'
          and p.proname in (
              'provisionar_canais_origem', 'provisionar_defaults_pacote', 'fn_onboarding_carimbar',
              'fn_somente_gerente', 'status_primeiro_acesso', 'atualizar_meu_perfil'
          )
    loop
        execute format('revoke execute on function %s from public', r.fn);
        if v_anon then
            execute format('revoke execute on function %s from anon', r.fn);
        end if;
        if v_auth then
            if r.nome in ('status_primeiro_acesso', 'atualizar_meu_perfil') then
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
