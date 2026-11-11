-- =====================================================================
-- TESTES DA MIGRATION 12 — papéis, exclusão, lixeira e equipe
--
-- Regras do Richard (2026-11-03), provadas aqui dos dois lados:
--   (a) o que não pode, falha — inclusive pela API direta;
--   (b) o que pode, continua funcionando.
--
--   * Gerente faz tudo na empresa.
--   * Vendedor VÊ os leads dos colegas, mas só EXCLUI/RESTAURA os seus.
--   * Excluir vai para a lixeira; DELETE físico só o gerente.
--   * Configuração e equipe: só o gerente.
--
-- Roda depois das suítes 01–05 (reaproveita tenants de crm_teste.ctx).
-- =====================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------
-- CENÁRIO — empresa A: gerente (user_a, papel admin), gerente2 (papel
-- "gerente"), vendedor Ana e vendedor Bruno.
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_ana uuid := gen_random_uuid();
    v_bruno uuid := gen_random_uuid();
    v_gerente2 uuid := gen_random_uuid();
begin
    insert into auth.users (id, email) values
        (v_ana, 'ana.vendas@teste.com'),
        (v_bruno, 'bruno.vendas@teste.com'),
        (v_gerente2, 'gerente.dois@teste.com');
    insert into public.utilizadores_empresas (auth_uid, empresa_id, role) values
        (v_ana, v_tenant_a, 'vendedor'),
        (v_bruno, v_tenant_a, 'vendedor'),
        (v_gerente2, v_tenant_a, 'gerente');
    insert into public.funcionarios (id, user_id, nome, email, cargo, ativo, tenant_id) values
        (v_ana, v_ana, 'Ana Vendas', 'ana.vendas@teste.com', 'Vendedora', true, v_tenant_a),
        (v_bruno, v_bruno, 'Bruno Vendas', 'bruno.vendas@teste.com', 'Vendedor', true, v_tenant_a);
    insert into crm_teste.ctx values ('ana', v_ana), ('bruno', v_bruno), ('gerente2', v_gerente2)
    on conflict (chave) do update set valor = excluded.valor;
end $$;

-- ---------------------------------------------------------------------
-- P1 — papel: "gerente" é gerente; vendedor não é
-- ---------------------------------------------------------------------
do $$
declare
    v_g2 boolean;
    v_ana boolean;
    v_admin boolean;
begin
    perform public.login_como((select valor from crm_teste.ctx where chave = 'gerente2'), 'gerente.dois@teste.com');
    v_g2 := public.eh_admin_do_tenant();
    perform public.login_admin();
    perform public.login_como((select valor from crm_teste.ctx where chave = 'ana'), 'ana.vendas@teste.com');
    v_ana := public.eh_admin_do_tenant();
    perform public.login_admin();
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    v_admin := public.eh_admin_do_tenant();
    perform public.login_admin();

    perform public.assert(v_g2, 'P1: papel "gerente" é reconhecido como gerente no banco');
    perform public.assert(v_admin, 'P1: papel "admin" (quem criou a empresa) segue gerente');
    perform public.assert(not v_ana, 'P1: vendedor não é gerente');
end $$;

-- ---------------------------------------------------------------------
-- E1..E8 — LEADS (negócios pela view clientes, como a tela faz)
-- ---------------------------------------------------------------------
do $$
declare
    v_ana uuid := (select valor from crm_teste.ctx where chave = 'ana');
    v_bruno uuid := (select valor from crm_teste.ctx where chave = 'bruno');
    v_user_a uuid := (select valor from crm_teste.ctx where chave = 'user_a');
    v_lead_ana uuid;
    v_lead_ana2 uuid;
    v_lead_gerente_p_ana uuid;
    v_lead_descartavel uuid;
    v_created_by uuid;
    v_bruno_le bigint;
    v_bruno_editou bigint;
    v_bloq_excluir boolean := false;
    v_bloq_update boolean := false;
    v_bloq_tomar boolean := false;
    v_bloq_autor boolean := false;
    v_bloq_fisico boolean := false;
    v_bloq_restaurar boolean := false;
    v_deleted_by uuid;
    v_restaurou boolean;
    v_ana_excluiu_atribuido boolean := false;
    v_gerente_ok boolean := false;
    v_existe bigint;
