-- =====================================================================
-- HARNESS DE TESTE — simula o ambiente Supabase em um Postgres local
--
-- Recria o mínimo que as migrations assumem existir em produção:
--   - schema auth com uid()/jwt() lendo request.jwt.claims (igual PostgREST)
--   - schema storage com objects e foldername()
--   - roles anon/authenticated/service_role e default privileges
--
-- NÃO cria tabela de negócio: quem constrói o schema é a migration 00.
-- É assim que a suíte prova que as migrations sobem um banco do zero.
--
-- Uso: psql -f database/tests/00_harness_supabase.sql
-- Não faz parte do deploy — é apenas o ambiente de teste local.
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin bypassrls;
    end if;
end $$;

create schema if not exists auth;
create schema if not exists storage;

-- auth.uid()/auth.jwt() com a mesma semântica do Supabase
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
    select coalesce(
        nullif(current_setting('request.jwt.claims', true), ''),
        '{}'
    )::jsonb;
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;

create table if not exists auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique
);

-- Colunas reais do auth.users do Supabase usadas pelo cadastro de equipe (simulacro crm_teste.equipe_criar)
alter table auth.users add column if not exists instance_id uuid;
alter table auth.users add column if not exists aud text;
alter table auth.users add column if not exists role text;
alter table auth.users add column if not exists encrypted_password text;
alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists confirmation_token text;
alter table auth.users add column if not exists recovery_token text;
alter table auth.users add column if not exists email_change_token_new text;
alter table auth.users add column if not exists raw_app_meta_data jsonb;
alter table auth.users add column if not exists raw_user_meta_data jsonb;
alter table auth.users add column if not exists created_at timestamptz;
alter table auth.users add column if not exists updated_at timestamptz;

create table if not exists auth.identities (
    id uuid primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    provider_id text not null,
    identity_data jsonb not null,
    provider text not null,
    last_sign_in_at timestamptz,
    created_at timestamptz,
    updated_at timestamptz
);

-- storage.objects + foldername (split do path em segmentos)
create table if not exists storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text,
    name text,
    owner uuid,
    created_at timestamptz default now()
);

create or replace function storage.foldername(name text)
returns text[]
language plpgsql
immutable
as $$
declare
    parts text[];
begin
    parts := string_to_array(name, '/');
    return parts[1:array_length(parts, 1) - 1];
end;
$$;

alter table storage.objects enable row level security;

-- storage.buckets (configuração do bucket: público/privado, limites)
create table if not exists storage.buckets (
    id text primary key,
    name text not null,
    public boolean default false,
    file_size_limit bigint,
    allowed_mime_types text[],
    created_at timestamptz default now()
);

grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all tables in schema storage to anon, authenticated, service_role;

-- O Supabase configura default privileges para que TABELAS NOVAS já nasçam
-- acessíveis aos roles da API. Sem isso, tudo que a migration cria fica
-- inacessível ao frontend (erro "permission denied for table").
alter default privileges in schema public
    grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
    grant all on sequences to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- As tabelas de negócio NÃO são criadas aqui de propósito.
--
-- Enquanto o harness as criava, ele mascarava o fato de que as migrations
-- não construíam o banco sozinhas: uma instalação nova simplesmente não
-- subia. Agora quem as cria é a migration 00 — e este arquivo simula
-- apenas o que o Supabase fornece (auth, storage, roles, privilégios).
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Simulacro da Edge Function `equipe-usuarios` (supabase/functions).
-- Em produção quem cria/apaga o login é a API de administração do Auth,
-- com a service_role; aqui o SECURITY DEFINER faz esse papel. O JWT do
-- chamador (auth.uid()) continua valendo dentro das RPCs, como na função
-- real, que as chama com o token do gerente.
-- ---------------------------------------------------------------------
create schema if not exists crm_teste;

create or replace function crm_teste.equipe_criar(
    p_email text, p_senha text, p_nome text, p_cargo text default null, p_role text default 'vendedor'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    r jsonb;
    v_user uuid := gen_random_uuid();
begin
    if length(coalesce(p_senha, '')) < 8 then
        return jsonb_build_object('success', false, 'error', 'A senha precisa ter pelo menos 8 caracteres.');
    end if;

    r := public.equipe_preparar_criacao(p_email, p_nome);
    if not (r ->> 'success')::boolean then
        return r;
    end if;

    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, created_at)
    values (v_user, r ->> 'email', 'hash-de-teste', now(),
            jsonb_build_object('crm_equipe_tenant', r ->> 'tenant_id', 'crm_equipe_criado_por', auth.uid()::text),
            now());

    r := public.equipe_concluir_criacao(v_user, p_nome, p_cargo, p_role);
    if not (r ->> 'success')::boolean then
        delete from auth.users where id = v_user;  -- compensação da função real
    end if;
    return r;
end;
$$;

create or replace function crm_teste.equipe_remover(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    r jsonb;
begin
    r := public.equipe_remover_membro(p_user_id);
    if (r ->> 'success')::boolean and (r ->> 'apagar_login')::boolean
       and not exists (select 1 from public.utilizadores_empresas where auth_uid = p_user_id) then
        delete from auth.users where id = p_user_id;
    end if;
    return r;
end;
$$;

grant usage on schema crm_teste to authenticated, anon;
grant execute on function crm_teste.equipe_criar(text, text, text, text, text) to authenticated;
grant execute on function crm_teste.equipe_remover(uuid) to authenticated;
