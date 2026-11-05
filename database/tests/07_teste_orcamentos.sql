-- =====================================================================
-- SUÍTE 7 — ORÇAMENTOS / PROPOSTAS (migration 13)
--
-- Para cada regra: o ATAQUE falha e o USO LEGÍTIMO funciona.
--   O1  identidade da empresa: gerente edita, vendedor só lê, validações
--   O2  catálogo de produtos: gerente edita, vendedor só lê
--   O3  orçamento: criar, editar, ler; totais recalculados no banco
--   O4  isolamento entre tenants (inclusive header forjado e FK cruzada)
--   O5  numeração: sem buraco, sem duplicata, independente por tenant
--   O6  exclusão: criador ou gerente; DELETE físico só gerente
--   O7  storage do logo isolado por tenant, escrita só gerente, sem SVG
--   O8  anon sem acesso; funções internas sem EXECUTE para a API
--
-- Rodar depois de 01..06 (usa assert/login_como/login_admin da suíte 1).
-- Deixa em crm_teste.ctx os ids usados pelo teste de concorrência do
-- runner (Suíte 7b).
-- =====================================================================

\set ON_ERROR_STOP on

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

-- Helpers da suíte (fora de public). Rodam com o papel de quem chama.
grant usage on schema crm_teste to authenticated, anon;

-- Executa o SQL e devolve 'OK' ou o SQLSTATE do erro.
create or replace function crm_teste.sqlstate_de(p_sql text)
returns text
language plpgsql
as $$
begin
    execute p_sql;
    return 'OK';
exception when others then
    return sqlstate;
end;
$$;

-- Executa o SQL e devolve quantas linhas foram afetadas.
create or replace function crm_teste.linhas(p_sql text)
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

grant execute on function crm_teste.sqlstate_de(text), crm_teste.linhas(text) to authenticated, anon;

-- ---------------------------------------------------------------------
-- CENÁRIO
--   Empresa A: gerente, vendedor 1, vendedor 2
--   Empresa B: admin, vendedor
--   Empresas C/D: usadas só no teste de concorrência (Suíte 7b)
-- ---------------------------------------------------------------------
do $$
declare
    v_ta uuid;
    v_tb uuid;
    v_tc uuid;
    v_td uuid;
    v_ger uuid := gen_random_uuid();
    v_v1 uuid := gen_random_uuid();
    v_v2 uuid := gen_random_uuid();
    v_adm_b uuid := gen_random_uuid();
    v_vb uuid := gen_random_uuid();
    v_neg_a uuid;
    v_neg_b uuid;
    v_neg_c uuid;
    v_neg_d uuid;
begin
    -- e-mail com o id: a suíte pode ser reexecutada no mesmo banco
    -- (auth.users.email é unique) sem recriar tudo.
    insert into auth.users (id, email) values
        (v_ger, v_ger || '@gerente.orc'), (v_v1, v_v1 || '@vendedor1.orc'), (v_v2, v_v2 || '@vendedor2.orc'),
        (v_adm_b, v_adm_b || '@admin-b.orc'), (v_vb, v_vb || '@vendedor-b.orc');

    insert into public.empresas (nome) values ('Orçamentos A') returning id into v_ta;
    insert into public.empresas (nome) values ('Orçamentos B') returning id into v_tb;
    insert into public.empresas (nome) values ('Concorrência C') returning id into v_tc;
    insert into public.empresas (nome) values ('Concorrência D') returning id into v_td;

    insert into public.utilizadores_empresas (auth_uid, empresa_id, role) values
        (v_ger, v_ta, 'gerente'), (v_v1, v_ta, 'vendedor'), (v_v2, v_ta, 'vendedor'),
        (v_adm_b, v_tb, 'admin'), (v_vb, v_tb, 'vendedor');

    insert into public.negocios (tenant_id, titulo, valor) values (v_ta, 'Usina solar Conceição', 1000) returning id into v_neg_a;
    insert into public.negocios (tenant_id, titulo) values (v_tb, 'Negócio da B') returning id into v_neg_b;
    insert into public.negocios (tenant_id, titulo) values (v_tc, 'Concorrência C') returning id into v_neg_c;
    insert into public.negocios (tenant_id, titulo) values (v_td, 'Concorrência D') returning id into v_neg_d;

    delete from crm_teste.ctx where chave like 'orc_%';
    insert into crm_teste.ctx values
        ('orc_ta', v_ta), ('orc_tb', v_tb), ('orc_tc', v_tc), ('orc_td', v_td),
        ('orc_ger', v_ger), ('orc_v1', v_v1), ('orc_v2', v_v2), ('orc_adm_b', v_adm_b), ('orc_vb', v_vb),
        ('orc_neg_a', v_neg_a), ('orc_neg_b', v_neg_b), ('orc_neg_c', v_neg_c), ('orc_neg_d', v_neg_d);
end $$;

-- O papel "gerente" passa a ser reconhecido pela migration 12. Sem ela,
-- a suíte usa "admin" para o mesmo usuário (a regra testada é a mesma:
-- eh_admin_do_tenant()).
do $$
declare
    v_ger uuid := (select valor from crm_teste.ctx where chave = 'orc_ger');
    v_reconhece boolean;
begin
    perform public.login_como(v_ger, 'gerente.orc@a.com');
    v_reconhece := public.eh_admin_do_tenant();
    perform public.login_admin();
    if v_reconhece then
        raise notice 'PASS  eh_admin_do_tenant() reconhece o papel gerente';
    else
        update public.utilizadores_empresas set role = 'admin' where auth_uid = v_ger;
        raise notice 'AVISO papel "gerente" ainda não reconhecido por eh_admin_do_tenant() (migration 12 ausente): a suíte usa "admin" para o gerente';
    end if;
end $$;

