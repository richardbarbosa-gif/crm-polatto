-- =====================================================================
-- Suíte 13 — migration 18: equipe sem escrever em auth.users, cadastro
-- de empresas fechado por padrão, histórico inviolável e RLS que usa
-- índice. Para cada correção: o ataque falha E o uso legítimo segue.
-- Roda depois de 13_preparo_estado_antigo.sql + reaplicação da 18.
-- =====================================================================
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------
-- R — RLS reescrita (P2-02)
-- ---------------------------------------------------------------------
do $$
declare
    v_lentas text;
    v_soltas text;
    v_all text;
    v_plano text := '';
    v_linha text;
    v_user_a uuid := (select valor from crm_teste.ctx where chave = 'user_a');
begin
    select string_agg(schemaname || '.' || tablename || '.' || policyname, ', ')
      into v_lentas
    from pg_policies
    where schemaname in ('public', 'storage')
      and (coalesce(qual, '') ~ 'tenant_filter\(' or coalesce(with_check, '') ~ 'tenant_filter\(');
    perform public.assert(v_lentas is null,
        'R1: nenhuma policy chama tenant_filter() linha a linha (restantes: ' || coalesce(v_lentas, 'nenhuma') || ')');

    select string_agg(schemaname || '.' || tablename || '.' || policyname, ', ')
      into v_soltas
    from pg_policies
    where schemaname in ('public', 'storage')
      and (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
          ~ '(?<!SELECT )\m(auth\.uid|auth\.jwt|current_tenant_id|is_system_admin|eh_admin_do_tenant)\(\)';
    perform public.assert(v_soltas is null,
        'R2: auth.uid()/current_tenant_id()/is_system_admin() sempre dentro de (select ...) (restantes: ' || coalesce(v_soltas, 'nenhuma') || ')');

    perform public.assert(public.otimizar_policies_rls() = 0 and public.separar_policies_de_escrita() = 0,
        'R3: reexecutar a otimização não altera mais nada (idempotente)');

    select string_agg(p.tablename || '.' || p.policyname, ', ')
      into v_all
    from pg_policies p
    where p.schemaname = 'public' and p.cmd = 'ALL'
      and exists (select 1 from pg_policies s
                  where s.schemaname = 'public' and s.tablename = p.tablename and s.cmd = 'SELECT');
    perform public.assert(v_all is null,
        'R4: nenhuma tabela com policy de leitura + escrita FOR ALL (restantes: ' || coalesce(v_all, 'nenhuma') || ')');

    perform public.assert(
        (select count(*) from pg_policies where schemaname = 'public' and tablename = 'produtos'
          and policyname in ('produtos_escrita_admin_insert', 'produtos_escrita_admin_update', 'produtos_escrita_admin_delete')) = 3
        and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'produtos' and policyname = 'produtos_escrita_admin'),
        'R4: policy FOR ALL recriada por migration antiga volta a ser separada em insert/update/delete');

    -- O planejador enxerga a coluna: o tenant vira InitPlan (1x por consulta)
    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    for v_linha in execute 'explain (costs off) select id from public.negocios' loop
        v_plano := v_plano || v_linha || E'\n';
    end loop;
    perform public.login_admin();
    perform public.assert(v_plano ~ 'InitPlan' and v_plano !~ 'tenant_filter',
        'R5: plano de negocios usa InitPlan para o tenant, sem tenant_filter() por linha');
end $$;

-- ---------------------------------------------------------------------
-- I — isolamento continua igual depois da reescrita
-- ---------------------------------------------------------------------
do $$
declare
    v_user_a uuid := (select valor from crm_teste.ctx where chave = 'user_a');
    v_user_b uuid := (select valor from crm_teste.ctx where chave = 'user_b');
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_lead uuid;
    v_visto_por_b integer;
    v_alterado_por_b integer;
    v_forjado_ok boolean := true;
