-- =====================================================================
-- CRM Polatto — Migration 20: privilégios mínimos, índices e arquivos.
-- (Auditoria 2026-11-10: P2-03 a P2-06 e P2-08.)
--
--   1. PRIVILÉGIOS (P2-03). A chave pública (anon) não precisa de nada
--      no schema public: perde todo privilégio de tabela, sequência e
--      função. authenticated perde TRUNCATE/REFERENCES/TRIGGER. Os
--      privilégios PADRÃO do schema são ajustados para que tabela e
--      função novas já nasçam assim. A RLS deixa de ser a única barreira.
--   2. FUNÇÕES INTERNAS FORA DA API (P2-04). enforce_rate_limit e
--      registro_eh_do_usuario só são chamadas de dentro de funções
--      SECURITY DEFINER; pela API serviam para encher rate_limit_hits.
--   3. ÍNDICES (P2-05). Toda tabela com tenant_id ganha índice começando
--      por ele (é o que a RLS reescrita na 18 usa) e toda chave
--      estrangeira ganha índice de cobertura. Genérico: vale para as
--      tabelas de hoje e para as que vierem — basta rodar de novo.
--   4. STORAGE (P2-06). No bucket lead-files, apagar ou sobrescrever um
--      arquivo passa a exigir ser quem enviou ou gerente (antes qualquer
--      membro apagava o contrato anexado por um colega, contornando a
--      regra da tabela documentos_lead). Policies RESTRITIVAS: valem
--      junto com as existentes e não são desfeitas se uma migration
--      antiga recriar as policies permissivas.
--   5. relatorio_privilegios() (P2-08): linter para rodar junto com
--      relatorio_rls() depois de qualquer mudança. Objetivo: zero linhas.
--
-- Só cria objetos novos e ajusta privilégios. Idempotente; pode ser
-- reexecutada a qualquer momento depois da 19.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. PRIVILÉGIOS MÍNIMOS
-- ---------------------------------------------------------------------
do $$
declare
    v_anon boolean := exists (select 1 from pg_roles where rolname = 'anon');
    v_auth boolean := exists (select 1 from pg_roles where rolname = 'authenticated');
    v_service boolean := exists (select 1 from pg_roles where rolname = 'service_role');
    r record;
    v_tinha_auth boolean;
    v_tinha_service boolean;
begin
    if v_anon then
        revoke all on all tables in schema public from anon;
        revoke all on all sequences in schema public from anon;
        alter default privileges in schema public revoke all on tables from anon;
        alter default privileges in schema public revoke all on sequences from anon;
        alter default privileges in schema public revoke execute on functions from anon;
    end if;

    if v_auth then
        -- TRUNCATE ignora a RLS; REFERENCES e TRIGGER não têm uso pela API.
        revoke truncate, references, trigger on all tables in schema public from authenticated;
        alter default privileges in schema public revoke truncate, references, trigger on tables from authenticated;
    end if;

    -- Funções: o Postgres concede EXECUTE a PUBLIC por padrão, e anon herda.
    -- Tira de PUBLIC e de anon; quem já executava como authenticated ou
    -- service_role continua executando, agora por concessão explícita.
    for r in
        select p.oid, p.oid::regprocedure as fn, p.prorettype = 'trigger'::regtype as eh_trigger
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public'
          and p.prokind in ('f', 'p')
          -- funções de extensão (pg_trgm etc.) não são nossas
          and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    loop
        -- Função de trigger é disparada pelo banco (o privilégio é conferido
        -- ao criar o trigger, não a cada disparo): ninguém a chama pela API.
        if r.eh_trigger and v_auth then
            execute format('revoke execute on function %s from authenticated', r.fn);
        end if;
        v_tinha_auth := v_auth and not r.eh_trigger and has_function_privilege('authenticated', r.oid, 'execute');
        v_tinha_service := v_service and has_function_privilege('service_role', r.oid, 'execute');

        execute format('revoke execute on function %s from public', r.fn);
        if v_anon then
            execute format('revoke execute on function %s from anon', r.fn);
        end if;
        if v_tinha_auth then
            execute format('grant execute on function %s to authenticated', r.fn);
        end if;
        if v_tinha_service then
            execute format('grant execute on function %s to service_role', r.fn);
        end if;
    end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. FUNÇÕES INTERNAS FORA DA API
-- ---------------------------------------------------------------------
do $$
declare
    r record;
begin
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        return;
    end if;
    for r in
        select p.oid::regprocedure as fn
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public'
          and p.proname in ('enforce_rate_limit', 'registro_eh_do_usuario')
    loop
        execute format('revoke execute on function %s from authenticated', r.fn);
    end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. ÍNDICES
-- ---------------------------------------------------------------------
-- 3a. tenant_id na frente de pelo menos um índice, em toda tabela que o tem.
do $$
declare
    r record;
begin
    for r in
        select c.oid, c.relname, a.attnum
        from pg_class c
        join pg_namespace ns on ns.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
        where ns.nspname = 'public' and c.relkind = 'r'
          and not exists (
              select 1 from pg_index i
              where i.indrelid = c.oid and i.indisvalid and i.indpred is null and i.indkey[0] = a.attnum
          )
    loop
        execute format('create index if not exists %I on public.%I (tenant_id)',
                       left('idx_' || r.relname || '_tenant_id', 63), r.relname);
    end loop;
end $$;

-- 3b. Chave estrangeira sem índice de cobertura: sem ele, apagar ou
-- alterar a linha referenciada (uma etapa, uma pessoa, um orçamento)
-- varre a tabela filha inteira.
do $$
declare
    r record;
    v_cols text;