-- ---------------------------------------------------------------------
-- O0: validação de CNPJ no banco (numérico e alfanumérico)
-- ---------------------------------------------------------------------
do $$
begin
    perform public.assert(public.identidade_cnpj_valido('11.222.333/0001-81'), 'O0: CNPJ numérico válido aceito (com pontuação)');
    perform public.assert(not public.identidade_cnpj_valido('11.222.333/0001-80'), 'O0: CNPJ com dígito verificador errado recusado');
    perform public.assert(not public.identidade_cnpj_valido('11111111111111'), 'O0: CNPJ de dígitos repetidos recusado');
    perform public.assert(not public.identidade_cnpj_valido('123'), 'O0: CNPJ curto recusado');
    perform public.assert(public.identidade_cnpj_valido('12.ABC.345/01DE-35'), 'O0: CNPJ alfanumérico (exemplo oficial da Receita) aceito');
end $$;

-- ---------------------------------------------------------------------
-- O1: identidade da empresa
-- ---------------------------------------------------------------------
do $$
declare
    v_ta uuid := (select valor from crm_teste.ctx where chave = 'orc_ta');
    v_tb uuid := (select valor from crm_teste.ctx where chave = 'orc_tb');
    v_ger uuid := (select valor from crm_teste.ctx where chave = 'orc_ger');
    v_v1 uuid := (select valor from crm_teste.ctx where chave = 'orc_v1');
    v_adm_b uuid := (select valor from crm_teste.ctx where chave = 'orc_adm_b');
    v_estado text;
    v_tenant uuid;
    v_n bigint;
begin
    -- ataque: vendedor cria a identidade da empresa
    perform public.login_como(v_v1, 'vendedor1.orc@a.com');
    v_estado := crm_teste.sqlstate_de(
        $q$insert into public.empresa_identidade (nome_fantasia) values ('Vendedor mudou')$q$);
    perform public.login_admin();
    perform public.assert(v_estado = '42501', 'O1: vendedor NÃO cria a identidade da empresa (RLS 42501)');

    -- uso legítimo: gerente cria; tenant forjado no payload é ignorado
    perform public.login_como(v_ger, 'gerente.orc@a.com');
    insert into public.empresa_identidade (
        tenant_id, nome_fantasia, razao_social, cnpj, endereco, telefone, email, site,
        cor_primaria, cor_secundaria, condicoes_pagamento, validade_dias, observacoes_padrao, rodape
    ) values (
        v_tb, 'Polatto Energia Solar', 'Polatto Soluções em Energia Ltda', '11222333000181',
        'Av. São João, 1000 — Centro, Ribeirão Preto/SP', '(16) 99999-0000', 'contato@polatto.com.br',
        'https://polatto.com.br', '#0F4C81', '#F2A900', 'Entrada de 30% e saldo em até 6x no cartão.',
        10, 'Instalação e homologação inclusas.', 'Polatto — energia que valoriza o seu imóvel.'
    ) returning tenant_id into v_tenant;
    perform public.login_admin();
    perform public.assert(v_tenant = v_ta, 'O1: gerente cria a identidade e o tenant_id vem do servidor (payload forjado ignorado)');

    perform public.login_como(v_ger, 'gerente.orc@a.com');
    perform public.assert(crm_teste.sqlstate_de($q$update public.empresa_identidade set cor_primaria = 'red'$q$) = '23514',
        'O1: cor fora do formato #RRGGBB recusada pelo banco');
    perform public.assert(crm_teste.sqlstate_de($q$update public.empresa_identidade set cor_secundaria = '#12345G'$q$) = '23514',
        'O1: cor secundária inválida recusada pelo banco');
    perform public.assert(crm_teste.sqlstate_de($q$update public.empresa_identidade set cnpj = '11222333000180'$q$) = '23514',
        'O1: CNPJ inválido recusado pelo banco');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$update public.empresa_identidade set logo_path = %L$q$, v_tb::text || '/logo.png')) = '23514',
        'O1: logo apontando para a pasta de OUTRO tenant recusado');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$update public.empresa_identidade set logo_path = %L$q$, v_ta::text || '/logo.svg')) = '23514',
        'O1: logo SVG recusado (só PNG/JPEG/WEBP)');
    perform public.assert(crm_teste.sqlstate_de($q$update public.empresa_identidade set site = 'javascript:alert(1)'$q$) = '23514',
        'O1: site com esquema javascript: recusado');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$update public.empresa_identidade set logo_path = %L$q$, v_ta::text || '/logo-1.png')) = 'OK',
        'O1: gerente grava logo PNG na pasta do próprio tenant');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$update public.empresa_identidade set tenant_id = %L$q$, v_tb)) = '42501',
        'O1: tenant_id da identidade não pode ser trocado');
    perform public.login_admin();

    -- vendedor lê, mas não altera nem apaga
    perform public.login_como(v_v1, 'vendedor1.orc@a.com');
    select count(*) into v_n from public.empresa_identidade;
    perform public.assert(v_n = 1, 'O1: vendedor LÊ a identidade da própria empresa (para gerar o PDF)');
    v_n := crm_teste.linhas($q$update public.empresa_identidade set nome_fantasia = 'Hackeado'$q$);
    perform public.assert(v_n = 0, 'O1: vendedor NÃO altera a identidade (0 linhas)');
    v_n := crm_teste.linhas($q$delete from public.empresa_identidade$q$);
    perform public.assert(v_n = 0, 'O1: vendedor NÃO apaga a identidade (0 linhas)');
    perform public.login_admin();

    perform public.assert(
        (select nome_fantasia from public.empresa_identidade where tenant_id = v_ta) = 'Polatto Energia Solar',
        'O1: identidade intacta depois das tentativas do vendedor');

    -- outro tenant não enxerga, nem forjando o header
    perform public.login_como(v_adm_b, 'admin.orc@b.com', v_ta);
    select count(*) into v_n from public.empresa_identidade where tenant_id = v_ta;
    v_estado := crm_teste.linhas(format($q$update public.empresa_identidade set rodape = 'x' where tenant_id = %L$q$, v_ta))::text;
    perform public.login_admin();
    perform public.assert(v_n = 0 and v_estado = '0', 'O1: admin de OUTRO tenant não lê nem altera a identidade (header x-tenant-id forjado)');