begin
    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    insert into public.clientes (nome, status) values ('Lead da suíte 13', 'Novo Lead') returning id into v_lead;
    perform public.login_admin();
    insert into crm_teste.ctx values ('s13_lead', v_lead) on conflict (chave) do update set valor = excluded.valor;

    -- B tenta ler e alterar, inclusive forjando o header da empresa A
    perform public.login_como(v_user_b, 'vendedor.b@teste.com', v_tenant_a);
    select count(*) into v_visto_por_b from public.negocios where id = v_lead;
    update public.negocios set titulo = 'Tomado por B' where id = v_lead;
    get diagnostics v_alterado_por_b = row_count;
    begin
        insert into public.tarefas (titulo, tenant_id) values ('Tarefa plantada em A', v_tenant_a);
        v_forjado_ok := not exists (select 1 from public.tarefas where titulo = 'Tarefa plantada em A' and tenant_id = v_tenant_a);
    exception when others then
        v_forjado_ok := true;
    end;
    perform public.login_admin();

    perform public.assert(v_visto_por_b = 0 and v_alterado_por_b = 0,
        'I1: usuário do tenant B não lê nem altera negócio do A (header forjado ignorado)');
    perform public.assert(
        v_forjado_ok and not exists (select 1 from public.tarefas where titulo = 'Tarefa plantada em A' and tenant_id = v_tenant_a),
        'I2: tenant_id do payload não planta registro em outra empresa');
    perform public.assert((select tenant_id from public.negocios where id = v_lead) = v_tenant_a,
        'I3: uso legítimo — lead do A criado no A');
end $$;

-- ---------------------------------------------------------------------
-- E — equipe (P1-01)
-- ---------------------------------------------------------------------
do $$
declare
    v_user_a uuid := (select valor from crm_teste.ctx where chave = 'user_a');
    v_user_b uuid := (select valor from crm_teste.ctx where chave = 'user_b');
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_solto uuid := gen_random_uuid();
    v_de_outro uuid := gen_random_uuid();
    v_velho uuid := gen_random_uuid();
    r_v1 jsonb;
    r_v2 jsonb;
    r_puxar_b jsonb;
    r_sem_marca jsonb;
    r_marca_outro jsonb;
    r_expirado jsonb;
    r_vend_prepara jsonb;
    r_vend_remove jsonb;
    v_v1 uuid;
    v_v2 uuid;
    v_escreve_auth text;