begin
    for r in
        select con.oid, con.conname, con.conrelid, c.relname, con.conkey
        from pg_constraint con
        join pg_class c on c.oid = con.conrelid
        join pg_namespace ns on ns.oid = c.relnamespace
        where con.contype = 'f' and ns.nspname = 'public' and c.relkind = 'r'
          and not exists (
              select 1 from pg_index i
              where i.indrelid = con.conrelid and i.indisvalid and i.indpred is null
                -- as colunas da FK são o prefixo do índice (em qualquer ordem)
                and (i.indkey::int2[])[0:cardinality(con.conkey) - 1] @> con.conkey
                and con.conkey @> (i.indkey::int2[])[0:cardinality(con.conkey) - 1]
          )
    loop
        select string_agg(quote_ident(a.attname), ', ' order by k.ord) into v_cols
        from unnest(r.conkey) with ordinality as k(attnum, ord)
        join pg_attribute a on a.attrelid = r.conrelid and a.attnum = k.attnum;

        execute format('create index if not exists %I on public.%I (%s)',
                       left('idx_fk_' || r.conname, 63), r.relname, v_cols);
    end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. STORAGE — lead-files: só quem enviou ou o gerente apaga/sobrescreve
-- ---------------------------------------------------------------------
do $$
declare
    v_dono text;
begin
    if to_regclass('storage.objects') is null then
        return;
    end if;

    -- owner_id (texto) substituiu owner (uuid) nas versões novas do Storage.
    if exists (select 1 from information_schema.columns
               where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner_id') then
        v_dono := 'coalesce(owner_id, owner::text) = (select auth.uid())::text';
    else
        v_dono := 'owner = (select auth.uid())';
    end if;

    begin
        drop policy if exists lead_files_dono_ou_gerente_delete on storage.objects;
        drop policy if exists lead_files_dono_ou_gerente_update on storage.objects;

        execute format($p$
            create policy lead_files_dono_ou_gerente_delete on storage.objects
            as restrictive for delete to authenticated
            using (bucket_id <> 'lead-files' or %s or (select public.eh_admin_do_tenant()))
        $p$, v_dono);

        execute format($p$
            create policy lead_files_dono_ou_gerente_update on storage.objects
            as restrictive for update to authenticated
            using (bucket_id <> 'lead-files' or %s or (select public.eh_admin_do_tenant()))
        $p$, v_dono);
    exception when insufficient_privilege then
        raise warning 'Sem permissão para criar policy em storage.objects: crie lead_files_dono_ou_gerente_delete/update pelo painel (Storage > Policies).';
    end;
end $$;

-- ---------------------------------------------------------------------
-- 5. LINTER DE PRIVILÉGIOS
-- ---------------------------------------------------------------------
create or replace function public.relatorio_privilegios()
returns table(objeto text, problema text, gravidade text)
language sql
stable
security definer
set search_path = public
as $$
    -- chave pública com privilégio em tabela
    select 'public.' || c.relname,
           'anon tem privilégio de tabela (' || string_agg(distinct p.privilege_type, ', ') || ')',
           'ALTA'
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    join information_schema.role_table_grants p
      on p.table_schema = ns.nspname and p.table_name = c.relname and p.grantee = 'anon'
    where ns.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
    group by c.relname

    union all
    select 'public.' || c.relname, 'authenticated pode executar TRUNCATE (ignora a RLS)', 'MEDIA'
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind = 'r'
      and exists (select 1 from pg_roles where rolname = 'authenticated')
      and has_table_privilege('authenticated', c.oid, 'truncate')

    union all
    select p.oid::regprocedure::text, 'função executável pela chave pública (anon)', 'ALTA'
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and exists (select 1 from pg_roles where rolname = 'anon')
      and has_function_privilege('anon', p.oid, 'execute')

    union all
    select p.oid::regprocedure::text, 'SECURITY DEFINER sem search_path fixo', 'ALTA'
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')

    union all
    select p.oid::regprocedure::text, 'função interna exposta à API (authenticated)', 'MEDIA'
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and (p.proname in ('enforce_rate_limit', 'registro_eh_do_usuario') or p.prorettype = 'trigger'::regtype)
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and exists (select 1 from pg_roles where rolname = 'authenticated')
      and has_function_privilege('authenticated', p.oid, 'execute')

    union all
    select pol.schemaname || '.' || pol.tablename || '.' || pol.policyname,
           'policy no formato lento (tenant_filter por linha): rode select public.otimizar_policies_rls()',
           'MEDIA'
    from pg_policies pol
    where pol.schemaname in ('public', 'storage')
      and (coalesce(pol.qual, '') || coalesce(pol.with_check, '')) ~ 'tenant_filter\('

    union all
    select 'public.' || c.relname, 'tabela com tenant_id sem índice começando por ele', 'MEDIA'
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
    where ns.nspname = 'public' and c.relkind = 'r'
      and not exists (
          select 1 from pg_index i
          where i.indrelid = c.oid and i.indisvalid and i.indpred is null and i.indkey[0] = a.attnum
      );
$$;

comment on function public.relatorio_privilegios() is 'Linter de privilégios e desempenho de RLS. Rodar com relatorio_rls() após qualquer mudança de schema: select * from relatorio_privilegios(); O objetivo é retornar ZERO linhas.';

revoke execute on function public.relatorio_privilegios() from public;
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke execute on function public.relatorio_privilegios() from anon;
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
        revoke execute on function public.relatorio_privilegios() from authenticated;
    end if;
end $$;
