-- =====================================================================
-- CRM Polatto — Migration 18: equipe sem tocar em auth.users, cadastro
-- de empresas fechado por padrão, histórico inviolável e RLS que usa
-- índice. (Auditoria 2026-11-10: P1-01, P1-03, P2-01, P2-02.)
--
--   1. EQUIPE (P1-01). As RPCs antigas criar_usuario_equipe /
--      excluir_usuario_equipe gravavam direto em auth.users e
--      auth.identities (tabelas internas do Supabase Auth, sem contrato
--      de compatibilidade). Somem. O login passa a ser criado/apagado
--      pela API de administração do Auth, dentro da Edge Function
--      `equipe-usuarios` (supabase/functions). O banco só valida e grava
--      o que é dele (funcionário + vínculo):
--        equipe_preparar_criacao  — valida ANTES de existir login
--        equipe_concluir_criacao  — liga o login recém-criado à empresa
--        equipe_remover_membro    — desfaz vínculo; diz se o login sobra
--   2. CADASTRO DE EMPRESAS (P1-03). plataforma_config.cadastro_aberto,
--      FALSE por padrão: a API pública não cria empresa nova enquanto o
--      operador não abrir (superadmin e SQL Editor continuam podendo).
--   3. HISTÓRICO (P2-01). cliente_status_history: a API só lê (quem
--      escreve é o trigger de mudança de etapa). atividades_lead: o autor
--      é carimbado pelo banco; linha do sistema é imutável; linha manual
--      só é alterada/apagada pelo autor ou pelo gerente.
--   4. RLS (P2-02). otimizar_policies_rls(): reescreve toda policy que
--      chama tenant_filter(tenant_id) — função SECURITY DEFINER avaliada
--      LINHA A LINHA e que esconde a coluna do planejador — para
--      `tenant_id = (select current_tenant_id())`, avaliado uma vez por
--      consulta e que usa o índice de tenant_id. Mesma regra de acesso.
--      Também separa os pares "leitura + escrita FOR ALL", que faziam o
--      SELECT avaliar duas policies.
--
-- Idempotente. RODAR SEMPRE POR ÚLTIMO: se qualquer migration anterior
-- for reexecutada, ela recria as policies no formato antigo — rode a 18
-- de novo (ou só `select public.otimizar_policies_rls();`).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. EQUIPE
-- ---------------------------------------------------------------------
-- Restos da geração anterior (em produção e em bancos que rodaram a 12
-- antiga). Sem elas, nada no schema public escreve em auth.*.
drop function if exists public.criar_usuario_equipe(text, text, text, text, text);
drop function if exists public.excluir_usuario_equipe(uuid);

