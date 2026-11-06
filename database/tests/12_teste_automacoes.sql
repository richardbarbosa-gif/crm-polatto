-- =====================================================================
-- TESTES DA MIGRATION 17 — automações do funil
--
-- Cada regra dos dois lados: o ataque falha E o uso legítimo funciona.
-- Cenário próprio (empresas "Aut X" e "Aut Y"), para o rodízio e os
-- contadores não dependerem das suítes anteriores.
-- =====================================================================

\set ON_ERROR_STOP on

-- A suíte 10 reaplica as migrations 15 e 16, que redefinem o gancho
-- provisionar_defaults_pacote e a vw_negocios_saude. Como manda o README
-- (reexecutou a 15/16, rode a 17 de novo), reaplica a 17 antes de testar.
\ir ../migrations/2026-11-06_17_automacoes.sql

create schema if not exists crm_teste;
create table if not exists crm_teste.aut (chave text primary key, valor text);
grant usage on schema crm_teste to authenticated, anon;

create or replace function crm_teste.aut_v(p_chave text)
returns text
language sql
stable
as $$ select valor from crm_teste.aut where chave = p_chave $$;

create or replace function crm_teste.aut_set(p_chave text, p_valor text)
returns void
language sql
as $$
    insert into crm_teste.aut values (p_chave, p_valor)
    on conflict (chave) do update set valor = excluded.valor
$$;

-- SQLSTATE e mensagem do comando (ou OK)
create or replace function crm_teste.aut_erro(p_sql text)
returns text
language plpgsql
as $$
begin
    execute p_sql;
    return 'OK';
exception when others then
    return sqlstate || ' ' || sqlerrm;
end;
$$;

create or replace function crm_teste.aut_linhas(p_sql text)
returns bigint
language plpgsql
as $$
declare
    v_n bigint;
begin
    execute p_sql;
    get diagnostics v_n = row_count;
    return v_n;
end;
$$;

grant execute on function crm_teste.aut_erro(text), crm_teste.aut_linhas(text), crm_teste.aut_v(text)
    to authenticated, anon;
grant select on crm_teste.aut to authenticated, anon;

create or replace function public.login_anon()
returns void
language plpgsql
as $$
begin
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, false);
    perform set_config('request.headers', '{}', false);
    execute 'set role anon';
end;
$$;

-- Gerente salva uma regra pela RPC da tela
create or replace function crm_teste.aut_salvar(p_user uuid, p_regra jsonb, p_acoes jsonb)
returns uuid
language plpgsql
as $$
declare
    v_id uuid;
begin
    perform public.login_como(p_user);
    v_id := public.salvar_automacao(p_regra, p_acoes);
    perform public.login_admin();
    return v_id;
end;
$$;

-- Usuário cadastra um lead pela tela (view clientes)
create or replace function crm_teste.aut_lead(p_user uuid, p_nome text, p_stage bigint, p_extra jsonb default '{}')
returns uuid
language plpgsql
as $$
declare
    v_id uuid;
begin
    perform public.login_como(p_user, null, nullif(p_extra ->> 'header_tenant', '')::uuid);
    insert into public.clientes (nome, status, stage_id, pipeline_id, responsavel, responsavel_id, temperatura, valor, dados_extras)
    values (
        p_nome, 'Novo Lead', p_stage, nullif(p_extra ->> 'pipeline_id', '')::uuid,
        coalesce(p_extra ->> 'responsavel', crm_teste.aut_v('nome_v1')),
        coalesce(nullif(p_extra ->> 'responsavel_id', '')::uuid, crm_teste.aut_v('v1')::uuid),
        p_extra ->> 'temperatura',
        nullif(p_extra ->> 'valor', '')::numeric,
        coalesce(p_extra -> 'dados_extras', '{}'::jsonb)
    )
    returning id into v_id;
    perform public.login_admin();
    return v_id;
end;
$$;

-- Usuário move o card (update pela view clientes, como o Kanban faz)
create or replace function crm_teste.aut_mover(p_user uuid, p_lead uuid, p_stage bigint)
returns void
language plpgsql
as $$
begin
    perform public.login_como(p_user);
    update public.clientes set stage_id = p_stage where id = p_lead;
    perform public.login_admin();
end;
$$;

create or replace function crm_teste.aut_tarefas(p_lead uuid, p_titulo text)
returns bigint
language sql
stable
as $$
    select count(*) from public.tarefas
    where cliente_id = p_lead::text and titulo = p_titulo and deleted_at is null
$$;

-- Desliga todas as regras da empresa X (cada teste liga só as suas)
create or replace function crm_teste.aut_desligar_tudo()
returns void
language sql
as $$
    update public.automacoes set ativo = false
    where tenant_id = crm_teste.aut_v('tx')::uuid and ativo
$$;

-- ---------------------------------------------------------------------
-- CENÁRIO — empresa X: gerente + 3 vendedores; empresa Y: gerente + 1
-- vendedor. Funil "Vendas" com etapas próprias e um segundo funil em X.
-- ---------------------------------------------------------------------
do $$
declare
    v_tx uuid;
    v_ty uuid;
    v_gx uuid := gen_random_uuid();
    v_v1 uuid := gen_random_uuid();
    v_v2 uuid := gen_random_uuid();
    v_v3 uuid := gen_random_uuid();
    v_gy uuid := gen_random_uuid();
    v_vy uuid := gen_random_uuid();
    v_px uuid;
    v_px2 uuid;
    v_py uuid;
    v_id bigint;
begin
    delete from crm_teste.aut;
    insert into auth.users (id, email) values
        (v_gx, 'aut.gerente.x@teste.com'), (v_v1, 'aut.v1@teste.com'), (v_v2, 'aut.v2@teste.com'),
        (v_v3, 'aut.v3@teste.com'), (v_gy, 'aut.gerente.y@teste.com'), (v_vy, 'aut.vy@teste.com');
    insert into public.empresas (nome, segmento) values ('Aut X', 'energia_solar') returning id into v_tx;
    insert into public.empresas (nome, segmento) values ('Aut Y', 'energia_solar') returning id into v_ty;
    insert into public.utilizadores_empresas (auth_uid, empresa_id, role) values
        (v_gx, v_tx, 'gerente'), (v_v1, v_tx, 'vendedor'), (v_v2, v_tx, 'vendedor'), (v_v3, v_tx, 'vendedor'),
        (v_gy, v_ty, 'gerente'), (v_vy, v_ty, 'vendedor');
    insert into public.funcionarios (id, user_id, nome, email, cargo, ativo, tenant_id) values
        (v_gx, v_gx, 'Gerente X', 'aut.gerente.x@teste.com', 'Gerente', true, v_tx),
        (v_v1, v_v1, 'Aut Vendedor 1', 'aut.v1@teste.com', 'Vendedor', true, v_tx),
        (v_v2, v_v2, 'Aut Vendedor 2', 'aut.v2@teste.com', 'Vendedor', true, v_tx),
        (v_v3, v_v3, 'Aut Vendedor 3', 'aut.v3@teste.com', 'Vendedor', true, v_tx),
        (v_gy, v_gy, 'Gerente Y', 'aut.gerente.y@teste.com', 'Gerente', true, v_ty),
        (v_vy, v_vy, 'Vendedor Y', 'aut.vy@teste.com', 'Vendedor', true, v_ty);

    -- Defaults (funil Vendas, tipos de atividade, canais, modelos...)
    perform public.provisionar_defaults_tenant(v_tx);
    perform public.provisionar_defaults_tenant(v_ty);

    select id into v_px from public.pipelines where tenant_id = v_tx order by ordem limit 1;
    select id into v_py from public.pipelines where tenant_id = v_ty order by ordem limit 1;
    insert into public.pipelines (tenant_id, nome, ordem) values (v_tx, 'Pós-venda', 2) returning id into v_px2;

    perform crm_teste.aut_set('tx', v_tx::text);
    perform crm_teste.aut_set('ty', v_ty::text);
    perform crm_teste.aut_set('gx', v_gx::text);
    perform crm_teste.aut_set('v1', v_v1::text);
    perform crm_teste.aut_set('v2', v_v2::text);
    perform crm_teste.aut_set('v3', v_v3::text);
    perform crm_teste.aut_set('gy', v_gy::text);
    perform crm_teste.aut_set('vy', v_vy::text);
    perform crm_teste.aut_set('nome_v1', 'Aut Vendedor 1');
    perform crm_teste.aut_set('px', v_px::text);
    perform crm_teste.aut_set('px2', v_px2::text);
    perform crm_teste.aut_set('py', v_py::text);

    insert into public.pipeline_stages (tenant_id, pipeline_id, nome, ordem) values (v_tx, v_px, 'Novo Lead', 1)
    returning id into v_id; perform crm_teste.aut_set('e_novo', v_id::text);
    insert into public.pipeline_stages (tenant_id, pipeline_id, nome, ordem) values (v_tx, v_px, 'Visita Agendada', 2)
    returning id into v_id; perform crm_teste.aut_set('e_visita', v_id::text);
    insert into public.pipeline_stages (tenant_id, pipeline_id, nome, ordem) values (v_tx, v_px, 'Proposta Enviada', 3)
    returning id into v_id; perform crm_teste.aut_set('e_proposta', v_id::text);
    insert into public.pipeline_stages (tenant_id, pipeline_id, nome, ordem, ganho) values (v_tx, v_px, 'Fechado', 4, true)
    returning id into v_id; perform crm_teste.aut_set('e_ganho', v_id::text);
    insert into public.pipeline_stages (tenant_id, pipeline_id, nome, ordem, perdido) values (v_tx, v_px, 'Perdido', 5, true)
    returning id into v_id; perform crm_teste.aut_set('e_perdido', v_id::text);
    insert into public.pipeline_stages (tenant_id, pipeline_id, nome, ordem) values (v_tx, v_px2, 'Instalação', 1)
    returning id into v_id; perform crm_teste.aut_set('e_outro_funil', v_id::text);
    insert into public.pipeline_stages (tenant_id, pipeline_id, nome, ordem) values (v_ty, v_py, 'Novo Y', 1)
    returning id into v_id; perform crm_teste.aut_set('ey_novo', v_id::text);
    insert into public.pipeline_stages (tenant_id, pipeline_id, nome, ordem) values (v_ty, v_py, 'Proposta Y', 2)
    returning id into v_id; perform crm_teste.aut_set('ey_proposta', v_id::text);
