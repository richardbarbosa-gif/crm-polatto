-- =====================================================================
-- TESTES DA MIGRATION 15 — saúde do funil, temperatura e modelos
--
-- Cada regra provada dos dois lados: o ataque falha E o uso legítimo
-- funciona. Reaproveita o cenário das suítes 01 e 06 (crm_teste.ctx):
-- tenant A (user_a gerente, Ana e Bruno vendedores) e tenant B (user_b
-- gerente).
-- =====================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------
-- S0 — idempotência sem sobrescrever o que o gerente configurou:
-- gerente muda o prazo de uma etapa e desliga outra; a migration roda de
-- novo; nada muda.
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_pipeline uuid;
    v_mon bigint;
    v_off bigint;
begin
    select id into v_pipeline from public.pipelines where tenant_id = v_tenant_a order by ordem limit 1;
    insert into public.pipeline_stages (tenant_id, pipeline_id, nome, ordem, dias_para_parado)
    values (v_tenant_a, v_pipeline, 'Saúde: monitorada', 90, 21) returning id into v_mon;
    insert into public.pipeline_stages (tenant_id, pipeline_id, nome, ordem, dias_para_parado)
    values (v_tenant_a, v_pipeline, 'Saúde: sem alerta', 91, null) returning id into v_off;
    -- ids bigint guardados como texto numa tabela própria da suíte
    create table if not exists crm_teste.ctx_txt (chave text primary key, valor text);
    insert into crm_teste.ctx_txt values ('etapa_21', v_mon::text), ('etapa_off', v_off::text)
    on conflict (chave) do update set valor = excluded.valor;
end $$;

\ir ../migrations/2026-11-05_15_negocio_parado_modelos_mensagem.sql
-- a 15 redefine o gancho de provisionamento; a 16 (sempre depois) o estende de novo
\ir ../migrations/2026-11-05_16_origem_primeiro_acesso_perfil.sql

do $$
declare
    v_21 integer;
    v_off integer;
    v_off_existe boolean;
    v_padrao integer;
begin
    select dias_para_parado into v_21 from public.pipeline_stages
    where id = (select valor::bigint from crm_teste.ctx_txt where chave = 'etapa_21');
    select dias_para_parado, true into v_off, v_off_existe from public.pipeline_stages
    where id = (select valor::bigint from crm_teste.ctx_txt where chave = 'etapa_off');

    insert into public.pipeline_stages (tenant_id, nome, ordem)
    values ((select valor from crm_teste.ctx where chave = 'tenant_a'), 'Saúde: nova sem prazo', 92)
    returning dias_para_parado into v_padrao;

    perform public.assert(v_21 = 21, 'S0: reexecutar a migration 15 não sobrescreve o prazo configurado pelo gerente (21 dias)');
    perform public.assert(v_off_existe and v_off is null, 'S0: etapa com alerta desligado (nulo) continua nula depois de reexecutar');
    perform public.assert(v_padrao = 7, 'S0: etapa nova sem prazo informado nasce monitorada com 7 dias');
end $$;

-- ---------------------------------------------------------------------
-- S1 — prazo por etapa: só gerente altera, faixa 1..365
-- ---------------------------------------------------------------------
do $$
declare
    v_etapa bigint := (select valor::bigint from crm_teste.ctx_txt where chave = 'etapa_21');
    v_ana uuid := (select valor from crm_teste.ctx where chave = 'ana');
    v_user_a uuid := (select valor from crm_teste.ctx where chave = 'user_a');
    v_user_b uuid := (select valor from crm_teste.ctx where chave = 'user_b');
    v_bloq_vendedor boolean := false;
    v_bloq_faixa boolean := false;
    v_outro_tenant integer;
    v_gerente integer;
    v_valor integer;
begin
    perform public.login_como(v_ana, 'ana.vendas@teste.com');
    begin
        update public.pipeline_stages set dias_para_parado = 99 where id = v_etapa;
    exception when insufficient_privilege then
        v_bloq_vendedor := true;
    end;
    perform public.login_admin();

    perform public.login_como(v_user_b, 'vendedor.b@teste.com');
    update public.pipeline_stages set dias_para_parado = 1 where id = v_etapa;
    get diagnostics v_outro_tenant = row_count;
    perform public.login_admin();

    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    begin
        update public.pipeline_stages set dias_para_parado = 0 where id = v_etapa;
    exception when check_violation then
        v_bloq_faixa := true;
    end;
    update public.pipeline_stages set dias_para_parado = 5 where id = v_etapa;
    get diagnostics v_gerente = row_count;
    perform public.login_admin();

    select dias_para_parado into v_valor from public.pipeline_stages where id = v_etapa;

    perform public.assert(v_bloq_vendedor, 'S1: vendedor NÃO altera o prazo de parado da etapa (configuração é do gerente)');
    perform public.assert(v_outro_tenant = 0, 'S1: gerente de outra empresa não altera etapa alheia');
    perform public.assert(v_bloq_faixa, 'S1: prazo fora de 1..365 é recusado pelo banco');
    perform public.assert(v_gerente = 1 and v_valor = 5, 'S1: gerente altera o prazo da etapa (5 dias)');