end $$;

-- ---------------------------------------------------------------------
-- O2: catálogo de produtos
-- ---------------------------------------------------------------------
do $$
declare
    v_ta uuid := (select valor from crm_teste.ctx where chave = 'orc_ta');
    v_ger uuid := (select valor from crm_teste.ctx where chave = 'orc_ger');
    v_v1 uuid := (select valor from crm_teste.ctx where chave = 'orc_v1');
    v_adm_b uuid := (select valor from crm_teste.ctx where chave = 'orc_adm_b');
    v_prod_a uuid;
    v_prod_b uuid;
    v_n bigint;
begin
    perform public.login_como(v_v1, 'vendedor1.orc@a.com');
    perform public.assert(
        crm_teste.sqlstate_de($q$insert into public.produtos (nome, preco_padrao) values ('Painel pirata', 1)$q$) = '42501',
        'O2: vendedor NÃO cadastra produto');
    perform public.login_admin();

    perform public.login_como(v_ger, 'gerente.orc@a.com');
    insert into public.produtos (nome, descricao, unidade, preco_padrao)
    values ('Módulo fotovoltaico 550 W', 'Monocristalino, garantia de 12 anos', 'un', 1234.56)
    returning id into v_prod_a;
    insert into public.produtos (nome, unidade, preco_padrao) values ('Inversor 8 kW', 'un', 6890.00);
    perform public.assert(crm_teste.sqlstate_de($q$insert into public.produtos (nome, preco_padrao) values ('Negativo', -1)$q$) = '23514',
        'O2: preço negativo recusado pelo banco');
    perform public.login_admin();
    perform public.assert(v_prod_a is not null, 'O2: gerente cadastra produto');

    perform public.login_como(v_v1, 'vendedor1.orc@a.com');
    select count(*) into v_n from public.produtos;
    perform public.assert(v_n = 2, 'O2: vendedor LÊ o catálogo do tenant');
    perform public.assert(crm_teste.linhas($q$update public.produtos set preco_padrao = 0.01$q$) = 0,
        'O2: vendedor NÃO altera preço do catálogo (0 linhas)');
    perform public.assert(crm_teste.linhas($q$delete from public.produtos$q$) = 0,
        'O2: vendedor NÃO apaga produto (0 linhas)');
    perform public.login_admin();

    perform public.login_como(v_adm_b, 'admin.orc@b.com', v_ta);
    select count(*) into v_n from public.produtos where tenant_id = v_ta;
    insert into public.produtos (nome, preco_padrao) values ('Produto da B', 10) returning id into v_prod_b;
    perform public.login_admin();
    perform public.assert(v_n = 0, 'O2: outro tenant não enxerga o catálogo (header forjado)');

    insert into crm_teste.ctx values ('orc_prod_a', v_prod_a), ('orc_prod_b', v_prod_b);
end $$;

-- ---------------------------------------------------------------------
-- O3: orçamento — criar, editar, ler; totais no banco
-- ---------------------------------------------------------------------
do $$
declare
    v_ta uuid := (select valor from crm_teste.ctx where chave = 'orc_ta');
    v_tb uuid := (select valor from crm_teste.ctx where chave = 'orc_tb');
    v_v1 uuid := (select valor from crm_teste.ctx where chave = 'orc_v1');
    v_v2 uuid := (select valor from crm_teste.ctx where chave = 'orc_v2');
    v_neg_a uuid := (select valor from crm_teste.ctx where chave = 'orc_neg_a');
    v_prod_a uuid := (select valor from crm_teste.ctx where chave = 'orc_prod_a');
    v_ano int := extract(year from (now() at time zone 'America/Sao_Paulo'))::int;
    v_orc record;
    v_item1 uuid;
    v_item2 uuid;
    v_item record;
    v_n bigint;