-- Funcionário desta empresa com o mesmo e-mail que pode receber o login:
-- ainda sem acesso (cadastrado só como membro) ou removido (lixeira).
-- Devolve: o id reaproveitável, NULL se não há linha com esse e-mail, ou
-- levanta 'P0001' se o e-mail pertence a quem já tem login / outra empresa.
create or replace function public.equipe_funcionario_reaproveitavel(p_tenant uuid, p_email text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_id uuid;
    v_tenant uuid;
    v_user uuid;
    v_deleted timestamptz;
begin
    select f.id, f.tenant_id, f.user_id, f.deleted_at
      into v_id, v_tenant, v_user, v_deleted
    from public.funcionarios f
    where lower(f.email) = lower(p_email)
    limit 1;

    if v_id is null then
        return null;
    end if;
    if v_tenant is distinct from p_tenant or (v_deleted is null and v_user is not null) then
        raise exception 'Este e-mail já está cadastrado na equipe.' using errcode = 'P0001';
    end if;
    return v_id;
end;
$$;

create or replace function public.equipe_preparar_criacao(p_email text, p_nome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_email text := lower(btrim(coalesce(p_email, '')));
    v_nome text := btrim(coalesce(p_nome, ''));
begin
    if auth.uid() is null then
        return jsonb_build_object('success', false, 'error', 'Faça login para continuar.');
    end if;
    if v_tenant is null or not public.eh_admin_do_tenant(v_tenant) then
        return jsonb_build_object('success', false, 'error', 'Somente o gerente da empresa pode cadastrar usuários.');
    end if;
    if v_nome = '' then
        return jsonb_build_object('success', false, 'error', 'Informe o nome.');
    end if;
    if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        return jsonb_build_object('success', false, 'error', 'E-mail inválido.');
    end if;
    if exists (select 1 from auth.users u where lower(u.email) = v_email) then
        return jsonb_build_object('success', false, 'error', 'Este e-mail já possui conta.');
    end if;

    begin
        perform public.equipe_funcionario_reaproveitavel(v_tenant, v_email);
    exception when sqlstate 'P0001' then
        return jsonb_build_object('success', false, 'error', sqlerrm);
    end;

    -- Só conta a tentativa que passou em todas as validações.
    begin
        perform public.enforce_rate_limit('criar_usuario_equipe', 20, interval '1 hour');
    exception when sqlstate 'P0001' then
        return jsonb_build_object('success', false, 'error', 'Muitos cadastros em pouco tempo. Tente novamente mais tarde.');
    end;

    return jsonb_build_object('success', true, 'tenant_id', v_tenant, 'email', v_email);
end;
$$;

comment on function public.equipe_preparar_criacao(text, text) is 'Passo 1 do cadastro de membro (chamado pela Edge Function equipe-usuarios com o JWT do gerente): valida gerente, empresa ativa, e-mail e limite ANTES de o login existir.';

-- Passo 2: o login JÁ foi criado pela Edge Function (API de administração
-- do Auth). Só aceita um login que a própria função acabou de criar PARA
-- ESTA empresa e POR ESTE gerente: a marca fica em raw_app_meta_data, que
-- só a service_role escreve. Sem isso um gerente poderia chamar a RPC na
-- mão e puxar qualquer conta existente para a empresa dele.
create or replace function public.equipe_concluir_criacao(
    p_user_id uuid,
    p_nome text,
    p_cargo text default null,
    p_role text default 'vendedor'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_nome text := btrim(coalesce(p_nome, ''));
    v_papel text := public.normalizar_papel(p_role);
    v_cargo text;
    v_email text;
    v_marca jsonb;
    v_criado_em timestamptz;
    v_func_antigo uuid;
begin
    if auth.uid() is null then
        return jsonb_build_object('success', false, 'error', 'Faça login para continuar.');
    end if;
    if v_tenant is null or not public.eh_admin_do_tenant(v_tenant) then
        return jsonb_build_object('success', false, 'error', 'Somente o gerente da empresa pode cadastrar usuários.');
    end if;
    if v_nome = '' then
        return jsonb_build_object('success', false, 'error', 'Informe o nome.');
    end if;

    select lower(u.email), coalesce(u.raw_app_meta_data, '{}'::jsonb), u.created_at
      into v_email, v_marca, v_criado_em
    from auth.users u
    where u.id = p_user_id;

    if v_email is null
       or v_marca ->> 'crm_equipe_tenant' is distinct from v_tenant::text
       or v_marca ->> 'crm_equipe_criado_por' is distinct from auth.uid()::text
       or v_criado_em is null
       or v_criado_em < now() - interval '10 minutes'
       or exists (select 1 from public.utilizadores_empresas ue where ue.auth_uid = p_user_id)
    then
        return jsonb_build_object('success', false, 'error', 'Cadastro inválido ou expirado. Tente novamente.');
    end if;

    begin
        v_func_antigo := public.equipe_funcionario_reaproveitavel(v_tenant, v_email);
    exception when sqlstate 'P0001' then
        return jsonb_build_object('success', false, 'error', sqlerrm);
    end;

    v_cargo := coalesce(nullif(btrim(p_cargo), ''), initcap(v_papel));

    -- Subtransação: se o limite do plano (trigger) ou qualquer constraint
    -- recusar, nada fica pela metade e a Edge Function apaga o login.
    begin
        if v_func_antigo is not null then
            update public.funcionarios
            set user_id = p_user_id, nome = v_nome, cargo = v_cargo, ativo = true, deleted_at = null
            where id = v_func_antigo;
        else
            insert into public.funcionarios (id, user_id, nome, email, cargo, ativo, tenant_id)
            values (p_user_id, p_user_id, v_nome, v_email, v_cargo, true, v_tenant);
        end if;

        insert into public.utilizadores_empresas (auth_uid, empresa_id, role)
        values (p_user_id, v_tenant, v_papel);
    exception
        when sqlstate 'P0001' then
            -- Mensagens de regra de negócio (ex.: limite de usuários do plano).
            return jsonb_build_object('success', false, 'error', sqlerrm);
        when others then
            raise warning 'equipe_concluir_criacao: % (%)', sqlerrm, sqlstate;
            return jsonb_build_object('success', false, 'error', 'Não foi possível concluir o cadastro do membro.');
    end;

    return jsonb_build_object(
        'success', true,
        'user_id', coalesce(v_func_antigo, p_user_id),
        'tenant_id', v_tenant,
        'message', 'Usuário criado. Ele já pode entrar com o e-mail e a senha informados.'
    );
end;
$$;

comment on function public.equipe_concluir_criacao(uuid, text, text, text) is 'Passo 2 do cadastro de membro: liga o login recém-criado pela Edge Function (marcado em app_metadata para ESTA empresa e ESTE gerente) ao funcionário e ao vínculo. Papel limitado a gerente/vendedor.';

-- Remoção: tudo o que é do schema public. `apagar_login` diz à Edge
-- Function se a conta ficou sem nenhuma empresa (ela confere de novo com
-- a service_role antes de apagar pelo Auth).
create or replace function public.equipe_remover_membro(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_nome text;
    v_email text;
    v_tinha_vinculo boolean;
begin
    if auth.uid() is null or v_tenant is null or not public.eh_admin_do_tenant(v_tenant) then
        return jsonb_build_object('success', false, 'error', 'Somente o gerente da empresa pode remover membros.');
    end if;
    if p_user_id is null or p_user_id = auth.uid() then
        return jsonb_build_object('success', false, 'error', 'Você não pode remover a si mesmo.');
    end if;

    select f.nome, lower(f.email) into v_nome, v_email
    from public.funcionarios f
    where (f.id = p_user_id or f.user_id = p_user_id)
      and f.tenant_id = v_tenant
    limit 1;

    v_tinha_vinculo := exists (
        select 1 from public.utilizadores_empresas ue
        where ue.auth_uid = p_user_id and ue.empresa_id = v_tenant
    );

    if v_nome is null and not v_tinha_vinculo then
        return jsonb_build_object('success', false, 'error', 'Membro não encontrado nesta empresa.');
    end if;

    if exists (select 1 from public.system_admins sa where lower(sa.email) = v_email) then
        return jsonb_build_object('success', false, 'error', 'Administradores da plataforma não podem ser removidos por aqui.');
    end if;

    -- A empresa nunca fica sem gerente
    if exists (
        select 1 from public.utilizadores_empresas ue
        where ue.auth_uid = p_user_id and ue.empresa_id = v_tenant
          and public.normalizar_papel(ue.role) = 'gerente'
    ) and not exists (
        select 1 from public.utilizadores_empresas ue
        where ue.empresa_id = v_tenant and ue.auth_uid <> p_user_id
          and public.normalizar_papel(ue.role) = 'gerente'
    ) then
        return jsonb_build_object('success', false, 'error', 'A empresa precisa de pelo menos um gerente.');
    end if;

    delete from public.utilizadores_empresas
    where auth_uid = p_user_id and empresa_id = v_tenant;

    -- Funcionário vai para a lixeira (relatórios mantêm o nome)
    update public.funcionarios
    set ativo = false, deleted_at = coalesce(deleted_at, now())
    where (id = p_user_id or user_id = p_user_id) and tenant_id = v_tenant;

    return jsonb_build_object(
        'success', true,
        'message', coalesce(v_nome, 'Membro') || ' removido da equipe.',
        -- Só quem TINHA login nesta empresa e ficou sem nenhuma outra.
        'apagar_login', v_tinha_vinculo and not exists (
            select 1 from public.utilizadores_empresas ue where ue.auth_uid = p_user_id
        )
    );
end;
$$;

comment on function public.equipe_remover_membro(uuid) is 'Gerente remove um membro da empresa ATIVA: desfaz o vínculo e manda o funcionário para a lixeira. apagar_login=true quando a conta ficou sem empresa (a Edge Function equipe-usuarios apaga o login pelo Auth).';

do $$
declare
    r record;
begin
    for r in
        select p.oid::regprocedure as fn, p.proname
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public'
          and p.proname in ('equipe_preparar_criacao', 'equipe_concluir_criacao',
                            'equipe_remover_membro', 'equipe_funcionario_reaproveitavel')
    loop
        execute format('revoke execute on function %s from public', r.fn);
        if exists (select 1 from pg_roles where rolname = 'anon') then
            execute format('revoke execute on function %s from anon', r.fn);
        end if;
        -- A auxiliar é interna: só as três RPCs são chamadas com o JWT do gerente.
        if r.proname <> 'equipe_funcionario_reaproveitavel' then
            if exists (select 1 from pg_roles where rolname = 'authenticated') then
                execute format('grant execute on function %s to authenticated', r.fn);
            end if;
        elsif exists (select 1 from pg_roles where rolname = 'authenticated') then
            execute format('revoke execute on function %s from authenticated', r.fn);
        end if;
    end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. CADASTRO DE NOVAS EMPRESAS — fechado por padrão
-- Uma única linha. Sem policy: só o operador (SQL Editor / service_role)
-- lê e altera. Abrir:  update public.plataforma_config set cadastro_aberto = true;
-- ---------------------------------------------------------------------
create table if not exists public.plataforma_config (
    id boolean primary key default true,
    cadastro_aberto boolean not null default false,
    updated_at timestamptz not null default now(),
    constraint plataforma_config_linha_unica check (id)
);

insert into public.plataforma_config (id) values (true) on conflict (id) do nothing;

alter table public.plataforma_config enable row level security;
revoke all on public.plataforma_config from public;
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on public.plataforma_config from anon;
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
        revoke all on public.plataforma_config from authenticated;
    end if;
end $$;

comment on table public.plataforma_config is 'Configuração global da plataforma (linha única). cadastro_aberto=false: a API pública não cria empresa nova (provisionar_tenant recusa); superadmin e contexto administrativo continuam podendo.';

create or replace function public.fn_guarda_cadastro_empresa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if public.requisicao_api_publica()
       and not public.is_system_admin()
       and not coalesce((select c.cadastro_aberto from public.plataforma_config c where c.id), false)
    then
        raise exception 'O cadastro de novas empresas está fechado no momento. Fale com o suporte para liberar o seu acesso.'
            using errcode = 'P0001';
    end if;
    return new;
end;
$$;

drop trigger if exists guarda_cadastro_empresa on public.empresas;
create trigger guarda_cadastro_empresa
    before insert on public.empresas
    for each row execute function public.fn_guarda_cadastro_empresa();

-- ---------------------------------------------------------------------
-- 3. HISTÓRICO INVIOLÁVEL
-- ---------------------------------------------------------------------
-- 3a. cliente_status_history: só leitura pela API. Quem grava é o
-- trigger registrar_mudanca_stage (SECURITY DEFINER, dono da tabela).
do $$
declare
    r record;
begin
    if to_regclass('public.cliente_status_history') is null then
        return;
    end if;
    for r in select policyname from pg_policies
             where schemaname = 'public' and tablename = 'cliente_status_history'
    loop
        execute format('drop policy %I on public.cliente_status_history', r.policyname);
    end loop;

    create policy cliente_status_history_leitura on public.cliente_status_history
        for select to authenticated
        using (public.tenant_filter(tenant_id));

    if exists (select 1 from pg_roles where rolname = 'authenticated') then
        revoke insert, update, delete, truncate on public.cliente_status_history from authenticated;
    end if;
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on public.cliente_status_history from anon;
    end if;
end $$;

-- 3b. atividades_lead: autor carimbado pelo banco.
-- created_by NULL  = linha do sistema (trigger de etapa, temperatura,
--                    automação) ou anterior a esta migration: imutável.
-- created_by = uid = anotação manual: o autor e o gerente alteram/apagam.
alter table public.atividades_lead add column if not exists created_by uuid;

-- SECURITY INVOKER de propósito: current_user é quem está inserindo.
-- Pela API é 'authenticated' (o payload não escolhe o autor); dentro de
-- função SECURITY DEFINER é o dono, e a linha fica como "do sistema".
create or replace function public.fn_atividades_lead_autor()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if current_user in ('authenticated', 'anon') then
        new.created_by := auth.uid();
    end if;
    return new;
end;
$$;

drop trigger if exists atividades_lead_autor on public.atividades_lead;
create trigger atividades_lead_autor
    before insert on public.atividades_lead
    for each row execute function public.fn_atividades_lead_autor();

-- O autor não muda depois de gravado (nem pelo próprio).
create or replace function public.fn_atividades_lead_autor_imutavel()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if current_user in ('authenticated', 'anon') then
        new.created_by := old.created_by;
        new.tenant_id := old.tenant_id;
    end if;
    return new;
end;
$$;

drop trigger if exists atividades_lead_autor_imutavel on public.atividades_lead;
create trigger atividades_lead_autor_imutavel
    before update on public.atividades_lead
    for each row execute function public.fn_atividades_lead_autor_imutavel();

do $$
declare
    r record;
begin
    for r in select policyname from pg_policies
             where schemaname = 'public' and tablename = 'atividades_lead'
    loop
        execute format('drop policy %I on public.atividades_lead', r.policyname);
    end loop;

    create policy atividades_lead_leitura on public.atividades_lead
        for select to authenticated
        using (public.tenant_filter(tenant_id));

    create policy atividades_lead_insercao on public.atividades_lead
        for insert to authenticated
        with check (public.tenant_filter(tenant_id));

    create policy atividades_lead_alteracao on public.atividades_lead
        for update to authenticated
        using (
            public.tenant_filter(tenant_id)
            and created_by is not null
            and (created_by = auth.uid() or public.eh_admin_do_tenant())
        )
        with check (public.tenant_filter(tenant_id));

    create policy atividades_lead_exclusao on public.atividades_lead
        for delete to authenticated
        using (
            public.tenant_filter(tenant_id)
            and created_by is not null
            and (created_by = auth.uid() or public.eh_admin_do_tenant())
        );

    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on public.atividades_lead from anon;
    end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. RLS QUE USA ÍNDICE
-- ---------------------------------------------------------------------
-- Reescreve as expressões das policies de public e storage:
--   tenant_filter(tenant_id)
--     -> (tenant_id = (select current_tenant_id())
--         or (tenant_id is not null and (select is_system_admin())))
--        Mesma tabela-verdade de tenant_filter (inclusive tenant nulo e
--        superadmin), mas com a coluna exposta ao planejador e as duas
--        funções avaliadas UMA vez por consulta (InitPlan).
--   eh_admin_do_tenant(tenant_id), quando acompanha tenant_filter
--     -> (select eh_admin_do_tenant())   [o tenant da linha já é o ativo]
--   current_tenant_id() / is_system_admin() / eh_admin_do_tenant() /
--   auth.uid() / auth.jwt() soltos -> embrulhados em (select ...).
-- Idempotente: o que já está embrulhado não é tocado.
-- Devolve quantas policies foram alteradas.
create or replace function public.otimizar_policies_rls()
returns integer
language plpgsql
set search_path = public
as $$
declare
    r record;
    v_qual text;
    v_check text;
    v_sql text;
    v_alteradas integer := 0;
    c_tenant constant text :=
        '((tenant_id = (SELECT current_tenant_id())) OR ((tenant_id IS NOT NULL) AND (SELECT is_system_admin())))';
begin
    for r in
        select n.nspname as esquema, c.relname as tabela, p.polname as nome,
               pg_get_expr(p.polqual, p.polrelid) as qual,
               pg_get_expr(p.polwithcheck, p.polrelid) as com_check
        from pg_policy p
        join pg_class c on c.oid = p.polrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('public', 'storage')
    loop
        v_qual := public.otimizar_expressao_rls(r.qual, c_tenant);
        v_check := public.otimizar_expressao_rls(r.com_check, c_tenant);

        if v_qual is not distinct from r.qual and v_check is not distinct from r.com_check then
            continue;
        end if;

        v_sql := format('alter policy %I on %I.%I', r.nome, r.esquema, r.tabela);
        if v_qual is not null then
            v_sql := v_sql || format(' using (%s)', v_qual);
        end if;
        if v_check is not null then
            v_sql := v_sql || format(' with check (%s)', v_check);
        end if;

        begin
            execute v_sql;
            v_alteradas := v_alteradas + 1;
        exception when insufficient_privilege then
            -- storage.objects pertence ao Supabase: sem permissão a policy
            -- fica como está (segura, só mais lenta) e o operador é avisado.
            raise warning 'otimizar_policies_rls: sem permissão para alterar %.%.% — mantida como estava.',
                r.esquema, r.tabela, r.nome;
        end;
    end loop;

    return v_alteradas;
end;
$$;

create or replace function public.otimizar_expressao_rls(p_expr text, p_tenant text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
    v text := p_expr;
    v_tinha_filtro boolean;
begin
    if v is null then
        return null;
    end if;

    -- pg_get_expr só qualifica o que está fora do search_path; normaliza
    -- para o caso de a função ser chamada com outro search_path.
    v := replace(v, 'public.tenant_filter(', 'tenant_filter(');
    v := replace(v, 'public.eh_admin_do_tenant(', 'eh_admin_do_tenant(');
    v := replace(v, 'public.current_tenant_id(', 'current_tenant_id(');
    v := replace(v, 'public.is_system_admin(', 'is_system_admin(');

    v_tinha_filtro := position('tenant_filter(tenant_id)' in v) > 0;
    v := replace(v, 'tenant_filter(tenant_id)', p_tenant);
    if v_tinha_filtro then
        v := replace(v, 'eh_admin_do_tenant(tenant_id)', '(SELECT eh_admin_do_tenant())');
    end if;

    -- Chamadas sem argumento ainda não embrulhadas. O deparse do Postgres
    -- devolve "( SELECT f() AS f)": o lookbehind reconhece e não repete.
    v := regexp_replace(v, '(?<!SELECT )\m(current_tenant_id|is_system_admin|eh_admin_do_tenant)\(\)',
                        '(SELECT \1())', 'g');
    v := regexp_replace(v, '(?<!SELECT )\mauth\.(uid|jwt)\(\)', '(SELECT auth.\1())', 'g');

    return v;
end;
$$;

comment on function public.otimizar_policies_rls() is 'Reescreve as policies de public/storage para o formato que usa índice: tenant_id = (select current_tenant_id()). Mesma regra de acesso de tenant_filter(). Rodar depois de reexecutar qualquer migration antiga. Devolve quantas policies mudaram (0 = tudo em dia).';

-- Separa "leitura (SELECT) + escrita (FOR ALL)" em SELECT + INSERT +
-- UPDATE + DELETE: com o FOR ALL, todo SELECT avaliava as duas policies.
-- Lista explícita: só onde a policy de leitura é comprovadamente mais
-- ampla que a de escrita (senão o UPDATE/DELETE deixaria de enxergar a
-- linha). Policy nova que entrar aqui precisa atender a mesma condição.
create or replace function public.separar_policies_de_escrita()
returns integer
language plpgsql
set search_path = public
as $$
declare
    r record;
    v_roles text;
    v_qual text;
    v_check text;
    v_separadas integer := 0;
begin
    for r in
        select * from (values
            ('automacoes', 'automacoes_escrita_gerente'),
            ('automacoes_acoes', 'automacoes_acoes_escrita_gerente'),
            ('canais_origem', 'canais_origem_escrita_gerente'),
            ('empresa_identidade', 'empresa_identidade_escrita_admin'),
            ('modelos_mensagem', 'modelos_mensagem_escrita_gerente'),
            ('onboarding_empresa', 'onboarding_empresa_escrita_gerente'),
            ('pipeline_stages', 'pipeline_stages_write'),
            ('politicas_retencao', 'politicas_retencao_escrita_admin'),
            ('produtos', 'produtos_escrita_admin'),
            ('tenant_features', 'tenant_features_escrita_superadmin'),
            ('utilizadores_empresas', 'utilizadores_empresas_superadmin_escrita')
        ) as t(tabela, nome)
    loop
        select array_to_string(array(select quote_ident(x) from unnest(p.roles) x), ', '),
               p.qual, coalesce(p.with_check, p.qual)
          into v_roles, v_qual, v_check
        from pg_policies p
        where p.schemaname = 'public' and p.tablename = r.tabela
          and p.policyname = r.nome and p.cmd = 'ALL';

        if not found then
            continue;
        end if;
        -- Sem policy de leitura separada, o FOR ALL é o que dá o SELECT: não mexe.
        if not exists (
            select 1 from pg_policies p
            where p.schemaname = 'public' and p.tablename = r.tabela and p.cmd = 'SELECT'
        ) then
            continue;
        end if;

        execute format('drop policy if exists %I on public.%I', r.nome || '_insert', r.tabela);
        execute format('drop policy if exists %I on public.%I', r.nome || '_update', r.tabela);
        execute format('drop policy if exists %I on public.%I', r.nome || '_delete', r.tabela);

        execute format('create policy %I on public.%I for insert to %s with check (%s)',
                       r.nome || '_insert', r.tabela, v_roles, v_check);
        execute format('create policy %I on public.%I for update to %s using (%s) with check (%s)',
                       r.nome || '_update', r.tabela, v_roles, v_qual, v_check);
        execute format('create policy %I on public.%I for delete to %s using (%s)',
                       r.nome || '_delete', r.tabela, v_roles, v_qual);
        execute format('drop policy %I on public.%I', r.nome, r.tabela);

        v_separadas := v_separadas + 1;
    end loop;

    return v_separadas;
end;
$$;

comment on function public.separar_policies_de_escrita() is 'Troca as policies de escrita FOR ALL (lista fixa) por INSERT/UPDATE/DELETE, para o SELECT avaliar uma policy só. Idempotente.';

-- Funções de operador: nunca pela API.
do $$
declare
    r record;
begin
    for r in
        select p.oid::regprocedure as fn
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public'
          and p.proname in ('otimizar_policies_rls', 'otimizar_expressao_rls',
                            'separar_policies_de_escrita', 'fn_guarda_cadastro_empresa')
    loop
        execute format('revoke execute on function %s from public', r.fn);
        if exists (select 1 from pg_roles where rolname = 'anon') then
            execute format('revoke execute on function %s from anon', r.fn);
        end if;
        if exists (select 1 from pg_roles where rolname = 'authenticated') then
            execute format('revoke execute on function %s from authenticated', r.fn);
        end if;
    end loop;
end $$;

-- Ordem: primeiro separa (copia a expressão ainda no formato antigo),
-- depois otimiza tudo de uma vez — inclusive as policies recém-criadas.
select public.separar_policies_de_escrita();
select public.otimizar_policies_rls();