begin
    perform public.assert(
        to_regprocedure('public.criar_usuario_equipe(text, text, text, text, text)') is null
        and to_regprocedure('public.excluir_usuario_equipe(uuid)') is null,
        'E1: RPCs antigas (gravavam em auth.users) removidas pela migration 18');

    select string_agg(p.proname, ', ') into v_escreve_auth
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+auth\.';
    perform public.assert(v_escreve_auth is null,
        'E2: nenhuma função do schema public escreve em auth.* (restantes: ' || coalesce(v_escreve_auth, 'nenhuma') || ')');

    -- uso legítimo: gerente cadastra dois vendedores
    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    r_v1 := crm_teste.equipe_criar('s13.v1@teste.com', 'senhaforte123', 'Vendedor Um', 'Vendedor', 'vendedor');
    r_v2 := crm_teste.equipe_criar('s13.v2@teste.com', 'senhaforte123', 'Vendedor Dois', 'Vendedor', 'vendedor');
    perform public.login_admin();
    v_v1 := (r_v1 ->> 'user_id')::uuid;
    v_v2 := (r_v2 ->> 'user_id')::uuid;
    perform public.assert((r_v1 ->> 'success')::boolean and (r_v2 ->> 'success')::boolean
        and exists (select 1 from public.utilizadores_empresas where auth_uid = v_v1 and empresa_id = v_tenant_a and role = 'vendedor')
        and exists (select 1 from public.funcionarios where id = v_v2 and tenant_id = v_tenant_a and ativo),
        'E3: uso legítimo — gerente cadastra vendedores (login + funcionário + vínculo)');
    insert into crm_teste.ctx values ('s13_v1', v_v1), ('s13_v2', v_v2)
        on conflict (chave) do update set valor = excluded.valor;

    -- ataques: gerente chama o passo 2 na mão
    insert into auth.users (id, email, created_at) values (v_solto, 's13.solto@teste.com', now());
    insert into auth.users (id, email, created_at, raw_app_meta_data) values
        (v_de_outro, 's13.outro@teste.com', now(),
         jsonb_build_object('crm_equipe_tenant', v_tenant_a::text, 'crm_equipe_criado_por', v_user_b::text)),
        (v_velho, 's13.velho@teste.com', now() - interval '1 hour',
         jsonb_build_object('crm_equipe_tenant', v_tenant_a::text, 'crm_equipe_criado_por', v_user_a::text));

    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    r_puxar_b := public.equipe_concluir_criacao(v_user_b, 'Gerente do B', 'x', 'vendedor');
    r_sem_marca := public.equipe_concluir_criacao(v_solto, 'Conta Solta', 'x', 'gerente');
    r_marca_outro := public.equipe_concluir_criacao(v_de_outro, 'Marca de Outro', 'x', 'vendedor');
    r_expirado := public.equipe_concluir_criacao(v_velho, 'Convite Velho', 'x', 'vendedor');
    perform public.login_admin();

    perform public.assert(
        not (r_puxar_b ->> 'success')::boolean and not (r_sem_marca ->> 'success')::boolean
        and not (r_marca_outro ->> 'success')::boolean and not (r_expirado ->> 'success')::boolean
        and not exists (select 1 from public.utilizadores_empresas
                        where empresa_id = v_tenant_a and auth_uid in (v_user_b, v_solto, v_de_outro, v_velho))
        and (select count(*) from public.utilizadores_empresas where auth_uid = v_user_b) = 1,
        'E4: gerente não puxa conta existente, sem marca, marcada por outro gerente ou expirada para a empresa dele');

    -- vendedor não prepara nem remove
    perform public.login_como(v_v1, 's13.v1@teste.com');
    r_vend_prepara := public.equipe_preparar_criacao('s13.intruso@teste.com', 'Intruso');
    r_vend_remove := public.equipe_remover_membro(v_v2);
    perform public.login_admin();
    perform public.assert(not (r_vend_prepara ->> 'success')::boolean and not (r_vend_remove ->> 'success')::boolean
        and exists (select 1 from public.utilizadores_empresas where auth_uid = v_v2),
        'E5: vendedor não cadastra nem remove membro');

    delete from auth.users where id in (v_solto, v_de_outro, v_velho);
end $$;

-- ---------------------------------------------------------------------
-- H — histórico inviolável (P2-01)
-- ---------------------------------------------------------------------
do $$
declare
    v_user_a uuid := (select valor from crm_teste.ctx where chave = 'user_a');
    v_user_b uuid := (select valor from crm_teste.ctx where chave = 'user_b');
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_lead uuid := (select valor from crm_teste.ctx where chave = 's13_lead');
    v_v1 uuid := (select valor from crm_teste.ctx where chave = 's13_v1');
    v_v2 uuid := (select valor from crm_teste.ctx where chave = 's13_v2');
    v_etapa bigint;
    v_etapa_nome text;
    v_nota bigint;
    v_sistema bigint;
    v_n integer;
    v_ins boolean := false;
    v_upd boolean := false;
    v_del boolean := false;
    v_visto_por_b integer;
