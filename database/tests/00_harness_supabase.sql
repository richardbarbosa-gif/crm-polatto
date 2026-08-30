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