begin
    -- Ana cadastra dois leads
    perform public.login_como(v_ana, 'ana.vendas@teste.com');
    insert into public.clientes (nome, status, responsavel) values ('Lead da Ana', 'Novo Lead', 'Ana Vendas');
    insert into public.clientes (nome, status, responsavel) values ('Lead da Ana 2', 'Novo Lead', 'Ana Vendas');
    perform public.login_admin();
    select id, created_by into v_lead_ana, v_created_by from public.negocios where titulo = 'Lead da Ana';
    select id into v_lead_ana2 from public.negocios where titulo = 'Lead da Ana 2';

    -- Gerente cadastra um lead e atribui à Ana
    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    insert into public.clientes (nome, status, responsavel) values ('Lead do gerente para Ana', 'Novo Lead', 'Ana Vendas');
    insert into public.clientes (nome, status, responsavel) values ('Lead descartável', 'Novo Lead', 'Bruno Vendas');
    perform public.login_admin();
    select id into v_lead_gerente_p_ana from public.negocios where titulo = 'Lead do gerente para Ana';
    select id into v_lead_descartavel from public.negocios where titulo = 'Lead descartável';

    -- Bruno (outro vendedor) VÊ e EDITA o lead da Ana, mas não exclui
    perform public.login_como(v_bruno, 'bruno.vendas@teste.com');
    select count(*) into v_bruno_le from public.clientes where id = v_lead_ana;
    update public.negocios set temperatura = 'quente' where id = v_lead_ana;
    get diagnostics v_bruno_editou = row_count;
    begin
        delete from public.clientes where id = v_lead_ana;
    exception when insufficient_privilege then
        v_bloq_excluir := true;
    end;
    begin
        update public.negocios set deleted_at = now() where id = v_lead_ana;
    exception when insufficient_privilege then
        v_bloq_update := true;
    end;
    begin
        update public.negocios set responsavel = 'Bruno Vendas' where id = v_lead_ana;
    exception when insufficient_privilege then
        v_bloq_tomar := true;
    end;
    begin
        update public.negocios set created_by = v_bruno where id = v_lead_ana;
    exception when insufficient_privilege then
        v_bloq_autor := true;
    end;
    perform public.login_admin();

    perform public.assert(v_created_by = v_ana, 'E1: lead registra quem cadastrou (created_by)');
    perform public.assert(v_bruno_le = 1, 'E2b: vendedor VÊ o lead de outro vendedor');
    perform public.assert(v_bruno_editou = 1, 'E2b: vendedor segue editando o lead do colega (só a exclusão é travada)');
    perform public.assert(v_bloq_excluir, 'E2a: vendedor NÃO exclui lead de outro vendedor (tela/view)');
    perform public.assert(v_bloq_update, 'E2a: vendedor NÃO exclui lead de outro vendedor (API direta, deleted_at)');
    perform public.assert(v_bloq_tomar, 'E3a: vendedor NÃO toma para si o lead de outro (para depois excluir)');
    perform public.assert(v_bloq_autor, 'E3a: ninguém altera o autor (created_by) pela API');
    perform public.assert(
        (select deleted_at is null and responsavel = 'Ana Vendas' from public.negocios where id = v_lead_ana),
        'E2a: o lead da Ana segue intacto depois das tentativas'
    );

    -- Ana exclui o próprio lead (vai para a lixeira) e restaura
    perform public.login_como(v_ana, 'ana.vendas@teste.com');
    delete from public.clientes where id = v_lead_ana;
    perform public.login_admin();
    select deleted_by into v_deleted_by from public.negocios where id = v_lead_ana and deleted_at is not null;

    -- Bruno não restaura o lead da Ana
    perform public.login_como(v_bruno, 'bruno.vendas@teste.com');
    begin
        perform public.restaurar_registro('negocios', v_lead_ana::text);
    exception when insufficient_privilege then
        v_bloq_restaurar := true;
    end;
    perform public.login_admin();

    perform public.login_como(v_ana, 'ana.vendas@teste.com');
    v_restaurou := public.restaurar_registro('negocios', v_lead_ana::text);
    -- lead atribuído a ela pelo gerente também é "dela"
    begin
        delete from public.clientes where id = v_lead_gerente_p_ana;
        v_ana_excluiu_atribuido := true;
    exception when insufficient_privilege then
        v_ana_excluiu_atribuido := false;
    end;
    -- DELETE físico direto na tabela: nem no próprio lead
    begin
        delete from public.negocios where id = v_lead_ana2;
    exception when insufficient_privilege then
        v_bloq_fisico := true;
    end;
    perform public.login_admin();

    perform public.assert(v_deleted_by = v_ana, 'E4b: vendedor exclui o PRÓPRIO lead (lixeira registra quem excluiu)');
    perform public.assert(v_bloq_restaurar, 'E4a: vendedor não restaura lead de outro vendedor');
    perform public.assert(v_restaurou and (select deleted_at is null and deleted_by is null from public.negocios where id = v_lead_ana),
        'E4b: vendedor restaura o próprio lead da lixeira');
    perform public.assert(v_ana_excluiu_atribuido, 'E5b: lead atribuído ao vendedor pelo gerente conta como dele');
    perform public.assert(v_bloq_fisico, 'E6a: DELETE físico é só do gerente (vendedor usa a lixeira)');

    -- Gerente: exclui o de qualquer um, restaura e apaga de vez
    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    delete from public.clientes where id = v_lead_ana2;
    perform public.restaurar_registro('negocios', v_lead_ana2::text);
    delete from public.negocios where id = v_lead_descartavel;
    v_gerente_ok := true;
    perform public.login_admin();
    select count(*) into v_existe from public.negocios where id = v_lead_descartavel;

    perform public.assert(v_gerente_ok and v_existe = 0, 'E7b: gerente exclui, restaura e apaga definitivamente lead de qualquer vendedor');
    perform public.assert((select deleted_at is null from public.negocios where id = v_lead_ana2), 'E7b: restauração do gerente vale');

    insert into crm_teste.ctx values ('lead_ana', v_lead_ana)
    on conflict (chave) do update set valor = excluded.valor;
