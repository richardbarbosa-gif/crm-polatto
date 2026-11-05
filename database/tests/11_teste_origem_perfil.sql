-- =====================================================================
-- TESTES DA MIGRATION 16 — origem do lead, primeiro acesso e meu perfil
--
-- Cada regra dos dois lados: o ataque falha E o uso legítimo funciona.
-- Reaproveita o cenário das suítes 01, 06 e 10 (crm_teste.ctx).
-- =====================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------
-- O1 — canais de origem: seeds, papéis e isolamento
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_ana uuid := (select valor from crm_teste.ctx where chave = 'ana');
    v_user_a uuid := (select valor from crm_teste.ctx where chave = 'user_a');
    v_user_b uuid := (select valor from crm_teste.ctx where chave = 'user_b');
    v_nomes text[];
    v_ana_le integer;
    v_bloq_insert boolean := false;
    v_ana_update integer;
    v_canal uuid;
    v_canal_tenant uuid;
    v_b_le integer;
    v_b_update integer;
    v_anon_bloqueado boolean := false;
    v_reprovisionado integer;
begin
    select array_agg(nome order by ordem) into v_nomes
    from public.canais_origem where tenant_id = v_tenant_a and padrao;
    perform public.assert(v_nomes = array['Instagram', 'Google', 'Indicação', 'Site', 'Feira', 'Outro'],
        'O1: cada empresa recebe os 6 canais de origem padrão, em ordem');
    perform public.assert((select count(*) from public.canais_origem where tenant_id = v_tenant_b and padrao) = 6,
        'O1: a outra empresa também recebe os canais padrão');

    perform public.login_como(v_ana, 'ana.vendas@teste.com');
    select count(*) into v_ana_le from public.canais_origem;
    begin
        insert into public.canais_origem (nome) values ('Canal do vendedor');
    exception when insufficient_privilege then
        v_bloq_insert := true;
    end;
    update public.canais_origem set nome = 'Hackeado' where tenant_id = v_tenant_a;
    get diagnostics v_ana_update = row_count;
    perform public.login_admin();

    perform public.assert(v_ana_le = 6, 'O1: vendedor lê os canais da própria empresa');
    perform public.assert(v_bloq_insert and v_ana_update = 0, 'O1: vendedor NÃO cria nem altera canal');

    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    insert into public.canais_origem (tenant_id, nome, ordem) values (v_tenant_b, 'Rádio local', 7)
    returning id, tenant_id into v_canal, v_canal_tenant;
    perform public.login_admin();
    perform public.assert(v_canal_tenant = v_tenant_a, 'O1: gerente cria canal; tenant_id forjado é trocado pelo dele');

    perform public.login_como(v_user_b, 'vendedor.b@teste.com', v_tenant_a);
    select count(*) into v_b_le from public.canais_origem where tenant_id = v_tenant_a;
    update public.canais_origem set nome = 'Invadido' where id = v_canal;
    get diagnostics v_b_update = row_count;
    perform public.login_admin();
    perform public.assert(v_b_le = 0 and v_b_update = 0, 'O1: gerente de outra empresa não lê nem altera canal alheio');

    perform public.login_anon();
    begin
        perform count(*) from public.canais_origem;
    exception when insufficient_privilege then
        v_anon_bloqueado := true;
    end;
    perform public.login_admin();
    perform public.assert(v_anon_bloqueado, 'O1: chave pública (anon) não lê canais');

    delete from public.canais_origem where tenant_id = v_tenant_a and nome = 'Feira';
    perform public.provisionar_defaults_tenant(v_tenant_a);
    select count(*) into v_reprovisionado from public.canais_origem where tenant_id = v_tenant_a and nome = 'Feira';
    perform public.assert(v_reprovisionado = 0, 'O1: canal padrão apagado pelo gerente não volta ao reprovisionar');

    insert into crm_teste.ctx values ('o_canal_radio', v_canal) on conflict (chave) do update set valor = excluded.valor;
end $$;

-- ---------------------------------------------------------------------
-- O2 — origem gravada pela tela (view clientes) e relatório por origem
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_ana uuid := (select valor from crm_teste.ctx where chave = 'ana');
    v_insta uuid;
    v_canal_b uuid;
    v_etapa_ganho bigint;
    v_etapa_perdido bigint;
    v_lead uuid;
    v_origem text;
    v_origem_mantida text;
    v_total bigint;
    v_ganhos bigint;
    v_perdidos bigint;
    v_valor numeric;
    v_forjado text;
    v_b_ve bigint;
    v_invoker boolean;