begin
    -- cliente_status_history: a API só lê
    perform public.login_como(v_v1, 's13.v1@teste.com');
    begin
        insert into public.cliente_status_history (de_status, para_status, movido_por)
        values ('Perdido', 'Ganho', 'Fulano inventado');
    exception when insufficient_privilege then v_ins := true;
    end;
    begin
        update public.cliente_status_history set para_status = 'Ganho';
    exception when insufficient_privilege then v_upd := true;
    end;
    begin
        delete from public.cliente_status_history;
    exception when insufficient_privilege then v_del := true;
    end;
    perform public.login_admin();
    perform public.assert(v_ins and v_upd and v_del,
        'H1: API não insere, altera nem apaga cliente_status_history');

    -- mudança de etapa pela tela continua gerando a linha do sistema
    select s.id, s.nome into v_etapa, v_etapa_nome
    from public.pipeline_stages s
    where s.tenant_id = v_tenant_a
      and s.id is distinct from (select stage_id from public.negocios where id = v_lead)
    order by s.ordem limit 1;

    perform public.login_como(v_v1, 's13.v1@teste.com');
    update public.clientes set stage_id = v_etapa, status = v_etapa_nome where id = v_lead;
    perform public.login_admin();

    select a.id into v_sistema
    from public.atividades_lead a
    where a.cliente_id = v_lead::text and a.tenant_id = v_tenant_a and a.created_by is null
    order by a.id desc limit 1;
    perform public.assert(v_sistema is not null,
        'H2: uso legítimo — mover o card grava a linha de histórico como "do sistema" (created_by nulo)');

    -- anotação manual: o autor é o do JWT, não o do payload
    perform public.login_como(v_v1, 's13.v1@teste.com');
    insert into public.atividades_lead (cliente_id, tipo, titulo, descricao, created_by)
    values (v_lead::text, 'nota', 'Ligação', 'Cliente pediu retorno', v_user_a)
    returning id into v_nota;
    perform public.login_admin();
    perform public.assert((select created_by from public.atividades_lead where id = v_nota) = v_v1,
        'H3: autor da atividade é carimbado pelo banco (created_by do payload ignorado)');

    -- colega não altera nem apaga a anotação do outro
    perform public.login_como(v_v2, 's13.v2@teste.com');
    update public.atividades_lead set descricao = 'Adulterado pelo colega' where id = v_nota;
    get diagnostics v_n = row_count;
    perform public.assert(v_n = 0, 'H4: vendedor não altera atividade de outro vendedor');
    delete from public.atividades_lead where id = v_nota;
    get diagnostics v_n = row_count;
    perform public.assert(v_n = 0, 'H4: vendedor não apaga atividade de outro vendedor');

    -- ninguém mexe na linha do sistema — nem o gerente
    update public.atividades_lead set descricao = 'x' where id = v_sistema;
    get diagnostics v_n = row_count;
    perform public.assert(v_n = 0, 'H5: vendedor não altera linha de histórico do sistema');
    perform public.login_admin();
    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    delete from public.atividades_lead where id = v_sistema;
    get diagnostics v_n = row_count;
    perform public.assert(v_n = 0, 'H5: nem o gerente apaga linha de histórico do sistema');
    perform public.login_admin();

    -- o autor edita a própria anotação, mas não troca o autor
    perform public.login_como(v_v1, 's13.v1@teste.com');
    update public.atividades_lead set descricao = 'Corrigido pelo autor', created_by = v_v2 where id = v_nota;
    get diagnostics v_n = row_count;
    perform public.login_admin();
    perform public.assert(v_n = 1
        and (select descricao from public.atividades_lead where id = v_nota) = 'Corrigido pelo autor'
        and (select created_by from public.atividades_lead where id = v_nota) = v_v1,
        'H6: uso legítimo — autor corrige a própria anotação; a autoria não muda');

    -- outra empresa não enxerga
    perform public.login_como(v_user_b, 'vendedor.b@teste.com', v_tenant_a);
    select count(*) into v_visto_por_b from public.atividades_lead where id in (v_nota, v_sistema);
    perform public.login_admin();
    perform public.assert(v_visto_por_b = 0, 'H7: tenant B não lê a timeline do A');

    -- gerente apaga anotação manual de um vendedor
    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    delete from public.atividades_lead where id = v_nota;
    get diagnostics v_n = row_count;
    perform public.login_admin();
    perform public.assert(v_n = 1, 'H8: uso legítimo — gerente apaga anotação manual da equipe');
end $$;

