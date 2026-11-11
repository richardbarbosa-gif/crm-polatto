-- =====================================================================
-- TESTES DA MIGRATION 10 — endurecimento de segurança (auditoria 2026-11)
--
-- Para cada correção, DOIS lados:
--   (a) o ataque agora falha;
--   (b) o uso legítimo continua funcionando (lead, Kanban, agenda,
--       importação, troca de empresa, equipe, KPIs).
--
-- Executar DEPOIS de 01, 02 (virada para a view) e 03 — reaproveita os
-- tenants/usuários de crm_teste.ctx. Antes das asserções, recria no banco
-- o estado "produção suja" (policies dos scripts avulsos, view sem
-- security_invoker, bucket público) e reexecuta a migration 10 por cima,
-- que é exatamente o que vai acontecer em produção.
-- =====================================================================

\set ON_ERROR_STOP on

-- Sessão da chave PÚBLICA (anon), igual o PostgREST faz sem login
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

-- ---------------------------------------------------------------------
-- CENÁRIO: vendedor (não admin) no tenant A, dados do tenant B
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_vendedor uuid := gen_random_uuid();
begin
    insert into auth.users (id, email) values (v_vendedor, 'vendedor.comum.a@teste.com');
    insert into public.utilizadores_empresas (auth_uid, empresa_id, role)
    values (v_vendedor, v_tenant_a, 'vendedor');
    insert into crm_teste.ctx values ('vendedor_a', v_vendedor)
    on conflict (chave) do update set valor = excluded.valor;
end $$;

-- B cadastra um contato sigiloso pela view (fluxo normal da tela)
do $$
begin
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_b'), 'vendedor.b@teste.com');
    insert into public.clientes (nome, cpf_cnpj, telefone, email, status)
    values ('Contato Sigiloso do B', '529.982.247-25', '(21) 97777-0000', 'sigilo@empresa-b.com', 'Novo Lead');
    perform public.login_admin();
end $$;

-- ---------------------------------------------------------------------
-- PRODUÇÃO "SUJA": o que os scripts avulsos / ajustes manuais deixam
-- ---------------------------------------------------------------------
-- (1) policies do fix_rls_policy_recursion: auto-vínculo a qualquer empresa
create policy ue_insert on public.utilizadores_empresas
    for insert to authenticated with check (auth_uid = auth.uid());
create policy ue_update on public.utilizadores_empresas
    for update to authenticated using (auth_uid = auth.uid()) with check (auth_uid = auth.uid());

-- (2) tabelas do insights_schema / phase34 sem tenant e com using(true)
create table public.crm_employees (
    id uuid primary key default gen_random_uuid(),
    full_name text not null,
    email text unique,
    role text
);
alter table public.crm_employees enable row level security;
create policy crm_employees_authenticated_all on public.crm_employees
    for all to authenticated using (true) with check (true);
insert into public.crm_employees (full_name, email, role)
values ('Funcionário legado da Polatto', 'legado@polatto.com', 'gestor');

create table public.anexos_lead (
    id uuid primary key default gen_random_uuid(),
    lead_id text not null,
    nome_ficheiro text not null
);
alter table public.anexos_lead enable row level security;
create policy anexos_lead_authenticated_all on public.anexos_lead
    for all to authenticated using (true) with check (true);

-- (3) policy de storage "bucket inteiro" do phase34 + bucket público
create policy lead_files_select on storage.objects
    for select to authenticated using (bucket_id = 'lead-files');
update storage.buckets
set public = true, file_size_limit = 52428800, allowed_mime_types = null
where id = 'lead-files';

-- (4) view criada à mão sem security_invoker (roda como dono, ignora RLS)
create view public.vw_teste_definer as
    select id, tenant_id, titulo from public.negocios;

-- (5) RPCs antigas da equipe, que só existiam em produção e gravavam em
-- auth.users: a migration 18 as remove (provado na suíte 13).

-- (6) policy using(true) reaplicada numa tabela legada já isolada
create policy tarefas_authenticated_all on public.tarefas
    for all to authenticated using (true) with check (true);

-- Prova de que o estado sujo VAZA antes da migration 10 (o teste vale)
do $$
declare
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_vaza_view bigint;
    v_vaza_tarefa bigint;
begin
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    select count(*) into v_vaza_view from public.vw_teste_definer where tenant_id = v_tenant_b;
    select count(*) into v_vaza_tarefa from public.tarefas where tenant_id = v_tenant_b;
    perform public.login_admin();
    perform public.assert(v_vaza_view > 0 and v_vaza_tarefa > 0,
        'PRÉ-CONDIÇÃO: o estado sujo de produção vaza dados do tenant B (view definer e using(true))');
end $$;

-- Assinatura das funções da view ANTES de reaplicar a 10 (versão da 01,
-- que a virada acabou de reexecutar)
create temp table h_assinatura as
select p.proname::text as nome, md5(p.prosrc) as hash
from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
where ns.nspname = 'public'
  and p.proname in ('fn_clientes_view_insert', 'fn_clientes_view_update');

-- =====================================================================
-- APLICA A MIGRATION 10 POR CIMA (ordem real de produção)
-- =====================================================================
\ir ../migrations/2026-11-02_10_hardening_seguranca.sql

do $$
begin
    perform public.assert(
        (select count(*) from h_assinatura h
         join pg_proc p on p.proname = h.nome
         join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname = 'public'
         where md5(p.prosrc) = h.hash) = 2,
        'H0: migrations 01 e 10 carregam exatamente o mesmo corpo das funções da view clientes'
    );
end $$;

