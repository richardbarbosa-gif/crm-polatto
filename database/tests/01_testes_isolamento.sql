-- =====================================================================
-- SUÍTE DE TESTES — isolamento multi-tenant, migração de dados e LGPD
--
-- Cada teste é uma asserção que ABORTA o script em caso de falha.
-- Rodar depois das migrations: psql -f database/tests/01_testes_isolamento.sql
-- =====================================================================

\set ON_ERROR_STOP on
\timing off

-- Schema auxiliar da suíte (fora de public para não poluir o relatorio_rls)
create schema if not exists crm_teste;
create table if not exists crm_teste.ctx (chave text primary key, valor uuid);

create or replace function public.assert(p_condicao boolean, p_descricao text)
returns void
language plpgsql
as $$
begin
    if p_condicao then
        raise notice 'PASS  %', p_descricao;
    else
        raise exception 'FALHOU: %', p_descricao;
    end if;
end;
$$;

-- Simula a sessão de um usuário autenticado (igual PostgREST faz).
-- p_tenant_selecionado simula o header x-tenant-id que o frontend envia
-- quando o usuário troca de empresa no seletor.
create or replace function public.login_como(
    p_user uuid,
    p_email text default null,
    p_tenant_selecionado uuid default null
)
returns void
language plpgsql
as $$
begin
    perform set_config(
        'request.jwt.claims',
        json_build_object('sub', p_user::text, 'email', coalesce(p_email, ''), 'role', 'authenticated')::text,
        false
    );
    perform set_config(
        'request.headers',
        json_build_object('x-tenant-id', coalesce(p_tenant_selecionado::text, ''))::text,
        false
    );
    execute 'set role authenticated';
end;
$$;

create or replace function public.login_admin()
returns void
language plpgsql
as $$
begin
    execute 'reset role';
    perform set_config('request.jwt.claims', '', false);
    perform set_config('request.headers', '', false);
end;
$$;

-- ---------------------------------------------------------------------
-- CENÁRIO: dois tenants, um usuário em cada
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_a uuid;
    v_tenant_b uuid;
    v_user_a uuid := gen_random_uuid();
    v_user_b uuid := gen_random_uuid();
begin
    insert into auth.users (id, email) values
        (v_user_a, 'vendedor.a@teste.com'),
        (v_user_b, 'vendedor.b@teste.com');

    insert into public.empresas (nome, segmento) values ('Empresa A', 'energia_solar') returning id into v_tenant_a;
    insert into public.empresas (nome, segmento) values ('Empresa B', 'software') returning id into v_tenant_b;

    insert into public.utilizadores_empresas (auth_uid, empresa_id, role) values
        (v_user_a, v_tenant_a, 'admin'),
        (v_user_b, v_tenant_b, 'admin');

    -- Guarda os ids para os testes seguintes. Fora do schema public para
    -- não ser confundida com tabela de negócio pelo relatorio_rls().
    delete from crm_teste.ctx;
    insert into crm_teste.ctx values
        ('tenant_a', v_tenant_a), ('tenant_b', v_tenant_b),
        ('user_a', v_user_a), ('user_b', v_user_b);

    perform public.provisionar_defaults_tenant(v_tenant_a);
    perform public.provisionar_defaults_tenant(v_tenant_b);
end $$;

-- ---------------------------------------------------------------------
-- TESTE 1: current_tenant_id() resolve pelo usuário autenticado
-- ---------------------------------------------------------------------
do $$
declare
    v_esperado uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_obtido uuid;
begin
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    v_obtido := public.current_tenant_id();
    perform public.login_admin();
    perform public.assert(v_obtido = v_esperado, 'current_tenant_id() resolve o tenant do usuário autenticado');
end $$;

-- ---------------------------------------------------------------------
-- TESTE 2: usuário SEM vínculo tem tenant nulo (fail-closed)
-- ---------------------------------------------------------------------
do $$
declare
    v_obtido uuid;
begin
    perform public.login_como(gen_random_uuid(), 'sem.vinculo@teste.com');
    v_obtido := public.current_tenant_id();
    perform public.login_admin();
    perform public.assert(v_obtido is null, 'usuário sem vínculo → current_tenant_id() nulo (fail-closed)');
end $$;

-- ---------------------------------------------------------------------
-- TESTE 3: trigger preenche tenant_id no servidor e IGNORA o do cliente
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_gravado uuid;
begin
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');

    -- Usuário A tenta forjar tenant_id do B no insert
    insert into public.negocios (tenant_id, titulo, valor)
    values (v_tenant_b, 'Tentativa de forjar tenant', 1000)
    returning tenant_id into v_gravado;

    perform public.login_admin();
    perform public.assert(
        v_gravado = v_tenant_a,
        'insert com tenant_id forjado é sobrescrito pelo tenant real do usuário'
    );
