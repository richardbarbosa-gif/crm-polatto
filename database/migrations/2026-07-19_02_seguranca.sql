-- =====================================================================
-- CRM POLATTO — MIGRATION 02: SEGURANÇA MULTI-TENANT
--
-- Resolve os itens 🔴 da seção 1 do escopo:
--   1. Isolamento do bucket lead-files por tenant (path {tenant_id}/...)
--   2. Remoção do default hardcoded de negocios.tenant_id → trigger
--      BEFORE INSERT fail-closed via current_tenant_id()
--   3. current_tenant_id()/is_system_admin() fail-closed derivados do
--      usuário AUTENTICADO (nunca do header x-tenant-id do frontend)
--   4. Rate limiting genérico (aplicar em criar_usuario_equipe)
--   5. RLS por tenant nas tabelas do modelo novo
--
-- IDEMPOTENTE. Executar APÓS o arquivo 01.
-- =====================================================================

-- ---------------------------------------------------------------------
-- system_admins (fonte de verdade de superadmin — já existe em produção;
-- o create if not exists apenas garante o contrato)
-- ---------------------------------------------------------------------
create table if not exists public.system_admins (
    id uuid primary key default gen_random_uuid(),
    email text unique not null,
    created_at timestamptz not null default now()
);

alter table public.system_admins enable row level security;
-- Sem policy de escrita: só service_role gerencia superadmins.
drop policy if exists system_admins_self_read on public.system_admins;
create policy system_admins_self_read on public.system_admins
    for select to authenticated
    using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create or replace function public.is_system_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.system_admins sa
        where lower(sa.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    );
$$;

-- ---------------------------------------------------------------------
-- current_tenant_id() — FAIL-CLOSED
-- Deriva o tenant do VÍNCULO do usuário autenticado (utilizadores_empresas),
-- nunca de header enviado pelo cliente. Sem vínculo → NULL → toda policy
-- "tenant_id = current_tenant_id()" nega acesso.
-- A coluna de tenant da tabela de vínculo é detectada dinamicamente
-- (empresa_id / tenant_id / company_id / id_empresa) para casar com produção.
-- ---------------------------------------------------------------------
do $$
declare
    v_col text;
begin
    select column_name into v_col
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'utilizadores_empresas'
      and column_name in ('empresa_id', 'tenant_id', 'company_id', 'id_empresa')
    order by array_position(
        array['empresa_id', 'tenant_id', 'company_id', 'id_empresa'],
        column_name
    )
    limit 1;

    if v_col is null then
        raise notice 'ATENÇÃO: utilizadores_empresas sem coluna de tenant reconhecida. current_tenant_id() ficará fail-closed (retorna null).';
        create or replace function public.current_tenant_id()
        returns uuid language sql stable security definer set search_path = public
        as 'select null::uuid';
        return;
    end if;

    execute format($fn$
        create or replace function public.current_tenant_id()
        returns uuid
        language sql
        stable
        security definer
        set search_path = public
        as $body$
            -- ORDER BY explícito: sem ele, um usuário vinculado a mais de uma
            -- empresa cairia em um tenant arbitrário (e instável entre queries).
            select ue.%I::uuid
            from public.utilizadores_empresas ue
            where ue.auth_uid = auth.uid()
              and ue.%I is not null
            order by ue.%I::text
            limit 1
        $body$;
    $fn$, v_col, v_col, v_col);
end $$;

comment on function public.current_tenant_id() is 'Tenant do usuário autenticado, derivado de utilizadores_empresas.auth_uid = auth.uid(). FAIL-CLOSED: retorna null sem vínculo. Nunca usar header do cliente.';

-- Filtro padrão para policies (tenant do usuário OU superadmin)
create or replace function public.tenant_filter(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select p_tenant_id is not null
       and (p_tenant_id = public.current_tenant_id() or public.is_system_admin());
$$;

-- ---------------------------------------------------------------------
-- Item 2 do escopo: remover default hardcoded de tenant_id.
-- Remove QUALQUER default de tenant_id nas tabelas do modelo
-- (o preenchimento passa a ser exclusivo do trigger fail-closed abaixo).
-- ---------------------------------------------------------------------
do $$
declare
    v_tabela text;
begin
    foreach v_tabela in array array[
        'negocios', 'organizacoes', 'pessoas', 'negocios_pessoas',
        'pipelines', 'pipeline_stages', 'custom_fields',
        'motivos_perda', 'tipos_atividade'
    ] loop
        if exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = v_tabela and column_name = 'tenant_id'
        ) then
            begin
                execute format('alter table public.%I alter column tenant_id drop default', v_tabela);
            exception when others then
                raise notice 'Não foi possível remover default de %.tenant_id: %', v_tabela, sqlerrm;
            end;
        end if;
    end loop;