end $$;

-- ---------------------------------------------------------------------
-- E8 — AGENDAMENTOS (tarefas): lixeira com as mesmas regras
-- ---------------------------------------------------------------------
do $$
declare
    v_ana uuid := (select valor from crm_teste.ctx where chave = 'ana');
    v_bruno uuid := (select valor from crm_teste.ctx where chave = 'bruno');
    v_user_a uuid := (select valor from crm_teste.ctx where chave = 'user_a');
    v_lead uuid := (select valor from crm_teste.ctx where chave = 'lead_ana');
    v_tarefa_ana bigint;
    v_tarefa_legada bigint;
    v_bloq_bruno boolean := false;
    v_bloq_legada boolean := false;
    v_na_lixeira boolean;
    v_restaurou boolean;
begin
    perform public.login_como(v_ana, 'ana.vendas@teste.com');
    insert into public.tarefas (titulo, tipo, cliente_id, responsavel, data_vencimento)
    values ('Ligar para o lead', 'ligacao', v_lead::text, 'Ana Vendas', now() + interval '1 day')
    returning id into v_tarefa_ana;
    perform public.login_admin();

    -- tarefa antiga, sem autor e sem responsável: só o gerente exclui
    insert into public.tarefas (tenant_id, titulo, tipo)
    values ((select valor from crm_teste.ctx where chave = 'tenant_a'), 'Tarefa antiga', 'visita')
    returning id into v_tarefa_legada;

    perform public.login_como(v_bruno, 'bruno.vendas@teste.com');
    begin
        update public.tarefas set deleted_at = now() where id = v_tarefa_ana;
    exception when insufficient_privilege then
        v_bloq_bruno := true;
    end;
    begin
        update public.tarefas set deleted_at = now() where id = v_tarefa_legada;
    exception when insufficient_privilege then
        v_bloq_legada := true;
    end;
    perform public.login_admin();

    perform public.login_como(v_ana, 'ana.vendas@teste.com');
    update public.tarefas set deleted_at = now() where id = v_tarefa_ana;
    perform public.login_admin();
    select deleted_at is not null into v_na_lixeira from public.tarefas where id = v_tarefa_ana;

    perform public.login_como(v_ana, 'ana.vendas@teste.com');
    v_restaurou := public.restaurar_registro('tarefas', v_tarefa_ana::text);
    perform public.login_admin();

    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    update public.tarefas set deleted_at = now() where id = v_tarefa_legada;
    perform public.login_admin();

    perform public.assert(v_bloq_bruno, 'E8a: vendedor não exclui agendamento de outro vendedor');
    perform public.assert(v_bloq_legada, 'E8a: agendamento antigo sem dono só o gerente exclui');
    perform public.assert(v_na_lixeira, 'E8b: vendedor manda o próprio agendamento para a lixeira');
    perform public.assert(v_restaurou, 'E8b: e restaura');
    perform public.assert((select deleted_at is not null from public.tarefas where id = v_tarefa_legada), 'E8b: gerente exclui qualquer agendamento');