begin
    perform public.login_como(v_v1, 'vendedor1.orc@a.com');
    -- payload com tudo forjado: tenant, número, criador e totais
    insert into public.orcamentos (tenant_id, negocio_id, titulo, numero, numero_seq, created_by, subtotal, total)
    values (v_tb, v_neg_a, 'Sistema fotovoltaico 8 kWp', '1999-9999', 9999, v_v2, 999999, 999999)
    returning * into v_orc;
    perform public.login_admin();

    perform public.assert(v_orc.tenant_id = v_ta, 'O3: tenant do orçamento vem do servidor');
    perform public.assert(v_orc.numero = v_ano || '-0001', 'O3: primeiro orçamento do tenant recebe ' || v_ano || '-0001 (número forjado ignorado)');
    perform public.assert(v_orc.created_by = v_v1, 'O3: created_by é o usuário logado (forjado ignorado)');
    perform public.assert(v_orc.responsavel_id = v_v1, 'O3: responsável padrão é quem criou');
    perform public.assert(v_orc.total = 0 and v_orc.subtotal = 0, 'O3: totais forjados ignorados (sem itens, total 0)');
    perform public.assert(v_orc.status = 'rascunho', 'O3: nasce como rascunho');
    perform public.assert(v_orc.valido_ate = v_orc.data_emissao + 10, 'O3: validade padrão vem da identidade da empresa (10 dias)');
    perform public.assert(v_orc.condicoes_pagamento = 'Entrada de 30% e saldo em até 6x no cartão.', 'O3: condições padrão vêm da identidade');

    perform public.login_como(v_v1, 'vendedor1.orc@a.com');
    -- item do catálogo (descrição e unidade herdadas do produto) com 10% de desconto
    insert into public.orcamento_itens (orcamento_id, produto_id, quantidade, valor_unitario, desconto_tipo, desconto_valor, ordem, total)
    values (v_orc.id, v_prod_a, 10, 1234.56, 'percentual', 10, 1, 1)
    returning id into v_item1;
    -- item livre com R$ 100 de desconto
    insert into public.orcamento_itens (orcamento_id, descricao, unidade, quantidade, valor_unitario, desconto_tipo, desconto_valor, ordem)
    values (v_orc.id, 'Instalação, projeto e homologação', 'serviço', 1, 2500.00, 'valor', 100, 2)
    returning id into v_item2;
    perform public.login_admin();

    select * into v_item from public.orcamento_itens where id = v_item1;
    perform public.assert(v_item.descricao = 'Módulo fotovoltaico 550 W' and v_item.unidade = 'un',
        'O3: item do catálogo herda descrição e unidade do produto');
    perform public.assert(v_item.total = 11111.04, 'O3: total do item = 10 x 1.234,56 - 10% = 11.111,04 (total forjado ignorado)');
    perform public.assert((select total from public.orcamento_itens where id = v_item2) = 2400.00,
        'O3: item livre = 2.500,00 - 100,00 = 2.400,00');
    select * into v_orc from public.orcamentos where id = v_orc.id;
    perform public.assert(v_orc.subtotal = 13511.04 and v_orc.total = 13511.04,
        'O3: subtotal/total do orçamento recalculados pelo banco (13.511,04)');

    perform public.login_como(v_v1, 'vendedor1.orc@a.com');
    update public.orcamentos set desconto_tipo = 'percentual', desconto_valor = 5, total = 1 where id = v_orc.id;
    perform public.login_admin();
    select * into v_orc from public.orcamentos where id = v_orc.id;
    perform public.assert(v_orc.desconto_total = 675.55 and v_orc.total = 12835.49,
        'O3: desconto de 5% = 675,55 e total 12.835,49 (total enviado pelo cliente ignorado)');

    perform public.login_como(v_v1, 'vendedor1.orc@a.com');
    update public.orcamentos set desconto_tipo = 'valor', desconto_valor = 20000 where id = v_orc.id;
    perform public.login_admin();
    select * into v_orc from public.orcamentos where id = v_orc.id;
    perform public.assert(v_orc.desconto_total = 13511.04 and v_orc.total = 0,
        'O3: desconto maior que o subtotal é limitado (total nunca negativo)');

    perform public.login_como(v_v1, 'vendedor1.orc@a.com');
    update public.orcamentos set desconto_valor = 0 where id = v_orc.id;
    update public.orcamento_itens set quantidade = 2.5 where id = v_item2;
    perform public.login_admin();
    perform public.assert((select total from public.orcamentos where id = v_orc.id) = 17261.04,
        'O3: editar a quantidade de um item recalcula o orçamento (11.111,04 + 2,5 x 2.500,00 - 100,00 = 17.261,04)');

    perform public.login_como(v_v1, 'vendedor1.orc@a.com');
    delete from public.orcamento_itens where id = v_item2;
    perform public.login_admin();
    perform public.assert((select total from public.orcamentos where id = v_orc.id) = 11111.04,
        'O3: remover item recalcula o orçamento');

    perform public.login_como(v_v1, 'vendedor1.orc@a.com');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$insert into public.orcamento_itens (orcamento_id, descricao, quantidade, valor_unitario) values (%L, 'Zero', 0, 10)$q$, v_orc.id)) = '23514',
        'O3: quantidade 0 recusada');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$insert into public.orcamento_itens (orcamento_id, descricao, quantidade, valor_unitario) values (%L, 'Negativo', 1, -1)$q$, v_orc.id)) = '23514',
        'O3: valor unitário negativo recusado');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$insert into public.orcamento_itens (orcamento_id, descricao, quantidade, valor_unitario, desconto_tipo, desconto_valor) values (%L, 'Pct', 1, 10, 'percentual', 101)$q$, v_orc.id)) = '23514',
        'O3: desconto acima de 100% recusado');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$update public.orcamentos set status = 'aprovado' where id = %L$q$, v_orc.id)) = '23514',
        'O3: status fora da lista recusado');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$update public.orcamentos set valido_ate = data_emissao - 1 where id = %L$q$, v_orc.id)) = '23514',
        'O3: validade anterior à emissão recusada');
    perform public.login_admin();

    -- outro vendedor do MESMO tenant lê e edita (o orçamento é do time).
    -- Edita ainda em rascunho: depois de enviado a proposta trava (migration 14).
    perform public.login_como(v_v2, 'vendedor2.orc@a.com');
    select count(*) into v_n from public.orcamento_itens where orcamento_id = v_orc.id;
    perform public.assert(v_n = 1, 'O3: outro vendedor do tenant lê os itens');
    perform public.assert(crm_teste.linhas(format(
        $q$update public.orcamentos set titulo = 'Sistema 8 kWp (revisado)' where id = %L$q$, v_orc.id)) = 1,
        'O3: outro vendedor do tenant edita o orçamento');
    perform public.login_admin();

    perform public.login_como(v_v1, 'vendedor1.orc@a.com');
    update public.orcamentos set status = 'enviado' where id = v_orc.id;
    perform public.login_admin();
    perform public.assert((select enviado_em is not null from public.orcamentos where id = v_orc.id),
        'O3: marcar como enviado registra enviado_em');

    insert into crm_teste.ctx values ('orc_orc1', v_orc.id), ('orc_item1', v_item1);
end $$;