end $$;

-- ---------------------------------------------------------------------
-- S2 — negócio parado e sem próximo passo, calculados no banco
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_etapa5 bigint := (select valor::bigint from crm_teste.ctx_txt where chave = 'etapa_21');
    v_etapa_off bigint := (select valor::bigint from crm_teste.ctx_txt where chave = 'etapa_off');
    v_etapa_ganho bigint;
    v_parado uuid;
    v_com_tarefa uuid;
    v_sem_alerta uuid;
    v_ganho uuid;
    v_atrasada uuid;
    v_tarefa bigint;
    r record;
begin
    select id into v_etapa_ganho from public.pipeline_stages
    where tenant_id = v_tenant_a and ganho limit 1;
    if v_etapa_ganho is null then
        insert into public.pipeline_stages (tenant_id, nome, ordem, ganho, dias_para_parado)
        values (v_tenant_a, 'Saúde: Fechado', 93, true, 3) returning id into v_etapa_ganho;
    else
        update public.pipeline_stages set dias_para_parado = 3 where id = v_etapa_ganho;
    end if;

    insert into public.negocios (tenant_id, titulo, stage_id, temperatura, responsavel)
    values (v_tenant_a, 'Saúde parado', v_etapa5, 'frio', 'Ana Vendas') returning id into v_parado;
    insert into public.negocios (tenant_id, titulo, stage_id, temperatura, responsavel)
    values (v_tenant_a, 'Saúde com tarefa', v_etapa5, 'quente', 'Ana Vendas') returning id into v_com_tarefa;
    insert into public.negocios (tenant_id, titulo, stage_id, temperatura, responsavel)
    values (v_tenant_a, 'Saúde etapa sem alerta', v_etapa_off, 'morno', 'Bruno Vendas') returning id into v_sem_alerta;
    insert into public.negocios (tenant_id, titulo, stage_id, responsavel)
    values (v_tenant_a, 'Saúde ganho antigo', v_etapa_ganho, 'Ana Vendas') returning id into v_ganho;
    insert into public.negocios (tenant_id, titulo, stage_id, temperatura, responsavel)
    values (v_tenant_a, 'Saúde tarefa atrasada', v_etapa5, 'quente', 'Ana Vendas') returning id into v_atrasada;

    -- Envelhece os negócios 10 dias sem disparar os triggers de updated_at
    perform set_config('session_replication_role', 'replica', true);
    update public.negocios set created_at = now() - interval '10 days', updated_at = now() - interval '10 days'
    where id in (v_parado, v_com_tarefa, v_sem_alerta, v_ganho, v_atrasada);
    perform set_config('session_replication_role', 'origin', true);

    -- Tarefa futura para um; tarefa atrasada (criada há 10 dias) para outro
    insert into public.tarefas (tenant_id, titulo, tipo, data_vencimento, cliente_id, responsavel)
    values (v_tenant_a, 'Ligar amanhã', 'ligacao', now() + interval '1 day', v_com_tarefa::text, 'Ana Vendas');
    insert into public.tarefas (tenant_id, titulo, tipo, data_vencimento, cliente_id, responsavel, created_at)
    values (v_tenant_a, 'Visita esquecida', 'visita', now() - interval '2 days', v_atrasada::text, 'Ana Vendas',
            now() - interval '10 days')
    returning id into v_tarefa;
    -- Tarefa excluída (lixeira) não conta como próximo passo
    insert into public.tarefas (tenant_id, titulo, data_vencimento, cliente_id, deleted_at)
    values (v_tenant_a, 'Tarefa na lixeira', now() + interval '3 days', v_parado::text, now());
    -- e a lixeira também não "renova" a atividade: envelhece a criação dela
    perform set_config('session_replication_role', 'replica', true);
    update public.tarefas set created_at = now() - interval '10 days' where cliente_id = v_parado::text;
    perform set_config('session_replication_role', 'origin', true);

    insert into crm_teste.ctx values
        ('s_parado', v_parado), ('s_com_tarefa', v_com_tarefa), ('s_sem_alerta', v_sem_alerta),
        ('s_ganho', v_ganho), ('s_atrasada', v_atrasada)
    on conflict (chave) do update set valor = excluded.valor;
    insert into crm_teste.ctx_txt values ('tarefa_atrasada', v_tarefa::text)
    on conflict (chave) do update set valor = excluded.valor;

    -- Leitura como a tela faz: vendedor logado, view com RLS
    perform public.login_como((select valor from crm_teste.ctx where chave = 'ana'), 'ana.vendas@teste.com');
    create temp table if not exists s_saude as select * from public.vw_negocios_saude where false;
    delete from s_saude;
    insert into s_saude select * from public.vw_negocios_saude
    where id in (v_parado, v_com_tarefa, v_sem_alerta, v_ganho, v_atrasada);
    perform public.login_admin();

    select * into r from s_saude where id = v_parado;
    perform public.assert(r.parado and r.dias_sem_atividade >= 10 and r.dias_para_parado = 5,
        'S2: negócio aberto há 10 dias sem atividade numa etapa de 5 dias está PARADO');
    perform public.assert(r.sem_proximo_passo and r.proxima_tarefa_em is null,
        'S2: negócio sem tarefa aberta está SEM PRÓXIMO PASSO (tarefa na lixeira não conta)');

    select * into r from s_saude where id = v_com_tarefa;
    perform public.assert(not r.parado and r.dias_sem_atividade = 0,
        'S2: criar tarefa conta como atividade — o negócio deixa de estar parado');
    perform public.assert(not r.sem_proximo_passo and r.proxima_tarefa_titulo = 'Ligar amanhã' and not r.proxima_tarefa_atrasada,
        'S2: tarefa futura aberta é o próximo passo do negócio');

    select * into r from s_saude where id = v_sem_alerta;
    perform public.assert(not r.parado and r.dias_para_parado is null and r.dias_sem_atividade >= 10,
        'S2: etapa com alerta desligado (nulo) nunca marca parado');

    select * into r from s_saude where id = v_ganho;
    perform public.assert(not r.aberto and not r.parado and not r.sem_proximo_passo,
        'S2: negócio em etapa de ganho nunca fica parado nem "sem próximo passo", mesmo com prazo na etapa');

    select * into r from s_saude where id = v_atrasada;
    perform public.assert(r.parado and not r.sem_proximo_passo and r.proxima_tarefa_atrasada,
        'S2: tarefa atrasada é próximo passo (em atraso), mas não renova a atividade: negócio segue parado');