-- ---------------------------------------------------------------------
-- H1 — header x-tenant-id forjado não grava nem altera nada alheio
-- (e a agenda continua funcionando para o próprio tenant)
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_tarefa_b bigint;
    v_tarefa_a bigint;
    v_gravado uuid;
    v_afetados integer;
    v_concluida boolean;
begin
    select id into v_tarefa_b from public.tarefas where tenant_id = v_tenant_b limit 1;

    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com', v_tenant_b);
    -- ataque: grava com o header do B e tenta concluir a tarefa do B
    insert into public.tarefas (titulo, tipo, data_vencimento, tenant_id)
    values ('Visita agendada com header do B', 'visita', now() + interval '2 days', v_tenant_b)
    returning id, tenant_id into v_tarefa_a, v_gravado;
    update public.tarefas set concluido = true where id = v_tarefa_b;
    get diagnostics v_afetados = row_count;
    perform public.login_admin();

    perform public.assert(v_gravado = v_tenant_a, 'H1a: header x-tenant-id forjado — a tarefa nasce no tenant do usuário, não no alheio');
    perform public.assert(v_afetados = 0, 'H1a: header x-tenant-id forjado — não altera tarefa de outro tenant');
    perform public.assert(
        not coalesce((select concluido from public.tarefas where id = v_tarefa_b), false),
        'H1a: tarefa do tenant B permanece intacta'
    );

    -- uso legítimo da agenda: listar e concluir a própria tarefa
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    update public.tarefas set concluido = true where id = v_tarefa_a;
    select concluido into v_concluida from public.tarefas where id = v_tarefa_a;
    perform public.login_admin();
    perform public.assert(v_concluida, 'H1b: agenda — usuário conclui a própria tarefa normalmente');
end $$;

-- ---------------------------------------------------------------------
-- H2 — INSERT anônimo pela view clientes (chave pública)
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_bloqueou_grant boolean := false;
    v_bloqueou_trigger boolean := false;
    v_estado text;
begin
    -- camada 1: anon não tem mais privilégio na view
    perform public.login_anon();
    begin
        insert into public.clientes (tenant_id, nome, status) values (v_tenant_b, 'Spam anônimo', 'Novo Lead');
    exception when insufficient_privilege then
        v_bloqueou_grant := true;
    end;
    perform public.login_admin();
    perform public.assert(v_bloqueou_grant, 'H2a: anon não tem privilégio de escrita na view clientes');

    -- camada 2: mesmo que alguém devolva o GRANT, a trigger recusa
    grant insert on public.clientes to anon;
    perform public.login_anon();
    begin
        insert into public.clientes (tenant_id, nome, status) values (v_tenant_b, 'Spam anônimo', 'Novo Lead');
    exception when others then
        v_bloqueou_trigger := true;
        v_estado := sqlstate;
    end;
    perform public.login_admin();
    revoke insert on public.clientes from anon;

    perform public.assert(v_bloqueou_trigger and v_estado = '42501',
        'H2a: trigger da view recusa tenant_id vindo de requisição anônima (42501)');
    perform public.assert(
        not exists (select 1 from public.negocios where titulo = 'Spam anônimo'),
        'H2a: nenhum lead anônimo foi gravado no tenant B'
    );
end $$;

-- ---------------------------------------------------------------------
-- H3 — usuário logado SEM vínculo não grava lead no tenant que escolher
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_bloqueou boolean := false;
begin
    perform public.login_como(gen_random_uuid(), 'recem.cadastrado@teste.com', v_tenant_b);
    begin
        insert into public.clientes (tenant_id, nome, status) values (v_tenant_b, 'Lead injetado sem vínculo', 'Novo Lead');
    exception when others then
        v_bloqueou := true;
    end;
    perform public.login_admin();

    perform public.assert(v_bloqueou, 'H3a: usuário sem vínculo não consegue inserir lead informando tenant_id alheio');
    perform public.assert(
        not exists (select 1 from public.negocios where titulo = 'Lead injetado sem vínculo'),
        'H3a: nada foi gravado no tenant B'
    );
end $$;

-- ---------------------------------------------------------------------
-- H4 — usuário do A não se liga ao contato do B pela busca de duplicata
-- (e o cadastro de lead pela tela segue igual)
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_pessoa_b uuid;
    v_negocio record;
    v_tenant_pessoa uuid;
begin
    select id into v_pessoa_b from public.pessoas where email = 'sigilo@empresa-b.com' and tenant_id = (select valor from crm_teste.ctx where chave = 'tenant_b');

    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    insert into public.clientes (tenant_id, nome, email, cpf_cnpj, status)
    values (v_tenant_b, 'Lead do A com e-mail do B', 'sigilo@empresa-b.com', '000.000.000-00', 'Novo Lead');
    perform public.login_admin();

    select * into v_negocio from public.negocios where titulo = 'Lead do A com e-mail do B';
    select tenant_id into v_tenant_pessoa from public.pessoas where id = v_negocio.pessoa_contato_principal_id;

    perform public.assert(v_negocio.tenant_id = v_tenant_a, 'H4b: lead criado pela view nasce no tenant do usuário');
    perform public.assert(
        v_negocio.pessoa_contato_principal_id is distinct from v_pessoa_b and v_tenant_pessoa = v_tenant_a,
        'H4a: busca de duplicata não reaproveita contato de outro tenant'
    );
end $$;

-- ---------------------------------------------------------------------
-- H5 — fork-on-write não copia nem sobrescreve contato de outro tenant
-- (cenário: negócio do A apontado para a pessoa do B pelo uuid)
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_pessoa_b uuid;
    v_negocio_a uuid;
    v_pessoa_b_depois record;
    v_status text;