end $$;

-- ---------------------------------------------------------------------
-- TESTE 4: RLS bloqueia leitura cross-tenant em negocios
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_visiveis bigint;
begin
    -- B cria um negócio próprio
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_b'), 'vendedor.b@teste.com');
    insert into public.negocios (titulo, valor) values ('Negócio secreto do B', 50000);
    perform public.login_admin();

    -- A tenta ler os dados de B
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    select count(*) into v_visiveis from public.negocios where tenant_id = v_tenant_b;
    perform public.login_admin();

    perform public.assert(v_visiveis = 0, 'RLS impede usuário A de LER negócios do tenant B');
end $$;

-- ---------------------------------------------------------------------
-- TESTE 5: RLS bloqueia UPDATE cross-tenant direto em negocios
-- ---------------------------------------------------------------------
do $$
declare
    v_id_b uuid;
    v_afetados integer;
    v_titulo_atual text;
begin
    select id into v_id_b from public.negocios where titulo = 'Negócio secreto do B';

    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    update public.negocios set titulo = 'INVADIDO POR A' where id = v_id_b;
    get diagnostics v_afetados = row_count;
    perform public.login_admin();

    select titulo into v_titulo_atual from public.negocios where id = v_id_b;

    perform public.assert(v_afetados = 0, 'RLS impede UPDATE cross-tenant direto em negocios');
    perform public.assert(
        v_titulo_atual = 'Negócio secreto do B',
        'dado do tenant B permanece intacto após tentativa de invasão'
    );
end $$;

-- ---------------------------------------------------------------------
-- TESTE 6: a view de compatibilidade "clientes" não vaza entre tenants
-- (só roda se a view já substituiu a tabela legada)
-- ---------------------------------------------------------------------
do $$
declare
    v_eh_view boolean;
    v_visiveis bigint;
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
begin
    select exists (
        select 1 from information_schema.views
        where table_schema = 'public' and table_name = 'clientes'
    ) into v_eh_view;

    if not v_eh_view then
        raise notice 'SKIP  view de compatibilidade ainda não criada (clientes é tabela física)';
        return;
    end if;

    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    select count(*) into v_visiveis from public.clientes where tenant_id = v_tenant_b;
    perform public.login_admin();

    perform public.assert(v_visiveis = 0, 'view clientes (security_invoker) não vaza dados entre tenants');
end $$;

-- ---------------------------------------------------------------------
-- TESTE 7: isolamento nas tabelas de configuração do tenant
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_motivos bigint;
    v_tipos bigint;
    v_pipelines bigint;
begin
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    select count(*) into v_motivos from public.motivos_perda where tenant_id = v_tenant_b;
    select count(*) into v_tipos from public.tipos_atividade where tenant_id = v_tenant_b;
    select count(*) into v_pipelines from public.pipelines where tenant_id = v_tenant_b;
    perform public.login_admin();

    perform public.assert(v_motivos = 0, 'motivos_perda isolados por tenant');
    perform public.assert(v_tipos = 0, 'tipos_atividade isolados por tenant');
    perform public.assert(v_pipelines = 0, 'pipelines isolados por tenant');
end $$;

-- ---------------------------------------------------------------------
-- TESTE 8: policies de Storage isolam por prefixo {tenant_id}/
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_visiveis bigint;
    v_tem_policy boolean;
begin
    select exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'objects' and policyname = 'lead_files_tenant_select'
    ) into v_tem_policy;

    if not v_tem_policy then
        raise notice 'SKIP  policies de storage não aplicadas neste ambiente';
        return;
    end if;

    insert into storage.objects (bucket_id, name) values
        ('lead-files', v_tenant_a::text || '/123/proposta.pdf'),
        ('lead-files', v_tenant_b::text || '/456/contrato.pdf');

    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    select count(*) into v_visiveis from storage.objects
    where bucket_id = 'lead-files' and name like v_tenant_b::text || '%';
    perform public.login_admin();

    perform public.assert(v_visiveis = 0, 'Storage: usuário A não enxerga arquivos do tenant B');
end $$;

-- ---------------------------------------------------------------------
-- TESTE 9: foldername extrai o tenant do path corretamente
-- ---------------------------------------------------------------------
do $$
declare
    v_primeiro text;
