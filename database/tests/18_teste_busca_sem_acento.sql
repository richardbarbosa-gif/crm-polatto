-- =====================================================================
-- Suíte 18 — migration 23: busca que ignora acentos.
-- As consultas abaixo são o SQL que o PostgREST gera para o filtro
-- ?busca_sem_acento=ilike.*termo* (coluna calculada).
-- =====================================================================
\set ON_ERROR_STOP on

do $$
declare
    v_user_a uuid := (select valor from crm_teste.ctx where chave = 'user_a');
    v_user_b uuid := (select valor from crm_teste.ctx where chave = 'user_b');
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_lead uuid;
    v_lead2 uuid;
    v_orc uuid;
    v_termo text;
    v_n integer;
    v_perdidos integer := 0;
    v_ganhos_novos integer := 0;
    v_cli_joao integer;
    v_cli_conceicao integer;
    v_cli_acentuado integer;
    v_cli_telefone integer;
    v_saude integer;
    v_pessoa integer;
    v_pessoa_email integer;
    v_org integer;
    v_orc_busca integer;
    v_b integer;
begin
    perform public.assert(
        public.sem_acento('João Conceição ÁVILA, Ñandú ÿ') = 'Joao Conceicao AVILA, Nandu y'
        and public.sem_acento(null) is null and public.sem_acento('') = '',
        'BA1: sem_acento troca só a letra acentuada (maiúscula continua maiúscula; nulo continua nulo)');

    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    insert into public.clientes (nome, telefone, email, status)
    values ('João da Conceição', '(11) 97531-8642', 'joao.conceicao.ba18@teste.com', 'Novo Lead')
    returning id into v_lead;
    insert into public.clientes (nome, telefone, status)
    values ('Jose Sem Acento Gravado', '(21) 3975-1864', 'Novo Lead')
    returning id into v_lead2;
    insert into public.organizacoes (razao_social, nome_fantasia, setor)
    values ('Padaria São José Ltda', 'Pão Quente', 'Alimentação');
    v_orc := public.salvar_orcamento(
        jsonb_build_object('negocio_id', v_lead, 'titulo', 'Instalação elétrica'),
        jsonb_build_array(jsonb_build_object('descricao', 'Item', 'quantidade', 1, 'valor_unitario', 100)));

    select count(*) into v_cli_joao from public.clientes c
    where c.id = v_lead and public.busca_sem_acento(c) ilike '%' || public.sem_acento('joao') || '%';
    select count(*) into v_cli_conceicao from public.clientes c
    where c.id = v_lead and public.busca_sem_acento(c) ilike '%' || public.sem_acento('CONCEICAO') || '%';
    -- termo com acento acha nome gravado sem acento
    select count(*) into v_cli_acentuado from public.clientes c
    where c.id = v_lead2 and public.busca_sem_acento(c) ilike '%' || public.sem_acento('José') || '%';
    select count(*) into v_cli_telefone from public.clientes c
    where c.id = v_lead and public.busca_sem_acento(c) ilike '%' || public.sem_acento('97531-86') || '%';
    select count(*) into v_saude from public.vw_negocios_saude s
    where s.id = v_lead and public.busca_sem_acento(s) ilike '%' || public.sem_acento('joao da conceicao') || '%';
    select count(*) into v_pessoa from public.pessoas p
    where p.nome = 'João da Conceição' and public.busca_sem_acento(p) ilike '%' || public.sem_acento('joao') || '%';
    select count(*) into v_pessoa_email from public.pessoas p
    where p.nome = 'João da Conceição' and public.busca_sem_acento(p) ilike '%' || public.sem_acento('conceicao.ba18@teste') || '%';
    select count(*) into v_org from public.organizacoes o
    where o.razao_social = 'Padaria São José Ltda'
      and public.busca_sem_acento(o) ilike '%' || public.sem_acento('sao jose') || '%'
      and public.busca_sem_acento(o) ilike '%' || public.sem_acento('pao quente') || '%'
      and public.busca_sem_acento(o) ilike '%' || public.sem_acento('alimentacao') || '%';
    select count(*) into v_orc_busca from public.vw_orcamentos_lista l
    where l.id = v_orc
      and public.busca_sem_acento(l) ilike '%' || public.sem_acento('instalacao') || '%'
      and public.busca_sem_acento(l) ilike '%' || public.sem_acento('joao da') || '%';

    -- Sem regressão: em cada fonte, todo registro que o filtro antigo (OR de
    -- ILIKE nas colunas) encontrava continua sendo encontrado pelo novo.
    foreach v_termo in array array['jo', 'João', 'ão', 'CONCEI', 'silva', '11', '97531', '-', 'a', 'Ltda', 'teste.com', 'Pão', '2026-']
    loop
        select count(*) into v_n from public.clientes c
        where (c.nome ilike '%' || v_termo || '%' or c.telefone ilike '%' || v_termo || '%')
          and not coalesce(public.busca_sem_acento(c) ilike '%' || public.sem_acento(v_termo) || '%', false);
        v_perdidos := v_perdidos + v_n;
        select count(*) into v_n from public.vw_negocios_saude c
        where (c.nome ilike '%' || v_termo || '%' or c.telefone ilike '%' || v_termo || '%')
          and not coalesce(public.busca_sem_acento(c) ilike '%' || public.sem_acento(v_termo) || '%', false);
        v_perdidos := v_perdidos + v_n;
        select count(*) into v_n from public.pessoas p
        where (p.nome ilike '%' || v_termo || '%' or p.email ilike '%' || v_termo || '%'
               or p.telefone ilike '%' || v_termo || '%' or p.cargo ilike '%' || v_termo || '%')
          and not coalesce(public.busca_sem_acento(p) ilike '%' || public.sem_acento(v_termo) || '%', false);
        v_perdidos := v_perdidos + v_n;
        select count(*) into v_n from public.organizacoes o
        where (o.nome_fantasia ilike '%' || v_termo || '%' or o.razao_social ilike '%' || v_termo || '%'
               or o.cnpj ilike '%' || v_termo || '%' or o.setor ilike '%' || v_termo || '%')
          and not coalesce(public.busca_sem_acento(o) ilike '%' || public.sem_acento(v_termo) || '%', false);
        v_perdidos := v_perdidos + v_n;
        select count(*) into v_n from public.vw_orcamentos_lista l
        where (l.numero ilike '%' || v_termo || '%' or l.titulo ilike '%' || v_termo || '%'
               or l.cliente_nome ilike '%' || v_termo || '%')
          and not coalesce(public.busca_sem_acento(l) ilike '%' || public.sem_acento(v_termo) || '%', false);
        v_perdidos := v_perdidos + v_n;
    end loop;
    select count(*) into v_ganhos_novos from public.clientes c
    where c.id = v_lead and not (c.nome ilike '%joao%') and public.busca_sem_acento(c) ilike '%joao%';
    perform public.login_admin();

    perform public.assert(v_cli_joao = 1 and v_cli_conceicao = 1,
        'BA2: "joao" e "CONCEICAO" acham "João da Conceição" (view clientes: busca global, agenda, lista)');
    perform public.assert(v_cli_acentuado = 1, 'BA3: termo com acento ("José") acha nome gravado sem acento');
    perform public.assert(v_cli_telefone = 1, 'BA4: telefone continua sendo encontrado pela mesma busca');
    perform public.assert(v_saude = 1, 'BA5: colunas do Kanban (vw_negocios_saude) acham sem acento');
    perform public.assert(v_pessoa = 1 and v_pessoa_email = 1, 'BA6: Pessoas: nome sem acento e e-mail');
    perform public.assert(v_org = 1, 'BA7: Organizações: razão social, nome fantasia e setor sem acento');
    perform public.assert(v_orc_busca = 1, 'BA8: Orçamentos: título e nome do cliente sem acento');
    perform public.assert(v_perdidos = 0,
        'BA9: sem regressão — nenhum registro achado pelo filtro antigo deixa de ser achado (5 fontes, 13 termos)');
    perform public.assert(v_ganhos_novos = 1, 'BA10: e o que só diferia no acento passa a ser achado');

    -- Outra empresa não enxerga nada disso, nem forjando o header
    perform public.login_como(v_user_b, 'vendedor.b@teste.com', v_tenant_a);
    select (select count(*) from public.clientes c where public.busca_sem_acento(c) ilike '%joao da conceicao%')
         + (select count(*) from public.vw_negocios_saude s where public.busca_sem_acento(s) ilike '%joao da conceicao%')
         + (select count(*) from public.pessoas p where public.busca_sem_acento(p) ilike '%joao da conceicao%')
         + (select count(*) from public.organizacoes o where public.busca_sem_acento(o) ilike '%sao jose ltda%')
         + (select count(*) from public.vw_orcamentos_lista l where public.busca_sem_acento(l) ilike '%instalacao eletrica%')
      into v_b;
    perform public.login_admin();
    perform public.assert(v_b = 0, 'BA11: tenant B não acha registros do A pela busca sem acento');

    perform public.assert(
        (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'busca_sem_acento') = 5,
        'BA12: coluna calculada nas 5 fontes (clientes, vw_negocios_saude, pessoas, organizacoes, vw_orcamentos_lista)');
    perform public.assert(
        not exists (
            select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('sem_acento', 'busca_sem_acento')
              and (has_function_privilege('anon', p.oid, 'execute')
                   or not has_function_privilege('authenticated', p.oid, 'execute')
                   or p.prosecdef)
        )
        and not exists (select 1 from public.relatorio_privilegios() where objeto like '%sem_acento%'),
        'BA13: SECURITY INVOKER, fechada para a chave pública, aberta ao usuário logado; linter sem achados');
end $$;