begin
    select id into v_pessoa_b from public.pessoas where email = 'sigilo@empresa-b.com' and tenant_id = (select valor from crm_teste.ctx where chave = 'tenant_b');
    update public.pessoas set cargo = 'Diretor Financeiro' where id = v_pessoa_b;

    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    insert into public.negocios (titulo, valor) values ('Negócio do A ligado ao contato do B', 10)
    returning id into v_negocio_a;
    -- adulteração direta pela API (o negócio é do A, então a RLS deixa)
    update public.negocios set pessoa_contato_principal_id = v_pessoa_b where id = v_negocio_a;
    -- o Kanban/edição passa pela view
    update public.clientes
    set status = 'Em Negociacao', nome = 'Nome sobrescrito pelo A', email = 'roubado@a.com', cpf_cnpj = null
    where id = v_negocio_a;
    perform public.login_admin();

    select * into v_pessoa_b_depois from public.pessoas where id = v_pessoa_b;
    select status into v_status from public.negocios where id = v_negocio_a;

    perform public.assert(
        v_pessoa_b_depois.nome = 'Contato Sigiloso do B' and v_pessoa_b_depois.email = 'sigilo@empresa-b.com',
        'H5a: update pela view não sobrescreve o contato de outro tenant'
    );
    perform public.assert(
        not exists (
            select 1 from public.pessoas
            where tenant_id = v_tenant_a
              and (cpf = '529.982.247-25' or cargo = 'Diretor Financeiro')
        ),
        'H5a: fork-on-write não copia CPF/cargo do contato de outro tenant'
    );
    perform public.assert(v_status = 'Em Negociacao', 'H5b: os campos do próprio negócio continuam sendo atualizados');
end $$;

-- ---------------------------------------------------------------------
-- H6 — fn_set_tenant_id: função SECURITY DEFINER chamada por usuário sem
-- vínculo não grava no tenant que ele escolher; contexto administrativo
-- e superadmin continuam podendo informar o tenant.
-- ---------------------------------------------------------------------
create or replace function crm_teste.inserir_negocio_definer(p_tenant uuid, p_titulo text)
returns uuid
language sql
security definer
set search_path = public
as $$
    insert into public.negocios (tenant_id, titulo) values (p_tenant, p_titulo) returning tenant_id;
$$;
grant usage on schema crm_teste to authenticated;
grant execute on function crm_teste.inserir_negocio_definer(uuid, text) to authenticated;

do $$
declare
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_super uuid := (select id from auth.users where email = 'super@polatto.com');
    v_bloqueou boolean := false;
    v_admin uuid;
    v_superadmin uuid;
begin
    perform public.login_como(gen_random_uuid(), 'sem.vinculo.definer@teste.com');
    begin
        perform crm_teste.inserir_negocio_definer(v_tenant_b, 'Injetado via definer');
    exception when others then
        v_bloqueou := true;
    end;
    perform public.login_admin();
    perform public.assert(v_bloqueou, 'H6a: usuário sem vínculo não usa função definer para gravar em tenant alheio');

    -- legítimo: SQL Editor/service_role (sem JWT)
    v_admin := crm_teste.inserir_negocio_definer(v_tenant_b, 'Criado pelo SQL Editor');
    perform public.assert(v_admin = v_tenant_b, 'H6b: contexto administrativo continua informando o tenant explicitamente');

    -- legítimo: superadmin sem vínculo
    perform public.login_como(v_super, 'super@polatto.com');
    v_superadmin := crm_teste.inserir_negocio_definer(v_tenant_b, 'Criado pelo superadmin');
    perform public.login_admin();
    perform public.assert(v_superadmin = v_tenant_b, 'H6b: superadmin sem vínculo continua informando o tenant');
end $$;

-- ---------------------------------------------------------------------
-- H7 — quem executa o quê
-- ---------------------------------------------------------------------
do $$
declare
    r record;
    v_falhas text := '';
begin
    for r in
        select p.oid::regprocedure::text as fn, p.proname::text as nome
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public'
          and p.proname in (
              'provisionar_defaults_tenant', 'migrar_clientes_para_negocios',
              'backfill_tenant_dados_legados', 'aplicar_rls_estrita_pipeline_stages',
              'backfill_tenant_legado', 'diagnostico_tenant_legado', 'aplicar_rls_legado',
              'aplicar_politica_retencao', 'limpar_erros_antigos', 'relatorio_rls',
              'testar_isolamento_tenant'
          )
    loop
        if has_function_privilege('anon', r.fn, 'execute') then
            v_falhas := v_falhas || ' anon:' || r.nome;
        end if;
        if has_function_privilege('authenticated', r.fn, 'execute') then
            v_falhas := v_falhas || ' authenticated:' || r.nome;
        end if;
        if not has_function_privilege('service_role', r.fn, 'execute') then
            v_falhas := v_falhas || ' sem-service_role:' || r.nome;
        end if;
    end loop;
    if v_falhas <> '' then raise notice 'Privilégios indevidos:%', v_falhas; end if;
    perform public.assert(v_falhas = '', 'H7a: funções administrativas só para postgres/service_role');

    v_falhas := '';
    for r in
        select p.oid::regprocedure::text as fn, p.proname::text as nome
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public'
          and p.proname in (
              'provisionar_tenant', 'log_acesso_titular', 'lgpd_exportar_dados_titular',
              'lgpd_apagar_dados_titular', 'get_tenant_segmento', 'uso_do_tenant',
              'restaurar_registro', 'registrar_erro_cliente', 'enforce_rate_limit',
              'eh_admin_do_tenant', 'equipe_preparar_criacao', 'equipe_concluir_criacao',
              'equipe_remover_membro'
          )
    loop
        if has_function_privilege('anon', r.fn, 'execute') then
            v_falhas := v_falhas || ' anon:' || r.nome;
        end if;
        if not has_function_privilege('authenticated', r.fn, 'execute') then
            v_falhas := v_falhas || ' sem-authenticated:' || r.nome;
        end if;
    end loop;
    if v_falhas <> '' then raise notice 'Privilégios incorretos:%', v_falhas; end if;
    perform public.assert(v_falhas = '', 'H7b: RPCs do app seguem liberadas para authenticated (inclusive as da equipe) e fechadas para anon');