-- ---------------------------------------------------------------------
-- O3b: salvar_orcamento() — cabeçalho e itens numa transação só
-- ---------------------------------------------------------------------
do $$
declare
    v_ta uuid := (select valor from crm_teste.ctx where chave = 'orc_ta');
    v_v1 uuid := (select valor from crm_teste.ctx where chave = 'orc_v1');
    v_vb uuid := (select valor from crm_teste.ctx where chave = 'orc_vb');
    v_neg_a uuid := (select valor from crm_teste.ctx where chave = 'orc_neg_a');
    v_prod_a uuid := (select valor from crm_teste.ctx where chave = 'orc_prod_a');
    v_id uuid;
    v_item_manter uuid;
    v_orc record;
    v_n bigint;
    v_estado text;
begin
    perform public.login_como(v_v1, 'vendedor1.orc@a.com');
    v_id := public.salvar_orcamento(
        jsonb_build_object('negocio_id', v_neg_a, 'titulo', 'Via RPC', 'desconto_tipo', 'valor', 'desconto_valor', 50,
                           'tenant_id', gen_random_uuid(), 'total', 1),
        jsonb_build_array(
            jsonb_build_object('produto_id', v_prod_a, 'descricao', '', 'quantidade', 2, 'valor_unitario', 1000),
            jsonb_build_object('descricao', 'Mão de obra', 'unidade', 'h', 'quantidade', 4, 'valor_unitario', 125.5)
        )
    );
    perform public.login_admin();

    select * into v_orc from public.orcamentos where id = v_id;
    perform public.assert(v_orc.tenant_id = v_ta and v_orc.created_by = v_v1, 'O3b: RPC cria o orçamento no tenant e com o criador do servidor');
    perform public.assert(v_orc.subtotal = 2502.00 and v_orc.total = 2452.00, 'O3b: RPC grava itens e o banco recalcula (2.000 + 502 - 50 = 2.452)');
    select id into v_item_manter from public.orcamento_itens where orcamento_id = v_id and ordem = 1;
    perform public.assert(
        (select descricao from public.orcamento_itens where id = v_item_manter) = 'Módulo fotovoltaico 550 W',
        'O3b: item do catálogo com descrição vazia herda o nome do produto');

    -- edição: mantém o 1º (quantidade nova), remove o 2º, inclui um 3º
    perform public.login_como(v_v1, 'vendedor1.orc@a.com');
    perform public.salvar_orcamento(
        jsonb_build_object('id', v_id, 'titulo', 'Via RPC (rev. 2)', 'desconto_tipo', 'percentual', 'desconto_valor', 10),
        jsonb_build_array(
            jsonb_build_object('descricao', 'Estrutura de fixação', 'quantidade', 1, 'valor_unitario', 800),
            jsonb_build_object('id', v_item_manter, 'produto_id', v_prod_a, 'descricao', 'Módulo fotovoltaico 550 W', 'quantidade', 3, 'valor_unitario', 1000)
        )
    );
    perform public.login_admin();

    select count(*) into v_n from public.orcamento_itens where orcamento_id = v_id;
    select * into v_orc from public.orcamentos where id = v_id;
    perform public.assert(v_n = 2, 'O3b: item que saiu da lista é removido');
    perform public.assert(
        (select ordem from public.orcamento_itens where id = v_item_manter) = 2
        and (select quantidade from public.orcamento_itens where id = v_item_manter) = 3,
        'O3b: item mantido é atualizado (quantidade e ordem) sem trocar de id');
    perform public.assert(v_orc.subtotal = 3800.00 and v_orc.desconto_total = 380.00 and v_orc.total = 3420.00,
        'O3b: totais recalculados após a edição (3.800 - 10% = 3.420)');

    -- atomicidade: item inválido no meio derruba tudo (cabeçalho inclusive)
    perform public.login_como(v_v1, 'vendedor1.orc@a.com');
    v_estado := crm_teste.sqlstate_de(format(
        $q$select public.salvar_orcamento(%L::jsonb, %L::jsonb)$q$,
        jsonb_build_object('id', v_id, 'titulo', 'NÃO PODE GRAVAR'),
        jsonb_build_array(
            jsonb_build_object('descricao', 'Ok', 'quantidade', 1, 'valor_unitario', 1),
            jsonb_build_object('descricao', 'Quantidade zero', 'quantidade', 0, 'valor_unitario', 1))));
    perform public.login_admin();
    perform public.assert(v_estado = '23514', 'O3b: item inválido recusa o salvamento inteiro');
    perform public.assert((select titulo from public.orcamentos where id = v_id) = 'Via RPC (rev. 2)'
        and (select count(*) from public.orcamento_itens where orcamento_id = v_id) = 2,
        'O3b: nada foi gravado pela metade (cabeçalho e itens intactos)');

    -- outro tenant não edita pela RPC
    perform public.login_como(v_vb, 'vendedor.orc@b.com', v_ta);
    v_estado := crm_teste.sqlstate_de(format(
        $q$select public.salvar_orcamento(%L::jsonb, '[]'::jsonb)$q$, jsonb_build_object('id', v_id, 'titulo', 'invadido')));
    perform public.assert(v_estado = 'P0002', 'O3b: tenant B não edita orçamento de A pela RPC (não encontrado)');
    v_estado := crm_teste.sqlstate_de(format(
        $q$select public.salvar_orcamento(%L::jsonb, '[]'::jsonb)$q$, jsonb_build_object('negocio_id', v_neg_a)));
    perform public.assert(v_estado = '23503', 'O3b: tenant B não cria orçamento no negócio de A pela RPC');
    perform public.login_admin();
    perform public.assert((select count(*) from public.orcamento_itens where orcamento_id = v_id) = 2,
        'O3b: itens de A intactos depois da tentativa de B');

    perform public.assert(
        has_function_privilege('authenticated', 'public.salvar_orcamento(jsonb, jsonb)', 'execute')
        and not has_function_privilege('anon', 'public.salvar_orcamento(jsonb, jsonb)', 'execute')
        and not (select prosecdef from pg_proc where oid = 'public.salvar_orcamento(jsonb, jsonb)'::regprocedure),
        'O3b: salvar_orcamento é SECURITY INVOKER, executável só por authenticated');