-- ---------------------------------------------------------------------
-- E (cont.) — remoção: login só some quando não sobra empresa
-- ---------------------------------------------------------------------
do $$
declare
    v_user_a uuid := (select valor from crm_teste.ctx where chave = 'user_a');
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_v1 uuid := (select valor from crm_teste.ctx where chave = 's13_v1');
    v_v2 uuid := (select valor from crm_teste.ctx where chave = 's13_v2');
    r1 jsonb;
    r2 jsonb;
begin
    -- v2 também pertence à empresa B
    insert into public.utilizadores_empresas (auth_uid, empresa_id, role) values (v_v2, v_tenant_b, 'vendedor');

    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    r1 := crm_teste.equipe_remover(v_v1);
    r2 := crm_teste.equipe_remover(v_v2);
    perform public.login_admin();

    perform public.assert((r1 ->> 'success')::boolean and (r1 ->> 'apagar_login')::boolean
        and not exists (select 1 from auth.users where id = v_v1)
        and exists (select 1 from public.funcionarios where id = v_v1 and deleted_at is not null and not ativo),
        'E6: membro só desta empresa — vínculo desfeito, funcionário na lixeira, login apagado');
    perform public.assert((r2 ->> 'success')::boolean and not (r2 ->> 'apagar_login')::boolean
        and exists (select 1 from auth.users where id = v_v2)
        and exists (select 1 from public.utilizadores_empresas where auth_uid = v_v2 and empresa_id = v_tenant_b),
        'E7: membro com outra empresa — sai só desta; o login e o outro vínculo ficam');

    delete from public.utilizadores_empresas where auth_uid = v_v2;
    delete from auth.users where id = v_v2;
end $$;

-- ---------------------------------------------------------------------
-- C — cadastro de novas empresas fechado por padrão (P1-03)
-- ---------------------------------------------------------------------
do $$
declare
    v_novo uuid := gen_random_uuid();
    v_antes integer;
    v_bloqueado boolean := false;
    v_msg text;
    v_tenant uuid;
    v_le_config boolean := true;
begin
    perform public.assert(
        (select column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'plataforma_config' and column_name = 'cadastro_aberto') = 'false',
        'C1: cadastro de empresas nasce FECHADO num banco novo');

    insert into auth.users (id, email) values (v_novo, 's13.visitante@teste.com');
    update public.plataforma_config set cadastro_aberto = false;
    select count(*) into v_antes from public.empresas;

    perform public.login_como(v_novo, 's13.visitante@teste.com');
    begin
        perform public.provisionar_tenant('Empresa do Visitante', 'energia_solar');
    exception when sqlstate 'P0001' then
        v_bloqueado := true;
        v_msg := sqlerrm;
    end;
    begin
        perform 1 from public.plataforma_config;
        v_le_config := true;
    exception when insufficient_privilege then
        v_le_config := false;
    end;
    perform public.login_admin();

    perform public.assert(v_bloqueado and v_msg ~ 'cadastro de novas empresas está fechado'
        and (select count(*) from public.empresas) = v_antes
        and not exists (select 1 from public.utilizadores_empresas where auth_uid = v_novo),
        'C2: com o cadastro fechado, a API não cria empresa (nada fica pela metade)');
    perform public.assert(not v_le_config, 'C3: a API não lê nem altera plataforma_config');

    update public.plataforma_config set cadastro_aberto = true;
    perform public.login_como(v_novo, 's13.visitante@teste.com');
    v_tenant := public.provisionar_tenant('Empresa do Visitante', 'energia_solar');
    perform public.login_admin();
    perform public.assert(v_tenant is not null
        and exists (select 1 from public.utilizadores_empresas where auth_uid = v_novo and empresa_id = v_tenant),
        'C4: uso legítimo — com o cadastro aberto pelo operador, quem se cadastra cria a empresa e vira gerente');
end $$;

do $$
begin
    raise notice '';
    raise notice '===============================================';
    raise notice 'MIGRATION 18 VALIDADA (equipe, cadastro, histórico, RLS)';
    raise notice '===============================================';
end $$;
