-- =====================================================================
-- Suíte 14 — migration 19: datas e autoria do servidor, operações de
-- várias etapas numa transação, metas únicas, auditoria.
-- Para cada correção: o ataque falha E o uso legítimo segue.
-- =====================================================================
\set ON_ERROR_STOP on

-- Cenário: gerente (user_a) + um vendedor novo na empresa A
do $$
declare
    v_user_a uuid := (select valor from crm_teste.ctx where chave = 'user_a');
    r jsonb;
begin
    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    r := crm_teste.equipe_criar('s14.vendedor@teste.com', 'senhaforte123', 'Vend Catorze', 'Vendedor', 'vendedor');
    perform public.login_admin();
    perform public.assert((r ->> 'success')::boolean, 'S14: cenário — vendedor criado');
    insert into crm_teste.ctx values ('s14_v', (r ->> 'user_id')::uuid)
        on conflict (chave) do update set valor = excluded.valor;
end $$;

-- ---------------------------------------------------------------------
-- F — fechamento com data do servidor + M — motivo da perda na timeline
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_v uuid := (select valor from crm_teste.ctx where chave = 's14_v');
    v_ganho bigint;
    v_perda bigint;
    v_aberta bigint;
    v_lead uuid;
    v_f1 timestamptz;
    v_f2 timestamptz;
    v_f3 timestamptz;
    v_f4 timestamptz;
    v_motivo record;
begin
    select id into v_ganho from public.pipeline_stages where tenant_id = v_tenant_a and ganho order by ordem limit 1;
    select id into v_perda from public.pipeline_stages where tenant_id = v_tenant_a and perdido order by ordem limit 1;
    select id into v_aberta from public.pipeline_stages
    where tenant_id = v_tenant_a and not coalesce(ganho, false) and not coalesce(perdido, false) order by ordem limit 1;
    perform public.assert(v_ganho is not null and v_perda is not null and v_aberta is not null,
        'S14: cenário — funil com etapa aberta, de ganho e de perda');

    perform public.login_como(v_v, 's14.vendedor@teste.com');
    insert into public.clientes (nome, status, stage_id, responsavel)
    values ('Lead da suíte 14', 'Novo Lead', v_aberta, 'Vend Catorze') returning id into v_lead;

    -- ataque: fecha a venda "no mês passado"
    update public.clientes set stage_id = v_ganho, status = 'Ganho', data_fechamento = '2020-01-31 12:00+00' where id = v_lead;
    perform public.login_admin();
    select fechado_em into v_f1 from public.negocios where id = v_lead;
    perform public.assert(v_f1 > now() - interval '1 minute',
        'F1: data de fechamento antedatada pelo navegador é ignorada — vale a hora do servidor');

    -- edição de outro campo com data forjada: a data não muda
    perform public.login_como(v_v, 's14.vendedor@teste.com');
    update public.clientes set nome = 'Lead da suíte 14 (editado)', data_fechamento = '2019-06-01 00:00+00' where id = v_lead;
    perform public.login_admin();
    select fechado_em into v_f2 from public.negocios where id = v_lead;
    perform public.assert(v_f2 = v_f1, 'F2: editar um negócio fechado não altera a data de fechamento');

    -- ganho -> perda: outro desfecho, nova data; motivo vai para a timeline
    perform pg_sleep(0.01);
    perform public.login_como(v_v, 's14.vendedor@teste.com');
    update public.clientes set stage_id = v_perda, status = 'Perdido', motivo_perda = 'Preço acima do orçamento' where id = v_lead;
    perform public.login_admin();
    select fechado_em into v_f3 from public.negocios where id = v_lead;
    perform public.assert(v_f3 >= v_f1, 'F3: trocar de ganho para perda registra o novo desfecho na hora do servidor');

    select a.created_by, a.criado_por into v_motivo
    from public.atividades_lead a
    where a.cliente_id = v_lead::text and a.tipo = 'perda' and a.descricao = 'Preço acima do orçamento';
    perform public.assert(found and v_motivo.created_by is null and v_motivo.criado_por = 'Vend Catorze',
        'M1: motivo da perda entra na timeline pelo banco, na mesma transação (linha do sistema, autor real)');

    -- reabrir limpa o fechamento
    perform public.login_como(v_v, 's14.vendedor@teste.com');
    update public.clientes set stage_id = v_aberta, status = 'Novo Lead', data_fechamento = null, motivo_perda = null where id = v_lead;
    perform public.login_admin();
    select fechado_em into v_f4 from public.negocios where id = v_lead;
    perform public.assert(v_f4 is null, 'F4: uso legítimo — reabrir o negócio limpa a data de fechamento');

    insert into crm_teste.ctx values ('s14_lead', v_lead) on conflict (chave) do update set valor = excluded.valor;
