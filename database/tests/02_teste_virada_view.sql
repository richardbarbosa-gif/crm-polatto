-- =====================================================================
-- TESTE DA VIRADA — tabela clientes → view de compatibilidade
--
-- Reproduz exatamente a sequência documentada em database/migrations/README.md
-- e valida que o frontend atual (que só conhece "clientes") continua
-- lendo, criando, editando e excluindo normalmente depois da troca,
-- com isolamento entre tenants preservado.
--
-- Executar DEPOIS de 01_testes_isolamento.sql (reaproveita os tenants).
-- =====================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------
-- VIRADA: migra os dados, renomeia a tabela e recria a view
-- ---------------------------------------------------------------------
do $$
begin
    perform public.migrar_clientes_para_negocios(false);
    raise notice 'dados migrados para o modelo novo';
end $$;

alter table if exists public.clientes rename to clientes_legado;

\ir ../migrations/2026-07-19_01_modelo_relacional.sql

do $$
begin
    perform public.assert(
        exists (
            select 1 from information_schema.views
            where table_schema = 'public' and table_name = 'clientes'
        ),
        'VIRADA: clientes agora é uma view de compatibilidade'
    );
end $$;

-- Garante que a view é acessível ao role da API
grant select, insert, update, delete on public.clientes to authenticated;

-- ---------------------------------------------------------------------
-- TESTE V1: a view executa com a RLS do usuário (security_invoker)
-- ---------------------------------------------------------------------
do $$
declare
    v_opcao boolean;
begin
    select coalesce(
        (select lower(o.option_value) in ('true', 'on')
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace,
         lateral pg_options_to_table(c.reloptions) as o(option_name, option_value)
         where n.nspname = 'public' and c.relname = 'clientes'
           and o.option_name = 'security_invoker'
         limit 1),
        false
    ) into v_opcao;

    perform public.assert(v_opcao, 'VIRADA: view clientes tem security_invoker=on');
end $$;

-- ---------------------------------------------------------------------
-- TESTE V2: leitura pela view continua isolada por tenant
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_do_b bigint;
    v_do_a bigint;
begin
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    select count(*) into v_do_b from public.clientes where tenant_id = v_tenant_b;
    select count(*) into v_do_a from public.clientes where tenant_id = v_tenant_a;
    perform public.login_admin();

    perform public.assert(v_do_b = 0, 'VIRADA: view não expõe clientes de outro tenant');
    perform public.assert(v_do_a > 0, 'VIRADA: view continua mostrando os clientes do próprio tenant');
end $$;

-- ---------------------------------------------------------------------
-- TESTE V3: INSERT pela view cria negócio + pessoa (fluxo do frontend)
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_negocio record;
begin
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');

    insert into public.clientes (nome, cpf_cnpj, telefone, email, conta_energia_media, status, responsavel)
    values ('Maria Souza', '111.222.333-44', '(11) 98888-7777', 'maria@teste.com', 620.50, 'Novo Lead', 'Vendedor A');

    perform public.login_admin();

    select * into v_negocio from public.negocios where titulo = 'Maria Souza';

    perform public.assert(v_negocio.id is not null, 'VIRADA: insert na view cria o negócio');
    perform public.assert(v_negocio.tenant_id = v_tenant_a, 'VIRADA: negócio criado nasce no tenant correto');
    perform public.assert(
        v_negocio.pessoa_contato_principal_id is not null,
        'VIRADA: insert na view cria a pessoa de contato'
    );
    perform public.assert(
        (v_negocio.dados_extras ->> 'conta_energia_media')::numeric = 620.50,
        'VIRADA: campos específicos do segmento vão para dados_extras'
    );
    perform public.assert(
        exists (select 1 from public.negocios_pessoas where negocio_id = v_negocio.id),
        'VIRADA: vínculo negócio-pessoa é criado'
    );
end $$;

-- ---------------------------------------------------------------------
-- TESTE V4: UPDATE pela view (o Kanban move etapa exatamente assim)
-- ---------------------------------------------------------------------
do $$
declare
    v_id uuid;
    v_status text;
    v_nome text;
begin
    select id into v_id from public.negocios where titulo = 'Maria Souza';

    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    update public.clientes
    set status = 'Em Negociacao', nome = 'Maria Souza Lima'
    where id = v_id;
    perform public.login_admin();

    select n.status into v_status from public.negocios n where n.id = v_id;
    select p.nome into v_nome
    from public.pessoas p
    join public.negocios n on n.pessoa_contato_principal_id = p.id
    where n.id = v_id;

    perform public.assert(v_status = 'Em Negociacao', 'VIRADA: update de status pela view chega em negocios');
    perform public.assert(v_nome = 'Maria Souza Lima', 'VIRADA: update de nome pela view chega em pessoas');
end $$;

-- ---------------------------------------------------------------------
-- TESTE V5: UPDATE cross-tenant pela view é bloqueado
-- ---------------------------------------------------------------------
do $$
declare
    v_id_b uuid;
    v_titulo text;
    v_afetados integer;