end $$;

-- ---------------------------------------------------------------------
-- A0 — modelos prontos: 6 por empresa, desativados, ligados à etapa
-- pelo nome; sem a etapa, ficam sem etapa e não ativam
-- ---------------------------------------------------------------------
do $$
declare
    v_tx uuid := crm_teste.aut_v('tx')::uuid;
    v_chaves text[];
    v_ativos integer;
    v_visita bigint;
    v_proposta bigint;
    v_tarefa text;
    v_user uuid := gen_random_uuid();
    v_tn uuid;
    v_tn_visita bigint;
    v_tn_proposta bigint;
    v_tn_total integer;
    v_erro text;
    v_volta integer;
begin
    select array_agg(modelo_chave order by modelo_chave), count(*) filter (where ativo)
    into v_chaves, v_ativos
    from public.automacoes where tenant_id = v_tx and modelo_chave is not null;
    perform public.assert(
        v_chaves = array['entrou_quente', 'ganho', 'perdido', 'proposta_enviada', 'proposta_sem_resposta', 'visita_agendada'],
        'A0: cada empresa recebe os 6 modelos prontos de automação');
    perform public.assert(v_ativos = 0, 'A0: todos os modelos nascem DESATIVADOS');

    select gatilho_etapa_id into v_visita from public.automacoes where tenant_id = v_tx and modelo_chave = 'visita_agendada';
    select gatilho_etapa_id into v_proposta from public.automacoes where tenant_id = v_tx and modelo_chave = 'proposta_enviada';
    perform public.assert(v_visita = crm_teste.aut_v('e_visita')::bigint,
        'A0: modelo "Visita agendada" ligado à etapa Visita Agendada pelo nome (etapa criada depois do modelo)');
    perform public.assert(v_proposta = crm_teste.aut_v('e_proposta')::bigint,
        'A0: modelo "Proposta enviada" ligado à etapa Proposta Enviada pelo nome');

    select ac.titulo into v_tarefa
    from public.automacoes a join public.automacoes_acoes ac on ac.automacao_id = a.id
    where a.tenant_id = v_tx and a.modelo_chave = 'proposta_enviada' and ac.tipo = 'criar_tarefa'
      and ac.prazo_quantidade = 2 and ac.prazo_unidade = 'dias';
    perform public.assert(v_tarefa = 'Ligar para saber o que achou', 'A0: modelo da proposta cria "Ligar para saber o que achou" em 2 dias');
    perform public.assert(
        (select count(*) from public.automacoes a join public.automacoes_acoes ac on ac.automacao_id = a.id
         where a.tenant_id = v_tx and a.modelo_chave = 'ganho' and ac.tipo in ('criar_tarefa', 'notificar_gerente')) = 2,
        'A0: modelo de ganho agenda a instalação E avisa o gerente');

    -- Empresa criada pelo app (provisionar_tenant): etapas padrão sem "visita"
    insert into auth.users (id, email) values (v_user, 'aut.nova.empresa@teste.com');
    perform public.login_como(v_user, 'aut.nova.empresa@teste.com');
    v_tn := public.provisionar_tenant('Aut Nova Solar');
    perform public.login_admin();
    select count(*) into v_tn_total from public.automacoes where tenant_id = v_tn and not ativo;
    select gatilho_etapa_id into v_tn_visita from public.automacoes where tenant_id = v_tn and modelo_chave = 'visita_agendada';
    select gatilho_etapa_id into v_tn_proposta from public.automacoes where tenant_id = v_tn and modelo_chave = 'proposta_enviada';
    perform public.assert(v_tn_total = 6, 'A0: empresa nova (cadastro pelo app) já nasce com os 6 modelos desativados');
    perform public.assert(
        v_tn_proposta = (select id from public.pipeline_stages where tenant_id = v_tn and nome = 'Proposta Enviada'),
        'A0: empresa nova: modelo ligado à etapa padrão "Proposta Enviada"');
    perform public.assert(v_tn_visita is null, 'A0: sem etapa de visita, o modelo fica SEM etapa');

    perform public.login_como(v_user, 'aut.nova.empresa@teste.com');
    v_erro := crm_teste.aut_erro(format(
        'update public.automacoes set ativo = true where tenant_id = %L and modelo_chave = %L', v_tn, 'visita_agendada'));
    perform public.login_admin();
    perform public.assert(v_erro like '23514 Automação incompleta: Escolha a etapa do gatilho.%',
        'A0: modelo sem etapa NÃO ativa: "Escolha a etapa do gatilho." (veio: ' || v_erro || ')');

    -- Apagado pelo gerente não volta ao reprovisionar
    delete from public.automacoes where tenant_id = v_tx and modelo_chave = 'perdido';
    perform public.provisionar_defaults_tenant(v_tx);
    select count(*) into v_volta from public.automacoes where tenant_id = v_tx and modelo_chave = 'perdido';
    perform public.assert(v_volta = 0, 'A0: modelo apagado pelo gerente não volta ao reprovisionar');
    perform public.provisionar_automacoes_modelo(v_tx);
    perform public.assert((select count(*) from public.automacoes where tenant_id = v_tx and modelo_chave = 'perdido') = 0,
        'A0: semear de novo é idempotente (crm_seeds_aplicados)');

    -- Empresa que já existia antes da migration (sem modelos)
    insert into public.empresas (nome, segmento) values ('Aut Existente', 'energia_solar') returning id into v_tn;
    perform crm_teste.aut_set('t_existente', v_tn::text);
end $$;

-- Reaplica a migration 17 com dados: empresa existente recebe os modelos
\ir ../migrations/2026-11-06_17_automacoes.sql

do $$
declare
    v_tn uuid := crm_teste.aut_v('t_existente')::uuid;
    v_tx uuid := crm_teste.aut_v('tx')::uuid;
begin
    perform public.assert((select count(*) from public.automacoes where tenant_id = v_tn and not ativo) = 6,
        'A0: empresa que já existia recebe os 6 modelos (desativados) quando a migration roda');
    perform public.assert((select count(*) from public.automacoes where tenant_id = v_tx and modelo_chave = 'perdido') = 0,
        'A0: reexecutar a migration não recria modelo apagado');
end $$;