begin
    v_primeiro := (storage.foldername('11111111-1111-1111-1111-111111111111/42/arquivo.pdf'))[1];
    perform public.assert(
        v_primeiro = '11111111-1111-1111-1111-111111111111',
        'storage.foldername()[1] devolve o tenant_id do path'
    );
end $$;

-- ---------------------------------------------------------------------
-- TESTE 10: migração de dados clientes → negocios (idempotente)
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_eh_tabela boolean;
    v_migrados bigint;
    v_segunda bigint;
    v_negocio record;
begin
    select exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'clientes' and table_type = 'BASE TABLE'
    ) into v_eh_tabela;

    if not v_eh_tabela then
        raise notice 'SKIP  clientes já é view — migração de dados não se aplica';
        return;
    end if;

    insert into public.clientes (tenant_id, nome, cpf_cnpj, telefone, email, conta_energia_media, status, responsavel)
    values
        (v_tenant_a, 'João da Silva', '123.456.789-01', '(11) 99999-1111', 'joao@teste.com', 450.75, 'Novo Lead', 'Vendedor A'),
        (v_tenant_a, 'Empresa XPTO LTDA', '12.345.678/0001-95', '(11) 3333-2222', 'contato@xpto.com', 8900.00, 'Em Negociacao', 'Vendedor A');

    select quantidade into v_migrados
    from public.migrar_clientes_para_negocios(false)
    where acao = 'migrados';

    perform public.assert(v_migrados = 2, 'migração converte os 2 clientes em negócios');

    -- CNPJ vira organização; CPF fica só como pessoa
    select * into v_negocio from public.negocios where titulo = 'Empresa XPTO LTDA';
    perform public.assert(
        v_negocio.organizacao_id is not null,
        'cliente com CNPJ gera organização vinculada'
    );

    select * into v_negocio from public.negocios where titulo = 'João da Silva';
    perform public.assert(
        v_negocio.organizacao_id is null and v_negocio.pessoa_contato_principal_id is not null,
        'cliente com CPF gera apenas pessoa (sem organização)'
    );
    perform public.assert(
        (v_negocio.dados_extras ->> 'conta_energia_media')::numeric = 450.75,
        'campos do modelo solar migram para dados_extras'
    );

    -- Idempotência: rodar de novo não duplica
    select quantidade into v_segunda
    from public.migrar_clientes_para_negocios(false)
    where acao = 'migrados';
    perform public.assert(v_segunda = 0, 'migração é idempotente (segunda execução não duplica)');
end $$;

-- ---------------------------------------------------------------------
-- TESTE 11: soft delete e restauração
-- ---------------------------------------------------------------------
do $$
declare
    v_id uuid;
    v_deletado timestamptz;
begin
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    insert into public.negocios (titulo, valor) values ('Negócio para excluir', 100) returning id into v_id;

    update public.negocios set deleted_at = now() where id = v_id;
    select deleted_at into v_deletado from public.negocios where id = v_id;
    perform public.assert(v_deletado is not null, 'soft delete marca deleted_at sem apagar a linha');

    perform public.restaurar_registro('negocios', v_id::text);
    select deleted_at into v_deletado from public.negocios where id = v_id;
    perform public.login_admin();

    perform public.assert(v_deletado is null, 'restaurar_registro() desfaz o soft delete');
end $$;

-- ---------------------------------------------------------------------
-- TESTE 12: audit_log registra as mudanças automaticamente
-- ---------------------------------------------------------------------
do $$
declare
    v_id uuid;
    v_registros bigint;
begin
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    insert into public.negocios (titulo, valor) values ('Negócio auditado', 777) returning id into v_id;
    update public.negocios set valor = 888 where id = v_id;
    perform public.login_admin();

    select count(*) into v_registros from public.audit_log
    where tabela = 'negocios' and registro_id = v_id::text;

    perform public.assert(v_registros >= 2, 'audit_log grava INSERT e UPDATE automaticamente');
end $$;

-- ---------------------------------------------------------------------
-- TESTE 13: LGPD — exportação e anonimização do titular
-- ---------------------------------------------------------------------
do $$
declare
    v_pessoa_id uuid;
    v_export jsonb;
    v_nome text;
    v_email text;
begin
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');

    insert into public.pessoas (nome, email, telefone, cpf)
    values ('Titular LGPD', 'titular@teste.com', '11988887777', '98765432100')
    returning id into v_pessoa_id;

    v_export := public.lgpd_exportar_dados_titular(v_pessoa_id);
    perform public.assert(
        v_export -> 'pessoa' ->> 'nome' = 'Titular LGPD',
        'LGPD: exportação do titular retorna os dados pessoais'
    );

    perform public.lgpd_apagar_dados_titular(v_pessoa_id);
    select nome, email into v_nome, v_email from public.pessoas where id = v_pessoa_id;
    perform public.login_admin();

    perform public.assert(v_nome = 'Titular removido (LGPD)', 'LGPD: anonimização remove o nome do titular');
    perform public.assert(v_email is null, 'LGPD: anonimização remove o e-mail do titular');