begin
    select id into v_insta from public.canais_origem where tenant_id = v_tenant_a and nome = 'Instagram';
    select id into v_canal_b from public.canais_origem where tenant_id = v_tenant_b and nome = 'Google';
    select id into v_etapa_ganho from public.pipeline_stages where tenant_id = v_tenant_a and ganho order by id limit 1;
    select id into v_etapa_perdido from public.pipeline_stages where tenant_id = v_tenant_a and perdido order by id limit 1;
    if v_etapa_perdido is null then
        insert into public.pipeline_stages (tenant_id, nome, ordem, perdido) values (v_tenant_a, 'Origem: Perdido', 95, true)
        returning id into v_etapa_perdido;
    end if;

    perform public.login_como(v_ana, 'ana.vendas@teste.com');
    insert into public.clientes (nome, status, responsavel, dados_extras)
    values ('Origem Insta 1', 'Novo Lead', 'Ana Vendas', jsonb_build_object('origem_id', v_insta, 'origem', 'Instagram'));
    select id, dados_extras ->> 'origem_id' into v_lead, v_origem from public.negocios where titulo = 'Origem Insta 1';
    -- Edição de outro campo não apaga a origem (merge de dados_extras)
    update public.clientes set valor = 10000, stage_id = v_etapa_ganho where id = v_lead;
    select dados_extras ->> 'origem_id' into v_origem_mantida from public.negocios where id = v_lead;

    insert into public.clientes (nome, status, responsavel, valor, stage_id, dados_extras)
    values ('Origem Insta 2', 'Perdido', 'Ana Vendas', 5000, v_etapa_perdido,
            jsonb_build_object('origem_id', v_insta, 'origem', 'Instagram'));
    insert into public.clientes (nome, status, responsavel, valor, dados_extras)
    values ('Origem Insta 3', 'Novo Lead', 'Ana Vendas', 7000, jsonb_build_object('origem_id', v_insta, 'origem', 'Instagram'));
    -- Ataque: aponta para o canal de OUTRA empresa
    insert into public.clientes (nome, status, responsavel, dados_extras)
    values ('Origem forjada', 'Novo Lead', 'Ana Vendas', jsonb_build_object('origem_id', v_canal_b, 'origem', 'Panfleto'));

    select sum(total_leads),
           sum(total_leads) filter (where stage_id = v_etapa_ganho),
           sum(total_leads) filter (where stage_id = v_etapa_perdido),
           sum(valor_total) filter (where stage_id = v_etapa_ganho)
    into v_total, v_ganhos, v_perdidos, v_valor
    from public.vw_vendas_por_origem where origem = 'Instagram';
    select string_agg(distinct origem, ',') into v_forjado
    from public.vw_vendas_por_origem v
    where exists (select 1 from public.negocios n where n.titulo = 'Origem forjada' and n.stage_id is not distinct from v.stage_id)
      and origem in ('Panfleto', 'Google');
    perform public.login_admin();

    perform public.assert(v_origem = v_insta::text, 'O2: lead criado pela view clientes grava a origem em dados_extras');
    perform public.assert(v_origem_mantida = v_insta::text, 'O2: editar outro campo do lead não apaga a origem');
    perform public.assert(v_total = 3 and v_ganhos = 1 and v_perdidos = 1 and v_valor = 10000,
        'O2: relatório por origem soma leads, ganhos, perdidos e valor ganho (Instagram: 3 leads, 1 ganho de R$ 10.000, 1 perdido)');
    perform public.assert(v_forjado = 'Panfleto',
        'O2: origem_id de canal de outra empresa não revela o nome do canal alheio (cai no texto salvo)');

    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_b'), 'vendedor.b@teste.com', v_tenant_a);
    select count(*) into v_b_ve from public.vw_vendas_por_origem where tenant_id = v_tenant_a;
    perform public.login_admin();
    perform public.assert(v_b_ve = 0, 'O2: outra empresa não lê o relatório de origem do tenant A');

    select coalesce((select lower(o.option_value) in ('on', 'true')
                     from pg_options_to_table(c.reloptions) as o(option_name, option_value)
                     where o.option_name = 'security_invoker'), false)
    into v_invoker
    from pg_class c where c.oid = 'public.vw_vendas_por_origem'::regclass;
    perform public.assert(v_invoker, 'O2: vw_vendas_por_origem tem security_invoker');
end $$;

-- ---------------------------------------------------------------------
-- O3 — primeiro acesso: estado real dos dados e dispensa por empresa
-- ---------------------------------------------------------------------
do $$
declare
    v_dono uuid := gen_random_uuid();
    v_vend uuid := gen_random_uuid();
    v_tenant uuid;
    v_antes jsonb;
    v_depois jsonb;
    v_etapa bigint;
    v_bloq_vendedor boolean := false;
    v_dispensado jsonb;
    v_por uuid;
    v_anon_bloqueado boolean := false;
    v_b jsonb;
