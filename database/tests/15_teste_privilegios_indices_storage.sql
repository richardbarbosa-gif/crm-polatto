-- =====================================================================
-- Suíte 15 — migration 20: privilégios mínimos, funções internas fora da
-- API, índices de tenant e de FK, arquivos do lead e linter.
-- Roda depois de 15_preparo_privilegios_frouxos.sql + reaplicação da 20.
-- =====================================================================
\set ON_ERROR_STOP on

select public.otimizar_policies_rls();  -- a policy do preparo nasce no formato antigo

-- ---------------------------------------------------------------------
-- V — privilégios e linter
-- ---------------------------------------------------------------------
do $$
declare
    v_user_a uuid := (select valor from crm_teste.ctx where chave = 'user_a');
    v_problemas text;
    v_anon_tabelas integer;
    v_api_bloqueada boolean := false;
    v_idx_tenant boolean;
    v_idx_fk boolean;
begin
    select count(*) into v_anon_tabelas
    from information_schema.role_table_grants
    where grantee = 'anon' and table_schema = 'public';
    perform public.assert(v_anon_tabelas = 0, 'V1: a chave pública (anon) não tem privilégio em nenhuma tabela de public');

    perform public.assert(not has_table_privilege('authenticated', 'public.tarefas', 'truncate')
        and has_table_privilege('authenticated', 'public.tarefas', 'select, insert, update, delete'),
        'V2: authenticated perde TRUNCATE e mantém o CRUD que a tela usa');

    perform public.assert(not has_function_privilege('anon', 'public.s15_funcao_esquecida()', 'execute')
        and has_function_privilege('authenticated', 'public.s15_funcao_esquecida()', 'execute'),
        'V3: função criada sem revoke deixa de ser executável pela chave pública (quem já usava logado continua)');

    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    begin
        perform public.enforce_rate_limit('ataque_' || gen_random_uuid()::text, 1000000, interval '1 second');
    exception when insufficient_privilege then
        v_api_bloqueada := true;
    end;
    perform public.login_admin();
    perform public.assert(v_api_bloqueada
        and not has_function_privilege('authenticated', 'public.registro_eh_do_usuario(jsonb)', 'execute'),
        'V4: funções internas (enforce_rate_limit, registro_eh_do_usuario) não são chamáveis pela API');

    select exists (select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
                   where i.indrelid = 'public.s15_tabela_nova'::regclass and a.attname = 'tenant_id'),
           exists (select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
                   where i.indrelid = 'public.s15_tabela_nova'::regclass and a.attname = 'negocio_id')
      into v_idx_tenant, v_idx_fk;
    perform public.assert(v_idx_tenant and v_idx_fk,
        'V5: tabela nova ganha índice de tenant_id e de cobertura da chave estrangeira ao reexecutar a 20');

    select string_agg(objeto || ' — ' || problema, E'\n') into v_problemas from public.relatorio_privilegios();
    perform public.assert(v_problemas is null,
        'V6: relatorio_privilegios() sem nenhuma linha' || coalesce(E':\n' || v_problemas, ''));
    perform public.assert(not exists (select 1 from public.relatorio_rls() where gravidade = 'CRITICA' and objeto not like '%s15_%'),
        'V6: relatorio_rls() sem problema crítico');
end $$;

-- o linter ACUSA quando algo regride
do $$
declare
    v_n integer;
begin
    grant select on public.negocios to anon;
    select count(*) into v_n from public.relatorio_privilegios() where objeto = 'public.negocios' and gravidade = 'ALTA';
    revoke all on public.negocios from anon;
    perform public.assert(v_n = 1, 'V7: o linter acusa privilégio devolvido à chave pública');
end $$;

-- ---------------------------------------------------------------------
-- U — uso legítimo continua: a tela lê e grava normalmente
-- ---------------------------------------------------------------------
do $$
declare
    v_user_a uuid := (select valor from crm_teste.ctx where chave = 'user_a');
    v_lead uuid;
    v_tarefa bigint;
    v_n integer;