-- ---------------------------------------------------------------------
-- A1 — papéis e acesso: vendedor lê e não escreve (API direta),
-- anon nada, gerente de outra empresa nada, nem com header forjado
-- ---------------------------------------------------------------------
do $$
declare
    v_tx uuid := crm_teste.aut_v('tx')::uuid;
    v_v1 uuid := crm_teste.aut_v('v1')::uuid;
    v_gy uuid := crm_teste.aut_v('gy')::uuid;
    v_gx uuid := crm_teste.aut_v('gx')::uuid;
    v_alvo uuid;
    v_le bigint;
    v_ins text;
    v_upd bigint;
    v_del bigint;
    v_rpc text;
    v_acao text;
    v_log text;
    v_agenda text;
    v_y_le bigint;
    v_y_upd bigint;
    v_anon text;
    v_anon_rpc text;
    v_anon_agenda text;
    v_ger_agenda text;
begin
    select id into v_alvo from public.automacoes where tenant_id = v_tx and modelo_chave = 'ganho';

    perform public.login_como(v_v1, 'aut.v1@teste.com');
    select count(*) into v_le from public.automacoes;
    v_ins := crm_teste.aut_erro($q$insert into public.automacoes (nome, gatilho) values ('Do vendedor', 'negocio_criado')$q$);
    v_upd := crm_teste.aut_linhas(format('update public.automacoes set nome = %L where id = %L', 'Hack', v_alvo));
    v_del := crm_teste.aut_linhas(format('delete from public.automacoes where id = %L', v_alvo));
    v_rpc := crm_teste.aut_erro($q$select public.salvar_automacao('{"nome":"X","gatilho":"negocio_criado"}',
        '[{"tipo":"mudar_temperatura","temperatura":"quente"}]')$q$);
    v_acao := crm_teste.aut_erro(format(
        $q$insert into public.automacoes_acoes (automacao_id, ordem, tipo, temperatura) values (%L, 9, 'mudar_temperatura', 'frio')$q$, v_alvo));
    v_log := crm_teste.aut_erro(format(
        $q$insert into public.automacoes_execucoes (tenant_id, automacao_id, evento, chave_idempotencia) values (%L, %L, 'x', 'forjada')$q$,
        v_tx, v_alvo));
    v_agenda := crm_teste.aut_erro('select public.executar_automacoes_agendadas()');
    perform public.login_admin();

    perform public.assert(v_le = 5, 'A1: vendedor VÊ a lista de automações da empresa (modo leitura)');
    perform public.assert(v_ins like '42501%', 'A1: vendedor NÃO cria automação pela API direta (' || v_ins || ')');
    perform public.assert(v_upd = 0 and v_del = 0, 'A1: vendedor NÃO edita nem exclui automação pela API direta');
    perform public.assert(v_rpc like '42501 Somente o gerente%', 'A1: vendedor NÃO salva automação pela RPC (' || v_rpc || ')');
    perform public.assert(v_acao like '42501%', 'A1: vendedor NÃO inclui ação em automação (' || v_acao || ')');
    perform public.assert(v_log like '42501%', 'A1: ninguém grava no histórico pela API (' || v_log || ')');
    perform public.assert(v_agenda like '42501%', 'A1: vendedor NÃO roda as automações agendadas (' || v_agenda || ')');
    perform public.assert((select nome from public.automacoes where id = v_alvo) <> 'Hack', 'A1: regra intacta');

    -- Gerente de outra empresa, com header forjado apontando para X
    perform public.login_como(v_gy, 'aut.gerente.y@teste.com', v_tx);
    select count(*) into v_y_le from public.automacoes where tenant_id = v_tx;
    v_y_upd := crm_teste.aut_linhas(format('update public.automacoes set ativo = true where id = %L', v_alvo));
    perform public.login_admin();
    perform public.assert(v_y_le = 0 and v_y_upd = 0,
        'A1: gerente de OUTRA empresa não lê nem liga regra alheia, nem com x-tenant-id forjado');

    perform public.login_anon();
    v_anon := crm_teste.aut_erro('select count(*) from public.automacoes');
    v_anon_rpc := crm_teste.aut_erro($q$select public.salvar_automacao('{}', '[]')$q$);
    v_anon_agenda := crm_teste.aut_erro('select public.executar_automacoes_agendadas()');
    perform public.login_admin();
    perform public.assert(v_anon like '42501%' and v_anon_rpc like '42501%' and v_anon_agenda like '42501%',
        'A1: chave pública (anon) não lê, não salva e não executa automações');

    perform public.login_como(v_gx, 'aut.gerente.x@teste.com');
    v_ger_agenda := crm_teste.aut_erro('select public.executar_automacoes_agendadas()');
    perform public.login_admin();
    perform public.assert(v_ger_agenda like '42501%', 'A1: nem o gerente chama o agendador pela API (só cron/admin)');

    perform public.login_anon();
    v_anon := crm_teste.aut_erro('select count(*) from public.automacoes_execucoes');
    perform public.login_admin();
    perform public.assert(v_anon like '42501%', 'A1: anon não lê o histórico');
end $$;

-- ---------------------------------------------------------------------
-- A2 — gerente cria pela RPC; referência a outra empresa é recusada
-- (FK composta), regra incompleta não ativa
-- ---------------------------------------------------------------------
do $$
declare
    v_gx uuid := crm_teste.aut_v('gx')::uuid;
    v_tx uuid := crm_teste.aut_v('tx')::uuid;
    v_id uuid;
    v_tenant uuid;
    v_erro_etapa text;
    v_erro_usuario text;
    v_erro_ativo text;
    v_erro_vazia text;
    v_erro_check text;
begin
    v_id := crm_teste.aut_salvar(v_gx,
        jsonb_build_object('nome', 'A2 criada pelo gerente', 'gatilho', 'negocio_criado', 'ativo', true,
                           'tenant_id', crm_teste.aut_v('ty')),
        '[{"tipo":"criar_tarefa","titulo":"Boas-vindas","prazo_quantidade":1,"prazo_unidade":"horas","responsavel_modo":"responsavel_negocio"}]');
    select tenant_id into v_tenant from public.automacoes where id = v_id;
    perform public.assert(v_tenant = v_tx, 'A2: gerente cria automação; tenant_id vem do servidor');
    perform public.assert((select ativo from public.automacoes where id = v_id), 'A2: regra completa ativa ao salvar');
    perform crm_teste.aut_set('r_criado', v_id::text);
    update public.automacoes set ativo = false where id = v_id;

    perform public.login_como(v_gx, 'aut.gerente.x@teste.com');
    v_erro_etapa := crm_teste.aut_erro(format($q$select public.salvar_automacao(%L, %L)$q$,
        jsonb_build_object('nome', 'A2 etapa alheia', 'gatilho', 'etapa_entrou', 'gatilho_etapa_id', crm_teste.aut_v('ey_proposta')),
        '[{"tipo":"mudar_temperatura","temperatura":"quente"}]'));
    v_erro_usuario := crm_teste.aut_erro(format($q$select public.salvar_automacao(%L, %L)$q$,
        jsonb_build_object('nome', 'A2 usuário alheio', 'gatilho', 'negocio_criado'),
        jsonb_build_array(jsonb_build_object('tipo', 'atribuir_responsavel', 'atribuicao_modo', 'usuario_fixo',
                                             'usuario_id', crm_teste.aut_v('vy')))));
    v_erro_ativo := crm_teste.aut_erro($q$insert into public.automacoes (nome, gatilho, ativo) values ('A2 ativa direta', 'negocio_criado', true)$q$);
    v_erro_vazia := crm_teste.aut_erro($q$select public.salvar_automacao('{"nome":"A2 sem ações","gatilho":"negocio_criado"}', '[]')$q$);
    v_erro_check := crm_teste.aut_erro($q$select public.salvar_automacao('{"nome":"A2 tarefa sem título","gatilho":"negocio_criado"}',
        '[{"tipo":"criar_tarefa","prazo_quantidade":1,"prazo_unidade":"dias","responsavel_modo":"responsavel_negocio"}]')$q$);
    perform public.login_admin();

    perform public.assert(v_erro_etapa like '23503%', 'A2: regra NÃO aponta para etapa de outra empresa (FK composta) (' || v_erro_etapa || ')');
    perform public.assert(v_erro_usuario like '23503%', 'A2: ação NÃO aponta para usuário de outra empresa (FK composta) (' || v_erro_usuario || ')');
    perform public.assert(v_erro_ativo like '23514%', 'A2: regra não nasce ativa sem ações pela API direta (' || v_erro_ativo || ')');
    perform public.assert(v_erro_vazia like '23514%', 'A2: regra sem ação é recusada (' || v_erro_vazia || ')');
    perform public.assert(v_erro_check like '23514%', 'A2: ação incompleta é recusada pelo CHECK do banco (' || v_erro_check || ')');
    perform public.assert(not exists (select 1 from public.automacoes where nome like 'A2 %' and nome <> 'A2 criada pelo gerente'),
        'A2: nada das tentativas recusadas ficou gravado');