end $$;

-- ---------------------------------------------------------------------
-- E9 — CONTATOS e ORGANIZAÇÕES
-- ---------------------------------------------------------------------
do $$
declare
    v_ana uuid := (select valor from crm_teste.ctx where chave = 'ana');
    v_bruno uuid := (select valor from crm_teste.ctx where chave = 'bruno');
    v_pessoa uuid;
    v_org uuid;
    v_bloq_pessoa boolean := false;
    v_bloq_org boolean := false;
begin
    perform public.login_como(v_ana, 'ana.vendas@teste.com');
    insert into public.pessoas (nome) values ('Contato da Ana') returning id into v_pessoa;
    insert into public.organizacoes (razao_social) values ('Organização da Ana') returning id into v_org;
    perform public.login_admin();

    perform public.login_como(v_bruno, 'bruno.vendas@teste.com');
    begin
        update public.pessoas set deleted_at = now() where id = v_pessoa;
    exception when insufficient_privilege then
        v_bloq_pessoa := true;
    end;
    begin
        update public.organizacoes set deleted_at = now() where id = v_org;
    exception when insufficient_privilege then
        v_bloq_org := true;
    end;
    perform public.login_admin();

    perform public.login_como(v_ana, 'ana.vendas@teste.com');
    update public.pessoas set deleted_at = now() where id = v_pessoa;
    update public.organizacoes set deleted_at = now() where id = v_org;
    perform public.login_admin();

    perform public.assert(v_bloq_pessoa and v_bloq_org, 'E9a: vendedor não exclui contato/organização de outro');
    perform public.assert(
        (select deleted_at is not null from public.pessoas where id = v_pessoa)
        and (select deleted_at is not null from public.organizacoes where id = v_org),
        'E9b: vendedor exclui o próprio contato e a própria organização'
    );
end $$;

-- ---------------------------------------------------------------------
-- C1 — CONFIGURAÇÃO E METAS: só gerente
-- ---------------------------------------------------------------------
do $$
declare
    v_ana uuid := (select valor from crm_teste.ctx where chave = 'ana');
    v_g2 uuid := (select valor from crm_teste.ctx where chave = 'gerente2');
    v_bloq_motivo boolean := false;
    v_bloq_etapa boolean := false;
    v_bloq_meta boolean := false;
    v_bloq_func boolean := false;
    v_le_motivos bigint;
begin
    perform public.login_como(v_ana, 'ana.vendas@teste.com');
    begin
        insert into public.motivos_perda (nome) values ('Motivo criado pelo vendedor');
    exception when insufficient_privilege then
        v_bloq_motivo := true;
    end;
    begin
        update public.pipeline_stages set nome = nome || ' (x)'
        where tenant_id = public.current_tenant_id();
    exception when insufficient_privilege then
        v_bloq_etapa := true;
    end;
    begin
        insert into public.metas (funcionario_id, valor_meta) values (v_ana, 999999);
    exception when insufficient_privilege then
        v_bloq_meta := true;
    end;
    begin
        update public.funcionarios set ativo = false where nome = 'Bruno Vendas';
    exception when insufficient_privilege then
        v_bloq_func := true;
    end;
    select count(*) into v_le_motivos from public.motivos_perda;
    perform public.login_admin();

    perform public.login_como(v_g2, 'gerente.dois@teste.com');
    insert into public.motivos_perda (nome) values ('Motivo do gerente');
    insert into public.metas (funcionario_id, valor_meta) values (v_ana, 50000);
    perform public.login_admin();

    perform public.assert(v_bloq_motivo and v_bloq_etapa, 'C1a: vendedor não altera funil, etapas nem motivos de perda');
    perform public.assert(v_bloq_meta, 'C1a: vendedor não define a própria meta');
    perform public.assert(v_bloq_func, 'C1a: vendedor não desativa colega da equipe');
    perform public.assert(v_le_motivos > 0, 'C1b: vendedor segue LENDO a configuração (motivos de perda)');
    perform public.assert(
        exists (select 1 from public.motivos_perda where nome = 'Motivo do gerente')
        and exists (select 1 from public.metas where funcionario_id = v_ana and valor_meta = 50000),
        'C1b: gerente configura motivos e metas'
    );