begin
    insert into auth.users (id, email) values (v_dono, 'dono.onboarding@teste.com'), (v_vend, 'vend.onboarding@teste.com');
    perform public.login_como(v_dono, 'dono.onboarding@teste.com');
    v_tenant := public.provisionar_tenant('Solar Primeiro Acesso', 'energia_solar');
    v_antes := public.status_primeiro_acesso();
    perform public.login_admin();

    perform public.assert(
        v_antes = jsonb_build_object('identidade', false, 'produtos', false, 'equipe', false,
                                     'funil', false, 'primeiro_lead', false, 'dispensado', false),
        'O3: empresa recém-criada começa com o checklist todo pendente (provisionar o funil não conta como revisão)');

    -- vendedor entra na equipe
    insert into public.utilizadores_empresas (auth_uid, empresa_id, role) values (v_vend, v_tenant, 'vendedor');
    insert into public.funcionarios (id, user_id, nome, email, cargo, ativo, tenant_id)
    values (v_vend, v_vend, 'Vendedor Onboarding', 'vend.onboarding@teste.com', 'Vendedor', true, v_tenant);

    perform public.login_como(v_dono, 'dono.onboarding@teste.com');
    insert into public.empresa_identidade (nome_fantasia) values ('Solar Primeiro Acesso');
    insert into public.produtos (nome, preco_padrao) values ('Kit 5 kWp', 18000);
    select id into v_etapa from public.pipeline_stages order by ordem limit 1;
    update public.pipeline_stages set dias_para_parado = 4 where id = v_etapa;
    insert into public.clientes (nome, status) values ('Primeiro lead', 'Novo Lead');
    v_depois := public.status_primeiro_acesso();
    perform public.login_admin();

    perform public.assert(
        v_depois = jsonb_build_object('identidade', true, 'produtos', true, 'equipe', true,
                                      'funil', true, 'primeiro_lead', true, 'dispensado', false),
        'O3: cada passo é marcado sozinho pelo dado real (identidade, produto, equipe, funil revisado, primeiro lead)');

    -- Vendedor não dispensa; gerente dispensa (autor carimbado no servidor)
    perform public.login_como(v_vend, 'vend.onboarding@teste.com');
    begin
        insert into public.onboarding_empresa (dispensado_em) values (now());
    exception when insufficient_privilege then
        v_bloq_vendedor := true;
    end;
    perform public.login_admin();

    perform public.login_como(v_dono, 'dono.onboarding@teste.com');
    insert into public.onboarding_empresa (dispensado_em, dispensado_por) values (now() - interval '1 year', v_vend);
    v_dispensado := public.status_primeiro_acesso();
    perform public.login_admin();
    select dispensado_por into v_por from public.onboarding_empresa where tenant_id = v_tenant;

    perform public.assert(v_bloq_vendedor, 'O3: vendedor NÃO dispensa o primeiro acesso da empresa');
    perform public.assert((v_dispensado ->> 'dispensado')::boolean, 'O3: gerente dispensa; a dispensa fica no banco, por empresa');
    perform public.assert(v_por = v_dono, 'O3: quem dispensou é carimbado pelo servidor (payload forjado ignorado)');

    -- Outra empresa vê o próprio estado, nunca o desta
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_b'), 'vendedor.b@teste.com', v_tenant);
    v_b := public.status_primeiro_acesso();
    perform public.login_admin();
    perform public.assert(not coalesce((v_b ->> 'dispensado')::boolean, false),
        'O3: header forjado não lê o checklist de outra empresa');

    perform public.login_anon();
    begin
        perform public.status_primeiro_acesso();
    exception when insufficient_privilege then
        v_anon_bloqueado := true;
    end;
    perform public.login_admin();
    perform public.assert(v_anon_bloqueado, 'O3: chave pública (anon) não executa status_primeiro_acesso');
end $$;

-- ---------------------------------------------------------------------
-- O4 — meu perfil: só nome e telefone da PRÓPRIA linha
-- ---------------------------------------------------------------------
do $$
declare
    v_ana uuid := (select valor from crm_teste.ctx where chave = 'ana');
    v_bruno uuid := (select valor from crm_teste.ctx where chave = 'bruno');
    v_user_a uuid := (select valor from crm_teste.ctx where chave = 'user_a');
    v_ret jsonb;
    v_ret_tel jsonb;
    v_ret_nome jsonb;
    v_antes record;
    v_depois record;
    v_bruno_antes record;
    v_bruno_depois record;
    v_bloq_colega boolean := false;
    v_bloq_direto boolean := false;
    v_bloq_cargo boolean := false;
    v_bloq_cargo_flag boolean := false;
    v_bloq_colega_flag boolean := false;
    v_bloq_ativo_flag boolean := false;
    v_anon_bloqueado boolean := false;
    v_gerente integer;
    v_papel text;