end $$;

-- ---------------------------------------------------------------------
-- A3 — gatilho 1: negócio criado (+ timeline, + inativa não dispara)
-- ---------------------------------------------------------------------
do $$
declare
    v_v1 uuid := crm_teste.aut_v('v1')::uuid;
    v_regra uuid := crm_teste.aut_v('r_criado')::uuid;
    v_lead uuid;
    v_lead2 uuid;
    v_tarefa record;
    v_timeline text;
    v_log record;
begin
    perform crm_teste.aut_desligar_tudo();
    update public.automacoes set ativo = true where id = v_regra;

    v_lead := crm_teste.aut_lead(v_v1, 'A3 Cliente novo', crm_teste.aut_v('e_novo')::bigint);
    select * into v_tarefa from public.tarefas where cliente_id = v_lead::text and titulo = 'Boas-vindas';
    perform public.assert(v_tarefa.id is not null, 'A3: negócio criado → tarefa "Boas-vindas" criada');
    perform public.assert(v_tarefa.tenant_id = crm_teste.aut_v('tx')::uuid, 'A3: tarefa no tenant do negócio');
    perform public.assert(v_tarefa.responsavel = 'Aut Vendedor 1', 'A3: responsável da tarefa = responsável do negócio');
    perform public.assert(v_tarefa.data_vencimento between now() + interval '59 minutes' and now() + interval '61 minutes',
        'A3: prazo de 1 hora a partir do evento');
    perform public.assert(v_tarefa.concluido is false and v_tarefa.created_by is null, 'A3: tarefa aberta, autoria do sistema');

    select coalesce(titulo, title) into v_timeline from public.atividades_lead
    where cliente_id = v_lead::text and coalesce(tipo, activity_type) = 'automacao';
    perform public.assert(v_timeline = 'Automação «A2 criada pelo gerente» criou a tarefa «Boas-vindas»',
        'A3: timeline do lead registra "Automação «nome» criou a tarefa «X»" (veio: ' || coalesce(v_timeline, 'nada') || ')');

    select * into v_log from public.automacoes_execucoes where automacao_id = v_regra and negocio_id = v_lead;
    perform public.assert(v_log.resultado = 'ok' and v_log.evento = 'negocio_criado' and v_log.negocio_nome = 'A3 Cliente novo',
        'A3: histórico registra execução ok com o negócio');

    update public.automacoes set ativo = false where id = v_regra;
    v_lead2 := crm_teste.aut_lead(v_v1, 'A3 Regra desligada', crm_teste.aut_v('e_novo')::bigint);
    perform public.assert(crm_teste.aut_tarefas(v_lead2, 'Boas-vindas') = 0
        and not exists (select 1 from public.automacoes_execucoes where negocio_id = v_lead2),
        'A3: regra INATIVA não dispara');
    perform crm_teste.aut_set('lead_a3', v_lead::text);
end $$;

-- ---------------------------------------------------------------------
-- A4 — gatilho 2: entrou na etapa X (+ idempotência no vai-e-volta)
-- ---------------------------------------------------------------------
do $$
declare
    v_v1 uuid := crm_teste.aut_v('v1')::uuid;
    v_v2 uuid := crm_teste.aut_v('v2')::uuid;
    v_regra uuid;
    v_lead uuid;
begin
    perform crm_teste.aut_desligar_tudo();
    select id into v_regra from public.automacoes where tenant_id = crm_teste.aut_v('tx')::uuid and modelo_chave = 'proposta_enviada';
    update public.automacoes set ativo = true where id = v_regra;   -- o "1 clique" do gerente

    v_lead := crm_teste.aut_lead(v_v1, 'A4 Proposta', crm_teste.aut_v('e_novo')::bigint);
    perform public.assert(crm_teste.aut_tarefas(v_lead, 'Ligar para saber o que achou') = 0,
        'A4: entrar em outra etapa não dispara a regra da proposta');

    perform crm_teste.aut_mover(v_v2, v_lead, crm_teste.aut_v('e_proposta')::bigint);   -- colega move o card
    perform public.assert(crm_teste.aut_tarefas(v_lead, 'Ligar para saber o que achou') = 1,
        'A4: entrou em Proposta Enviada → tarefa "Ligar para saber o que achou"');
    perform public.assert(
        (select data_vencimento from public.tarefas where cliente_id = v_lead::text and titulo = 'Ligar para saber o que achou')
            between now() + interval '2 days' - interval '1 minute' and now() + interval '2 days' + interval '1 minute',
        'A4: prazo de 2 dias');
    perform public.assert(
        (select responsavel from public.tarefas where cliente_id = v_lead::text and titulo = 'Ligar para saber o que achou') = 'Aut Vendedor 1',
        'A4: tarefa vai para o responsável do negócio, não para quem moveu o card');

    perform crm_teste.aut_mover(v_v1, v_lead, crm_teste.aut_v('e_visita')::bigint);
    perform crm_teste.aut_mover(v_v1, v_lead, crm_teste.aut_v('e_proposta')::bigint);
    perform crm_teste.aut_mover(v_v1, v_lead, crm_teste.aut_v('e_proposta')::bigint);
    perform public.assert(crm_teste.aut_tarefas(v_lead, 'Ligar para saber o que achou') = 1
        and (select count(*) from public.automacoes_execucoes where automacao_id = v_regra and negocio_id = v_lead) = 1,
        'A4: IDEMPOTÊNCIA: sair e voltar para a etapa no mesmo dia não duplica a tarefa nem o log');
    perform public.assert(
        (select negocio_id from public.automacoes_execucoes where automacao_id = v_regra and negocio_id = v_lead) = v_lead
        and (select stage_id from public.negocios where id = v_lead) = crm_teste.aut_v('e_proposta')::bigint,
        'A4: o card ficou na etapa escolhida pelo usuário');
    perform crm_teste.aut_set('lead_a4', v_lead::text);
end $$;

-- ---------------------------------------------------------------------
-- A5 — gatilhos 3 e 4: ganho (tarefa + aviso ao gerente) e perdido
-- ---------------------------------------------------------------------
do $$
declare
    v_tx uuid := crm_teste.aut_v('tx')::uuid;
    v_v1 uuid := crm_teste.aut_v('v1')::uuid;
    v_ganho uuid;
    v_perdido uuid;
    v_lead uuid;
    v_lead2 uuid;
    v_aviso record;
begin
    perform crm_teste.aut_desligar_tudo();
    select id into v_ganho from public.automacoes where tenant_id = v_tx and modelo_chave = 'ganho';
    update public.automacoes set ativo = true where id = v_ganho;
    -- "perdido" foi apagado no A0: o gerente recria pela tela
    v_perdido := crm_teste.aut_salvar(crm_teste.aut_v('gx')::uuid,
        '{"nome":"Perdido: retomar em 180 dias","gatilho":"negocio_perdido","ativo":true}',
        '[{"tipo":"criar_tarefa","titulo":"Retomar contato","prazo_quantidade":180,"prazo_unidade":"dias","responsavel_modo":"responsavel_negocio"}]');

    v_lead := crm_teste.aut_lead(v_v1, 'A5 Ganho', crm_teste.aut_v('e_proposta')::bigint);
    perform crm_teste.aut_mover(v_v1, v_lead, crm_teste.aut_v('e_ganho')::bigint);
    perform public.assert(crm_teste.aut_tarefas(v_lead, 'Agendar instalação') = 1, 'A5: ganho → tarefa "Agendar instalação"');
    select * into v_aviso from public.tarefas
    where cliente_id = v_lead::text and titulo = 'Negócio ganho: acompanhar a instalação';
    perform public.assert(v_aviso.responsavel = 'Gerente X' and v_aviso.data_vencimento <= now(),
        'A5: ganho → aviso ao gerente (tarefa do gerente vencendo agora: aparece no sino)');
    perform public.assert(
        (select count(*) from public.atividades_lead where cliente_id = v_lead::text and coalesce(tipo, activity_type) = 'automacao') = 2,
        'A5: as duas ações aparecem na timeline do lead');

    -- Reabrir e ganhar de novo não agenda outra instalação
    perform crm_teste.aut_mover(v_v1, v_lead, crm_teste.aut_v('e_proposta')::bigint);
    perform crm_teste.aut_mover(v_v1, v_lead, crm_teste.aut_v('e_ganho')::bigint);
    perform public.assert(crm_teste.aut_tarefas(v_lead, 'Agendar instalação') = 1,
        'A5: IDEMPOTÊNCIA: o mesmo negócio ganho de novo não duplica');

    v_lead2 := crm_teste.aut_lead(v_v1, 'A5 Perdido', crm_teste.aut_v('e_novo')::bigint);
    perform crm_teste.aut_mover(v_v1, v_lead2, crm_teste.aut_v('e_perdido')::bigint);
    perform public.assert(
        (select data_vencimento from public.tarefas where cliente_id = v_lead2::text and titulo = 'Retomar contato')
            between now() + interval '180 days' - interval '1 minute' and now() + interval '180 days' + interval '1 minute',
        'A5: perdido → "Retomar contato" em 180 dias');
    perform public.assert(crm_teste.aut_tarefas(v_lead2, 'Agendar instalação') = 0, 'A5: perdido não dispara a regra de ganho');
    perform crm_teste.aut_set('lead_ganho', v_lead::text);