end $$;

-- ---------------------------------------------------------------------
-- T1..T3 — EQUIPE: criar, mudar papel e remover
-- ---------------------------------------------------------------------
do $$
declare
    v_ana uuid := (select valor from crm_teste.ctx where chave = 'ana');
    v_user_a uuid := (select valor from crm_teste.ctx where chave = 'user_a');
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_user_b uuid := (select valor from crm_teste.ctx where chave = 'user_b');
    r_vend jsonb;
    r_ok jsonb;
    r_dup jsonb;
    r_senha jsonb;
    r_forjado jsonb;
    r_papel_vend jsonb;
    r_papel_ok jsonb;
    r_papel_self jsonb;
    r_exc_vend jsonb;
    r_exc_self jsonb;
    r_exc_outro_tenant jsonb;
    r_exc_ok jsonb;
    v_novo uuid;
    v_anon_bloqueado boolean := false;
begin
    -- vendedor não cria usuário
    perform public.login_como(v_ana, 'ana.vendas@teste.com');
    r_vend := crm_teste.equipe_criar('intruso@teste.com', 'senhaforte123', 'Intruso', 'Vendedor', 'admin');
    perform public.login_admin();

    -- chave pública nem executa
    perform public.login_anon();
    begin
        perform public.equipe_preparar_criacao('anon@teste.com', 'Anon');
    exception when insufficient_privilege then
        v_anon_bloqueado := true;
    end;
    perform public.login_admin();

    -- gerente cria (header forjado para o B não muda a empresa de destino)
    perform public.login_como(v_user_a, 'vendedor.a@teste.com', v_tenant_b);
    r_forjado := crm_teste.equipe_criar('carla.vendas@teste.com', 'senhaforte123', 'Carla Vendas', 'Vendedora', 'vendedor');
    r_dup := crm_teste.equipe_criar('carla.vendas@teste.com', 'senhaforte123', 'Carla 2', 'Vendedora', 'vendedor');
    r_senha := crm_teste.equipe_criar('curta@teste.com', '123', 'Senha Curta', 'Vendedora', 'vendedor');
    perform public.login_admin();
    v_novo := (r_forjado ->> 'user_id')::uuid;

    perform public.assert(not (r_vend ->> 'success')::boolean, 'T1a: vendedor não cadastra usuário');
    perform public.assert(not exists (select 1 from auth.users where email = 'intruso@teste.com'), 'T1a: nenhuma conta criada pelo vendedor');
    perform public.assert(v_anon_bloqueado, 'T1a: chave pública (anon) não executa equipe_preparar_criacao');
    perform public.assert((r_forjado ->> 'success')::boolean, 'T1b: gerente cadastra membro');
    perform public.assert(
        exists (select 1 from public.utilizadores_empresas where auth_uid = v_novo and empresa_id = v_tenant_a and role = 'vendedor')
        and exists (select 1 from public.funcionarios where id = v_novo and tenant_id = v_tenant_a)
        and exists (select 1 from auth.users where id = v_novo and encrypted_password is not null and email_confirmed_at is not null),
        'T1b: login + funcionário + vínculo criados na empresa ATIVA (header forjado ignorado)'
    );
    perform public.assert(not (r_dup ->> 'success')::boolean, 'T1a: e-mail repetido é recusado');
    perform public.assert(not (r_senha ->> 'success')::boolean, 'T1a: senha curta é recusada');

    -- papel
    perform public.login_como(v_ana, 'ana.vendas@teste.com');
    r_papel_vend := public.alterar_papel_membro(v_novo, 'gerente');
    perform public.login_admin();
    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    r_papel_ok := public.alterar_papel_membro(v_novo, 'gerente');
    r_papel_self := public.alterar_papel_membro(v_user_a, 'vendedor');
    perform public.login_admin();

    perform public.assert(not (r_papel_vend ->> 'success')::boolean, 'T2a: vendedor não promove ninguém (nem a si)');
    perform public.assert((r_papel_ok ->> 'success')::boolean
        and (select role from public.utilizadores_empresas where auth_uid = v_novo) = 'gerente',
        'T2b: gerente promove membro a gerente');
    perform public.assert(not (r_papel_self ->> 'success')::boolean, 'T2a: ninguém altera o próprio papel');

    -- remover
    perform public.login_como(v_ana, 'ana.vendas@teste.com');
    r_exc_vend := crm_teste.equipe_remover(v_novo);
    perform public.login_admin();
    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    r_exc_self := crm_teste.equipe_remover(v_user_a);
    r_exc_outro_tenant := crm_teste.equipe_remover(v_user_b);
    r_exc_ok := crm_teste.equipe_remover(v_novo);
    perform public.login_admin();

    perform public.assert(not (r_exc_vend ->> 'success')::boolean, 'T3a: vendedor não remove membro');
    perform public.assert(not (r_exc_self ->> 'success')::boolean, 'T3a: gerente não remove a si mesmo');
    perform public.assert(not (r_exc_outro_tenant ->> 'success')::boolean
        and exists (select 1 from auth.users where id = v_user_b),
        'T3a: gerente do A não remove usuário do B');
    perform public.assert((r_exc_ok ->> 'success')::boolean
        and not exists (select 1 from public.utilizadores_empresas where auth_uid = v_novo)
        and not exists (select 1 from auth.users where id = v_novo)
        and exists (select 1 from public.funcionarios where id = v_novo and deleted_at is not null and ativo = false),
        'T3b: gerente remove membro (sem login, funcionário na lixeira, histórico preservado)');
