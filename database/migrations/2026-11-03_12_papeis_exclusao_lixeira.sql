-- =====================================================================
-- MIGRATION 12 — PAPÉIS, EXCLUSÃO, LIXEIRA E GESTÃO DA EQUIPE
--
-- Regras de negócio definidas pelo Richard (2026-11-03):
--   * Cada empresa (tenant) só enxerga os próprios dados (já garantido
--     pelas migrations 02/10).
--   * GERENTE (papel gerente/admin/gestor/owner em utilizadores_empresas)
--     faz tudo dentro da empresa: vê, edita, exclui, restaura, configura o
--     CRM e administra a equipe.
--   * VENDEDOR vê os leads de todos os vendedores da empresa, mas só
--     EXCLUI (e restaura) o que é dele — nunca o de outro vendedor.
--   * Excluir manda para a LIXEIRA (soft delete) e pode ser desfeito.
--
-- Fonte única do papel: utilizadores_empresas.role, que o usuário não
-- consegue alterar (só leitura via RLS). funcionarios.cargo é só o cargo
-- exibido na tela e NÃO concede permissão.
--
-- Contexto administrativo (SQL Editor, service_role, cron de retenção):
-- requisicao_api_publica() = false, e nenhuma trava daqui se aplica.
--
-- Idempotente. Rodar depois da 10 (e de novo após reexecutar a 01 na
-- virada — inofensivo).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. AUTOR E EXCLUSÃO RASTREÁVEIS
-- created_by: quem cadastrou (default auth.uid(); linhas antigas ficam
-- null e passam a ser excluídas só pelo gerente ou pelo responsável).
-- deleted_by: quem mandou para a lixeira (mostrado na tela da lixeira).
-- O default é avaliado uma vez no ALTER (contexto sem JWT => null): não
-- reescreve a tabela.
-- ---------------------------------------------------------------------
do $$
declare
    t text;
begin
    foreach t in array array['negocios', 'pessoas', 'organizacoes', 'tarefas', 'documentos_lead', 'funcionarios'] loop
        if to_regclass('public.' || t) is not null then
            execute format('alter table public.%I add column if not exists created_by uuid default auth.uid()', t);
            execute format('alter table public.%I add column if not exists deleted_by uuid', t);
            execute format('alter table public.%I add column if not exists deleted_at timestamptz', t);
        end if;
    end loop;
end $$;

-- Índices parciais da lixeira (consultas por deleted_at not null)
do $$
declare
    t text;
begin
    foreach t in array array['negocios', 'pessoas', 'organizacoes', 'tarefas'] loop
        if to_regclass('public.' || t) is not null then
            execute format(
                'create index if not exists %I on public.%I (tenant_id, deleted_at desc) where deleted_at is not null',
                'idx_' || t || '_lixeira', t
            );
        end if;
    end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. O REGISTRO É DO USUÁRIO?