end $$;

-- ---------------------------------------------------------------------
-- A6 — gatilho 5: temperatura mudou para X (inclusive lead que já entra quente)
-- ---------------------------------------------------------------------
do $$
declare
    v_tx uuid := crm_teste.aut_v('tx')::uuid;
    v_v1 uuid := crm_teste.aut_v('v1')::uuid;
    v_regra uuid;
    v_lead uuid;
    v_lead2 uuid;
begin
    perform crm_teste.aut_desligar_tudo();
    select id into v_regra from public.automacoes where tenant_id = v_tx and modelo_chave = 'entrou_quente';
    update public.automacoes set ativo = true where id = v_regra;

    v_lead := crm_teste.aut_lead(v_v1, 'A6 Esquentou', crm_teste.aut_v('e_novo')::bigint, '{"temperatura":"morno"}');
    perform public.assert(crm_teste.aut_tarefas(v_lead, 'Ligar em até 1 hora') = 0, 'A6: morno não dispara a regra de quente');
    perform public.login_como(v_v1);
    update public.clientes set temperatura = 'quente' where id = v_lead;
    perform public.login_admin();
    perform public.assert(crm_teste.aut_tarefas(v_lead, 'Ligar em até 1 hora') = 1, 'A6: virou quente → "Ligar em até 1 hora"');
    perform public.assert(
        (select data_vencimento from public.tarefas where cliente_id = v_lead::text and titulo = 'Ligar em até 1 hora')
            <= now() + interval '1 hour',
        'A6: prazo de 1 hora');

    v_lead2 := crm_teste.aut_lead(v_v1, 'A6 Já quente', crm_teste.aut_v('e_novo')::bigint, '{"temperatura":"quente"}');
    perform public.assert(crm_teste.aut_tarefas(v_lead2, 'Ligar em até 1 hora') = 1, 'A6: lead que já ENTRA quente também dispara');
end $$;

-- ---------------------------------------------------------------------
-- A7 — condições: funil, temperatura, valor mínimo e origem filtram
-- ---------------------------------------------------------------------
do $$
declare
    v_tx uuid := crm_teste.aut_v('tx')::uuid;
    v_v1 uuid := crm_teste.aut_v('v1')::uuid;
    v_insta uuid;
    v_google uuid;
    v_regra uuid;
    v_ok uuid;
    v_barato uuid;
    v_frio uuid;
    v_google_lead uuid;
    v_outro_funil uuid;
    v_extra jsonb;
begin
    perform crm_teste.aut_desligar_tudo();
    select id into v_insta from public.canais_origem where tenant_id = v_tx and nome = 'Instagram';
    select id into v_google from public.canais_origem where tenant_id = v_tx and nome = 'Google';
    v_regra := crm_teste.aut_salvar(crm_teste.aut_v('gx')::uuid,
        jsonb_build_object('nome', 'A7 condições', 'gatilho', 'negocio_criado', 'ativo', true,
            'cond_pipeline_id', crm_teste.aut_v('px'), 'cond_temperatura', 'morno',
            'cond_valor_minimo', 20000, 'cond_origem_id', v_insta),
        '[{"tipo":"criar_tarefa","titulo":"Lead qualificado","prazo_quantidade":0,"prazo_unidade":"horas","responsavel_modo":"responsavel_negocio"}]');

    v_extra := jsonb_build_object('temperatura', 'morno', 'valor', 25000, 'pipeline_id', crm_teste.aut_v('px'),
        'dados_extras', jsonb_build_object('origem_id', v_insta, 'origem', 'Instagram'));
    v_ok := crm_teste.aut_lead(v_v1, 'A7 Atende tudo', crm_teste.aut_v('e_novo')::bigint, v_extra);
    v_barato := crm_teste.aut_lead(v_v1, 'A7 Barato', crm_teste.aut_v('e_novo')::bigint, v_extra || '{"valor":5000}');
    v_frio := crm_teste.aut_lead(v_v1, 'A7 Frio', crm_teste.aut_v('e_novo')::bigint, v_extra || '{"temperatura":"frio"}');
    v_google_lead := crm_teste.aut_lead(v_v1, 'A7 Google', crm_teste.aut_v('e_novo')::bigint,
        v_extra || jsonb_build_object('dados_extras', jsonb_build_object('origem_id', v_google)));
    v_outro_funil := crm_teste.aut_lead(v_v1, 'A7 Outro funil', crm_teste.aut_v('e_outro_funil')::bigint,
        v_extra || jsonb_build_object('pipeline_id', crm_teste.aut_v('px2')));

    perform public.assert(crm_teste.aut_tarefas(v_ok, 'Lead qualificado') = 1, 'A7: negócio que atende todas as condições dispara');
    perform public.assert(crm_teste.aut_tarefas(v_barato, 'Lead qualificado') = 0, 'A7: valor abaixo do mínimo NÃO dispara');
    perform public.assert(crm_teste.aut_tarefas(v_frio, 'Lead qualificado') = 0, 'A7: temperatura diferente NÃO dispara');
    perform public.assert(crm_teste.aut_tarefas(v_google_lead, 'Lead qualificado') = 0, 'A7: outra origem NÃO dispara');
    perform public.assert(crm_teste.aut_tarefas(v_outro_funil, 'Lead qualificado') = 0, 'A7: outro funil NÃO dispara');
    perform public.assert(
        (select count(*) from public.automacoes_execucoes where automacao_id = v_regra) = 1,
        'A7: condição não atendida não gera execução no histórico');
end $$;

-- ---------------------------------------------------------------------
-- A8 — isolamento: regra da empresa X nunca age em negócio da Y
-- ---------------------------------------------------------------------
do $$
declare
    v_tx uuid := crm_teste.aut_v('tx')::uuid;
    v_ty uuid := crm_teste.aut_v('ty')::uuid;
    v_vy uuid := crm_teste.aut_v('vy')::uuid;
    v_regra uuid := crm_teste.aut_v('r_criado')::uuid;
    v_lead_y uuid;
    v_lead_forjado uuid;
    v_direto text;
begin
    perform crm_teste.aut_desligar_tudo();
    update public.automacoes set ativo = true where id = v_regra;   -- X: "negócio criado"

    v_lead_y := crm_teste.aut_lead(v_vy, 'A8 Negócio da Y', crm_teste.aut_v('ey_novo')::bigint,
        jsonb_build_object('responsavel', 'Vendedor Y', 'responsavel_id', v_vy));
    v_lead_forjado := crm_teste.aut_lead(v_vy, 'A8 Header forjado', crm_teste.aut_v('ey_novo')::bigint,
        jsonb_build_object('responsavel', 'Vendedor Y', 'responsavel_id', v_vy, 'header_tenant', v_tx));

    perform public.assert((select tenant_id from public.negocios where id = v_lead_forjado) = v_ty,
        'A8: header x-tenant-id forjado não muda a empresa do negócio');
    perform public.assert(
        crm_teste.aut_tarefas(v_lead_y, 'Boas-vindas') = 0 and crm_teste.aut_tarefas(v_lead_forjado, 'Boas-vindas') = 0,
        'A8: regra da empresa X NÃO age em negócio da empresa Y (nem com header forjado)');
    perform public.assert(not exists (
        select 1 from public.automacoes_execucoes where negocio_id in (v_lead_y, v_lead_forjado)),
        'A8: nenhum log da X para negócio da Y');

    -- Mesmo chamando o motor direto com a regra da X e o negócio da Y
    v_direto := public.automacao_executar(v_regra, v_lead_y, 'negocio_criado', 'forcado|' || v_lead_y);
    perform public.assert(v_direto = 'ignorado' and crm_teste.aut_tarefas(v_lead_y, 'Boas-vindas') = 0,
        'A8: o motor usa o tenant do NEGÓCIO: regra de outra empresa é ignorada');
    perform public.assert(not exists (select 1 from public.tarefas where tenant_id = v_ty and titulo = 'Boas-vindas'),
        'A8: nenhuma tarefa da regra X caiu na empresa Y');
    update public.automacoes set ativo = false where id = v_regra;