end $$;

-- ataque concreto: reatribuir as etapas do B para um funil alheio
do $$
declare
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_antes text;
    v_depois text;
    v_bloqueou boolean := false;
begin
    select string_agg(coalesce(pipeline_id::text, '-'), ',' order by id) into v_antes
    from public.pipeline_stages where tenant_id = v_tenant_b;

    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    begin
        perform public.provisionar_defaults_tenant(v_tenant_b);
    exception when insufficient_privilege then
        v_bloqueou := true;
    end;
    perform public.login_admin();

    select string_agg(coalesce(pipeline_id::text, '-'), ',' order by id) into v_depois
    from public.pipeline_stages where tenant_id = v_tenant_b;

    perform public.assert(v_bloqueou, 'H7a: usuário logado não chama provisionar_defaults_tenant para outro tenant');
    perform public.assert(v_antes is not distinct from v_depois, 'H7a: funil do tenant B intacto');
end $$;

-- uso legítimo das RPCs pelo app
do $$
declare
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_segmento text;
    v_uso bigint;
    v_tenant uuid;
begin
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    v_segmento := public.get_tenant_segmento(v_tenant_a);
    select count(*) into v_uso from public.uso_do_tenant(v_tenant_a);
    v_tenant := public.provisionar_tenant('Nada muda para quem já tem empresa');
    perform public.login_admin();

    perform public.assert(v_segmento = 'energia_solar', 'H7b: get_tenant_segmento continua respondendo ao app');
    perform public.assert(v_uso = 3, 'H7b: uso_do_tenant continua respondendo ao app');
    perform public.assert(v_tenant = v_tenant_a, 'H7b: provisionar_tenant continua idempotente para quem já tem empresa');
end $$;

-- ---------------------------------------------------------------------
-- H8 — política de retenção: só admin configura; expurgo não é público
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_vendedor_bloqueado boolean := false;
    v_anon_bloqueado boolean := false;
    v_lidas bigint;
    v_dias integer;
begin
    -- ataque: vendedor tenta zerar a retenção do tenant
    perform public.login_como((select valor from crm_teste.ctx where chave = 'vendedor_a'), 'vendedor.comum.a@teste.com');
    begin
        insert into public.politicas_retencao (tenant_id, entidade, dias_retencao)
        values (v_tenant_a, 'negocio_inativo', 0);
    exception when others then
        v_vendedor_bloqueado := true;
    end;
    perform public.login_admin();

    -- ataque: disparar o expurgo com a chave pública
    perform public.login_anon();
    begin
        perform public.aplicar_politica_retencao();
    exception when insufficient_privilege then
        v_anon_bloqueado := true;
    end;
    perform public.login_admin();

    perform public.assert(v_vendedor_bloqueado, 'H8a: vendedor não configura política de retenção');
    perform public.assert(v_anon_bloqueado, 'H8a: anon não dispara aplicar_politica_retencao');

    -- legítimo: admin configura e ajusta; o tenant inteiro lê
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    insert into public.politicas_retencao (tenant_id, entidade, dias_retencao)
    values (v_tenant_a, 'negocio_perdido', 730);
    update public.politicas_retencao set dias_retencao = 1095
    where tenant_id = v_tenant_a and entidade = 'negocio_perdido';
    perform public.login_admin();

    perform public.login_como((select valor from crm_teste.ctx where chave = 'vendedor_a'), 'vendedor.comum.a@teste.com');
    select count(*) into v_lidas from public.politicas_retencao;
    perform public.login_admin();

    select dias_retencao into v_dias from public.politicas_retencao
    where tenant_id = v_tenant_a and entidade = 'negocio_perdido';

    perform public.assert(v_dias = 1095, 'H8b: admin do tenant configura e ajusta a retenção');
    perform public.assert(v_lidas = 1, 'H8b: vendedor continua lendo a política do próprio tenant');

    -- legítimo: rotina agendada (postgres/service_role) roda o expurgo
    perform public.aplicar_politica_retencao();
    perform public.assert(true, 'H8b: rotina agendada continua executando aplicar_politica_retencao');
end $$;

-- ---------------------------------------------------------------------
-- H9 — LGPD: anonimizar exige admin; exportar continua para o tenant e
-- não arrasta negócio de outro tenant
-- ---------------------------------------------------------------------
do $$
declare
    v_pessoa uuid;
    v_pessoa_b uuid;
    v_bloqueou boolean := false;
    v_estado text;
    v_export jsonb;
    v_export_b jsonb;
    v_nome text;
