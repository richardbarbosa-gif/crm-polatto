-- =====================================================================
-- TESTE DA MIGRATION 11 — religar referências legadas após a virada
--
-- Executar DEPOIS de 02_teste_virada_view.sql (precisa de clientes como
-- view). Cria um negócio migrado (legado_cliente_id) com tarefa, atividade
-- e documento apontando para o id antigo e prova que:
--   1. a função troca o id antigo pelo UUID do negócio;
--   2. não toca registros de OUTRO tenant com o mesmo id antigo;
--   3. é idempotente;
--   4. não fica exposta aos papéis da API.
-- =====================================================================

\set ON_ERROR_STOP on

do $$
declare
    v_tenant uuid;
    v_outro uuid;
    v_negocio uuid;
    v_qtd bigint;
begin
    insert into public.empresas (nome) values ('Tenant religar A') returning id into v_tenant;
    insert into public.empresas (nome) values ('Tenant religar B') returning id into v_outro;

    insert into public.negocios (tenant_id, titulo, legado_cliente_id)
    values (v_tenant, 'Negócio migrado', '990001')
    returning id into v_negocio;

    insert into public.tarefas (tenant_id, titulo, cliente_id) values (v_tenant, 'Visita', '990001');
    insert into public.tarefas (tenant_id, titulo, cliente_id) values (v_outro, 'De outro tenant', '990001');
    insert into public.atividades_lead (tenant_id, cliente_id, tipo, titulo) values (v_tenant, '990001', 'nota', 'Ligou');
    insert into public.documentos_lead (tenant_id, cliente_id, tipo, nome_arquivo) values (v_tenant, '990001', 'proposta', 'p.pdf');

    perform public.religar_referencias_legadas();

    perform public.assert(
        (select cliente_id from public.tarefas where titulo = 'Visita' and tenant_id = v_tenant) = v_negocio::text,
        'RELIGAR: tarefa do negócio migrado passa a apontar para o UUID'
    );
    perform public.assert(
        (select cliente_id from public.atividades_lead where titulo = 'Ligou' and tenant_id = v_tenant) = v_negocio::text,
        'RELIGAR: atividade da timeline passa a apontar para o UUID'
    );
    perform public.assert(
        (select cliente_id from public.documentos_lead where nome_arquivo = 'p.pdf' and tenant_id = v_tenant) = v_negocio::text,
        'RELIGAR: documento passa a apontar para o UUID'
    );
    perform public.assert(
        (select cliente_id from public.tarefas where titulo = 'De outro tenant') = '990001',
        'RELIGAR: registro de outro tenant com o mesmo id antigo não é tocado'
    );

    select coalesce(sum(linhas_religadas), 0) into v_qtd from public.religar_referencias_legadas();
    perform public.assert(v_qtd = 0, 'RELIGAR: segunda execução não religa nada (idempotente)');

    perform public.assert(
        not has_function_privilege('authenticated', 'public.religar_referencias_legadas()', 'execute'),
        'RELIGAR: função não é executável pelo papel authenticated da API'
    );
end $$;

do $$
begin
    raise notice 'MIGRATION 11 (religar referências legadas) VALIDADA';
end $$;
