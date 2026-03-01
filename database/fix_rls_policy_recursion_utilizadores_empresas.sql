-- Corrige erro: "infinite recursion detected in policy for relation 'utilizadores_empresas'"
-- Versao resiliente:
-- 1) Detecta o schema da tabela automaticamente.
-- 2) Remove todas as policies atuais da tabela.
-- 3) Recria policies sem autorreferencia (sem EXISTS na propria tabela).
-- 4) Mantem fail-closed e bypass de System Admin por email.

begin;

do $$
declare
    target_schema text;
    target_table constant text := 'utilizadores_empresas';
    policy_row record;
    user_col text;
    user_col_type text;
    own_user_condition text;
    system_admin_condition constant text := 'lower(coalesce(auth.jwt() ->> ''email'', '''')) = ''richardbarbosa28@gmail.com''';
begin
    -- Descobre em qual schema a tabela existe (prioriza public)
    select n.nspname
      into target_schema
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where c.relkind = 'r'
       and c.relname = target_table
     order by case when n.nspname = 'public' then 0 else 1 end, n.nspname
     limit 1;

    if target_schema is null then
        raise exception 'Tabela %.% nao encontrada.', 'public', target_table;
    end if;

    -- Dropa todas as policies existentes na tabela alvo
    for policy_row in
        select p.policyname
          from pg_policies p
         where p.schemaname = target_schema
           and p.tablename = target_table
    loop
        execute format(
            'drop policy if exists %I on %I.%I',
            policy_row.policyname,
            target_schema,
            target_table
        );
    end loop;

    execute format('alter table %I.%I enable row level security', target_schema, target_table);

    -- Descobre a melhor coluna de identificacao do usuario
    select c.column_name, c.data_type
      into user_col, user_col_type
      from information_schema.columns c
     where c.table_schema = target_schema
       and c.table_name = target_table
       and c.column_name in (
            'user_id',
            'usuario_id',
            'utilizador_id',
            'id_usuario',
            'id_utilizador',
            'email',
            'usuario_email',
            'utilizador_email'
       )
     order by case c.column_name
        when 'user_id' then 1
        when 'usuario_id' then 2
        when 'utilizador_id' then 3
        when 'id_usuario' then 4
        when 'id_utilizador' then 5
        when 'email' then 6
        when 'usuario_email' then 7
        when 'utilizador_email' then 8
        else 99
     end
     limit 1;

    -- Se nao tiver coluna conhecida, aplica policy admin-only (fail-closed para demais usuarios)
    if user_col is null then
        execute format(
            'create policy ue_admin_only_all on %I.%I
             for all to authenticated
             using (%s)
             with check (%s)',
            target_schema,
            target_table,
            system_admin_condition,
            system_admin_condition
        );
        return;
    end if;

    if user_col_type = 'uuid' then
        own_user_condition := format('%I = auth.uid()', user_col);
    else
        own_user_condition := format(
            'lower(coalesce(%I::text, '''')) = lower(coalesce(auth.jwt() ->> ''email'', ''''))',
            user_col
        );
    end if;

    execute format(
        'create policy ue_select on %I.%I
         for select to authenticated
         using ((%s) or (%s))',
        target_schema,
        target_table,
        system_admin_condition,
        own_user_condition
    );

    execute format(
        'create policy ue_insert on %I.%I
         for insert to authenticated
         with check ((%s) or (%s))',
        target_schema,
        target_table,
        system_admin_condition,
        own_user_condition
    );

    execute format(
        'create policy ue_update on %I.%I
         for update to authenticated
         using ((%s) or (%s))
         with check ((%s) or (%s))',
        target_schema,
        target_table,
        system_admin_condition,
        own_user_condition,
        system_admin_condition,
        own_user_condition
    );

    execute format(
        'create policy ue_delete on %I.%I
         for delete to authenticated
         using ((%s))',
        target_schema,
        target_table,
        system_admin_condition
    );
end $$;

commit;

-- Pos-validacao:
-- select schemaname, tablename, policyname, cmd, qual, with_check
--   from pg_policies
--  where tablename in ('utilizadores_empresas', 'clientes')
--  order by schemaname, tablename, policyname;