begin
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    insert into public.pessoas (nome, email, cpf) values ('Titular H9', 'titular.h9@teste.com', '11122233344')
    returning id into v_pessoa;
    perform public.login_admin();

    -- ataque: vendedor anonimiza (irreversível) pela API
    perform public.login_como((select valor from crm_teste.ctx where chave = 'vendedor_a'), 'vendedor.comum.a@teste.com');
    begin
        perform public.lgpd_apagar_dados_titular(v_pessoa);
    exception when others then
        v_bloqueou := true;
        v_estado := sqlstate;
    end;
    -- legítimo: vendedor exporta (portabilidade) — dados que ele já lê
    v_export := public.lgpd_exportar_dados_titular(v_pessoa);
    perform public.login_admin();

    select nome into v_nome from public.pessoas where id = v_pessoa;
    perform public.assert(v_bloqueou and v_estado = '42501', 'H9a: vendedor não anonimiza titular (42501)');
    perform public.assert(v_nome = 'Titular H9', 'H9a: titular segue intacto após a tentativa');
    perform public.assert(v_export -> 'pessoa' ->> 'nome' = 'Titular H9', 'H9b: vendedor continua exportando os dados do titular');

    -- legítimo: admin anonimiza
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    perform public.lgpd_apagar_dados_titular(v_pessoa);
    perform public.login_admin();
    select nome into v_nome from public.pessoas where id = v_pessoa;
    perform public.assert(v_nome = 'Titular removido (LGPD)', 'H9b: admin do tenant continua anonimizando');

    -- exportação do B não inclui o negócio do A que aponta para o contato do B
    select id into v_pessoa_b from public.pessoas where email = 'sigilo@empresa-b.com' and tenant_id = (select valor from crm_teste.ctx where chave = 'tenant_b');
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_b'), 'vendedor.b@teste.com');
    v_export_b := public.lgpd_exportar_dados_titular(v_pessoa_b);
    perform public.login_admin();

    perform public.assert(
        not (v_export_b::text like '%Negócio do A ligado ao contato do B%'),
        'H9a: exportação LGPD não inclui negócio de outro tenant'
    );
    perform public.assert(
        jsonb_array_length(v_export_b -> 'negocios') >= 1,
        'H9b: exportação LGPD inclui os negócios do próprio tenant'
    );
end $$;

-- ---------------------------------------------------------------------
-- H10 — tenant_features: tenant lê, só a plataforma liga
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_super uuid := (select id from auth.users where email = 'super@polatto.com');
    v_bloqueou boolean := false;
    v_lidas bigint;
begin
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    begin
        insert into public.tenant_features (tenant_id, feature_key, enabled) values (v_tenant_a, 'recurso_pago', true);
    exception when others then
        v_bloqueou := true;
    end;
    perform public.login_admin();
    perform public.assert(v_bloqueou, 'H10a: membro do tenant não liga feature flag por conta própria');

    perform public.login_como(v_super, 'super@polatto.com');
    insert into public.tenant_features (tenant_id, feature_key, enabled) values (v_tenant_a, 'negocios_v2', true);
    perform public.login_admin();

    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    select count(*) into v_lidas from public.tenant_features where feature_key = 'negocios_v2' and enabled;
    perform public.login_admin();
    perform public.assert(v_lidas = 1, 'H10b: superadmin liga a flag e o tenant enxerga');
end $$;

-- ---------------------------------------------------------------------
-- H11 — monitoramento de erros sem token na URL e com teto de contexto
-- ---------------------------------------------------------------------
do $$
declare
    v_linha record;
    v_bloqueou_anon boolean := false;
begin
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    perform public.registrar_erro_cliente(
        'erro de teste hardening',
        'Error: x\n at y',
        'https://crm.exemplo.com/update-password?email=a@b.com#access_token=TOKEN_SECRETO&refresh_token=REFRESH_SECRETO',
        'Mozilla/5.0',
        'window.onerror',
        jsonb_build_object('lixo', repeat('x', 20000))
    );
    perform public.login_admin();

    select * into v_linha from public.client_errors where mensagem = 'erro de teste hardening';

    perform public.assert(v_linha.id is not null, 'H11b: erro do app continua sendo registrado');
    perform public.assert(v_linha.url = 'https://crm.exemplo.com/update-password', 'H11a: URL gravada sem query nem hash');
    perform public.assert(
        not (to_jsonb(v_linha)::text like '%SECRETO%'),
        'H11a: nenhum token do link de recuperação chega em client_errors'
    );
    perform public.assert(octet_length(v_linha.contexto::text) < 8192, 'H11a: contexto gigante é descartado');

    perform public.login_anon();
    begin
        perform public.registrar_erro_cliente('spam anônimo');
    exception when insufficient_privilege then
        v_bloqueou_anon := true;
    end;
    perform public.login_admin();
    perform public.assert(v_bloqueou_anon, 'H11a: chave pública não escreve em client_errors');
end $$;

-- ---------------------------------------------------------------------
-- H12 — provisionar_tenant não toma funcionário de outro tenant
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_novo uuid := gen_random_uuid();
    v_tenant_novo uuid;
    v_tenant_func uuid;
    v_pipelines bigint;
begin
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_b'), 'vendedor.b@teste.com');
    insert into public.funcionarios (nome, email, cargo) values ('Funcionária do B', 'disputado@teste.com', 'vendedor');
    perform public.login_admin();

    -- o atacante se cadastra com o e-mail da funcionária do B
    insert into auth.users (id, email) values (v_novo, 'disputado@teste.com');
    perform public.login_como(v_novo, 'disputado@teste.com');
    v_tenant_novo := public.provisionar_tenant('Empresa do Atacante');
    perform public.login_admin();

    select tenant_id into v_tenant_func from public.funcionarios where email = 'disputado@teste.com';
    select count(*) into v_pipelines from public.pipelines where tenant_id = v_tenant_novo;

    perform public.assert(v_tenant_func = v_tenant_b, 'H12a: funcionário do tenant B não muda de empresa');
    perform public.assert(v_tenant_novo is not null and v_tenant_novo <> v_tenant_b and v_pipelines = 1,
        'H12b: onboarding self-service continua criando a empresa completa');