begin
    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    insert into public.clientes (nome, status) values ('Lead da suíte 15', 'Novo Lead') returning id into v_lead;
    insert into public.tarefas (titulo, tipo, data_vencimento) values ('Tarefa 15', 'ligacao', now() + interval '1 day')
    returning id into v_tarefa;
    update public.tarefas set deleted_at = now() where id = v_tarefa;  -- passa por guarda_exclusao -> registro_eh_do_usuario
    select count(*) into v_n from public.vw_kanban_kpis;
    perform public.registrar_erro_cliente('erro de teste', null, 'https://app/x', 'ua', 'manual', '{}'::jsonb);  -- usa enforce_rate_limit por dentro
    perform public.login_admin();

    perform public.assert(v_lead is not null
        and (select deleted_at from public.tarefas where id = v_tarefa) is not null
        and exists (select 1 from public.client_errors where mensagem = 'erro de teste'),
        'U1: criar lead, excluir tarefa e registrar erro seguem funcionando (as funções internas rodam por dentro das RPCs)');
end $$;

-- ---------------------------------------------------------------------
-- S — arquivos do lead: só quem enviou ou o gerente apaga/sobrescreve
-- ---------------------------------------------------------------------
do $$
declare
    v_user_a uuid := (select valor from crm_teste.ctx where chave = 'user_a');
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    r1 jsonb;
    r2 jsonb;
    v_v1 uuid;
    v_v2 uuid;
    v_n integer;
begin
    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    r1 := crm_teste.equipe_criar('s15.v1@teste.com', 'senhaforte123', 'Quinze Um', 'Vendedor', 'vendedor');
    r2 := crm_teste.equipe_criar('s15.v2@teste.com', 'senhaforte123', 'Quinze Dois', 'Vendedor', 'vendedor');
    perform public.login_admin();
    v_v1 := (r1 ->> 'user_id')::uuid;
    v_v2 := (r2 ->> 'user_id')::uuid;

    perform public.login_como(v_v1, 's15.v1@teste.com');
    insert into storage.objects (bucket_id, name, owner) values
        ('lead-files', v_tenant_a::text || '/lead/contrato-v1.pdf', v_v1),
        ('lead-files', v_tenant_a::text || '/lead/proposta-v1.pdf', v_v1),
        ('lead-files', v_tenant_a::text || '/lead/conta-v1.pdf', v_v1);
    perform public.login_admin();

    perform public.login_como(v_v2, 's15.v2@teste.com');
    delete from storage.objects where bucket_id = 'lead-files' and name like v_tenant_a::text || '/lead/%-v1.pdf';
    get diagnostics v_n = row_count;
    perform public.assert(v_n = 0, 'S1: vendedor não apaga do Storage o arquivo enviado por um colega');
    update storage.objects set name = v_tenant_a::text || '/lead/trocado.pdf'
    where bucket_id = 'lead-files' and name = v_tenant_a::text || '/lead/contrato-v1.pdf';
    get diagnostics v_n = row_count;
    perform public.assert(v_n = 0, 'S2: vendedor não sobrescreve o arquivo de um colega');
    perform public.assert(
        (select count(*) from storage.objects where bucket_id = 'lead-files' and name like v_tenant_a::text || '/lead/%-v1.pdf') = 3,
        'S3: uso legítimo — o colega continua VENDO os arquivos da empresa');
    perform public.login_admin();

    perform public.login_como(v_v1, 's15.v1@teste.com');
    delete from storage.objects where bucket_id = 'lead-files' and name = v_tenant_a::text || '/lead/conta-v1.pdf';
    get diagnostics v_n = row_count;
    perform public.login_admin();
    perform public.assert(v_n = 1, 'S4: uso legítimo — quem enviou apaga o próprio arquivo');

    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    delete from storage.objects where bucket_id = 'lead-files' and name = v_tenant_a::text || '/lead/proposta-v1.pdf';
    get diagnostics v_n = row_count;
    perform public.login_admin();
    perform public.assert(v_n = 1, 'S5: uso legítimo — o gerente apaga arquivo de qualquer membro');

    delete from storage.objects where bucket_id = 'lead-files' and name like v_tenant_a::text || '/lead/%';
    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    perform crm_teste.equipe_remover(v_v1);
    perform crm_teste.equipe_remover(v_v2);
    perform public.login_admin();
end $$;

drop table public.s15_tabela_nova;
drop function public.s15_funcao_esquecida();

do $$
begin
    raise notice '';
    raise notice '===============================================';
    raise notice 'MIGRATION 20 VALIDADA (privilégios, índices, storage, linter)';
    raise notice '===============================================';
end $$;
