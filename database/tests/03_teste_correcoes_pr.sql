-- =====================================================================
-- TESTES DAS CORREÇÕES DO PR #1
--
-- Cobre os problemas apontados na revisão:
--   1. View de KPI do Kanban com nome divergente entre migration e frontend
--   2. Seletor de empresa ignorado por current_tenant_id()
--
-- Executar DEPOIS de 01_testes_isolamento.sql (reaproveita os tenants).
-- =====================================================================

\set ON_ERROR_STOP on

-- =====================================================================
-- PROBLEMA 1 — vw_kanban_kpis não existe em banco criado do zero
--
-- O frontend (src/pages/clientes/list.tsx) consome o recurso
-- "vw_kanban_kpis". A migration criava apenas "vw_dashboard_kpis".
-- Em qualquer banco inicializado pelas migrations, o Kanban exibia erro.
-- =====================================================================

do $$
begin
    perform public.assert(
        to_regclass('public.vw_kanban_kpis') is not null,
        'KPI: a view vw_kanban_kpis (consumida pelo frontend) existe'
    );
end $$;

-- A view precisa expor exatamente as colunas que o Kanban lê
do $$
declare
    v_faltando text;
begin
    select string_agg(c.coluna, ', ')
    into v_faltando
    from (values ('tenant_id'), ('status'), ('total_leads'), ('valor_total')) as c(coluna)
    where not exists (
        select 1 from information_schema.columns ic
        where ic.table_schema = 'public'
          and ic.table_name = 'vw_kanban_kpis'
          and ic.column_name = c.coluna
    );

    if v_faltando is not null then
        raise notice 'Colunas ausentes em vw_kanban_kpis: %', v_faltando;
    end if;

    perform public.assert(
        v_faltando is null,
        'KPI: vw_kanban_kpis expõe as colunas que o Kanban consome'
    );
end $$;

-- E precisa respeitar a RLS do usuário logado (security_invoker)
do $$
declare
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_linhas_de_b bigint;
begin
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    select count(*) into v_linhas_de_b
    from public.vw_kanban_kpis where tenant_id = v_tenant_b;
    perform public.login_admin();

    perform public.assert(
        v_linhas_de_b = 0,
        'KPI: vw_kanban_kpis não expõe números de outro tenant'
    );
end $$;

-- =====================================================================
-- PROBLEMA 2 — seletor de empresa ignorado
--
-- Um usuário vinculado a mais de uma empresa troca de empresa na
-- interface (o frontend envia o header x-tenant-id), mas
-- current_tenant_id() devolvia sempre a primeira empresa por ordem de
-- UUID. Todas as queries continuavam rodando sob a empresa errada,
-- silenciosamente.
-- =====================================================================

-- Cenário: usuário multi-empresa vinculado a DUAS empresas novas
do $$
declare
    v_user uuid := gen_random_uuid();
    v_emp1 uuid;
    v_emp2 uuid;
begin
    insert into auth.users (id, email) values (v_user, 'multi@teste.com');

    insert into public.empresas (nome, segmento) values ('Multi Empresa 1', 'consultoria')
    returning id into v_emp1;
    insert into public.empresas (nome, segmento) values ('Multi Empresa 2', 'software')
    returning id into v_emp2;

    insert into public.utilizadores_empresas (auth_uid, empresa_id, role) values
        (v_user, v_emp1, 'admin'),
        (v_user, v_emp2, 'admin');

    perform public.provisionar_defaults_tenant(v_emp1);
    perform public.provisionar_defaults_tenant(v_emp2);

    -- Um negócio identificável em cada empresa
    insert into public.negocios (tenant_id, titulo, valor) values
        (v_emp1, 'Negócio da Empresa 1', 1000),
        (v_emp2, 'Negócio da Empresa 2', 2000);

    insert into crm_teste.ctx values
        ('multi_user', v_user), ('multi_emp1', v_emp1), ('multi_emp2', v_emp2)
    on conflict (chave) do update set valor = excluded.valor;
end $$;

-- 2.1 — sem seleção explícita, o tenant resolve de forma determinística
do $$
declare
    v_user uuid := (select valor from crm_teste.ctx where chave = 'multi_user');
    v_emp1 uuid := (select valor from crm_teste.ctx where chave = 'multi_emp1');
    v_emp2 uuid := (select valor from crm_teste.ctx where chave = 'multi_emp2');
    v_obtido uuid;
begin
    perform public.login_como(v_user, 'multi@teste.com');
    v_obtido := public.current_tenant_id();
    perform public.login_admin();

    perform public.assert(
        v_obtido in (v_emp1, v_emp2),
        'MULTI: sem seleção, o tenant resolvido é uma das empresas do usuário'
    );
end $$;

-- 2.2 — CORE DO BUG: selecionar a empresa 2 precisa mudar o tenant ativo
do $$
declare
    v_user uuid := (select valor from crm_teste.ctx where chave = 'multi_user');
    v_emp2 uuid := (select valor from crm_teste.ctx where chave = 'multi_emp2');
    v_obtido uuid;