end $$;

-- Concluir a tarefa atrasada: carimba concluido_em, renova a atividade e
-- o negócio fica sem próximo passo. Reabrir limpa o carimbo.
do $$
declare
    v_tarefa bigint := (select valor::bigint from crm_teste.ctx_txt where chave = 'tarefa_atrasada');
    v_atrasada uuid := (select valor from crm_teste.ctx where chave = 's_atrasada');
    v_carimbo timestamptz;
    v_reaberto timestamptz;
    r record;
begin
    perform public.login_como((select valor from crm_teste.ctx where chave = 'ana'), 'ana.vendas@teste.com');
    update public.tarefas set concluido = true where id = v_tarefa;
    select * into r from public.vw_negocios_saude where id = v_atrasada;
    perform public.login_admin();
    select concluido_em into v_carimbo from public.tarefas where id = v_tarefa;

    perform public.assert(v_carimbo is not null and v_carimbo > now() - interval '1 minute',
        'S3: concluir a tarefa carimba concluido_em no servidor');
    perform public.assert(not r.parado and r.dias_sem_atividade = 0 and r.dias_sem_contato = 0,
        'S3: tarefa concluída renova a última atividade e o último contato');
    perform public.assert(r.sem_proximo_passo, 'S3: sem outra tarefa aberta, o negócio fica sem próximo passo');

    update public.tarefas set concluido = false where id = v_tarefa;
    select concluido_em into v_reaberto from public.tarefas where id = v_tarefa;
    perform public.assert(v_reaberto is null, 'S3: reabrir a tarefa limpa concluido_em');
    update public.tarefas set concluido = true where id = v_tarefa;
end $$;