end $$;

-- ---------------------------------------------------------------------
-- O4: isolamento entre tenants
-- ---------------------------------------------------------------------
do $$
declare
    v_ta uuid := (select valor from crm_teste.ctx where chave = 'orc_ta');
    v_tb uuid := (select valor from crm_teste.ctx where chave = 'orc_tb');
    v_v1 uuid := (select valor from crm_teste.ctx where chave = 'orc_v1');
    v_vb uuid := (select valor from crm_teste.ctx where chave = 'orc_vb');
    v_neg_a uuid := (select valor from crm_teste.ctx where chave = 'orc_neg_a');
    v_neg_b uuid := (select valor from crm_teste.ctx where chave = 'orc_neg_b');
    v_prod_a uuid := (select valor from crm_teste.ctx where chave = 'orc_prod_a');
    v_orc1 uuid := (select valor from crm_teste.ctx where chave = 'orc_orc1');
    v_ano int := extract(year from (now() at time zone 'America/Sao_Paulo'))::int;
    v_orc_b record;
    v_n bigint;
    v_m bigint;
begin
    perform public.login_como(v_vb, 'vendedor.orc@b.com', v_ta);
    select count(*) into v_n from public.orcamentos where tenant_id = v_ta or id = v_orc1;
    select count(*) into v_m from public.orcamento_itens where orcamento_id = v_orc1;
    perform public.assert(v_n = 0 and v_m = 0, 'O4: tenant B não lê orçamentos nem itens de A (header x-tenant-id forjado)');

    perform public.assert(crm_teste.linhas(format(
        $q$update public.orcamentos set titulo = 'invadido' where id = %L$q$, v_orc1)) = 0,
        'O4: tenant B não altera orçamento de A (0 linhas)');
    perform public.assert(crm_teste.linhas(format(
        $q$delete from public.orcamentos where id = %L$q$, v_orc1)) = 0,
        'O4: tenant B não apaga orçamento de A (0 linhas)');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$insert into public.orcamento_itens (orcamento_id, descricao, quantidade, valor_unitario) values (%L, 'Item intruso', 1, 1)$q$, v_orc1)) = '23503',
        'O4: item apontando para orçamento de OUTRO tenant recusado (FK composta)');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$insert into public.orcamento_itens (tenant_id, orcamento_id, descricao, quantidade, valor_unitario) values (%L, %L, 'Item intruso', 1, 1)$q$, v_ta, v_orc1)) = '23503',
        'O4: item com tenant_id forjado para A continua recusado (tenant vem do servidor)');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$insert into public.orcamentos (negocio_id) values (%L)$q$, v_neg_a)) = '23503',
        'O4: orçamento ligado a negócio de OUTRO tenant recusado (FK composta)');

    insert into public.orcamentos (negocio_id, titulo) values (v_neg_b, 'Proposta da B') returning * into v_orc_b;
    perform public.assert(v_orc_b.numero = v_ano || '-0001', 'O4: numeração do tenant B é independente (' || v_ano || '-0001)');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$insert into public.orcamento_itens (orcamento_id, produto_id, descricao, quantidade, valor_unitario) values (%L, %L, 'Produto alheio', 1, 1)$q$, v_orc_b.id, v_prod_a)) = '23503',
        'O4: item com produto do catálogo de OUTRO tenant recusado (FK composta)');
    perform public.login_admin();

    perform public.login_como(v_v1, 'vendedor1.orc@a.com');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$update public.orcamentos set tenant_id = %L where id = %L$q$, v_tb, v_orc1)) = '42501',
        'O4: orçamento não pode ser movido para outro tenant');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$update public.orcamento_itens set tenant_id = %L where orcamento_id = %L$q$, v_tb, v_orc1)) = '42501',
        'O4: item não pode ser movido para outro tenant');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$update public.orcamentos set negocio_id = %L where id = %L$q$, v_neg_b, v_orc1)) = '42501',
        'O4: orçamento não pode ser religado a outro negócio');
    perform public.assert(crm_teste.sqlstate_de($q$select count(*) from public.orcamento_contadores$q$) = '42501',
        'O4: contador de numeração inacessível pela API (authenticated)');
    perform public.login_admin();

    insert into crm_teste.ctx values ('orc_orc_b', v_orc_b.id);
end $$;

-- ---------------------------------------------------------------------
-- O5: numeração sem buraco e sem duplicata
-- ---------------------------------------------------------------------
do $$
declare
    v_ta uuid := (select valor from crm_teste.ctx where chave = 'orc_ta');
    v_v1 uuid := (select valor from crm_teste.ctx where chave = 'orc_v1');
    v_neg_a uuid := (select valor from crm_teste.ctx where chave = 'orc_neg_a');
    v_neg_b uuid := (select valor from crm_teste.ctx where chave = 'orc_neg_b');
    v_orc1 uuid := (select valor from crm_teste.ctx where chave = 'orc_orc1');
    v_ano int := extract(year from (now() at time zone 'America/Sao_Paulo'))::int;
    v_numero text;
    v_seqs int[];