end $$;

-- ---------------------------------------------------------------------
-- A9 — sem laço: ação que muda temperatura não dispara cascata
-- ---------------------------------------------------------------------
do $$
declare
    v_gx uuid := crm_teste.aut_v('gx')::uuid;
    v_v1 uuid := crm_teste.aut_v('v1')::uuid;
    v_l1 uuid;
    v_l2 uuid;
    v_lead uuid;
    v_temp text;
begin
    perform crm_teste.aut_desligar_tudo();
    v_l1 := crm_teste.aut_salvar(v_gx, '{"nome":"A9 quente vira frio","gatilho":"temperatura_mudou","gatilho_temperatura":"quente","ativo":true}',
        '[{"tipo":"mudar_temperatura","temperatura":"frio"}]');
    v_l2 := crm_teste.aut_salvar(v_gx, '{"nome":"A9 frio vira quente","gatilho":"temperatura_mudou","gatilho_temperatura":"frio","ativo":true}',
        '[{"tipo":"mudar_temperatura","temperatura":"quente"},{"tipo":"atribuir_responsavel","atribuicao_modo":"rodizio"}]');

    v_lead := crm_teste.aut_lead(v_v1, 'A9 Laço', crm_teste.aut_v('e_novo')::bigint, '{"temperatura":"morno"}');
    perform public.login_como(v_v1);
    update public.clientes set temperatura = 'quente' where id = v_lead;
    perform public.login_admin();

    select temperatura into v_temp from public.negocios where id = v_lead;
    perform public.assert(v_temp = 'frio', 'A9: a regra 1 mudou a temperatura (quente → frio)');
    perform public.assert(
        (select count(*) from public.automacoes_execucoes where automacao_id = v_l1) = 1
        and (select count(*) from public.automacoes_execucoes where automacao_id = v_l2) = 0,
        'A9: SEM LAÇO: a mudança feita pela automação não disparou a regra 2 (frio → quente) nem a 1 de novo');
    perform public.assert(
        exists (select 1 from public.atividades_lead where cliente_id = v_lead::text
                and coalesce(titulo, title) = 'Automação «A9 quente vira frio» mudou a temperatura para Frio'),
        'A9: timeline registra a mudança de temperatura feita pela automação');
    delete from public.automacoes where id in (v_l1, v_l2);
end $$;

-- ---------------------------------------------------------------------
-- A10 — falha isolada: erro vai para o log, o card é movido e as
-- outras regras rodam; a regra que falhou é desfeita por inteiro
-- ---------------------------------------------------------------------
do $$
declare
    v_gx uuid := crm_teste.aut_v('gx')::uuid;
    v_v1 uuid := crm_teste.aut_v('v1')::uuid;
    v_v3 uuid := crm_teste.aut_v('v3')::uuid;
    v_falha uuid;
    v_boa uuid;
    v_lead uuid;
    v_log record;
    v_stage bigint;
    v_erro_mover text;
begin
    perform crm_teste.aut_desligar_tudo();
    v_falha := crm_teste.aut_salvar(v_gx,
        jsonb_build_object('nome', 'A10 falha', 'gatilho', 'etapa_entrou', 'gatilho_etapa_id', crm_teste.aut_v('e_visita'), 'ativo', true),
        jsonb_build_array(
            jsonb_build_object('tipo', 'criar_tarefa', 'titulo', 'A10 primeira ação', 'prazo_quantidade', 1, 'prazo_unidade', 'dias',
                               'responsavel_modo', 'responsavel_negocio'),
            jsonb_build_object('tipo', 'criar_tarefa', 'titulo', 'A10 para o vendedor 3', 'prazo_quantidade', 1, 'prazo_unidade', 'dias',
                               'responsavel_modo', 'usuario_fixo', 'usuario_id', v_v3)));
    v_boa := crm_teste.aut_salvar(v_gx,
        jsonb_build_object('nome', 'A10 boa', 'gatilho', 'etapa_entrou', 'gatilho_etapa_id', crm_teste.aut_v('e_visita'), 'ativo', true),
        '[{"tipo":"criar_tarefa","titulo":"A10 regra boa","prazo_quantidade":1,"prazo_unidade":"dias","responsavel_modo":"responsavel_negocio"}]');

    -- O vendedor 3 sai da empresa: a ação passa a falhar
    update public.funcionarios set ativo = false where id = v_v3;

    v_lead := crm_teste.aut_lead(v_v1, 'A10 Card', crm_teste.aut_v('e_novo')::bigint);
    perform public.login_como(v_v1);
    v_erro_mover := crm_teste.aut_erro(format('update public.clientes set stage_id = %s where id = %L', crm_teste.aut_v('e_visita'), v_lead));
    perform public.login_admin();
    select stage_id into v_stage from public.negocios where id = v_lead;

    perform public.assert(v_erro_mover = 'OK' and v_stage = crm_teste.aut_v('e_visita')::bigint,
        'A10: FALHA ISOLADA: o usuário moveu o card normalmente mesmo com a automação falhando');
    select * into v_log from public.automacoes_execucoes where automacao_id = v_falha and negocio_id = v_lead;
    perform public.assert(v_log.resultado = 'erro' and v_log.mensagem = 'O usuário escolhido na ação não está ativo nesta empresa.',
        'A10: o erro vai para o histórico com a mensagem (' || coalesce(v_log.mensagem, 'sem mensagem') || ')');
    perform public.assert(crm_teste.aut_tarefas(v_lead, 'A10 primeira ação') = 0,
        'A10: a regra que falhou é desfeita por inteiro (nem a 1ª ação fica pela metade)');
    perform public.assert(crm_teste.aut_tarefas(v_lead, 'A10 regra boa') = 1
        and (select resultado from public.automacoes_execucoes where automacao_id = v_boa and negocio_id = v_lead) = 'ok',
        'A10: as outras regras do mesmo evento rodam normalmente');

    -- Salvar o negócio (outro campo) também segue funcionando
    perform public.login_como(v_v1);
    v_erro_mover := crm_teste.aut_erro(format('update public.clientes set valor = 12345 where id = %L', v_lead));
    perform public.login_admin();
    perform public.assert(v_erro_mover = 'OK' and (select valor from public.negocios where id = v_lead) = 12345,
        'A10: editar o negócio segue funcionando');

    update public.funcionarios set ativo = true where id = v_v3;
    delete from public.automacoes where id in (v_falha, v_boa);
end $$;

-- ---------------------------------------------------------------------
-- A11 — rodízio justo entre vendedores ativos (gerente fora), com estado
-- ---------------------------------------------------------------------
do $$
declare
    v_tx uuid := crm_teste.aut_v('tx')::uuid;
    v_gx uuid := crm_teste.aut_v('gx')::uuid;
    v_v1 uuid := crm_teste.aut_v('v1')::uuid;
    v_v2 uuid := crm_teste.aut_v('v2')::uuid;
    v_regra uuid;
    v_resp text[] := '{}';
    v_lead uuid;
    v_cont record;
    v_v4 uuid := gen_random_uuid();
    i integer;