-- Dono = quem cadastrou (created_by) OU o responsável — por id
-- (responsavel_id → funcionário do usuário) ou, no legado do Kanban, pelo
-- nome/e-mail gravado em "responsavel". Recebe a linha como jsonb para
-- servir a qualquer tabela.
-- SECURITY DEFINER: precisa ler funcionarios independentemente da RLS.
-- ---------------------------------------------------------------------
create or replace function public.registro_eh_do_usuario(p_registro jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_uid uuid := auth.uid();
    v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
    v_resp_id text := nullif(p_registro ->> 'responsavel_id', '');
    v_resp text := lower(btrim(coalesce(p_registro ->> 'responsavel', '')));
begin
    if v_uid is null or p_registro is null then
        return false;
    end if;

    if p_registro ->> 'created_by' = v_uid::text then
        return true;
    end if;

    if v_resp_id is not null then
        if v_resp_id = v_uid::text then
            return true;
        end if;
        if exists (
            select 1 from public.funcionarios f
            where f.id::text = v_resp_id
              and (f.user_id = v_uid or f.id = v_uid or (v_email <> '' and lower(f.email) = v_email))
        ) then
            return true;
        end if;
    end if;

    if v_resp <> '' then
        if v_email <> '' and v_resp = v_email then
            return true;
        end if;
        if exists (
            select 1 from public.funcionarios f
            where (f.user_id = v_uid or f.id = v_uid or (v_email <> '' and lower(f.email) = v_email))
              and (lower(btrim(f.nome)) = v_resp or lower(btrim(f.email)) = v_resp)
        ) then
            return true;
        end if;
    end if;

    return false;
end;
$$;

comment on function public.registro_eh_do_usuario(jsonb) is 'O usuário autenticado é dono do registro: cadastrou (created_by) ou é o responsável (responsavel_id/responsavel).';

-- ---------------------------------------------------------------------
-- 3. GUARDA DE EXCLUSÃO (lixeira) — vale para tela, API direta e RPCs.
--   UPDATE de deleted_at (excluir/restaurar): gerente ou dono.
--   UPDATE de created_by: ninguém pela API (o autor não muda).
--   UPDATE do responsável: gerente ou dono (o vendedor não "toma" o
--     registro de outro para depois excluí-lo).
--   DELETE físico: só gerente (a exclusão normal é a lixeira).
-- ---------------------------------------------------------------------
create or replace function public.fn_guarda_exclusao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_old jsonb;
    v_new jsonb;
    v_gerente boolean;
    v_dono boolean;
begin
    if not public.requisicao_api_publica() then
        if tg_op = 'DELETE' then
            return old;
        end if;
        return new;
    end if;

    v_gerente := public.eh_admin_do_tenant();

    if tg_op = 'DELETE' then
        if v_gerente then
            return old;
        end if;
        raise exception 'Somente o gerente pode excluir definitivamente. Use Excluir (o registro vai para a lixeira).'
            using errcode = '42501';
    end if;

    v_old := to_jsonb(old);
    v_new := to_jsonb(new);

    if v_new -> 'created_by' is distinct from v_old -> 'created_by' then
        raise exception 'O autor do registro não pode ser alterado.' using errcode = '42501';
    end if;

    if v_new -> 'deleted_at' is distinct from v_old -> 'deleted_at' then
        if not v_gerente and not public.registro_eh_do_usuario(v_old) then
            raise exception 'Você só pode excluir ou restaurar registros seus. Peça ao gerente.'
                using errcode = '42501';
        end if;
        -- quem excluiu (limpo ao restaurar)
        new.deleted_by := case when new.deleted_at is null then null else auth.uid() end;
    end if;

    if (v_new -> 'responsavel_id' is distinct from v_old -> 'responsavel_id'
        or v_new -> 'responsavel' is distinct from v_old -> 'responsavel')
       and not v_gerente
       and not public.registro_eh_do_usuario(v_old) then
        raise exception 'Só o gerente ou o responsável atual podem reatribuir este registro.'
            using errcode = '42501';
    end if;

    return new;
end;
$$;

do $$
declare
    t text;
begin
    foreach t in array array['negocios', 'pessoas', 'organizacoes', 'tarefas', 'documentos_lead', 'funcionarios'] loop
        if to_regclass('public.' || t) is not null then
            execute format('drop trigger if exists guarda_exclusao on public.%I', t);
            execute format(
                'create trigger guarda_exclusao before update or delete on public.%I
                 for each row execute function public.fn_guarda_exclusao()',
                t
            );
        end if;
    end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. CONFIGURAÇÃO E EQUIPE SÓ PARA GERENTE (no banco, não só na tela)
-- Funil, etapas, motivos de perda, tipos de atividade, campos
-- personalizados, metas e cadastro da equipe. Leitura segue liberada para
-- todo o tenant (as policies existentes cuidam disso).
-- ---------------------------------------------------------------------
create or replace function public.fn_somente_gerente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if public.requisicao_api_publica() and not public.eh_admin_do_tenant() then
        raise exception 'Somente o gerente pode alterar % (configuração da empresa).', tg_table_name
            using errcode = '42501';
    end if;
    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;

do $$
declare
    t text;
begin
    foreach t in array array['pipelines', 'pipeline_stages', 'motivos_perda', 'tipos_atividade', 'custom_fields', 'metas', 'funcionarios'] loop
        if to_regclass('public.' || t) is not null then
            execute format('drop trigger if exists somente_gerente on public.%I', t);
            execute format(
                'create trigger somente_gerente before insert or update or delete on public.%I
                 for each row execute function public.fn_somente_gerente()',
                t
            );
        end if;
    end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. LIXEIRA — restaurar (a guarda da seção 3 decide quem pode)
-- Mesma função da migration 04, agora cobrindo orçamentos (migration 13).
-- ---------------------------------------------------------------------
create or replace function public.restaurar_registro(p_tabela text, p_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_permitidas text[] := array['negocios', 'pessoas', 'organizacoes', 'tarefas', 'funcionarios', 'documentos_lead', 'orcamentos'];
    v_afetados integer;
begin
    if not (p_tabela = any(v_permitidas)) or to_regclass('public.' || p_tabela) is null then
        raise exception 'Tabela % não suporta restauração.', p_tabela;
    end if;

    execute format(
        'update public.%I set deleted_at = null where id::text = $1 and deleted_at is not null and public.tenant_filter(tenant_id)',
        p_tabela
    ) using p_id;

    get diagnostics v_afetados = row_count;
    return v_afetados > 0;
end;
$$;

comment on function public.restaurar_registro(text, text) is 'Tira um registro da lixeira (tenant ativo). Gerente restaura qualquer um; vendedor só os seus (trigger guarda_exclusao).';

-- ---------------------------------------------------------------------
-- 6. GESTÃO DA EQUIPE (RPCs usadas pela tela Equipe)
-- Antes só existiam em produção, sem versionamento e SEM checagem: a
-- chave pública criava usuário "admin" na primeira empresa e apagava
-- qualquer conta. Aqui: só gerente, só no tenant ativo, papel limitado a
-- gerente/vendedor, com rate limit.
-- ---------------------------------------------------------------------
create or replace function public.normalizar_papel(p_papel text)
returns text
language sql
immutable
as $$
    select case
        when lower(coalesce(p_papel, '')) ~ '(admin|owner|gerente|gestor|manager)' then 'gerente'
        else 'vendedor'
    end;
$$;

create or replace function public.criar_usuario_equipe(
    p_email text,
    p_senha text,
    p_nome text,
    p_cargo text default 'vendedor',
    p_role text default 'vendedor'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_email text := lower(btrim(coalesce(p_email, '')));
    v_nome text := btrim(coalesce(p_nome, ''));
    v_papel text := public.normalizar_papel(p_role);
    v_cargo text;
    v_user uuid;
    v_func_antigo uuid;
begin
    if auth.uid() is null then
        return jsonb_build_object('success', false, 'error', 'Faça login para continuar.');
    end if;
    if v_tenant is null or not public.eh_admin_do_tenant(v_tenant) then
        return jsonb_build_object('success', false, 'error', 'Somente o gerente da empresa pode cadastrar usuários.');
    end if;

    perform public.enforce_rate_limit('criar_usuario_equipe', 20, interval '1 hour');

    if v_nome = '' then
        return jsonb_build_object('success', false, 'error', 'Informe o nome.');
    end if;
    if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        return jsonb_build_object('success', false, 'error', 'E-mail inválido.');
    end if;
    if length(coalesce(p_senha, '')) < 8 then
        return jsonb_build_object('success', false, 'error', 'A senha precisa ter pelo menos 8 caracteres.');
    end if;
    if exists (select 1 from auth.users u where lower(u.email) = v_email) then
        return jsonb_build_object('success', false, 'error', 'Este e-mail já possui conta.');
    end if;

    -- Funcionário removido antes desta empresa com o mesmo e-mail: reativa
    -- a mesma linha (mantém o histórico); em outra empresa, recusa.
    select f.id into v_func_antigo
    from public.funcionarios f
    where lower(f.email) = v_email
    limit 1;

    if v_func_antigo is not null and not exists (
        select 1 from public.funcionarios f
        where f.id = v_func_antigo and f.tenant_id = v_tenant and f.deleted_at is not null
    ) then
        return jsonb_build_object('success', false, 'error', 'Este e-mail já está cadastrado na equipe.');
    end if;

    v_cargo := coalesce(nullif(btrim(p_cargo), ''), initcap(v_papel));
    v_user := gen_random_uuid();

    insert into auth.users (
        id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, confirmation_token, recovery_token,
        email_change_token_new, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at
    ) values (
        v_user, '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', v_email, crypt(p_senha, gen_salt('bf')),
        now(), '', '', '',
        jsonb_build_object('provider', 'email', 'providers', array['email']),
        jsonb_build_object('full_name', v_nome),
        now(), now()
    );

    if to_regclass('auth.identities') is not null then
        insert into auth.identities (
            id, user_id, provider_id, identity_data, provider,
            last_sign_in_at, created_at, updated_at
        ) values (
            v_user, v_user, v_user::text,
            jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true),
            'email', now(), now(), now()
        );
    end if;

    if v_func_antigo is not null then
        update public.funcionarios
        set user_id = v_user, nome = v_nome, cargo = v_cargo, ativo = true, deleted_at = null
        where id = v_func_antigo;
    else
        insert into public.funcionarios (id, user_id, nome, email, cargo, ativo, tenant_id)
        values (v_user, v_user, v_nome, v_email, v_cargo, true, v_tenant);
    end if;

    insert into public.utilizadores_empresas (auth_uid, empresa_id, role)
    values (v_user, v_tenant, v_papel);

    return jsonb_build_object(
        'success', true,
        'user_id', coalesce(v_func_antigo, v_user),
        'tenant_id', v_tenant,
        'message', 'Usuário criado. Ele já pode entrar com o e-mail e a senha informados.'
    );
exception when others then
    return jsonb_build_object('success', false, 'error', sqlerrm);
end;
$$;

comment on function public.criar_usuario_equipe(text, text, text, text, text) is 'Gerente cadastra um membro (login + funcionário + vínculo) na empresa ATIVA. Papel limitado a gerente/vendedor.';

create or replace function public.excluir_usuario_equipe(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_nome text;
    v_email text;
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

    if v_nome is null and not exists (
        select 1 from public.utilizadores_empresas ue
        where ue.auth_uid = p_user_id and ue.empresa_id = v_tenant
    ) then
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

    -- O login só some se a pessoa não pertencer a nenhuma outra empresa
    if not exists (select 1 from public.utilizadores_empresas ue where ue.auth_uid = p_user_id) then
        if to_regclass('auth.identities') is not null then
            delete from auth.identities where user_id = p_user_id;
        end if;
        delete from auth.users where id = p_user_id;
    end if;

    return jsonb_build_object(
        'success', true,
        'message', coalesce(v_nome, 'Membro') || ' removido da equipe.'
    );
exception when others then
    return jsonb_build_object('success', false, 'error', sqlerrm);
end;
$$;

comment on function public.excluir_usuario_equipe(uuid) is 'Gerente remove um membro da empresa ATIVA: desfaz o vínculo, manda o funcionário para a lixeira e apaga o login se ele não tiver outra empresa.';

create or replace function public.alterar_papel_membro(p_user_id uuid, p_papel text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_papel text := lower(btrim(coalesce(p_papel, '')));
begin
    if auth.uid() is null or v_tenant is null or not public.eh_admin_do_tenant(v_tenant) then
        return jsonb_build_object('success', false, 'error', 'Somente o gerente pode alterar permissões.');
    end if;
    if v_papel not in ('gerente', 'vendedor') then
        return jsonb_build_object('success', false, 'error', 'Papel inválido: use gerente ou vendedor.');
    end if;
    if p_user_id is null or p_user_id = auth.uid() then
        return jsonb_build_object('success', false, 'error', 'Você não pode alterar o próprio papel.');
    end if;
    if not exists (
        select 1 from public.utilizadores_empresas ue
        where ue.auth_uid = p_user_id and ue.empresa_id = v_tenant
    ) then
        return jsonb_build_object('success', false, 'error', 'Este membro não tem acesso a esta empresa.');
    end if;
    if v_papel = 'vendedor' and not exists (
        select 1 from public.utilizadores_empresas ue
        where ue.empresa_id = v_tenant and ue.auth_uid <> p_user_id
          and public.normalizar_papel(ue.role) = 'gerente'
    ) then
        return jsonb_build_object('success', false, 'error', 'A empresa precisa de pelo menos um gerente.');
    end if;

    update public.utilizadores_empresas
    set role = v_papel
    where auth_uid = p_user_id and empresa_id = v_tenant;

    return jsonb_build_object('success', true, 'message', 'Permissão atualizada para ' || v_papel || '.');
end;
$$;

comment on function public.alterar_papel_membro(uuid, text) is 'Gerente define o papel (gerente/vendedor) de outro membro da empresa ATIVA. Nunca o próprio; a empresa nunca fica sem gerente.';

-- Feature flags (useFeature.ts): lê do tenant ATIVO, validado. O
-- p_tenant_id é aceito por compatibilidade e ignorado (antes permitia
-- consultar flags de qualquer empresa).
create or replace function public.check_feature(p_feature_key text, p_tenant_id text default null)
returns boolean
language sql
stable
set search_path = public
as $$
    select coalesce((
        select tf.enabled
        from public.tenant_features tf
        where tf.tenant_id = public.current_tenant_id()
          and tf.feature_key = p_feature_key
        limit 1
    ), false);
$$;

-- Quem executa: só usuário logado (nunca a chave pública)
do $$
declare
    r record;
begin
    for r in
        select p.oid::regprocedure as fn
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public'
          and p.proname in ('criar_usuario_equipe', 'excluir_usuario_equipe', 'alterar_papel_membro',
                            'check_feature', 'registro_eh_do_usuario', 'restaurar_registro')
    loop
        execute format('revoke execute on function %s from public', r.fn);
        if exists (select 1 from pg_roles where rolname = 'anon') then
            execute format('revoke execute on function %s from anon', r.fn);
        end if;
        if exists (select 1 from pg_roles where rolname = 'authenticated') then
            execute format('grant execute on function %s to authenticated', r.fn);
        end if;
        if exists (select 1 from pg_roles where rolname = 'service_role') then
            execute format('grant execute on function %s to service_role', r.fn);
        end if;
    end loop;
end $$;

-- ---------------------------------------------------------------------
-- 7. DIAGNÓSTICO — empresa sem gerente (só avisa; não promove ninguém)
-- ---------------------------------------------------------------------
do $$
declare
    r record;
begin
    if to_regclass('public.empresas') is null or to_regclass('public.utilizadores_empresas') is null then
        return;
    end if;
    for r in
        select e.id, e.nome
        from public.empresas e
        where exists (select 1 from public.utilizadores_empresas ue where ue.empresa_id = e.id)
          and not exists (
              select 1 from public.utilizadores_empresas ue
              where ue.empresa_id = e.id and public.normalizar_papel(ue.role) = 'gerente'
          )
    loop
        raise warning 'AÇÃO MANUAL: a empresa % (%) não tem gerente. Defina: update utilizadores_empresas set role = ''gerente'' where empresa_id = ''%'' and auth_uid = ''<uuid>'';', r.nome, r.id, r.id;
    end loop;
end $$;

-- ---------------------------------------------------------------------
-- 8. REALTIME — agenda e funil atualizam ao vivo
-- A Agenda usa liveMode em tarefas e o Kanban recarrega etapas; sem a
-- tabela na publicação os eventos simplesmente não chegam. (negocios já
-- entra pela migration 01.) Só onde a publicação existe (Supabase).
-- ---------------------------------------------------------------------
do $$
declare
    t text;
begin
    if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        return;
    end if;
    foreach t in array array['tarefas', 'pipeline_stages'] loop
        if to_regclass('public.' || t) is not null and not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
        ) then
            execute format('alter publication supabase_realtime add table public.%I', t);
        end if;
    end loop;
end $$;