begin
    perform public.login_como(v_v1, 'vendedor1.orc@a.com');
    insert into public.orcamentos (negocio_id) values (v_neg_a);
    -- falha DEPOIS de numerar (FK do negócio): o número volta junto
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$insert into public.orcamentos (negocio_id) values (%L)$q$, v_neg_b)) = '23503',
        'O5: insert que falha (negócio de outro tenant) é recusado');
    insert into public.orcamentos (negocio_id) values (v_neg_a) returning numero into v_numero;
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$update public.orcamentos set numero = '2000-0001' where id = %L$q$, v_orc1)) = '42501',
        'O5: número do orçamento é imutável');
    perform public.login_admin();

    perform public.assert(v_numero = v_ano || '-0004', 'O5: a tentativa que falhou não consumiu número (próximo = ' || v_ano || '-0004)');
    select array_agg(numero_seq order by numero_seq) into v_seqs from public.orcamentos where tenant_id = v_ta;
    perform public.assert(v_seqs = array[1, 2, 3, 4], 'O5: sequência do tenant A sem buraco e sem duplicata (1..4)');
    perform public.assert(
        (select ultimo from public.orcamento_contadores where tenant_id = v_ta and ano = v_ano) = 4,
        'O5: contador do tenant A consistente com os orçamentos gravados');
end $$;

-- ---------------------------------------------------------------------
-- O6: exclusão — criador ou gerente; DELETE físico só gerente
-- ---------------------------------------------------------------------
do $$
declare
    v_ger uuid := (select valor from crm_teste.ctx where chave = 'orc_ger');
    v_v1 uuid := (select valor from crm_teste.ctx where chave = 'orc_v1');
    v_v2 uuid := (select valor from crm_teste.ctx where chave = 'orc_v2');
    v_neg_a uuid := (select valor from crm_teste.ctx where chave = 'orc_neg_a');
    v_orc1 uuid := (select valor from crm_teste.ctx where chave = 'orc_orc1');
    v_orc_v2 uuid;
    v_deleted_by uuid;
begin
    -- ataques do vendedor 2 contra o orçamento do vendedor 1
    perform public.login_como(v_v2, 'vendedor2.orc@a.com');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$update public.orcamentos set deleted_at = now() where id = %L$q$, v_orc1)) = '42501',
        'O6: vendedor NÃO exclui (soft delete) orçamento criado por outro vendedor');
    perform public.assert(crm_teste.linhas(format(
        $q$delete from public.orcamentos where id = %L$q$, v_orc1)) = 0,
        'O6: vendedor NÃO apaga fisicamente orçamento de outro (0 linhas)');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$update public.orcamentos set created_by = %L where id = %L$q$, v_v2, v_orc1)) = '42501',
        'O6: vendedor NÃO se torna "criador" do orçamento alheio para poder excluí-lo');
    insert into public.orcamentos (negocio_id, titulo) values (v_neg_a, 'Do vendedor 2') returning id into v_orc_v2;
    perform public.login_admin();

    -- criador exclui o próprio (soft delete), mas não apaga fisicamente
    perform public.login_como(v_v1, 'vendedor1.orc@a.com');
    perform public.assert(crm_teste.linhas(format(
        $q$delete from public.orcamentos where id = %L$q$, v_orc1)) = 0,
        'O6: DELETE físico não é permitido nem ao criador (0 linhas)');
    perform public.assert(crm_teste.linhas(format(
        $q$update public.orcamentos set deleted_at = '2000-01-01' where id = %L$q$, v_orc1)) = 1,
        'O6: criador EXCLUI o próprio orçamento (soft delete)');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$update public.orcamentos set titulo = 'editado na lixeira' where id = %L$q$, v_orc1)) = '55000',
        'O6: orçamento excluído não pode ser editado');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$insert into public.orcamento_itens (orcamento_id, descricao, quantidade, valor_unitario) values (%L, 'Depois de excluir', 1, 1)$q$, v_orc1)) = '55000',
        'O6: não entra item novo em orçamento excluído');
    perform public.login_admin();

    select deleted_by into v_deleted_by from public.orcamentos where id = v_orc1;
    perform public.assert(v_deleted_by = v_v1, 'O6: deleted_by registra quem excluiu');
    perform public.assert((select deleted_at::date from public.orcamentos where id = v_orc1) <> '2000-01-01',
        'O6: deleted_at vem do relógio do servidor (data forjada ignorada)');

    perform public.login_como(v_v2, 'vendedor2.orc@a.com');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$update public.orcamentos set deleted_at = null where id = %L$q$, v_orc1)) = '42501',
        'O6: outro vendedor NÃO restaura orçamento alheio');
    perform public.login_admin();

    perform public.login_como(v_v1, 'vendedor1.orc@a.com');
    perform public.assert(crm_teste.linhas(format(
        $q$update public.orcamentos set deleted_at = null where id = %L$q$, v_orc1)) = 1,
        'O6: criador restaura o próprio orçamento');
    perform public.login_admin();

    -- gerente exclui qualquer um e é o único com DELETE físico
    perform public.login_como(v_ger, 'gerente.orc@a.com');
    perform public.assert(crm_teste.linhas(format(
        $q$update public.orcamentos set deleted_at = now() where id = %L$q$, v_orc_v2)) = 1,
        'O6: gerente EXCLUI orçamento de qualquer vendedor (soft delete)');
    perform public.assert(crm_teste.linhas(format(
        $q$delete from public.orcamentos where id = %L$q$, v_orc1)) = 1,
        'O6: gerente apaga fisicamente');
    perform public.login_admin();

    perform public.assert(not exists (select 1 from public.orcamento_itens where orcamento_id = v_orc1),
        'O6: itens do orçamento apagado vão junto (cascade)');
end $$;

-- ---------------------------------------------------------------------
-- O7: storage do logo (bucket empresa-assets)
-- ---------------------------------------------------------------------
do $$
declare
    v_ta uuid := (select valor from crm_teste.ctx where chave = 'orc_ta');
    v_tb uuid := (select valor from crm_teste.ctx where chave = 'orc_tb');
    v_ger uuid := (select valor from crm_teste.ctx where chave = 'orc_ger');
    v_v1 uuid := (select valor from crm_teste.ctx where chave = 'orc_v1');
    v_adm_b uuid := (select valor from crm_teste.ctx where chave = 'orc_adm_b');
    v_vb uuid := (select valor from crm_teste.ctx where chave = 'orc_vb');
    v_bucket record;
    v_n bigint;