begin
    perform crm_teste.aut_desligar_tudo();
    v_regra := crm_teste.aut_salvar(v_gx, '{"nome":"A11 rodízio","gatilho":"negocio_criado","ativo":true}',
        '[{"tipo":"atribuir_responsavel","atribuicao_modo":"rodizio"},{"tipo":"criar_tarefa","titulo":"Primeiro contato","prazo_quantidade":2,"prazo_unidade":"horas","responsavel_modo":"responsavel_negocio"}]');

    for i in 1..6 loop
        v_lead := crm_teste.aut_lead(v_v1, 'A11 Lead ' || i, crm_teste.aut_v('e_novo')::bigint);
        v_resp := v_resp || (select responsavel from public.negocios where id = v_lead);
        perform public.assert(
            (select responsavel from public.tarefas where cliente_id = v_lead::text and titulo = 'Primeiro contato')
                = (select responsavel from public.negocios where id = v_lead),
            'A11: a tarefa da ação seguinte vai para o vendedor sorteado (lead ' || i || ')');
    end loop;
    perform public.assert(
        v_resp = array['Aut Vendedor 1', 'Aut Vendedor 2', 'Aut Vendedor 3', 'Aut Vendedor 1', 'Aut Vendedor 2', 'Aut Vendedor 3'],
        'A11: RODÍZIO JUSTO: 6 leads → 2 para cada vendedor, em ordem, gerente fora (veio: ' || array_to_string(v_resp, ', ') || ')');
    perform public.assert(
        (select responsavel_id from public.negocios where titulo = 'A11 Lead 2') = v_v2,
        'A11: lead criado pelo vendedor 1 foi atribuído ao vendedor 2 (a trava de reatribuição não bloqueia o motor)');
    select atribuicoes, ultimo_funcionario_id into v_cont from public.automacoes_rodizio where automacao_id = v_regra;
    perform public.assert(v_cont.atribuicoes = 6, 'A11: estado do rodízio guardado no banco (6 atribuições)');

    -- Vendedor novo entra na fila na posição dele; inativo sai
    insert into auth.users (id, email) values (v_v4, 'aut.v0@teste.com');
    insert into public.utilizadores_empresas (auth_uid, empresa_id, role) values (v_v4, v_tx, 'vendedor');
    insert into public.funcionarios (id, user_id, nome, email, ativo, tenant_id)
    values (v_v4, v_v4, 'Aut Vendedor 0', 'aut.v0@teste.com', true, v_tx);
    update public.funcionarios set ativo = false where id = crm_teste.aut_v('v2')::uuid;
    v_resp := '{}';
    for i in 7..9 loop
        v_lead := crm_teste.aut_lead(v_v1, 'A11 Lead ' || i, crm_teste.aut_v('e_novo')::bigint);
        v_resp := v_resp || (select responsavel from public.negocios where id = v_lead);
    end loop;
    perform public.assert(v_resp = array['Aut Vendedor 0', 'Aut Vendedor 1', 'Aut Vendedor 3'],
        'A11: fila continua de onde parou com quem entrou e sem quem saiu (veio: ' || array_to_string(v_resp, ', ') || ')');

    update public.funcionarios set ativo = true where id = crm_teste.aut_v('v2')::uuid;
    update public.funcionarios set ativo = false where id = v_v4;
    delete from public.automacoes where id = v_regra;
    perform public.assert(not exists (select 1 from public.automacoes_rodizio where automacao_id = v_regra),
        'A11: excluir a regra limpa o estado do rodízio');
end $$;

-- ---------------------------------------------------------------------
-- A12 — tarefa criada por automação: excluível pelo responsável do
-- negócio, NÃO por outro vendedor
-- ---------------------------------------------------------------------
do $$
declare
    v_lead uuid := crm_teste.aut_v('lead_a4')::uuid;
    v_tarefa bigint;
    v_outro text;
    v_dono bigint;
begin
    select id into v_tarefa from public.tarefas where cliente_id = v_lead::text and titulo = 'Ligar para saber o que achou';

    perform public.login_como(crm_teste.aut_v('v2')::uuid, 'aut.v2@teste.com');
    v_outro := crm_teste.aut_erro(format('update public.tarefas set deleted_at = now() where id = %s', v_tarefa));
    perform public.login_admin();
    perform public.assert(v_outro like '42501 Você só pode excluir%',
        'A12: outro vendedor NÃO exclui a tarefa criada pela automação (' || v_outro || ')');

    perform public.login_como(crm_teste.aut_v('v1')::uuid, 'aut.v1@teste.com');
    v_dono := crm_teste.aut_linhas(format('update public.tarefas set deleted_at = now() where id = %s', v_tarefa));
    perform public.login_admin();
    perform public.assert(v_dono = 1 and (select deleted_at is not null from public.tarefas where id = v_tarefa),
        'A12: o responsável do negócio exclui a tarefa criada pela automação');
end $$;

-- ---------------------------------------------------------------------
-- A13 — agendadas: negócio parado e proposta sem resposta; segunda
-- execução não duplica
-- ---------------------------------------------------------------------
do $$
declare
    v_tx uuid := crm_teste.aut_v('tx')::uuid;
    v_gx uuid := crm_teste.aut_v('gx')::uuid;
    v_v1 uuid := crm_teste.aut_v('v1')::uuid;
    v_parado uuid;
    v_ativo uuid;
    v_lead_p uuid;
    v_lead_novo uuid;
    v_lead_prop uuid;
    v_lead_recente uuid;
    v_lead_aceito uuid;
    v_sem_resposta uuid;
    v_orc uuid;
    v_res1 jsonb;
    v_res2 jsonb;
    v_dup text;
begin
    perform crm_teste.aut_desligar_tudo();
    update public.pipeline_stages set dias_para_parado = 5 where id = crm_teste.aut_v('e_novo')::bigint;

    v_parado := crm_teste.aut_salvar(v_gx, '{"nome":"A13 parado","gatilho":"negocio_parado","ativo":true}',
        '[{"tipo":"criar_tarefa","titulo":"Retomar negócio parado","prazo_quantidade":1,"prazo_unidade":"dias","responsavel_modo":"responsavel_negocio"},{"tipo":"notificar_gerente","titulo":"Negócio parado"}]');
    select id into v_sem_resposta from public.automacoes where tenant_id = v_tx and modelo_chave = 'proposta_sem_resposta';
    update public.automacoes set ativo = true where id = v_sem_resposta;

    v_lead_p := crm_teste.aut_lead(v_v1, 'A13 Parado', crm_teste.aut_v('e_novo')::bigint);
    v_lead_novo := crm_teste.aut_lead(v_v1, 'A13 Em dia', crm_teste.aut_v('e_novo')::bigint);
    v_lead_prop := crm_teste.aut_lead(v_v1, 'A13 Proposta antiga', crm_teste.aut_v('e_proposta')::bigint);
    v_lead_recente := crm_teste.aut_lead(v_v1, 'A13 Proposta recente', crm_teste.aut_v('e_proposta')::bigint);
    v_lead_aceito := crm_teste.aut_lead(v_v1, 'A13 Proposta aceita', crm_teste.aut_v('e_proposta')::bigint);

    -- Propostas enviadas
    insert into public.orcamentos (tenant_id, negocio_id, created_by) values (v_tx, v_lead_prop, v_v1) returning id into v_orc;
    update public.orcamentos set status = 'enviado' where id = v_orc;
    perform crm_teste.aut_set('orc_antigo', v_orc::text);
    insert into public.orcamentos (tenant_id, negocio_id, created_by) values (v_tx, v_lead_recente, v_v1) returning id into v_orc;
    update public.orcamentos set status = 'enviado' where id = v_orc;
    insert into public.orcamentos (tenant_id, negocio_id, created_by) values (v_tx, v_lead_aceito, v_v1) returning id into v_orc;
    update public.orcamentos set status = 'enviado' where id = v_orc;
    perform crm_teste.aut_set('orc_aceito', v_orc::text);

    -- Envelhece (sem disparar os triggers de updated_at)
    perform set_config('session_replication_role', 'replica', true);
    update public.negocios set created_at = now() - interval '10 days', updated_at = now() - interval '10 days'
    where id in (v_lead_p, v_lead_prop, v_lead_recente, v_lead_aceito);
    update public.atividades_lead set created_at = now() - interval '10 days'
    where cliente_id in (v_lead_p::text, v_lead_prop::text, v_lead_recente::text, v_lead_aceito::text);
    update public.orcamentos set enviado_em = now() - interval '4 days'
    where id in (crm_teste.aut_v('orc_antigo')::uuid, crm_teste.aut_v('orc_aceito')::uuid);
    update public.orcamentos set enviado_em = now() - interval '1 day' where negocio_id = v_lead_recente;
    perform set_config('session_replication_role', 'origin', true);
    update public.orcamentos set status = 'aceito' where id = crm_teste.aut_v('orc_aceito')::uuid;

    perform public.assert((select parado from public.vw_negocios_saude where id = v_lead_p),
        'A13: cenário: negócio parado pela regra da vw_negocios_saude');

    v_res1 := public.executar_automacoes_agendadas();
    perform public.assert(crm_teste.aut_tarefas(v_lead_p, 'Retomar negócio parado') = 1,
        'A13: negócio PARADO → tarefa "Retomar negócio parado"');
    perform public.assert(
        exists (select 1 from public.tarefas where cliente_id = v_lead_p::text and titulo = 'Negócio parado' and responsavel = 'Gerente X'),
        'A13: negócio parado → aviso ao gerente');
    perform public.assert(crm_teste.aut_tarefas(v_lead_novo, 'Retomar negócio parado') = 0,
        'A13: negócio com atividade recente não é tratado como parado');
    perform public.assert(crm_teste.aut_tarefas(v_lead_prop, 'Fazer follow-up da proposta') = 1,
        'A13: proposta enviada há 4 dias sem resposta → follow-up (modelo de 3 dias)');
    perform public.assert(crm_teste.aut_tarefas(v_lead_recente, 'Fazer follow-up da proposta') = 0,
        'A13: proposta enviada há 1 dia ainda não dispara');
    perform public.assert(crm_teste.aut_tarefas(v_lead_aceito, 'Fazer follow-up da proposta') = 0,
        'A13: proposta aceita não dispara');
    perform public.assert((v_res1 ->> 'executadas')::int >= 2 and (v_res1 ->> 'erros')::int = 0,
        'A13: resumo da execução agendada (' || v_res1::text || ')');

    v_res2 := public.executar_automacoes_agendadas();
    perform public.assert(
        crm_teste.aut_tarefas(v_lead_p, 'Retomar negócio parado') = 1
        and crm_teste.aut_tarefas(v_lead_prop, 'Fazer follow-up da proposta') = 1
        and (v_res2 ->> 'executadas')::int = 0,
        'A13: SEGUNDA execução não duplica nada (' || v_res2::text || ')');

    v_dup := public.automacao_executar(v_sem_resposta, v_lead_prop, 'proposta_sem_resposta',
        format('%s|proposta|%s', v_sem_resposta, crm_teste.aut_v('orc_antigo')));
    perform public.assert(v_dup = 'duplicado', 'A13: a chave de idempotência barra o mesmo evento (UNIQUE no log)');
    perform public.assert(
        (select count(*) from public.automacoes_execucoes
         where chave_idempotencia = format('%s|proposta|%s', v_sem_resposta, crm_teste.aut_v('orc_antigo'))) = 1,
        'A13: uma única linha no histórico por evento');
    perform public.assert(
        (select count(*) from public.atividades_lead where cliente_id = v_lead_p::text and coalesce(tipo, activity_type) = 'automacao') = 2,
        'A13: timeline do negócio parado mostra as ações da automação');