begin
    select nome, telefone, cargo, ativo, tenant_id, email into v_antes from public.funcionarios where id = v_ana;
    select nome, telefone, cargo into v_bruno_antes from public.funcionarios where id = v_bruno;

    perform public.login_como(v_ana, 'ana.vendas@teste.com');
    v_ret := public.atualizar_meu_perfil('Ana Souza', '(11) 98888-7777');
    v_ret_tel := public.atualizar_meu_perfil('Ana Souza', '11 9999<script>');
    v_ret_nome := public.atualizar_meu_perfil(' A ', null);

    -- Ataques diretos pela API (fora da RPC)
    begin
        update public.funcionarios set nome = 'Bruno Invadido' where id = v_bruno;
    exception when insufficient_privilege then
        v_bloq_colega := true;
    end;
    begin
        update public.funcionarios set telefone = '1199999999' where id = v_ana;
    exception when insufficient_privilege then
        v_bloq_direto := true;
    end;
    begin
        update public.funcionarios set cargo = 'Gerente' where id = v_ana;
    exception when insufficient_privilege then
        v_bloq_cargo := true;
    end;
    -- Mesmo que alguém ligasse o sinal da RPC (não dá pela API), a exceção
    -- do trigger só aceita nome/telefone da própria linha.
    perform set_config('crm.meu_perfil', 'on', false);
    begin
        update public.funcionarios set cargo = 'Gerente' where id = v_ana;
    exception when insufficient_privilege then
        v_bloq_cargo_flag := true;
    end;
    begin
        update public.funcionarios set ativo = false, nome = 'Ana' where id = v_ana;
    exception when insufficient_privilege then
        v_bloq_ativo_flag := true;
    end;
    begin
        update public.funcionarios set nome = 'Bruno Invadido' where id = v_bruno;
    exception when insufficient_privilege then
        v_bloq_colega_flag := true;
    end;
    perform set_config('crm.meu_perfil', 'off', false);
    perform public.login_admin();

    select nome, telefone, cargo, ativo, tenant_id, email into v_depois from public.funcionarios where id = v_ana;
    select nome, telefone, cargo into v_bruno_depois from public.funcionarios where id = v_bruno;
    select role into v_papel from public.utilizadores_empresas where auth_uid = v_ana;

    perform public.assert((v_ret ->> 'success')::boolean, 'O4: vendedor atualiza o próprio nome e telefone pela RPC');
    perform public.assert(v_depois.nome = 'Ana Souza' and v_depois.telefone = '(11) 98888-7777',
        'O4: nome e telefone gravados na própria linha');
    perform public.assert(v_depois.cargo is not distinct from v_antes.cargo and v_depois.ativo is not distinct from v_antes.ativo
                          and v_depois.tenant_id = v_antes.tenant_id and v_depois.email = v_antes.email and v_papel = 'vendedor',
        'O4: cargo, ativo, tenant, e-mail e papel continuam iguais');
    perform public.assert(not (v_ret_tel ->> 'success')::boolean and not (v_ret_nome ->> 'success')::boolean,
        'O4: telefone com caractere inválido e nome curto demais são recusados');
    perform public.assert(v_bloq_colega and v_bruno_depois.nome = v_bruno_antes.nome,
        'O4: vendedor NÃO altera o cadastro do colega');
    perform public.assert(v_bloq_direto, 'O4: update direto em funcionarios (fora da RPC) segue bloqueado para o vendedor');
    perform public.assert(v_bloq_cargo, 'O4: vendedor NÃO altera o próprio cargo');
    perform public.assert(v_bloq_cargo_flag and v_bloq_ativo_flag and v_bloq_colega_flag,
        'O4: nem com o sinal interno ligado: cargo, ativo e colega continuam bloqueados');

    -- Gerente segue editando a equipe normalmente
    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    update public.funcionarios set cargo = 'Vendedora sênior' where id = v_ana;
    get diagnostics v_gerente = row_count;
    perform public.login_admin();
    perform public.assert(v_gerente = 1, 'O4: gerente continua editando o cadastro da equipe');

    perform public.login_anon();
    begin
        perform public.atualizar_meu_perfil('Anônimo', null);
    exception when insufficient_privilege then
        v_anon_bloqueado := true;
    end;
    perform public.login_admin();
    perform public.assert(v_anon_bloqueado, 'O4: chave pública (anon) não executa atualizar_meu_perfil');
end $$;

select public.assert(
    not exists (select 1 from public.relatorio_rls() where gravidade = 'CRITICA'),
    'O5: relatorio_rls() sem nenhuma linha CRÍTICA depois da migration 16'
);
