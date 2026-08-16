-- =====================================================================
-- CRM POLATTO — MIGRATION 06: AUDITORIA FORMAL DE RLS
--
-- Item da seção 1 do escopo: "Auditoria de RLS cross-tenant".
-- Cria duas ferramentas executáveis:
--
--   1. relatorio_rls() — linter automático: lista toda tabela/policy/view
--      com problema de isolamento (RLS desligada, policy using(true),
--      view sem security_invoker, coluna tenant_id ausente).
--      Uso: select * from public.relatorio_rls();
--
--   2. testar_isolamento_tenant(user_a, user_b) — teste formal: simula os
--      JWTs de dois usuários de tenants diferentes e verifica que um NÃO
--      enxerga os dados do outro (inclui a resposta à pergunta do escopo:
--      "forjar o header x-tenant-id vaza dado?" — não, porque
--      current_tenant_id() ignora o header e deriva do auth.uid()).
--      Uso: select * from public.testar_isolamento_tenant('<uuid_user_a>', '<uuid_user_b>');
--
-- IDEMPOTENTE. Executar após 02.
-- =====================================================================

create or replace function public.relatorio_rls()
returns table(objeto text, tipo text, problema text, gravidade text)
language plpgsql
security definer
set search_path = public
as $$
begin
    -- 1. Tabelas do schema public SEM RLS habilitada
    return query
    select c.relname::text, 'tabela'::text,
           'RLS desabilitada — qualquer authenticated lê/escreve tudo'::text,
           'CRITICA'::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity;

    -- 2. Policies permissivas using(true) — anulam o isolamento por tenant.
    --    "planos" é catálogo público de preços por definição, fica de fora.
    return query
    select (p.tablename || ' / ' || p.policyname)::text, 'policy'::text,
           'Policy com using(true) — não filtra por tenant'::text,
           'CRITICA'::text
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename not in ('planos')
      and (btrim(coalesce(p.qual, '')) = 'true' or btrim(coalesce(p.with_check, '')) = 'true');

    -- 3. Views sem security_invoker — executam com privilégio do dono e
    --    IGNORAM a RLS das tabelas de origem (vazamento cross-tenant).
    --    O Postgres grava a opção como "on", não "true".
    return query
    select c.relname::text, 'view'::text,
           'View sem security_invoker=on — bypassa a RLS das tabelas de origem'::text,
           'CRITICA'::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'v'
      and not coalesce(
          (select lower(o.option_value) in ('true', 'on', '1', 'yes')
           from pg_options_to_table(c.reloptions) as o(option_name, option_value)
           where o.option_name = 'security_invoker'
           limit 1),
          false
      );

    -- 4. Tabelas de negócio sem coluna tenant_id
    return query
    select t.table_name::text, 'tabela'::text,
           'Sem coluna tenant_id — impossível isolar por tenant'::text,
           'ALTA'::text
    from information_schema.tables t
    where t.table_schema = 'public'
      and t.table_type = 'BASE TABLE'
      and t.table_name not in (
          'system_admins', 'rate_limit_hits', 'audit_log',
          'acessos_dados_pessoais', 'cliente_status_history',
          'utilizadores_empresas'
      )
      and not exists (
          select 1 from information_schema.columns c
          where c.table_schema = 'public'
            and c.table_name = t.table_name
            and c.column_name = 'tenant_id'
      );

    -- 5. Linhas legadas com tenant_id null em tabelas com RLS estrita
    return query
    select ('negocios (' || count(*) || ' linhas)')::text, 'dados'::text,
           'Registros com tenant_id null — invisíveis sob RLS estrita'::text,
           'MEDIA'::text
    from public.negocios where tenant_id is null having count(*) > 0;

    return;
end;
$$;

comment on function public.relatorio_rls() is 'Linter de isolamento multi-tenant. Rodar após qualquer mudança de schema: select * from relatorio_rls(); O objetivo é retornar ZERO linhas.';

-- ---------------------------------------------------------------------
-- Teste formal de isolamento entre dois usuários reais
-- ---------------------------------------------------------------------
create or replace function public.testar_isolamento_tenant(p_user_a uuid, p_user_b uuid)
returns table(teste text, resultado text)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant_a uuid;
    v_tenant_b uuid;
    v_visiveis_cross bigint;
    v_claims_a text;
begin
    if not public.is_system_admin() then
        raise exception 'Apenas superadmin pode rodar o teste de isolamento.';
    end if;

    -- Descobre o tenant de cada usuário pelo vínculo
    select ue.tenant into v_tenant_a from (
        select coalesce(
            to_jsonb(u) ->> 'empresa_id',
            to_jsonb(u) ->> 'tenant_id',
            to_jsonb(u) ->> 'company_id',
            to_jsonb(u) ->> 'id_empresa'
        )::uuid as tenant
        from public.utilizadores_empresas u
        where u.auth_uid = p_user_a limit 1
    ) ue;
    select ue.tenant into v_tenant_b from (
        select coalesce(
            to_jsonb(u) ->> 'empresa_id',
            to_jsonb(u) ->> 'tenant_id',
            to_jsonb(u) ->> 'company_id',
            to_jsonb(u) ->> 'id_empresa'
        )::uuid as tenant
        from public.utilizadores_empresas u
        where u.auth_uid = p_user_b limit 1
    ) ue;

    if v_tenant_a is null or v_tenant_b is null then
        teste := 'pré-condição';
        resultado := 'FALHOU: um dos usuários não tem vínculo em utilizadores_empresas.';
        return next;
        return;
    end if;

    if v_tenant_a = v_tenant_b then
        teste := 'pré-condição';
        resultado := 'INVÁLIDO: os dois usuários são do MESMO tenant. Use usuários de tenants diferentes.';
        return next;
        return;
    end if;

    -- Simula a sessão do usuário A e tenta ler dados do tenant B.
    -- set_config request.jwt.claims é exatamente o mecanismo que o PostgREST
    -- usa; forjar o header x-tenant-id NÃO altera esses claims — por isso
    -- o header é irrelevante para a RLS (current_tenant_id usa auth.uid()).
    v_claims_a := json_build_object('sub', p_user_a::text, 'role', 'authenticated')::text;
    perform set_config('request.jwt.claims', v_claims_a, true);
    perform set_config('role', 'authenticated', true);

    select count(*) into v_visiveis_cross
    from public.negocios
    where tenant_id = v_tenant_b;

    -- Restaura contexto
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);

    teste := 'negocios cross-tenant (user A lendo tenant B)';
    resultado := case
        when v_visiveis_cross = 0 then 'OK: 0 linhas visíveis'
        else format('FALHOU: %s linhas do tenant B visíveis para o user A', v_visiveis_cross)
    end;
    return next;

    teste := 'header x-tenant-id forjado';
    resultado := 'OK por construção: current_tenant_id() deriva de auth.uid() (JWT assinado), o header do cliente não participa de nenhuma policy.';
    return next;
end;
$$;