end $$;

-- ---------------------------------------------------------------------
-- A — atividades: data e autor do servidor · X — lixeira com hora do servidor
-- ---------------------------------------------------------------------
do $$
declare
    v_v uuid := (select valor from crm_teste.ctx where chave = 's14_v');
    v_lead uuid := (select valor from crm_teste.ctx where chave = 's14_lead');
    v_nota bigint;
    v_tarefa bigint;
    v_linha record;
    v_del timestamptz;
    v_auditado boolean;
begin
    perform public.login_como(v_v, 's14.vendedor@teste.com');
    insert into public.atividades_lead (cliente_id, tipo, titulo, descricao, criado_por, author, created_at)
    values (v_lead::text, 'nota', 'Ligação', 'Falou com o cliente', 'Diretor Geral', 'Diretor Geral', '2001-01-01 00:00+00')
    returning id into v_nota;
    update public.atividades_lead
    set descricao = 'Falou com o cliente (corrigido)', criado_por = 'Outro', created_at = '2002-02-02 00:00+00'
    where id = v_nota;

    insert into public.tarefas (titulo, tipo, data_vencimento) values ('Tarefa da suíte 14', 'ligacao', now() + interval '1 day')
    returning id into v_tarefa;
    update public.tarefas set deleted_at = '2001-01-01 00:00+00' where id = v_tarefa;
    perform public.login_admin();

    select created_at, criado_por, author, descricao into v_linha from public.atividades_lead where id = v_nota;
    perform public.assert(v_linha.created_at > now() - interval '1 minute'
        and v_linha.criado_por = 'Vend Catorze' and v_linha.author = 'Vend Catorze',
        'A1: atividade nasce com a data do servidor e o nome real do autor (payload ignorado)');
    perform public.assert(v_linha.descricao = 'Falou com o cliente (corrigido)',
        'A2: uso legítimo — o autor corrige o texto; data e autoria não mudam');

    select deleted_at into v_del from public.tarefas where id = v_tarefa;
    perform public.assert(v_del > now() - interval '1 minute',
        'X1: enviar para a lixeira grava a hora do servidor, não a do navegador');

    select exists (select 1 from public.audit_log where tabela = 'tarefas' and registro_id = v_tarefa::text) into v_auditado;
    perform public.assert(v_auditado, 'AU1: alterações em tarefas entram no audit_log');
    perform public.assert(
        exists (select 1 from public.audit_log where tabela = 'atividades_lead' and registro_id = v_nota::text and operacao = 'UPDATE'),
        'AU2: edição de atividade entra no audit_log');
end $$;

-- ---------------------------------------------------------------------
-- MT — metas: únicas por funcionário/mês, salvas em bloco
-- ---------------------------------------------------------------------
do $$
declare
    v_user_a uuid := (select valor from crm_teste.ctx where chave = 'user_a');
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_v uuid := (select valor from crm_teste.ctx where chave = 's14_v');
    v_f2 uuid := gen_random_uuid();
    v_fb uuid := gen_random_uuid();
    v_mes date := date_trunc('month', now())::date;
    v_n integer;
    v_vendedor_bloqueado boolean := false;
    v_atomico boolean := false;