-- ---------------------------------------------------------------------
-- S4 — isolamento da view: outra empresa e a chave pública não leem
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_b_ve bigint;
    v_b_header bigint;
    v_ana_ve bigint;
    v_anon_bloqueado boolean := false;
    v_invoker boolean;
begin
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_b'), 'vendedor.b@teste.com');
    select count(*) into v_b_ve from public.vw_negocios_saude where tenant_id = v_tenant_a;
    perform public.login_admin();

    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_b'), 'vendedor.b@teste.com', v_tenant_a);
    select count(*) into v_b_header from public.vw_negocios_saude where tenant_id = v_tenant_a;
    perform public.login_admin();

    perform public.login_como((select valor from crm_teste.ctx where chave = 'ana'), 'ana.vendas@teste.com');
    select count(*) into v_ana_ve from public.vw_negocios_saude where tenant_id = v_tenant_a;
    perform public.login_admin();

    perform public.login_anon();
    begin
        perform count(*) from public.vw_negocios_saude;
    exception when insufficient_privilege then
        v_anon_bloqueado := true;
    end;
    perform public.login_admin();

    select coalesce((select lower(o.option_value) in ('on', 'true')
                     from pg_options_to_table(c.reloptions) as o(option_name, option_value)
                     where o.option_name = 'security_invoker'), false)
    into v_invoker
    from pg_class c where c.oid = 'public.vw_negocios_saude'::regclass;

    perform public.assert(v_invoker, 'S4: vw_negocios_saude tem security_invoker (respeita a RLS)');
    perform public.assert(v_b_ve = 0, 'S4: usuário de outra empresa não lê a saúde dos negócios do tenant A');
    perform public.assert(v_b_header = 0, 'S4: header x-tenant-id forjado não abre a saúde do tenant A');
    perform public.assert(v_ana_ve >= 5, 'S4: vendedor lê a saúde de todos os negócios da própria empresa');
    perform public.assert(v_anon_bloqueado, 'S4: chave pública (anon) não lê vw_negocios_saude');
end $$;

-- ---------------------------------------------------------------------
-- S5 — temperatura: timeline, ordem e "quente sem contato"
-- ---------------------------------------------------------------------
do $$
declare
    v_parado uuid := (select valor from crm_teste.ctx where chave = 's_parado');
    v_com_tarefa uuid := (select valor from crm_teste.ctx where chave = 's_com_tarefa');
    v_sem_alerta uuid := (select valor from crm_teste.ctx where chave = 's_sem_alerta');
    v_atrasada uuid := (select valor from crm_teste.ctx where chave = 's_atrasada');
    v_registros integer;
    v_registros_mesmo integer;
    v_registros_view integer;
    v_desc text;
    v_titulo text;
    v_tipo text;
    v_tenant uuid;
    v_ordem uuid[];
    v_sem_contato integer;
    v_com_nota integer;
begin
    -- Ana esquenta o negócio frio pela tabela (API direta)...
    perform public.login_como((select valor from crm_teste.ctx where chave = 'ana'), 'ana.vendas@teste.com');
    update public.negocios set temperatura = 'morno' where id = v_parado;
    -- ...gravar o mesmo valor não gera registro...
    update public.negocios set temperatura = 'morno' where id = v_parado;
    -- ...e pela view clientes, como o drawer do lead faz
    update public.clientes set temperatura = 'quente' where id = v_parado;
    perform public.login_admin();

    select count(*) into v_registros from public.atividades_lead
    where cliente_id = v_parado::text and tipo = 'temperatura';
    select descricao, titulo, tipo, tenant_id into v_desc, v_titulo, v_tipo, v_tenant
    from public.atividades_lead
    where cliente_id = v_parado::text and tipo = 'temperatura'
    order by id limit 1;
    select count(*) into v_registros_view from public.atividades_lead
    where cliente_id = v_parado::text and tipo = 'temperatura' and descricao = 'Morno → Quente, por Ana Vendas';

    perform public.assert(v_registros = 2, 'S5: cada mudança de temperatura gera um registro na timeline (gravar o mesmo valor não gera)');
    perform public.assert(v_desc = 'Frio → Morno, por Ana Vendas' and v_titulo = 'Temperatura: Frio → Morno',
        'S5: timeline registra "Frio → Morno, por Ana Vendas" (nome do funcionário logado)');
    perform public.assert(v_registros_view = 1, 'S5: mudança pela view clientes (tela) também vai para a timeline');
    perform public.assert(v_tenant = (select valor from crm_teste.ctx where chave = 'tenant_a'),
        'S5: registro da timeline nasce no tenant do negócio');

    -- Ordem do card: quente > morno > frio > sem temperatura
    select array_agg(id order by temperatura_ordem desc, created_at, id) into v_ordem
    from public.vw_negocios_saude where id in (v_parado, v_com_tarefa, v_sem_alerta, v_atrasada);
    perform public.assert(
        (select temperatura_ordem from public.vw_negocios_saude where id = v_ordem[1]) = 3
        and (select temperatura_ordem from public.vw_negocios_saude where id = v_ordem[4]) = 2,
        'S5: temperatura_ordem coloca quentes primeiro e mornos depois');

    -- Quente sem contato: mudar a temperatura não conta como contato
    select dias_sem_contato into v_sem_contato from public.vw_negocios_saude where id = v_parado;
    insert into public.atividades_lead (tenant_id, cliente_id, tipo, activity_type, titulo, descricao)
    values ((select valor from crm_teste.ctx where chave = 'tenant_a'), v_parado::text, 'ligacao', 'ligacao',
            'Ligação com o lead', 'Cliente pediu retorno');
    select dias_sem_contato into v_com_nota from public.vw_negocios_saude where id = v_parado;

    perform public.assert(v_sem_contato >= 10, 'S5: lead quente sem contato há 10 dias (mudança de temperatura não é contato)');
    perform public.assert(v_com_nota = 0, 'S5: ligação registrada na timeline zera os dias sem contato');