end $$;

-- ---------------------------------------------------------------------
-- TESTE 14: LGPD — não é possível exportar titular de outro tenant
-- ---------------------------------------------------------------------
do $$
declare
    v_pessoa_b uuid;
    v_erro boolean := false;
begin
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_b'), 'vendedor.b@teste.com');
    insert into public.pessoas (nome, email) values ('Titular do B', 'b@teste.com') returning id into v_pessoa_b;
    perform public.login_admin();

    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    begin
        perform public.lgpd_exportar_dados_titular(v_pessoa_b);
    exception when others then
        v_erro := true;
    end;
    perform public.login_admin();

    perform public.assert(v_erro, 'LGPD: exportar titular de outro tenant é bloqueado');
end $$;

-- ---------------------------------------------------------------------
-- TESTE 15: rate limiting bloqueia excesso de chamadas
-- ---------------------------------------------------------------------
do $$
declare
    v_bloqueou boolean := false;
    i integer;
begin
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    begin
        for i in 1..5 loop
            perform public.enforce_rate_limit('teste_limite', 3, interval '1 hour');
        end loop;
    exception when others then
        v_bloqueou := true;
    end;
    perform public.login_admin();

    perform public.assert(v_bloqueou, 'enforce_rate_limit bloqueia após o limite configurado');
end $$;

-- ---------------------------------------------------------------------
-- TESTE 16: limite de leads do plano é aplicado
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_plano_id uuid;
    v_bloqueou boolean := false;
    i integer;
begin
    -- Plano artificial com teto baixo para exercitar a trava
    insert into public.planos (nome, max_usuarios, max_leads, max_storage_mb, preco_mensal)
    values ('TesteLimite', 100, 3, 100, 0)
    on conflict (nome) do update set max_leads = 3
    returning id into v_plano_id;

    insert into public.tenant_planos (tenant_id, plano_id) values (v_tenant_a, v_plano_id)
    on conflict (tenant_id) do update set plano_id = excluded.plano_id;

    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    begin
        for i in 1..10 loop
            insert into public.negocios (titulo, valor) values ('Lead limite ' || i, 1);
        end loop;
    exception when others then
        v_bloqueou := true;
    end;
    perform public.login_admin();

    perform public.assert(v_bloqueou, 'limite de leads do plano bloqueia novos cadastros');

    -- Limpa a trava para não afetar testes seguintes
    delete from public.tenant_planos where tenant_id = v_tenant_a;
end $$;

-- ---------------------------------------------------------------------
-- TESTE 16b: tabelas legadas (agenda, timeline, anexos, equipe) isoladas
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_tarefas bigint;
    v_atividades bigint;
    v_documentos bigint;
    v_funcionarios bigint;
begin
    -- B cria dados nas tabelas legadas
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_b'), 'vendedor.b@teste.com');
    insert into public.tarefas (titulo, tipo, data_vencimento)
    values ('Visita confidencial do B', 'visita', now() + interval '1 day');
    insert into public.atividades_lead (activity_type, titulo)
    values ('nota', 'Nota interna do B');
    insert into public.documentos_lead (cliente_id, tipo, nome_arquivo, caminho_storage)
    values ('x', 'proposta', 'proposta-b.pdf', v_tenant_b::text || '/x/proposta-b.pdf');
    insert into public.funcionarios (nome, email, cargo)
    values ('Funcionário do B', 'func.b@teste.com', 'vendedor');
    perform public.login_admin();

    -- A tenta enxergar
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    select count(*) into v_tarefas from public.tarefas where tenant_id = v_tenant_b;
    select count(*) into v_atividades from public.atividades_lead where tenant_id = v_tenant_b;
    select count(*) into v_documentos from public.documentos_lead where tenant_id = v_tenant_b;
    select count(*) into v_funcionarios from public.funcionarios where tenant_id = v_tenant_b;
    perform public.login_admin();

    perform public.assert(v_tarefas = 0, 'tarefas (agenda) isoladas por tenant');
    perform public.assert(v_atividades = 0, 'atividades_lead (timeline) isoladas por tenant');
    perform public.assert(v_documentos = 0, 'documentos_lead (anexos) isolados por tenant');
    perform public.assert(v_funcionarios = 0, 'funcionarios (equipe) isolados por tenant');