begin
    insert into public.funcionarios (id, nome, email, cargo, ativo, tenant_id) values
        (v_f2, 'Sem Login Catorze', 's14.semlogin@teste.com', 'Vendedor', true, v_tenant_a),
        (v_fb, 'Do Tenant B', 's14.b@teste.com', 'Vendedor', true, v_tenant_b);
    delete from public.metas where funcionario_id in (v_v, v_f2);

    perform public.assert(
        exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_metas_funcionario_mes'),
        'MT1: índice único (empresa, funcionário, mês) em metas');

    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    v_n := public.salvar_metas_mes(v_mes, jsonb_build_array(
        jsonb_build_object('funcionario_id', v_v, 'valor_meta', 50000, 'target_wins', 5),
        jsonb_build_object('funcionario_id', v_f2, 'valor_meta', 30000, 'target_wins', 0)));
    -- "clique duplo": a segunda gravação atualiza, não duplica
    perform public.salvar_metas_mes(v_mes + 3, jsonb_build_array(
        jsonb_build_object('funcionario_id', v_v, 'valor_meta', 60000, 'target_wins', 6)));
    perform public.login_admin();

    perform public.assert(v_n = 2
        and (select count(*) from public.metas where funcionario_id in (v_v, v_f2) and mes_referencia = v_mes) = 2
        and (select valor_meta from public.metas where funcionario_id = v_v and mes_referencia = v_mes) = 60000
        and (select target_wins from public.metas where funcionario_id = v_v and mes_referencia = v_mes) = 6,
        'MT2: uso legítimo — metas do mês gravadas; regravar atualiza a mesma linha (sem duplicata)');

    -- tudo ou nada: o segundo item é de outra empresa
    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    begin
        perform public.salvar_metas_mes(v_mes, jsonb_build_array(
            jsonb_build_object('funcionario_id', v_v, 'valor_meta', 1, 'target_wins', 1),
            jsonb_build_object('funcionario_id', v_fb, 'valor_meta', 999999, 'target_wins', 9)));
    exception when sqlstate 'P0001' then
        v_atomico := true;
    end;
    perform public.login_admin();
    perform public.assert(v_atomico
        and (select valor_meta from public.metas where funcionario_id = v_v and mes_referencia = v_mes) = 60000
        and not exists (select 1 from public.metas where funcionario_id = v_fb),
        'MT3: um item inválido (funcionário de outra empresa) desfaz o lote inteiro');

    perform public.login_como(v_v, 's14.vendedor@teste.com');
    begin
        perform public.salvar_metas_mes(v_mes, jsonb_build_array(
            jsonb_build_object('funcionario_id', v_v, 'valor_meta', 1, 'target_wins', 0)));
    exception when insufficient_privilege then
        v_vendedor_bloqueado := true;
    end;
    perform public.login_admin();
    perform public.assert(v_vendedor_bloqueado, 'MT4: vendedor não define metas');

    insert into crm_teste.ctx values ('s14_f2', v_f2) on conflict (chave) do update set valor = excluded.valor;
end $$;

-- ---------------------------------------------------------------------
-- EQ — editar membro: dados + papel + meta numa transação
-- ---------------------------------------------------------------------
do $$
declare
    v_user_a uuid := (select valor from crm_teste.ctx where chave = 'user_a');
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_v uuid := (select valor from crm_teste.ctx where chave = 's14_v');
    v_mes date := date_trunc('month', now())::date;
    v_func_a uuid;
    v_recusado boolean := false;
    v_msg text;
    v_vendedor_bloqueado boolean := false;