end $$;

-- ---------------------------------------------------------------------
-- A14 — regra incompleta / referência excluída
-- ---------------------------------------------------------------------
do $$
declare
    v_tx uuid := crm_teste.aut_v('tx')::uuid;
    v_gx uuid := crm_teste.aut_v('gx')::uuid;
    v_etapa bigint;
    v_regra uuid;
    v_regra_usuario uuid;
    v_func uuid := gen_random_uuid();
    v_ativo boolean;
begin
    insert into public.pipeline_stages (tenant_id, pipeline_id, nome, ordem)
    values (v_tx, crm_teste.aut_v('px')::uuid, 'Etapa temporária', 9) returning id into v_etapa;
    v_regra := crm_teste.aut_salvar(v_gx,
        jsonb_build_object('nome', 'A14 etapa temporária', 'gatilho', 'etapa_entrou', 'gatilho_etapa_id', v_etapa, 'ativo', true),
        '[{"tipo":"mudar_temperatura","temperatura":"quente"}]');
    perform public.assert((select ativo from public.automacoes where id = v_regra), 'A14: cenário: regra ativa na etapa');

    perform public.login_como(v_gx);
    delete from public.pipeline_stages where id = v_etapa;
    perform public.login_admin();
    select ativo into v_ativo from public.automacoes where id = v_regra;
    perform public.assert(not v_ativo and (select gatilho_etapa_id is null from public.automacoes where id = v_regra),
        'A14: etapa excluída → a regra é DESLIGADA (nunca passa a valer para qualquer etapa)');

    insert into public.funcionarios (id, nome, email, ativo, tenant_id) values (v_func, 'Temporário', 'aut.temp@teste.com', true, v_tx);
    v_regra_usuario := crm_teste.aut_salvar(v_gx,
        '{"nome":"A14 usuário fixo","gatilho":"negocio_criado","ativo":true}',
        jsonb_build_array(jsonb_build_object('tipo', 'atribuir_responsavel', 'atribuicao_modo', 'usuario_fixo', 'usuario_id', v_func)));
    delete from public.funcionarios where id = v_func;
    perform public.assert(not (select ativo from public.automacoes where id = v_regra_usuario),
        'A14: usuário fixo excluído → a regra é desligada');
    delete from public.automacoes where id in (v_regra, v_regra_usuario);
end $$;

-- ---------------------------------------------------------------------
-- A15 — histórico e contadores (leitura do tenant) + relatorio_rls
-- ---------------------------------------------------------------------
do $$
declare
    v_tx uuid := crm_teste.aut_v('tx')::uuid;
    v_v1_le bigint;
    v_y_le bigint;
    v_resumo record;
    v_ganho uuid;
    v_criticos integer;
    v_invoker boolean;
begin
    select id into v_ganho from public.automacoes where tenant_id = v_tx and modelo_chave = 'ganho';

    perform public.login_como(crm_teste.aut_v('v1')::uuid);
    select count(*) into v_v1_le from public.automacoes_execucoes;
    select * into v_resumo from public.vw_automacoes_resumo where automacao_id = v_ganho;
    perform public.login_admin();
    perform public.login_como(crm_teste.aut_v('gy')::uuid, null, v_tx);
    select count(*) into v_y_le from public.automacoes_execucoes where tenant_id = v_tx;
    perform public.login_admin();

    perform public.assert(v_v1_le > 0, 'A15: vendedor vê o histórico da própria empresa');
    perform public.assert(v_y_le = 0, 'A15: outra empresa não vê o histórico (nem com header forjado)');
    perform public.assert(v_resumo.total_execucoes = 1 and v_resumo.total_erros = 0,
        'A15: contadores por automação (vw_automacoes_resumo)');
    perform public.assert(
        (select total_erros from public.vw_automacoes_resumo r
         join public.automacoes a on a.id = r.automacao_id where a.nome = 'A10 falha') is null,
        'A15: contador some com a regra excluída');

    select coalesce((select lower(o.option_value) = 'on' from pg_options_to_table(c.reloptions) as o(option_name, option_value)
                     where o.option_name = 'security_invoker'), false)
    into v_invoker
    from pg_class c where c.oid = 'public.vw_automacoes_resumo'::regclass;
    perform public.assert(v_invoker, 'A15: vw_automacoes_resumo com security_invoker');

    select count(*) into v_criticos from public.relatorio_rls() where gravidade = 'CRITICA';
    perform public.assert(v_criticos = 0, 'A15: relatorio_rls() sem CRÍTICO depois da migration 17');
    perform public.assert(
        not has_function_privilege('authenticated', 'public.automacao_executar(uuid,uuid,text,text)', 'execute')
        and not has_function_privilege('authenticated', 'public.executar_automacoes_agendadas()', 'execute')
        and not has_function_privilege('anon', 'public.salvar_automacao(jsonb,jsonb)', 'execute')
        and has_function_privilege('authenticated', 'public.salvar_automacao(jsonb,jsonb)', 'execute'),
        'A15: motor sem EXECUTE para a API; só salvar_automacao (INVOKER) é chamada pela tela');
    perform public.assert(
        (select prosecdef from pg_proc where oid = 'public.automacao_executar(uuid,uuid,text,text)'::regprocedure)
        and (select proconfig::text like '%search_path=public%' from pg_proc where oid = 'public.automacao_executar(uuid,uuid,text,text)'::regprocedure)
        and not (select prosecdef from pg_proc where oid = 'public.salvar_automacao(jsonb,jsonb)'::regprocedure),
        'A15: motor SECURITY DEFINER com search_path fixo; RPC da tela SECURITY INVOKER');
end $$;

do $$ begin raise notice 'SUÍTE 12 (AUTOMAÇÕES) OK'; end $$;