end $$;

-- ---------------------------------------------------------------------
-- T4 — membro da equipe SEM login (cadastro antigo) ganha acesso
-- ---------------------------------------------------------------------
do $$
declare
    v_user_a uuid := (select valor from crm_teste.ctx where chave = 'user_a');
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_func uuid := gen_random_uuid();
    r jsonb;
    r_de_novo jsonb;
begin
    insert into public.funcionarios (id, nome, email, cargo, ativo, tenant_id)
    values (v_func, 'Diego Sem Login', 'diego.semlogin@teste.com', 'Representante', true, v_tenant_a);

    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    r := crm_teste.equipe_criar('diego.semlogin@teste.com', 'senhaforte123', 'Diego Sem Login', 'Representante', 'vendedor');
    r_de_novo := crm_teste.equipe_criar('diego.semlogin@teste.com', 'senhaforte123', 'Diego 2', 'x', 'vendedor');
    perform public.login_admin();

    perform public.assert((r ->> 'success')::boolean and (r ->> 'user_id')::uuid = v_func,
        'T4b: funcionário antigo sem login ganha acesso na MESMA linha (histórico preservado)');
    perform public.assert(
        exists (select 1 from public.funcionarios f
                join public.utilizadores_empresas ue on ue.auth_uid = f.user_id and ue.empresa_id = v_tenant_a
                where f.id = v_func and f.user_id is not null),
        'T4b: login ligado ao funcionário e à empresa'
    );
    perform public.assert(not (r_de_novo ->> 'success')::boolean, 'T4a: quem já tem login não ganha um segundo');
end $$;

-- ---------------------------------------------------------------------
-- F1 — check_feature lê só a empresa ativa
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_ana uuid := (select valor from crm_teste.ctx where chave = 'ana');
    v_ve_a boolean;
    v_ve_b boolean;
begin
    insert into public.tenant_features (tenant_id, feature_key, enabled) values
        (v_tenant_a, 'teste_flag_a', true),
        (v_tenant_b, 'teste_flag_b', true)
    on conflict (tenant_id, feature_key) do update set enabled = excluded.enabled;

    perform public.login_como(v_ana, 'ana.vendas@teste.com');
    v_ve_a := public.check_feature('teste_flag_a');
    v_ve_b := public.check_feature('teste_flag_b', v_tenant_b::text);
    perform public.login_admin();

    perform public.assert(v_ve_a, 'F1b: flag da própria empresa é lida');
    perform public.assert(not v_ve_b, 'F1a: flag de outra empresa não vaza, mesmo passando o tenant');
end $$;

do $$
begin
    raise notice '';
    raise notice '===============================================';
    raise notice 'PAPÉIS, EXCLUSÃO, LIXEIRA E EQUIPE (MIGRATION 12) VALIDADOS';
    raise notice '===============================================';
end $$;