begin
    -- Negócio do tenant B criado nos testes anteriores
    select id into v_id_b from public.negocios where titulo = 'Negócio secreto do B';

    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    begin
        update public.clientes set status = 'INVADIDO' where id = v_id_b;
        get diagnostics v_afetados = row_count;
    exception when others then
        v_afetados := 0;
    end;
    perform public.login_admin();

    select status into v_titulo from public.negocios where id = v_id_b;

    perform public.assert(v_afetados = 0, 'VIRADA: update cross-tenant pela view não afeta nenhuma linha');
    perform public.assert(
        v_titulo is distinct from 'INVADIDO',
        'VIRADA: negócio do tenant B permanece intacto'
    );
end $$;

-- ---------------------------------------------------------------------
-- TESTE V5b: editar um lead NÃO altera outro que compartilha o contato
-- ---------------------------------------------------------------------
do $$
declare
    v_pessoa uuid;
    v_neg1 uuid;
    v_neg2 uuid;
    v_nome1 text;
    v_nome2 text;
begin
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');

    -- Dois negócios do mesmo contato (dedup por telefone reaproveita a pessoa).
    -- O valor distingue os dois: created_at é idêntico na mesma transação.
    insert into public.clientes (nome, telefone, email, status, valor)
    values ('Carlos Contato', '(11) 91234-5678', 'carlos@teste.com', 'Novo Lead', 1111);
    insert into public.clientes (nome, telefone, email, status, valor)
    values ('Carlos Contato', '(11) 91234-5678', 'carlos@teste.com', 'Novo Lead', 2222);

    perform public.login_admin();

    select id into v_neg1 from public.negocios where titulo = 'Carlos Contato' and valor = 1111;
    select id into v_neg2 from public.negocios where titulo = 'Carlos Contato' and valor = 2222;
    select pessoa_contato_principal_id into v_pessoa from public.negocios where id = v_neg1;

    perform public.assert(
        v_pessoa = (select pessoa_contato_principal_id from public.negocios where id = v_neg2),
        'VIRADA: dedup reaproveita a mesma pessoa nos dois negócios'
    );

    -- Renomear pelo primeiro lead não pode afetar o segundo
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    update public.clientes set nome = 'Carlos Renomeado' where id = v_neg1;
    perform public.login_admin();

    select p.nome into v_nome1 from public.pessoas p
    join public.negocios n on n.pessoa_contato_principal_id = p.id where n.id = v_neg1;
    select p.nome into v_nome2 from public.pessoas p
    join public.negocios n on n.pessoa_contato_principal_id = p.id where n.id = v_neg2;

    perform public.assert(v_nome1 = 'Carlos Renomeado', 'VIRADA: edição aplica no lead editado');
    perform public.assert(
        v_nome2 = 'Carlos Contato',
        'VIRADA: fork-on-write impede que a edição vaze para o outro negócio'
    );
end $$;

-- ---------------------------------------------------------------------
-- TESTE V6: DELETE pela view faz soft delete (não perde dado)
-- ---------------------------------------------------------------------
do $$
declare
    v_id uuid;
    v_deletado timestamptz;
    v_visivel bigint;
begin
    select id into v_id from public.negocios where titulo = 'Maria Souza';

    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    delete from public.clientes where id = v_id;
    select count(*) into v_visivel from public.clientes where id = v_id;
    perform public.login_admin();

    select deleted_at into v_deletado from public.negocios where id = v_id;

    perform public.assert(v_deletado is not null, 'VIRADA: delete pela view faz soft delete em negocios');
    perform public.assert(v_visivel = 0, 'VIRADA: registro excluído some da view');
end $$;

-- ---------------------------------------------------------------------
-- TESTE V7: as colunas que o frontend usa existem na view
-- ---------------------------------------------------------------------
do $$
declare
    v_faltando text;
begin
    select string_agg(c.coluna, ', ')
    into v_faltando
    from (values
        ('id'), ('tenant_id'), ('nome'), ('cpf_cnpj'), ('telefone'), ('email'),
        ('ddi'), ('cep'), ('endereco_instalacao'), ('numero'), ('complemento'),
        ('conta_energia_media'), ('valor'), ('status'), ('stage_id'),
        ('temperatura'), ('responsavel'), ('responsavel_id'), ('motivo_perda'),
        ('created_at')
    ) as c(coluna)
    where not exists (
        select 1 from information_schema.columns ic
        where ic.table_schema = 'public' and ic.table_name = 'clientes'
          and ic.column_name = c.coluna
    );

    if v_faltando is not null then
        raise notice 'Colunas ausentes na view: %', v_faltando;
    end if;

    perform public.assert(
        v_faltando is null,
        'VIRADA: view expõe todas as colunas que o frontend consome'
    );
end $$;

-- ---------------------------------------------------------------------
-- TESTE V8: relatorio_rls() continua limpo depois da virada
-- ---------------------------------------------------------------------
do $$
declare
    v_criticos bigint;
    v_detalhe text;
begin
    select count(*), string_agg(objeto || ' (' || problema || ')', '; ')
    into v_criticos, v_detalhe
    from public.relatorio_rls()
    where gravidade = 'CRITICA';

    if v_criticos > 0 then
        raise notice 'Críticos após a virada: %', v_detalhe;
    end if;

    perform public.assert(v_criticos = 0, 'VIRADA: nenhum problema crítico de isolamento após a troca');
end $$;

do $$
begin
    raise notice '';
    raise notice '===============================================';
    raise notice 'VIRADA PARA A VIEW VALIDADA COM SUCESSO';
    raise notice '===============================================';
end $$;