begin
    -- o gerente precisa de uma linha de funcionário para o teste do "próprio papel"
    select id into v_func_a from public.funcionarios where user_id = v_user_a and tenant_id = v_tenant_a limit 1;
    if v_func_a is null then
        v_func_a := gen_random_uuid();
        insert into public.funcionarios (id, user_id, nome, email, cargo, ativo, tenant_id)
        values (v_func_a, v_user_a, 'Gerente A', 's14.gerente@teste.com', 'Gerente', true, v_tenant_a);
    end if;

    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    perform public.salvar_membro_equipe(v_v, 'Vend Catorze Silva', 'trocado@teste.com', 'Consultor', true, 'gerente', 75000);
    perform public.login_admin();
    perform public.assert(
        (select nome from public.funcionarios where id = v_v) = 'Vend Catorze Silva'
        and (select cargo from public.funcionarios where id = v_v) = 'Consultor'
        and (select email from public.funcionarios where id = v_v) = 's14.vendedor@teste.com'
        and (select public.normalizar_papel(role) from public.utilizadores_empresas where auth_uid = v_v and empresa_id = v_tenant_a) = 'gerente'
        and (select valor_meta from public.metas where funcionario_id = v_v and mes_referencia = v_mes) = 75000,
        'EQ1: uso legítimo — nome, cargo, papel e meta gravados juntos (e-mail de quem tem login não muda por aqui)');

    -- papel recusado (o próprio) => NADA é gravado, nem o nome
    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    begin
        perform public.salvar_membro_equipe(v_func_a, 'Nome Que Não Pode Ficar', null, 'x', true, 'vendedor', 12345);
    exception when sqlstate 'P0001' then
        v_recusado := true;
        v_msg := sqlerrm;
    end;
    perform public.login_admin();
    perform public.assert(v_recusado and v_msg ~ 'próprio papel'
        and (select nome from public.funcionarios where id = v_func_a) <> 'Nome Que Não Pode Ficar'
        and not exists (select 1 from public.metas where funcionario_id = v_func_a and valor_meta = 12345),
        'EQ2: papel recusado desfaz a edição inteira (nome e meta não ficam pela metade)');

    perform public.alterar_papel_membro(v_v, 'vendedor');  -- contexto admin: volta a vendedor
    update public.utilizadores_empresas set role = 'vendedor' where auth_uid = v_v and empresa_id = v_tenant_a;

    perform public.login_como(v_v, 's14.vendedor@teste.com');
    begin
        perform public.salvar_membro_equipe(v_v, 'Auto Promovido', null, 'Diretor', true, 'gerente', 1);
    exception when insufficient_privilege then
        v_vendedor_bloqueado := true;
    end;
    perform public.login_admin();
    perform public.assert(v_vendedor_bloqueado
        and (select public.normalizar_papel(role) from public.utilizadores_empresas where auth_uid = v_v and empresa_id = v_tenant_a) = 'vendedor',
        'EQ3: vendedor não edita a equipe nem se promove');
end $$;

-- ---------------------------------------------------------------------
-- D — documentos: versão, substituição e registro numa transação
-- ---------------------------------------------------------------------
do $$
declare
    v_user_b uuid := (select valor from crm_teste.ctx where chave = 'user_b');
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_v uuid := (select valor from crm_teste.ctx where chave = 's14_v');
    v_lead uuid := (select valor from crm_teste.ctx where chave = 's14_lead');
    r1 jsonb;
    r2 jsonb;
    v_fora boolean := false;
    v_visto_por_b integer;
begin
    perform public.login_como(v_v, 's14.vendedor@teste.com');
    r1 := public.registrar_documento_lead(v_lead::text, 'contrato', 'contrato.pdf',
        v_tenant_a::text || '/' || v_lead::text || '/1_contrato.pdf', 1024);
    r2 := public.registrar_documento_lead(v_lead::text, 'contrato', 'contrato-v2.pdf',
        v_tenant_a::text || '/' || v_lead::text || '/2_contrato.pdf', 2048);
    begin
        perform public.registrar_documento_lead(v_lead::text, 'contrato', 'invasor.pdf',
            v_tenant_b::text || '/' || v_lead::text || '/3_invasor.pdf', 10);
    exception when insufficient_privilege then
        v_fora := true;
    end;
    perform public.login_admin();

    perform public.assert((r1 ->> 'versao')::int = 1 and (r2 ->> 'versao')::int = 2
        and (select status from public.documentos_lead where id = (r1 ->> 'id')::uuid) = 'substituido'
        and (select status from public.documentos_lead where id = (r2 ->> 'id')::uuid) = 'ativo'
        and (select enviado_por from public.documentos_lead where id = (r2 ->> 'id')::uuid) = 'Vend Catorze Silva'
        and (select count(*) from public.documentos_lead where cliente_id = v_lead::text and tipo = 'contrato' and status = 'ativo') = 1,
        'D1: uso legítimo — nova versão substitui a anterior; sempre há exatamente um documento ativo; autor do banco');
    perform public.assert(v_fora
        and not exists (select 1 from public.documentos_lead where nome_arquivo = 'invasor.pdf'),
        'D2: caminho fora da pasta da empresa é recusado (e não derruba a versão ativa)');

    perform public.login_como(v_user_b, 'vendedor.b@teste.com', v_tenant_a);
    select count(*) into v_visto_por_b from public.documentos_lead where cliente_id = v_lead::text;
    perform public.login_admin();
    perform public.assert(v_visto_por_b = 0, 'D3: tenant B não lê os documentos do A');
