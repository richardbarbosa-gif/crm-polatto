-- =====================================================================
-- BANCO NOVO — o caminho de uma instalação do zero (e da reconstrução de
-- produção de 2026-11): 00..N, virada (clientes -> view) e 01/10+ de novo.
--
-- Roda num banco SEPARADO, sem os dados legados das suítes 01–07, e prova
-- que o CRM funciona de ponta a ponta para quem acabou de se cadastrar:
-- onboarding, lead pela view, Kanban, equipe e as regras de exclusão.
-- =====================================================================

\set ON_ERROR_STOP on

create or replace function public.assert(p_condicao boolean, p_descricao text)
returns void language plpgsql as $$
begin
    if p_condicao then
        raise notice 'PASS  %', p_descricao;
    else
        raise exception 'FALHOU: %', p_descricao;
    end if;
end;
$$;

create or replace function public.login_como(p_user uuid, p_email text default null, p_tenant uuid default null)
returns void language plpgsql as $$
begin
    perform set_config('request.jwt.claims',
        json_build_object('sub', p_user::text, 'email', coalesce(p_email, ''), 'role', 'authenticated')::text, false);
    perform set_config('request.headers',
        json_build_object('x-tenant-id', coalesce(p_tenant::text, ''))::text, false);
    execute 'set role authenticated';
end;
$$;

create or replace function public.login_admin()
returns void language plpgsql as $$
begin
    execute 'reset role';
    perform set_config('request.jwt.claims', '', false);
    perform set_config('request.headers', '', false);
end;
$$;

do $$
declare
    v_dono uuid := gen_random_uuid();
    v_tenant uuid;
    v_tenant_de_novo uuid;
    v_lead uuid;
    v_kpi bigint;
    v_etapas bigint;
    v_motivos bigint;
    r_membro jsonb;
    v_vendedor uuid;
    v_lead_vendedor uuid;
    v_bloq boolean := false;
    v_papel text;
begin
    perform public.assert(
        (select relkind from pg_class where relname = 'clientes' and relnamespace = 'public'::regnamespace) = 'v',
        'N0: banco novo termina com clientes como VIEW do modelo novo'
    );
    perform public.assert(
        not exists (select 1 from public.relatorio_rls() where gravidade = 'CRITICA'),
        'N0: linter de RLS sem problema crítico no banco novo'
    );

    -- Onboarding: quem se cadastra cria a própria empresa e vira gerente
    insert into auth.users (id, email) values (v_dono, 'dono@empresa-nova.com');
    perform public.login_como(v_dono, 'dono@empresa-nova.com');
    v_tenant := public.provisionar_tenant('Empresa Nova Solar', 'energia_solar');
    v_tenant_de_novo := public.provisionar_tenant('Outra tentativa', 'energia_solar');
    select count(*) into v_etapas from public.pipeline_stages where tenant_id = v_tenant;
    select count(*) into v_motivos from public.motivos_perda;
    perform public.login_admin();
    select role into v_papel from public.utilizadores_empresas where auth_uid = v_dono;

    perform public.assert(v_tenant is not null and v_tenant_de_novo = v_tenant, 'N1: cadastro cria UMA empresa (idempotente)');
    perform public.assert(public.normalizar_papel(v_papel) = 'gerente', 'N1: quem cria a empresa é gerente');
    perform public.assert(v_etapas > 0 and v_motivos > 0, 'N1: funil, etapas e motivos padrão criados');

    -- Lead pela view (como a tela) e Kanban
    perform public.login_como(v_dono, 'dono@empresa-nova.com');
    insert into public.clientes (nome, status, telefone, cpf_cnpj, valor)
    values ('Primeiro cliente', 'Novo Lead', '(11) 98888-7777', '529.982.247-25', 25000)
    returning id into v_lead;
    select coalesce(sum(total_leads), 0) into v_kpi from public.vw_kanban_kpis;
    perform public.login_admin();

    perform public.assert(v_lead is not null and (select tenant_id from public.negocios where id = v_lead) = v_tenant,
        'N2: lead criado pela tela cai na empresa certa');
    perform public.assert(v_kpi = 1, 'N2: Kanban (vw_kanban_kpis) enxerga o lead');

    -- Equipe: gerente cadastra vendedor com login
    perform public.login_como(v_dono, 'dono@empresa-nova.com');
    r_membro := crm_teste.equipe_criar('vendedor@empresa-nova.com', 'senhaforte123', 'Vendedor Novo', 'Vendedor', 'vendedor');
    perform public.login_admin();
    v_vendedor := (r_membro ->> 'user_id')::uuid;
    perform public.assert((r_membro ->> 'success')::boolean, 'N3: gerente cadastra vendedor com login');

    -- Vendedor vê o lead do gerente, cria o dele, e só exclui o dele
    perform public.login_como(v_vendedor, 'vendedor@empresa-nova.com');
    perform public.assert((select count(*) from public.clientes where id = v_lead) = 1, 'N4: vendedor vê o lead do gerente');
    insert into public.clientes (nome, status, responsavel) values ('Lead do vendedor', 'Novo Lead', 'Vendedor Novo')
    returning id into v_lead_vendedor;
    begin
        delete from public.clientes where id = v_lead;
    exception when insufficient_privilege then
        v_bloq := true;
    end;
    delete from public.clientes where id = v_lead_vendedor;
    perform public.login_admin();

    perform public.assert(v_bloq, 'N4: vendedor não exclui lead do gerente');
    perform public.assert((select deleted_at is not null from public.negocios where id = v_lead_vendedor), 'N4: vendedor exclui o próprio (lixeira)');
end $$;

do $$
begin
    raise notice '';
    raise notice '===============================================';
    raise notice 'BANCO NOVO (INSTALAÇÃO DO ZERO) VALIDADO';
    raise notice '===============================================';
end $$;