end $$;

-- ---------------------------------------------------------------------
-- H13 — restos de produção: vínculos, tabelas avulsas, storage, views
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_user_a uuid := (select valor from crm_teste.ctx where chave = 'user_a');
    v_super uuid := (select id from auth.users where email = 'super@polatto.com');
    v_insert_bloqueado boolean := false;
    v_afetados integer;
    v_proprios bigint;
    v_crm_a bigint;
    v_crm_super bigint;
    v_anexo_bloqueado boolean := false;
    v_arquivos_b bigint;
    v_arquivos_a bigint;
    v_view_b bigint;
    v_view_a bigint;
    v_anon_view boolean := false;
    v_bucket record;
begin
    perform public.assert(
        not exists (select 1 from pg_policies where tablename = 'utilizadores_empresas' and policyname in ('ue_insert', 'ue_update')),
        'H13a: policies de auto-vínculo do script avulso foram removidas'
    );

    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    begin
        insert into public.utilizadores_empresas (auth_uid, empresa_id, role) values (v_user_a, v_tenant_b, 'admin');
    exception when others then
        v_insert_bloqueado := true;
    end;
    update public.utilizadores_empresas set empresa_id = v_tenant_b, role = 'admin' where auth_uid = v_user_a;
    get diagnostics v_afetados = row_count;
    -- só a linha do próprio usuário: colegas do mesmo tenant também são
    -- visíveis (tela de equipe), o que o H17 cobre separadamente
    select count(*) into v_proprios from public.utilizadores_empresas where auth_uid = v_user_a;
    perform public.login_admin();

    perform public.assert(v_insert_bloqueado, 'H13a: usuário não se vincula a empresa alheia');
    perform public.assert(v_afetados = 0, 'H13a: usuário não move o próprio vínculo para empresa alheia');
    perform public.assert(
        (select empresa_id from public.utilizadores_empresas where auth_uid = v_user_a) = v_tenant_a,
        'H13a: vínculo do usuário segue na empresa original'
    );
    perform public.assert(v_proprios = 1, 'H13b: usuário continua lendo o próprio vínculo (seletor de empresa)');

    -- tabelas avulsas sem tenant
    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    select count(*) into v_crm_a from public.crm_employees;
    begin
        insert into public.anexos_lead (lead_id, nome_ficheiro) values ('1', 'x.pdf');
    exception when others then
        v_anexo_bloqueado := true;
    end;
    perform public.login_admin();
    perform public.login_como(v_super, 'super@polatto.com');
    select count(*) into v_crm_super from public.crm_employees;
    perform public.login_admin();

    perform public.assert(v_crm_a = 0, 'H13a: crm_employees (sem tenant) não vaza para usuário de tenant');
    perform public.assert(v_anexo_bloqueado, 'H13a: anexos_lead (sem tenant) não aceita escrita de usuário de tenant');
    perform public.assert(v_crm_super = 1, 'H13b: superadmin mantém acesso aos dados legados (nada foi apagado)');

    -- storage
    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    select count(*) into v_arquivos_b from storage.objects where bucket_id = 'lead-files' and name like v_tenant_b::text || '/%';
    select count(*) into v_arquivos_a from storage.objects where bucket_id = 'lead-files' and name like v_tenant_a::text || '/%';
    perform public.login_admin();
    select * into v_bucket from storage.buckets where id = 'lead-files';

    perform public.assert(
        not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'lead_files_select'),
        'H13a: policy de storage "bucket inteiro" removida'
    );
    perform public.assert(v_arquivos_b = 0, 'H13a: Storage — usuário A não lista arquivos do tenant B');
    perform public.assert(v_arquivos_a > 0, 'H13b: Storage — usuário A continua vendo os próprios arquivos');
    perform public.assert(
        v_bucket.public = false and v_bucket.file_size_limit = 10485760
        and v_bucket.allowed_mime_types = array['application/pdf'],
        'H13a: bucket lead-files privado, só PDF, até 10 MB'
    );

    -- view criada à mão
    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    select count(*) into v_view_b from public.vw_teste_definer where tenant_id = v_tenant_b;
    select count(*) into v_view_a from public.vw_teste_definer where tenant_id = v_tenant_a;
    perform public.login_admin();
    perform public.login_anon();
    begin
        perform 1 from public.vw_teste_definer limit 1;
    exception when insufficient_privilege then
        v_anon_view := true;
    end;
    perform public.login_admin();

    perform public.assert(v_view_b = 0, 'H13a: view sem security_invoker foi corrigida e não vaza o tenant B');
    perform public.assert(v_view_a > 0, 'H13b: a mesma view continua mostrando os dados do próprio tenant');
    perform public.assert(v_anon_view, 'H13a: anon não lê views');

    -- using(true) reaplicada em tabela legada isolada
    perform public.assert(
        not exists (select 1 from pg_policies where tablename = 'tarefas' and policyname = 'tarefas_authenticated_all'),
        'H13a: policy using(true) reaplicada em tarefas foi removida'
    );
end $$;

-- ---------------------------------------------------------------------
-- H14 — invariantes que já estavam certas (prova explícita)
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_id_a uuid;
    v_id_b uuid;
    v_restaurou boolean;
    v_audit_afetados integer;
    v_audit_insert boolean := false;