begin
    select * into v_bucket from storage.buckets where id = 'empresa-assets';
    perform public.assert(v_bucket.public = false, 'O7: bucket empresa-assets é PRIVADO');
    perform public.assert(v_bucket.file_size_limit = 2097152, 'O7: bucket empresa-assets limita a 2 MB');
    perform public.assert(
        v_bucket.allowed_mime_types @> array['image/png', 'image/jpeg', 'image/webp']
        and not ('image/svg+xml' = any(v_bucket.allowed_mime_types)),
        'O7: bucket aceita PNG/JPEG/WEBP e NÃO aceita SVG');

    perform public.login_como(v_ger, 'gerente.orc@a.com');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$insert into storage.objects (bucket_id, name) values ('empresa-assets', %L)$q$, v_ta::text || '/logo-1.png')) = 'OK',
        'O7: gerente envia o logo PNG para a pasta do próprio tenant');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$insert into storage.objects (bucket_id, name) values ('empresa-assets', %L)$q$, v_tb::text || '/logo.png')) = '42501',
        'O7: gerente NÃO grava na pasta de outro tenant');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$insert into storage.objects (bucket_id, name) values ('empresa-assets', %L)$q$, v_ta::text || '/logo.svg')) = '42501',
        'O7: arquivo .svg recusado pela policy (mesmo que o bucket seja afrouxado)');
    perform public.assert(crm_teste.sqlstate_de($q$insert into storage.objects (bucket_id, name) values ('empresa-assets', 'logo-sem-pasta.png')$q$) = '42501',
        'O7: arquivo fora de uma pasta de tenant recusado');
    perform public.login_admin();

    perform public.login_como(v_v1, 'vendedor1.orc@a.com');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$insert into storage.objects (bucket_id, name) values ('empresa-assets', %L)$q$, v_ta::text || '/trocado.png')) = '42501',
        'O7: vendedor NÃO troca o logo');
    select count(*) into v_n from storage.objects where bucket_id = 'empresa-assets' and name = v_ta::text || '/logo-1.png';
    perform public.assert(v_n = 1, 'O7: vendedor LÊ o logo do próprio tenant (para o PDF)');
    perform public.assert(crm_teste.linhas(format(
        $q$delete from storage.objects where bucket_id = 'empresa-assets' and name = %L$q$, v_ta::text || '/logo-1.png')) = 0,
        'O7: vendedor NÃO apaga o logo');
    perform public.login_admin();

    perform public.login_como(v_vb, 'vendedor.orc@b.com', v_ta);
    select count(*) into v_n from storage.objects where bucket_id = 'empresa-assets' and name like v_ta::text || '/%';
    perform public.login_admin();
    perform public.assert(v_n = 0, 'O7: outro tenant NÃO lê o logo (header forjado)');

    perform public.login_como(v_adm_b, 'admin.orc@b.com', v_ta);
    perform public.assert(crm_teste.linhas(format(
        $q$delete from storage.objects where bucket_id = 'empresa-assets' and name = %L$q$, v_ta::text || '/logo-1.png')) = 0,
        'O7: admin de outro tenant NÃO apaga o logo');
    perform public.login_admin();

    perform public.login_como(v_ger, 'gerente.orc@a.com');
    perform public.assert(crm_teste.linhas(format(
        $q$delete from storage.objects where bucket_id = 'empresa-assets' and name = %L$q$, v_ta::text || '/logo-1.png')) = 1,
        'O7: gerente remove o logo antigo do próprio tenant');
    perform public.login_admin();
end $$;

-- ---------------------------------------------------------------------
-- O8: anon e privilégios de função
-- ---------------------------------------------------------------------
do $$
declare
    v_tabela text;
begin
    foreach v_tabela in array array['empresa_identidade', 'produtos', 'orcamentos', 'orcamento_itens', 'orcamento_contadores'] loop
        perform public.login_anon();
        perform public.assert(crm_teste.sqlstate_de(format('select count(*) from public.%I', v_tabela)) = '42501',
            'O8: anon sem acesso de leitura a ' || v_tabela);
        perform public.login_admin();
    end loop;

    perform public.login_anon();
    perform public.assert(crm_teste.sqlstate_de(
        $q$insert into public.orcamentos (negocio_id) values (gen_random_uuid())$q$) = '42501',
        'O8: anon não cria orçamento');
    perform public.login_admin();

    perform public.assert(
        not has_function_privilege('authenticated', 'public.fn_orcamentos_numerar()', 'execute')
        and not has_function_privilege('anon', 'public.fn_orcamentos_numerar()', 'execute'),
        'O8: função SECURITY DEFINER da numeração sem EXECUTE para a API (só dispara como trigger)');
    perform public.assert(
        not has_function_privilege('anon', 'public.identidade_cnpj_valido(text)', 'execute'),
        'O8: helper de CNPJ sem EXECUTE para anon');
    perform public.assert(
        (select prosecdef from pg_proc where oid = 'public.fn_orcamentos_numerar()'::regprocedure)
        and (select proconfig::text like '%search_path=public%' from pg_proc where oid = 'public.fn_orcamentos_numerar()'::regprocedure),
        'O8: única função SECURITY DEFINER do módulo tem search_path fixo');
    perform public.assert(
        not exists (
            select 1 from pg_proc
            where oid in ('public.fn_orcamentos_preparar()'::regprocedure, 'public.fn_orcamento_itens_preparar()'::regprocedure,
                          'public.fn_orcamento_itens_recalcular()'::regprocedure, 'public.fn_orc_proteger_tenant()'::regprocedure)
              and prosecdef
        ),
        'O8: regras de orçamento/itens rodam como invoker (respeitam a RLS do usuário)');
end $$;

do $$
begin
    raise notice 'MIGRATION 13 (orçamentos) VALIDADA';
end $$;
