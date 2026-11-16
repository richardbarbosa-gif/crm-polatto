-- =====================================================================
-- Suíte 17 — migration 22: lista e resumo de orçamentos no banco.
-- =====================================================================
\set ON_ERROR_STOP on

do $$
declare
    v_user_a uuid := (select valor from crm_teste.ctx where chave = 'user_a');
    v_user_b uuid := (select valor from crm_teste.ctx where chave = 'user_b');
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_lead uuid;
    v_o1 uuid;
    v_o2 uuid;
    v_o3 uuid;
    v_rev uuid;
    v_antes record;
    v_depois record;
    v_lista integer;
    v_busca integer;
    v_b_lista integer;
    v_b_resumo integer;
begin
    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    select abertos, valor_aberto, aceitos, valor_aceito, decididos into v_antes from public.vw_orcamentos_resumo;
    v_antes.abertos := coalesce(v_antes.abertos, 0);
    v_antes.valor_aberto := coalesce(v_antes.valor_aberto, 0);
    v_antes.aceitos := coalesce(v_antes.aceitos, 0);
    v_antes.valor_aceito := coalesce(v_antes.valor_aceito, 0);
    v_antes.decididos := coalesce(v_antes.decididos, 0);

    insert into public.clientes (nome, status) values ('Cliente Dezessete Ltda', 'Novo Lead') returning id into v_lead;

    -- o1: enviado e depois revisado (a revisão é que conta como aberta)
    v_o1 := public.salvar_orcamento(
        jsonb_build_object('negocio_id', v_lead, 'titulo', 'Proposta 17-A', 'responsavel_nome', 'Resp Dezessete'),
        jsonb_build_array(jsonb_build_object('descricao', 'Item', 'quantidade', 1, 'valor_unitario', 1000)));
    update public.orcamentos set status = 'enviado' where id = v_o1;
    v_rev := public.nova_versao_orcamento(v_o1);

    -- o2: aceito
    v_o2 := public.salvar_orcamento(
        jsonb_build_object('negocio_id', v_lead, 'titulo', 'Proposta 17-B', 'responsavel_nome', 'Resp Dezessete'),
        jsonb_build_array(jsonb_build_object('descricao', 'Item', 'quantidade', 2, 'valor_unitario', 500)));
    update public.orcamentos set status = 'enviado' where id = v_o2;
    update public.orcamentos set status = 'aceito' where id = v_o2;

    -- o3: recusado, sem responsável
    v_o3 := public.salvar_orcamento(
        jsonb_build_object('negocio_id', v_lead, 'titulo', 'Proposta 17-C'),
        jsonb_build_array(jsonb_build_object('descricao', 'Item', 'quantidade', 1, 'valor_unitario', 300)));
    update public.orcamentos set status = 'enviado' where id = v_o3;
    update public.orcamentos set status = 'recusado' where id = v_o3;

    select abertos, valor_aberto, aceitos, valor_aceito, decididos, responsaveis, tem_sem_responsavel
      into v_depois from public.vw_orcamentos_resumo;
    select count(*) into v_lista from public.vw_orcamentos_lista where id in (v_o1, v_o2, v_o3, v_rev);
    select count(*) into v_busca from public.vw_orcamentos_lista where cliente_nome ilike '%dezessete ltda%';
    perform public.login_admin();

    perform public.assert(
        v_depois.abertos = v_antes.abertos + 1 and v_depois.valor_aberto = v_antes.valor_aberto + 1000,
        'OL1: proposta com revisão em andamento conta uma vez só nas abertas (pela revisão)');
    perform public.assert(
        v_depois.aceitos = v_antes.aceitos + 1 and v_depois.valor_aceito = v_antes.valor_aceito + 1000
        and v_depois.decididos = v_antes.decididos + 2,
        'OL2: aceitos e decididos (aceito + recusado) somados no banco');
    perform public.assert('Resp Dezessete' = any(v_depois.responsaveis) and v_depois.tem_sem_responsavel,
        'OL3: resumo traz os responsáveis para o filtro e sinaliza orçamento sem responsável');
    perform public.assert(v_lista = 4 and v_busca = 4,
        'OL4: a lista traz o nome do cliente do negócio e permite buscar por ele no banco');

    -- excluído (lixeira) sai da lista e do resumo
    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    update public.orcamentos set deleted_at = now() where id = v_o3;
    select count(*) into v_lista from public.vw_orcamentos_lista where id = v_o3;
    select decididos into v_depois.decididos from public.vw_orcamentos_resumo;
    perform public.login_admin();
    perform public.assert(v_lista = 0 and v_depois.decididos = v_antes.decididos + 1,
        'OL5: orçamento na lixeira sai da lista e do resumo');

    -- outra empresa não enxerga nada disso, nem forjando o header
    perform public.login_como(v_user_b, 'vendedor.b@teste.com', v_tenant_a);
    select count(*) into v_b_lista from public.vw_orcamentos_lista where id in (v_o1, v_o2, v_rev);
    select count(*) into v_b_resumo from public.vw_orcamentos_resumo where tenant_id = v_tenant_a;
    perform public.login_admin();
    perform public.assert(v_b_lista = 0 and v_b_resumo = 0, 'OL6: tenant B não lê a lista nem o resumo do A');

    perform public.assert(
        not has_table_privilege('anon', 'public.vw_orcamentos_lista', 'select')
        and not has_table_privilege('anon', 'public.vw_orcamentos_resumo', 'select')
        and not exists (select 1 from public.relatorio_privilegios() where objeto like '%vw_orcamentos_%'),
        'OL7: views fechadas para a chave pública; o linter de privilégios não acusa nada nelas');
end $$;