begin
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    insert into public.negocios (titulo) values ('Negócio imutável do A') returning id into v_id_a;
    begin
        update public.negocios set tenant_id = v_tenant_b where id = v_id_a;
    exception when others then
        null; -- esperado: a policy (WITH CHECK) recusa a nova linha
    end;
    -- pela view, tenant_id é ignorado
    update public.clientes set tenant_id = v_tenant_b where id = v_id_a;
    perform public.login_admin();
    perform public.assert(
        (select tenant_id from public.negocios where id = v_id_a) = v_tenant_a,
        'H14: tenant_id é imutável para o usuário (tabela e view)'
    );

    -- soft delete de outro tenant não é restaurável
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_b'), 'vendedor.b@teste.com');
    insert into public.negocios (titulo) values ('Excluído do B') returning id into v_id_b;
    update public.negocios set deleted_at = now() where id = v_id_b;
    perform public.login_admin();
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    v_restaurou := public.restaurar_registro('negocios', v_id_b::text);
    perform public.login_admin();
    perform public.assert(
        not v_restaurou and (select deleted_at from public.negocios where id = v_id_b) is not null,
        'H14: soft delete de outro tenant não pode ser restaurado'
    );

    -- audit_log imutável para usuário comum
    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com');
    update public.audit_log set dados_depois = '{}'::jsonb where tenant_id = v_tenant_a;
    get diagnostics v_audit_afetados = row_count;
    delete from public.audit_log where tenant_id = v_tenant_a;
    begin
        insert into public.audit_log (tenant_id, tabela, operacao) values (v_tenant_a, 'forjado', 'INSERT');
    exception when others then
        v_audit_insert := true;
    end;
    perform public.login_admin();
    perform public.assert(v_audit_afetados = 0, 'H14: usuário não altera o audit_log');
    perform public.assert(
        exists (select 1 from public.audit_log where tenant_id = v_tenant_a),
        'H14: usuário não apaga o audit_log'
    );
    perform public.assert(v_audit_insert, 'H14: usuário não forja linha no audit_log');
end $$;

-- ---------------------------------------------------------------------
-- H15 — FLUXOS LEGÍTIMOS DO APP, ponta a ponta, depois do endurecimento
-- ---------------------------------------------------------------------
do $$
declare
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_stage bigint;
    v_id uuid;
    v_lido record;
    v_timeline bigint;
    v_importados bigint;
    v_kpi bigint;
    v_kpi_b bigint;
    v_func uuid;
    v_meta_tenant uuid;
begin
    select id into v_stage from public.pipeline_stages
    where tenant_id = v_tenant_a order by ordem limit 1;
    if v_stage is null then
        insert into public.pipeline_stages (tenant_id, nome, cor, ordem)
        values (v_tenant_a, 'Etapa H15', '#5d9cec', 1)
        returning id into v_stage;
    end if;

    perform public.login_como((select valor from crm_teste.ctx where chave = 'user_a'), 'vendedor.a@teste.com', v_tenant_a);

    -- criar lead (tela "Nova oportunidade" manda o tenant_id selecionado)
    insert into public.clientes (tenant_id, nome, telefone, email, valor, status)
    values (v_tenant_a, 'Fluxo Legítimo', '(11) 95555-0000', 'fluxo@cliente.com', 5000, 'Novo Lead')
    returning id into v_id;

    -- ler, editar e mover no Kanban
    select * into v_lido from public.clientes where id = v_id;
    update public.clientes set nome = 'Fluxo Legítimo Editado', valor = 6000 where id = v_id;
    update public.clientes set stage_id = v_stage, status = 'Contato Feito' where id = v_id;

    -- importação em lote (CSV) pela mesma view
    insert into public.clientes (tenant_id, nome, telefone, status) values
        (v_tenant_a, 'Importado 1', '(11) 90000-0001', 'Novo Lead'),
        (v_tenant_a, 'Importado 2', '(11) 90000-0002', 'Novo Lead'),
        (v_tenant_a, 'Importado 3', '(11) 90000-0003', 'Novo Lead');

    -- KPIs do Kanban/dashboard
    select count(*) into v_kpi from public.vw_kanban_kpis;
    select count(*) into v_kpi_b from public.vw_kanban_kpis where tenant_id <> v_tenant_a;

    -- equipe: o que a tela faz depois do criar_usuario_equipe (funcionário + meta)
    insert into public.funcionarios (nome, email, cargo) values ('Novo Vendedor A', 'novo.vendedor.a@teste.com', 'vendedor')
    returning id into v_func;
    insert into public.metas (funcionario_id, valor_meta, tenant_id) values (v_func, 10000, v_tenant_a)
    returning tenant_id into v_meta_tenant;
    perform public.login_admin();

    select count(*) into v_timeline from public.atividades_lead
    where cliente_id = v_id::text and tenant_id = v_tenant_a;
    select count(*) into v_importados from public.negocios
    where tenant_id = v_tenant_a and titulo like 'Importado %';

    perform public.assert(v_lido.id is not null and v_lido.tenant_id = v_tenant_a, 'H15: lead criado e lido pela view no próprio tenant');
    perform public.assert(
        (select nome from public.clientes where id = v_id) = 'Fluxo Legítimo Editado'
        and (select valor from public.clientes where id = v_id) = 6000,
        'H15: edição do lead persiste'
    );
    perform public.assert(
        (select stage_id from public.negocios where id = v_id) = v_stage,
        'H15: Kanban move a etapa'
    );
    perform public.assert(v_timeline >= 1, 'H15: mover etapa registra a timeline no tenant certo');
    perform public.assert(v_importados = 3, 'H15: importação em lote grava todos os leads no tenant');
    perform public.assert(v_kpi > 0 and v_kpi_b = 0, 'H15: vw_kanban_kpis traz os números do próprio tenant e só dele');
    perform public.assert(v_meta_tenant = v_tenant_a, 'H15: equipe — funcionário e meta gravados no tenant do admin');