end $$;

-- ---------------------------------------------------------------------
-- Trigger BEFORE INSERT fail-closed: preenche tenant_id no servidor.
-- Se o frontend mandar um tenant_id DIFERENTE do vínculo do usuário,
-- é sobrescrito (superadmin pode informar tenant explicitamente).
-- ---------------------------------------------------------------------
create or replace function public.fn_set_tenant_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant uuid;
begin
    v_tenant := public.current_tenant_id();

    if v_tenant is not null then
        -- Usuário logado: o tenant é SEMPRE o do vínculo. Ignora o que veio
        -- do cliente — é isto que impede forjar tenant_id pelo frontend.
        new.tenant_id := v_tenant;
    elsif new.tenant_id is not null then
        -- Sem usuário logado (service_role, SQL Editor, cron) ou superadmin
        -- sem vínculo: aceita o tenant informado explicitamente. Não é uma
        -- brecha: a RLS (tenant_filter) continua sendo a barreira real, e
        -- ela nega qualquer requisição autenticada que não seja do tenant.
        -- Sem esta ramificação o provisionamento de tenants é impossível.
        null;
    else
        raise exception
            'tenant_id não pôde ser resolvido: usuário sem vínculo em utilizadores_empresas e nenhum tenant informado. Insert em % bloqueado.',
            tg_table_name;
    end if;

    return new;
end;
$$;

do $$
declare
    v_tabela text;
begin
    foreach v_tabela in array array[
        'negocios', 'organizacoes', 'pessoas', 'negocios_pessoas',
        'pipelines', 'pipeline_stages', 'custom_fields',
        'motivos_perda', 'tipos_atividade'
    ] loop
        if exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = v_tabela and column_name = 'tenant_id'
        ) then
            execute format('drop trigger if exists set_tenant_id on public.%I', v_tabela);
            execute format(
                'create trigger set_tenant_id before insert on public.%I for each row execute function public.fn_set_tenant_id()',
                v_tabela
            );
        end if;
    end loop;
end $$;

-- ---------------------------------------------------------------------
-- RLS POR TENANT — tabelas do modelo novo (estritas: dado novo já nasce
-- com tenant_id preenchido pelo trigger acima).
-- pipeline_stages tem tratamento especial: linhas legadas com tenant_id
-- null são visíveis como "defaults compartilhados" até o backfill.
-- ---------------------------------------------------------------------
do $$
declare
    v_tabela text;
begin
    foreach v_tabela in array array[
        'negocios', 'organizacoes', 'pessoas', 'negocios_pessoas',
        'pipelines', 'custom_fields', 'motivos_perda', 'tipos_atividade',
        'tenant_features'
    ] loop
        if to_regclass('public.' || v_tabela) is not null then
            execute format('alter table public.%I enable row level security', v_tabela);
            execute format('drop policy if exists %I on public.%I', v_tabela || '_tenant_isolation', v_tabela);
            execute format(
                'create policy %I on public.%I for all to authenticated using (public.tenant_filter(tenant_id)) with check (public.tenant_filter(tenant_id))',
                v_tabela || '_tenant_isolation', v_tabela
            );
        end if;
    end loop;
end $$;

-- pipeline_stages: legado compartilhado (tenant_id null) permanece legível;
-- escrita exige tenant próprio. Rodar backfill_tenant_dados_legados() e
-- depois aplicar_rls_estrita_pipeline_stages() para fechar de vez.
alter table public.pipeline_stages enable row level security;
drop policy if exists pipeline_stages_tenant_isolation on public.pipeline_stages;
drop policy if exists pipeline_stages_read on public.pipeline_stages;
drop policy if exists pipeline_stages_write on public.pipeline_stages;
create policy pipeline_stages_read on public.pipeline_stages
    for select to authenticated
    using (tenant_id is null or public.tenant_filter(tenant_id));