end $$;

-- ---------------------------------------------------------------------
-- TESTE 16c: usuário não enxerga a empresa nem o vínculo de outro tenant
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_user_b uuid := (select valor from crm_teste.ctx where chave = 'user_b');
    v_empresas bigint;
    v_vinculos bigint;
begin
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    select count(*) into v_empresas from public.empresas where id = v_tenant_b;
    select count(*) into v_vinculos from public.utilizadores_empresas where auth_uid = v_user_b;
    perform public.login_admin();

    perform public.assert(v_empresas = 0, 'usuário não enxerga empresa de outro tenant');
    perform public.assert(v_vinculos = 0, 'usuário não enxerga vínculo de outro usuário');
end $$;

-- ---------------------------------------------------------------------
-- TESTE 17: relatorio_rls() não encontra problema de isolamento
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
        raise notice 'Problemas críticos encontrados: %', v_detalhe;
    end if;

    perform public.assert(v_criticos = 0, 'relatorio_rls() não aponta problema CRÍTICO de isolamento');
end $$;

-- ---------------------------------------------------------------------
-- TESTE 18: provisionamento self-service cria tenant completo
-- ---------------------------------------------------------------------
do $$
declare
    v_novo_user uuid := gen_random_uuid();
    v_tenant uuid;
    v_pipelines bigint;
    v_stages bigint;
    v_motivos bigint;
    v_plano bigint;
begin
    insert into auth.users (id, email) values (v_novo_user, 'novo@empresa.com');

    perform public.login_como(v_novo_user, 'novo@empresa.com');
    v_tenant := public.provisionar_tenant('Empresa Nova Ltda', 'consultoria');
    perform public.login_admin();

    perform public.assert(v_tenant is not null, 'provisionar_tenant cria a empresa e devolve o id');

    select count(*) into v_pipelines from public.pipelines where tenant_id = v_tenant;
    select count(*) into v_stages from public.pipeline_stages where tenant_id = v_tenant;
    select count(*) into v_motivos from public.motivos_perda where tenant_id = v_tenant;
    select count(*) into v_plano from public.tenant_planos where tenant_id = v_tenant;

    perform public.assert(v_pipelines = 1, 'provisionamento cria 1 funil default');
    perform public.assert(v_stages = 6, 'provisionamento cria as 6 etapas default');
    perform public.assert(v_motivos >= 6, 'provisionamento cria os motivos de perda default');
    perform public.assert(v_plano = 1, 'provisionamento vincula o plano inicial');

    -- O novo usuário enxerga o próprio tenant
    perform public.login_como(v_novo_user, 'novo@empresa.com');
    perform public.assert(
        public.current_tenant_id() = v_tenant,
        'usuário provisionado passa a ter tenant resolvido'
    );
    perform public.login_admin();
end $$;

-- ---------------------------------------------------------------------
-- TESTE 19: provisionar_tenant é idempotente por usuário
-- ---------------------------------------------------------------------
do $$
declare
    v_user uuid := (select valor from crm_teste.ctx where chave = 'user_a');
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_retorno uuid;
    v_empresas_antes bigint;
    v_empresas_depois bigint;
begin
    select count(*) into v_empresas_antes from public.empresas;

    perform public.login_como(v_user, 'vendedor.a@teste.com');
    v_retorno := public.provisionar_tenant('Tentativa de segunda empresa');
    perform public.login_admin();

    select count(*) into v_empresas_depois from public.empresas;

    perform public.assert(v_retorno = v_tenant_a, 'usuário já vinculado recebe o tenant existente');
    perform public.assert(
        v_empresas_antes = v_empresas_depois,
        'provisionar_tenant não cria empresa duplicada para usuário já vinculado'
    );
end $$;

-- ---------------------------------------------------------------------
-- TESTE 20: superadmin enxerga todos os tenants
-- ---------------------------------------------------------------------
do $$
declare
    v_super uuid := gen_random_uuid();
    v_visiveis bigint;
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
begin
    insert into auth.users (id, email) values (v_super, 'super@polatto.com');
    insert into public.system_admins (email) values ('super@polatto.com');

    perform public.login_como(v_super, 'super@polatto.com');
    select count(*) into v_visiveis from public.negocios where tenant_id = v_tenant_b;
    perform public.login_admin();

    perform public.assert(v_visiveis > 0, 'superadmin (system_admins) enxerga dados de qualquer tenant');
end $$;

do $$
begin
    raise notice '';
    raise notice '===============================================';
    raise notice 'TODOS OS TESTES PASSARAM';
    raise notice '===============================================';
end $$;