end $$;

-- ---------------------------------------------------------------------
-- S6 — modelos de mensagem: seeds, papéis e isolamento
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_ana uuid := (select valor from crm_teste.ctx where chave = 'ana');
    v_user_a uuid := (select valor from crm_teste.ctx where chave = 'user_a');
    v_user_b uuid := (select valor from crm_teste.ctx where chave = 'user_b');
    v_seeds_a integer;
    v_seeds_b integer;
    v_canais text[];
    v_ana_le integer;
    v_bloq_insert boolean := false;
    v_ana_update integer;
    v_ana_delete integer;
    v_modelo uuid;
    v_modelo_tenant uuid;
    v_gerente_update integer;
    v_b_le integer;
    v_b_update integer;
    v_b_delete integer;
    v_anon_bloqueado boolean := false;
    v_seed_tabela_bloqueada boolean := false;
    v_seed_fn_bloqueada boolean := false;
    v_canal_invalido boolean := false;
    v_texto_vazio boolean := false;
    v_apos_reprovisionar integer;
begin
    select count(*), array_agg(distinct canal order by canal) into v_seeds_a, v_canais
    from public.modelos_mensagem where tenant_id = v_tenant_a and padrao;
    select count(*) into v_seeds_b from public.modelos_mensagem where tenant_id = v_tenant_b and padrao;
    perform public.assert(v_seeds_a = 3 and v_seeds_b = 3, 'S6: cada empresa recebe 3 modelos padrão');
    perform public.assert(v_canais = array['email', 'whatsapp'], 'S6: modelos padrão cobrem WhatsApp e e-mail');
    perform public.assert(
        (select count(*) from public.modelos_mensagem where tenant_id = v_tenant_a and texto like '%{primeiro_nome}%') = 3,
        'S6: modelos padrão usam a variável {primeiro_nome}');

    -- Vendedor lê, mas não escreve
    perform public.login_como(v_ana, 'ana.vendas@teste.com');
    select count(*) into v_ana_le from public.modelos_mensagem;
    begin
        insert into public.modelos_mensagem (nome, canal, texto) values ('Do vendedor', 'whatsapp', 'Oi {nome}');
    exception when insufficient_privilege then
        v_bloq_insert := true;
    end;
    update public.modelos_mensagem set texto = 'alterado pelo vendedor' where tenant_id = v_tenant_a;
    get diagnostics v_ana_update = row_count;
    delete from public.modelos_mensagem where tenant_id = v_tenant_a;
    get diagnostics v_ana_delete = row_count;
    perform public.login_admin();

    perform public.assert(v_ana_le = 3, 'S6: vendedor lê os modelos da própria empresa');
    perform public.assert(v_bloq_insert, 'S6: vendedor NÃO cria modelo');
    perform public.assert(v_ana_update = 0 and v_ana_delete = 0, 'S6: vendedor NÃO altera nem apaga modelo');

    -- Gerente cria (tenant forjado é ignorado) e edita
    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    insert into public.modelos_mensagem (tenant_id, nome, canal, texto)
    values (v_tenant_b, 'Pós-venda', 'whatsapp', 'Olá, {primeiro_nome}! Como está a geração do seu sistema?')
    returning id, tenant_id into v_modelo, v_modelo_tenant;
    update public.modelos_mensagem set ativo = false where id = v_modelo;
    get diagnostics v_gerente_update = row_count;
    begin
        insert into public.modelos_mensagem (nome, canal, texto) values ('SMS', 'sms', 'x');
    exception when check_violation then
        v_canal_invalido := true;
    end;
    begin
        insert into public.modelos_mensagem (nome, canal, texto) values ('Vazio', 'email', '   ');
    exception when check_violation then
        v_texto_vazio := true;
    end;
    perform public.login_admin();

    perform public.assert(v_modelo_tenant = v_tenant_a, 'S6: gerente cria modelo; tenant_id forjado no payload é trocado pelo dele');
    perform public.assert(v_gerente_update = 1, 'S6: gerente edita modelo');
    perform public.assert(v_canal_invalido and v_texto_vazio, 'S6: canal fora de whatsapp/email e texto vazio são recusados');

    -- Gerente de OUTRA empresa: não lê, não altera, não apaga
    perform public.login_como(v_user_b, 'vendedor.b@teste.com', v_tenant_a);
    select count(*) into v_b_le from public.modelos_mensagem where tenant_id = v_tenant_a;
    update public.modelos_mensagem set texto = 'invadido' where id = v_modelo;
    get diagnostics v_b_update = row_count;
    delete from public.modelos_mensagem where id = v_modelo;
    get diagnostics v_b_delete = row_count;
    perform public.login_admin();

    perform public.assert(v_b_le = 0, 'S6: gerente de outra empresa não lê modelos alheios (nem com header forjado)');
    perform public.assert(v_b_update = 0 and v_b_delete = 0, 'S6: gerente de outra empresa não altera nem apaga modelo alheio');

    -- Chave pública e funções administrativas
    perform public.login_anon();
    begin
        perform count(*) from public.modelos_mensagem;
    exception when insufficient_privilege then
        v_anon_bloqueado := true;
    end;
    perform public.login_admin();

    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    begin
        perform count(*) from public.crm_seeds_aplicados;
    exception when insufficient_privilege then
        v_seed_tabela_bloqueada := true;
    end;
    begin
        perform public.provisionar_modelos_mensagem(v_tenant_b);
    exception when insufficient_privilege then
        v_seed_fn_bloqueada := true;
    end;
    perform public.login_admin();

    perform public.assert(v_anon_bloqueado, 'S6: chave pública (anon) não lê modelos');
    perform public.assert(v_seed_tabela_bloqueada, 'S6: controle de seeds não é acessível pela API');
    perform public.assert(v_seed_fn_bloqueada, 'S6: provisionamento de modelos não é executável pela API');

    -- Modelo padrão apagado pelo gerente não volta ao reprovisionar
    delete from public.modelos_mensagem where tenant_id = v_tenant_a and padrao and canal = 'email';
    perform public.provisionar_defaults_tenant(v_tenant_a);
    select count(*) into v_apos_reprovisionar from public.modelos_mensagem where tenant_id = v_tenant_a and padrao;
    perform public.assert(v_apos_reprovisionar = 2, 'S6: modelo padrão apagado não volta quando o provisionamento roda de novo');
end $$;

-- Empresa nova criada pelo app já nasce com os modelos
do $$
declare
    v_user uuid := gen_random_uuid();
    v_tenant uuid;
    v_qtd integer;
    v_visiveis integer;
begin
    insert into auth.users (id, email) values (v_user, 'dono.modelos@teste.com');
    perform public.login_como(v_user, 'dono.modelos@teste.com');
    v_tenant := public.provisionar_tenant('Solar dos Modelos', 'energia_solar');
    select count(*) into v_visiveis from public.modelos_mensagem;
    perform public.login_admin();
    select count(*) into v_qtd from public.modelos_mensagem where tenant_id = v_tenant and padrao;

    perform public.assert(v_qtd = 3, 'S6: empresa criada pelo cadastro (provisionar_tenant) nasce com os 3 modelos');
    perform public.assert(v_visiveis = 3, 'S6: o dono da empresa nova enxerga só os modelos dela');
end $$;

select public.assert(
    not exists (select 1 from public.relatorio_rls() where gravidade = 'CRITICA'),
    'S7: relatorio_rls() sem nenhuma linha CRÍTICA depois da migration 15'
);