create policy pipeline_stages_write on public.pipeline_stages
    for all to authenticated
    using (public.tenant_filter(tenant_id))
    with check (public.tenant_filter(tenant_id));

create or replace function public.backfill_tenant_dados_legados(p_tenant_id uuid)
returns table(tabela text, linhas_atualizadas bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tabela text;
    v_count bigint;
begin
    if not public.is_system_admin() then
        raise exception 'Apenas superadmin pode executar o backfill de dados legados.';
    end if;

    foreach v_tabela in array array[
        'pipeline_stages', 'tarefas', 'funcionarios', 'atividades_lead', 'metas'
    ] loop
        if to_regclass('public.' || v_tabela) is not null and exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = v_tabela and column_name = 'tenant_id'
        ) then
            -- Só carimba o que está órfão. Linhas que já pertencem a outro
            -- tenant nunca são tocadas (ver migration 09 para o backfill
            -- que deriva o tenant das relações, em vez de assumir um só).
            execute format('update public.%I set tenant_id = $1 where tenant_id is null', v_tabela)
                using p_tenant_id;
            get diagnostics v_count = row_count;
            tabela := v_tabela;
            linhas_atualizadas := v_count;
            return next;
        end if;
    end loop;
end;
$$;

create or replace function public.aplicar_rls_estrita_pipeline_stages()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_system_admin() then
        raise exception 'Apenas superadmin.';
    end if;
    if exists (select 1 from public.pipeline_stages where tenant_id is null) then
        raise exception 'Ainda existem stages com tenant_id null. Rode backfill_tenant_dados_legados() antes.';
    end if;
    drop policy if exists pipeline_stages_read on public.pipeline_stages;
    create policy pipeline_stages_read on public.pipeline_stages
        for select to authenticated
        using (public.tenant_filter(tenant_id));
end;
$$;

-- Tabelas legadas: adiciona tenant_id (sem quebrar nada — policies antigas
-- permanecem até o backfill ser executado e as estritas serem aplicadas
-- conscientemente pelo admin).
alter table if exists public.tarefas add column if not exists tenant_id uuid;
alter table if exists public.funcionarios add column if not exists tenant_id uuid;
alter table if exists public.atividades_lead add column if not exists tenant_id uuid;
alter table if exists public.metas add column if not exists tenant_id uuid;

-- ---------------------------------------------------------------------
-- GRANTS: a RLS só entra em ação depois que o role tem permissão na tabela.
-- Sem isto o frontend recebe "permission denied for table X" em tudo que a
-- migration criou (o default privilege do projeto nem sempre cobre tabelas
-- criadas por outro role no SQL Editor). Idempotente e seguro: a barreira de
-- segurança continua sendo a RLS, não o GRANT.
-- ---------------------------------------------------------------------
do $$
declare
    v_tabela text;
begin
    foreach v_tabela in array array[
        'negocios', 'organizacoes', 'pessoas', 'negocios_pessoas',
        'pipelines', 'pipeline_stages', 'custom_fields',
        'motivos_perda', 'tipos_atividade', 'tenant_features',
        'consentimentos', 'politicas_retencao', 'planos', 'tenant_planos',
        'audit_log', 'acessos_dados_pessoais', 'client_errors'
    ] loop
        if to_regclass('public.' || v_tabela) is not null then
            execute format(
                'grant select, insert, update, delete on public.%I to authenticated',
                v_tabela
            );
        end if;
    end loop;

    -- Sequences das tabelas com identity/serial
    execute 'grant usage on all sequences in schema public to authenticated';
exception when insufficient_privilege then
    raise notice 'Sem permissão para conceder GRANTs — verifique se o frontend acessa as tabelas novas.';
end $$;

-- ---------------------------------------------------------------------
-- Item 1 do escopo: STORAGE lead-files isolado por tenant.
-- Convenção de path (já usada pelo frontend): {tenant_id}/{negocio_id}/arquivo.pdf
-- Remove policies antigas do bucket e cria as estritas.
-- Arquivos legados fora do padrão (ex: prefixo "global/") ficam acessíveis
-- somente ao superadmin — mover para o path do tenant correto.
-- ---------------------------------------------------------------------
do $$
declare
    r record;