begin
    perform public.login_como(v_user, 'multi@teste.com', v_emp2);
    v_obtido := public.current_tenant_id();
    perform public.login_admin();

    perform public.assert(
        v_obtido = v_emp2,
        'MULTI: selecionar a Empresa 2 faz current_tenant_id() devolver a Empresa 2'
    );
end $$;

-- 2.3 — e a troca precisa refletir nos DADOS retornados
do $$
declare
    v_user uuid := (select valor from crm_teste.ctx where chave = 'multi_user');
    v_emp1 uuid := (select valor from crm_teste.ctx where chave = 'multi_emp1');
    v_emp2 uuid := (select valor from crm_teste.ctx where chave = 'multi_emp2');
    v_titulo text;
    v_qtd bigint;
begin
    -- Selecionando a Empresa 2, só os dados dela aparecem
    perform public.login_como(v_user, 'multi@teste.com', v_emp2);
    select count(*) into v_qtd from public.negocios;
    select titulo into v_titulo from public.negocios limit 1;
    perform public.login_admin();

    perform public.assert(
        v_titulo = 'Negócio da Empresa 2',
        'MULTI: com Empresa 2 selecionada, os dados retornados são da Empresa 2'
    );
    perform public.assert(v_qtd = 1, 'MULTI: dados da Empresa 1 não aparecem quando a 2 está ativa');

    -- Voltando para a Empresa 1, o inverso
    perform public.login_como(v_user, 'multi@teste.com', v_emp1);
    select titulo into v_titulo from public.negocios limit 1;
    perform public.login_admin();

    perform public.assert(
        v_titulo = 'Negócio da Empresa 1',
        'MULTI: voltar para a Empresa 1 traz os dados da Empresa 1'
    );
end $$;

-- 2.4 — SEGURANÇA: forjar uma empresa que não é dele NÃO pode funcionar
do $$
declare
    v_user uuid := (select valor from crm_teste.ctx where chave = 'multi_user');
    v_emp1 uuid := (select valor from crm_teste.ctx where chave = 'multi_emp1');
    v_emp2 uuid := (select valor from crm_teste.ctx where chave = 'multi_emp2');
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_obtido uuid;
    v_visiveis bigint;
begin
    -- Header aponta para a Empresa B, onde este usuário NÃO tem vínculo
    perform public.login_como(v_user, 'multi@teste.com', v_tenant_b);
    v_obtido := public.current_tenant_id();
    select count(*) into v_visiveis from public.negocios where tenant_id = v_tenant_b;
    perform public.login_admin();

    perform public.assert(
        v_obtido is distinct from v_tenant_b,
        'MULTI: header apontando para empresa de terceiro NÃO vira o tenant ativo'
    );
    perform public.assert(
        v_obtido in (v_emp1, v_emp2),
        'MULTI: seleção inválida cai para uma empresa legítima do usuário'
    );
    perform public.assert(
        v_visiveis = 0,
        'MULTI: usuário continua sem enxergar dados de empresa que não é dele'
    );
end $$;

-- 2.5 — usuário de UMA empresa só não é afetado pela mudança
do $$
declare
    v_user_a uuid := (select valor from crm_teste.ctx where chave = 'user_a');
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_sem_header uuid;
    v_com_header_valido uuid;
    v_com_header_alheio uuid;
begin
    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    v_sem_header := public.current_tenant_id();
    perform public.login_admin();

    perform public.login_como(v_user_a, 'vendedor.a@teste.com', v_tenant_a);
    v_com_header_valido := public.current_tenant_id();
    perform public.login_admin();

    perform public.login_como(v_user_a, 'vendedor.a@teste.com', v_tenant_b);
    v_com_header_alheio := public.current_tenant_id();
    perform public.login_admin();

    perform public.assert(v_sem_header = v_tenant_a, 'MULTI: usuário de uma empresa só continua resolvendo o tenant dele');
    perform public.assert(v_com_header_valido = v_tenant_a, 'MULTI: selecionar a própria empresa mantém o tenant');
    perform public.assert(v_com_header_alheio = v_tenant_a, 'MULTI: header alheio é ignorado e o tenant próprio prevalece');
end $$;

-- 2.6 — escrita respeita a empresa selecionada
do $$
declare
    v_user uuid := (select valor from crm_teste.ctx where chave = 'multi_user');
    v_emp2 uuid := (select valor from crm_teste.ctx where chave = 'multi_emp2');
    v_gravado uuid;
begin
    perform public.login_como(v_user, 'multi@teste.com', v_emp2);
    insert into public.negocios (titulo, valor) values ('Criado com Empresa 2 ativa', 500)
    returning tenant_id into v_gravado;
    perform public.login_admin();

    perform public.assert(
        v_gravado = v_emp2,
        'MULTI: negócio criado nasce na empresa que está selecionada'
    );
end $$;

do $$
begin
    raise notice '';
    raise notice '===============================================';
    raise notice 'CORREÇÕES DO PR #1 VALIDADAS';
    raise notice '===============================================';
end $$;