end $$;

-- ---------------------------------------------------------------------
-- ET — excluir etapa: move e apaga, sem negócio órfão
-- ---------------------------------------------------------------------
do $$
declare
    v_user_a uuid := (select valor from crm_teste.ctx where chave = 'user_a');
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_v uuid := (select valor from crm_teste.ctx where chave = 's14_v');
    v_lead uuid := (select valor from crm_teste.ctx where chave = 's14_lead');
    v_pipeline uuid;
    v_extra bigint;
    v_destino bigint;
    v_sem_destino boolean := false;
    v_vendedor_bloqueado boolean := false;
    v_movidos integer;
begin
    select stage_id into v_destino from public.negocios where id = v_lead;
    select pipeline_id into v_pipeline from public.pipeline_stages where id = v_destino;

    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    insert into public.pipeline_stages (pipeline_id, nome, cor, ordem) values (v_pipeline, 'Etapa Temporária 14', '#999999', 99)
    returning id into v_extra;
    update public.clientes set stage_id = v_extra, status = 'Etapa Temporária 14' where id = v_lead;

    begin
        perform public.excluir_etapa(v_extra, null);
    exception when sqlstate 'P0001' then
        v_sem_destino := true;
    end;
    perform public.login_admin();
    perform public.assert(v_sem_destino
        and exists (select 1 from public.pipeline_stages where id = v_extra)
        and (select stage_id from public.negocios where id = v_lead) = v_extra,
        'ET1: etapa com negócios não é excluída sem destino (nenhum negócio fica sem etapa)');

    perform public.login_como(v_v, 's14.vendedor@teste.com');
    begin
        perform public.excluir_etapa(v_extra, v_destino);
    exception when insufficient_privilege then
        v_vendedor_bloqueado := true;
    end;
    perform public.login_admin();
    perform public.assert(v_vendedor_bloqueado and exists (select 1 from public.pipeline_stages where id = v_extra),
        'ET2: vendedor não exclui etapa');

    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    v_movidos := public.excluir_etapa(v_extra, v_destino);
    perform public.login_admin();
    perform public.assert(v_movidos = 1
        and not exists (select 1 from public.pipeline_stages where id = v_extra)
        and (select stage_id from public.negocios where id = v_lead) = v_destino
        and (select status from public.negocios where id = v_lead) = (select nome from public.pipeline_stages where id = v_destino),
        'ET3: uso legítimo — negócios movidos para o destino e etapa excluída na mesma transação');
end $$;

-- ---------------------------------------------------------------------
-- P — privilégios das funções novas
-- ---------------------------------------------------------------------
do $$
declare
    v_falhas text := '';
    r record;
begin
    for r in
        select p.oid::regprocedure::text as fn, p.proname::text as nome
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public'
          and p.proname in ('salvar_metas_mes', 'salvar_membro_equipe', 'registrar_documento_lead',
                            'excluir_etapa', 'definir_meta_mensal', 'nome_do_usuario_atual', 'limpar_registros_tecnicos')
    loop
        if has_function_privilege('anon', r.fn, 'execute') then
            v_falhas := v_falhas || ' anon:' || r.nome;
        end if;
        if r.nome = 'limpar_registros_tecnicos' and has_function_privilege('authenticated', r.fn, 'execute') then
            v_falhas := v_falhas || ' authenticated:' || r.nome;
        end if;
    end loop;
    perform public.assert(v_falhas = '', 'P1: RPCs novas fechadas para a chave pública; rotina de limpeza fora da API (' || v_falhas || ')');
end $$;

do $$
begin
    raise notice '';
    raise notice '===============================================';
    raise notice 'MIGRATION 19 VALIDADA (relógio do servidor, transações, metas, auditoria)';
    raise notice '===============================================';
end $$;