begin
    for r in
        select policyname
        from pg_policies
        where schemaname = 'storage'
          and tablename = 'objects'
          and (coalesce(qual, '') like '%lead-files%' or coalesce(with_check, '') like '%lead-files%')
    loop
        execute format('drop policy if exists %I on storage.objects', r.policyname);
    end loop;
exception when insufficient_privilege then
    raise notice 'Sem permissão para alterar policies de storage via SQL — criar no painel do Supabase (Storage > Policies) com as regras abaixo.';
end $$;

do $$
begin
    execute $p$
        create policy lead_files_tenant_select on storage.objects
        for select to authenticated
        using (
            bucket_id = 'lead-files'
            and (
                (storage.foldername(name))[1] = public.current_tenant_id()::text
                or public.is_system_admin()
            )
        )
    $p$;
    execute $p$
        create policy lead_files_tenant_insert on storage.objects
        for insert to authenticated
        with check (
            bucket_id = 'lead-files'
            and (
                (storage.foldername(name))[1] = public.current_tenant_id()::text
                or public.is_system_admin()
            )
        )
    $p$;
    execute $p$
        create policy lead_files_tenant_update on storage.objects
        for update to authenticated
        using (
            bucket_id = 'lead-files'
            and (
                (storage.foldername(name))[1] = public.current_tenant_id()::text
                or public.is_system_admin()
            )
        )
        with check (
            bucket_id = 'lead-files'
            and (
                (storage.foldername(name))[1] = public.current_tenant_id()::text
                or public.is_system_admin()
            )
        )
    $p$;
    execute $p$
        create policy lead_files_tenant_delete on storage.objects
        for delete to authenticated
        using (
            bucket_id = 'lead-files'
            and (
                (storage.foldername(name))[1] = public.current_tenant_id()::text
                or public.is_system_admin()
            )
        )
    $p$;
exception
    when duplicate_object then
        null; -- já criadas em execução anterior
    when insufficient_privilege then
        raise notice 'Sem permissão para criar policies de storage via SQL — replicar manualmente no painel (Storage > lead-files > Policies).';
end $$;

-- ---------------------------------------------------------------------
-- Item 4 do escopo: RATE LIMITING genérico.
-- Uso dentro de qualquer função sensível (ex: criar_usuario_equipe):
--   perform public.enforce_rate_limit('criar_usuario_equipe', 10, interval '1 hour');
-- Lança exceção quando o usuário autenticado excede o limite na janela.
-- ---------------------------------------------------------------------
create table if not exists public.rate_limit_hits (
    id bigint generated by default as identity primary key,
    chave text not null,
    ator text not null,
    criado_em timestamptz not null default now()
);

create index if not exists idx_rate_limit_hits_busca
    on public.rate_limit_hits (chave, ator, criado_em desc);

alter table public.rate_limit_hits enable row level security;
-- Sem policies: apenas funções security definer escrevem/leem.

create or replace function public.enforce_rate_limit(
    p_chave text,
    p_limite integer default 10,
    p_janela interval default interval '1 hour'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ator text;
    v_hits integer;
begin
    v_ator := coalesce(auth.uid()::text, 'anon');

    select count(*) into v_hits
    from public.rate_limit_hits
    where chave = p_chave
      and ator = v_ator
      and criado_em > now() - p_janela;

    if v_hits >= p_limite then
        raise exception 'Limite de % chamadas por % excedido para %. Tente novamente mais tarde.',
            p_limite, p_janela, p_chave
            using errcode = 'P0001';
    end if;

    insert into public.rate_limit_hits (chave, ator) values (p_chave, v_ator);

    -- Higiene: descarta hits antigos (barato, evita crescimento infinito)
    delete from public.rate_limit_hits
    where chave = p_chave and criado_em < now() - interval '7 days';
end;
$$;

-- Aviso operacional: aplicar na função existente de criação de usuários.
do $$
begin
    if exists (
        select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public' and p.proname = 'criar_usuario_equipe'
    ) then
        raise notice 'AÇÃO NECESSÁRIA: adicionar como primeira linha do corpo de criar_usuario_equipe: perform public.enforce_rate_limit(''criar_usuario_equipe'', 10, interval ''1 hour'');';
    end if;
end $$;