end $$;

-- troca de empresa (usuário em duas empresas) continua valendo na view
do $$
declare
    v_user uuid := (select valor from crm_teste.ctx where chave = 'multi_user');
    v_emp1 uuid := (select valor from crm_teste.ctx where chave = 'multi_emp1');
    v_emp2 uuid := (select valor from crm_teste.ctx where chave = 'multi_emp2');
    v_t1 uuid;
    v_t2 uuid;
    v_perf bigint;
begin
    perform public.login_como(v_user, 'multi@teste.com', v_emp2);
    insert into public.clientes (tenant_id, nome, status) values (v_emp2, 'Lead com Empresa 2 ativa', 'Novo Lead');
    perform public.login_admin();
    perform public.login_como(v_user, 'multi@teste.com', v_emp1);
    insert into public.clientes (tenant_id, nome, status) values (v_emp1, 'Lead com Empresa 1 ativa', 'Novo Lead');
    select count(*) into v_perf from public.vw_performance_vendedores;
    perform public.login_admin();

    select tenant_id into v_t2 from public.negocios where titulo = 'Lead com Empresa 2 ativa';
    select tenant_id into v_t1 from public.negocios where titulo = 'Lead com Empresa 1 ativa';

    perform public.assert(v_t2 = v_emp2 and v_t1 = v_emp1, 'H15: troca de empresa — o lead nasce na empresa selecionada');
    perform public.assert(v_perf >= 0, 'H15: vw_performance_vendedores segue consultável');
end $$;

-- ---------------------------------------------------------------------
-- H16 — o linter de RLS fica limpo depois da migration 10
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
        raise notice 'Críticos: %', v_detalhe;
    end if;
    perform public.assert(v_criticos = 0, 'H16: relatorio_rls() sem problema CRÍTICO após a migration 10');
end $$;

-- ---------------------------------------------------------------------
-- H17 — seletor de empresa e tela de equipe enxergam o que precisam,
-- e só isso. A policy antiga de empresas liberava só o tenant ATIVO (o
-- seletor de quem tem 2 empresas mostrava 1 nome) e a de vínculos só a
-- linha do próprio usuário (a equipe não sabia quem tem login).
-- ---------------------------------------------------------------------
do $$
declare
    v_multi uuid := (select valor from crm_teste.ctx where chave = 'multi_user');
    v_emp1 uuid := (select valor from crm_teste.ctx where chave = 'multi_emp1');
    v_emp2 uuid := (select valor from crm_teste.ctx where chave = 'multi_emp2');
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    v_user_a uuid := (select valor from crm_teste.ctx where chave = 'user_a');
    v_vendedor uuid := (select valor from crm_teste.ctx where chave = 'vendedor_a');
    v_nomes_multi bigint;
    v_alheias_multi bigint;
    v_colegas_a bigint;
    v_vinculos_b bigint;
    v_vinculos_b_forjado bigint;
    v_empresa_b_forjado bigint;
    v_vinculos_anon bigint;
    v_empresas_anon bigint;
begin
    -- (b) quem tem duas empresas lê o nome das duas, com qualquer uma ativa
    perform public.login_como(v_multi, 'multi@teste.com', v_emp1);
    select count(*) into v_nomes_multi from public.empresas where id in (v_emp1, v_emp2);
    select count(*) into v_alheias_multi from public.empresas where id not in (v_emp1, v_emp2);
    perform public.login_admin();

    -- (b) o vendedor do A vê os vínculos da própria empresa (colegas)
    perform public.login_como(v_vendedor, 'vendedor.comum.a@teste.com');
    select count(*) into v_colegas_a from public.utilizadores_empresas where empresa_id = v_tenant_a;
    -- (a) e nenhum vínculo do B, nem forjando o header para o B
    select count(*) into v_vinculos_b from public.utilizadores_empresas where empresa_id = v_tenant_b;
    perform public.login_admin();
    perform public.login_como(v_vendedor, 'vendedor.comum.a@teste.com', v_tenant_b);
    select count(*) into v_vinculos_b_forjado from public.utilizadores_empresas where empresa_id = v_tenant_b;
    select count(*) into v_empresa_b_forjado from public.empresas where id = v_tenant_b;
    perform public.login_admin();

    -- (a) a chave pública não lê nada
    perform public.login_anon();
    select count(*) into v_vinculos_anon from public.utilizadores_empresas;
    select count(*) into v_empresas_anon from public.empresas;
    perform public.login_admin();

    perform public.assert(v_nomes_multi = 2, 'H17b: seletor — usuário de 2 empresas lê o nome das duas');
    perform public.assert(v_alheias_multi = 0, 'H17a: seletor — e nenhuma empresa da qual não participa');
    perform public.assert(v_colegas_a >= 2, 'H17b: equipe — membro lê os vínculos da própria empresa (quem tem login)');
    perform public.assert(v_vinculos_b = 0, 'H17a: equipe — membro do A não lê vínculos do B');
    perform public.assert(v_vinculos_b_forjado = 0 and v_empresa_b_forjado = 0,
        'H17a: header x-tenant-id forjado para o B não abre vínculos nem a empresa do B');
    perform public.assert(v_vinculos_anon = 0 and v_empresas_anon = 0, 'H17a: anon não lê vínculos nem empresas');
end $$;

do $$
begin
    raise notice '';
    raise notice '===============================================';
    raise notice 'ENDURECIMENTO DE SEGURANÇA (MIGRATION 10) VALIDADO';
    raise notice '===============================================';
end $$;
