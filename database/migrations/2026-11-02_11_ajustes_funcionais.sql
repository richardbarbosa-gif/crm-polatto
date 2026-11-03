-- =====================================================================
-- CRM POLATTO — MIGRATION 11: AJUSTES FUNCIONAIS (revisão de 2026-11)
--
-- RELIGAR REFERÊNCIAS LEGADAS DEPOIS DA VIRADA
--
-- tarefas, atividades_lead e documentos_lead guardam cliente_id como
-- TEXTO com o id do lead. Antes da virada esse id é o bigint da tabela
-- clientes; depois da virada a view clientes expõe o UUID de negocios, e o
-- id antigo fica apenas em negocios.legado_cliente_id. Nada reescrevia as
-- referências: após a virada, a agenda, a "próxima atividade" do card, a
-- timeline e os documentos de TODO lead migrado sumiam da tela (o
-- frontend procura pelo UUID e o registro aponta para o número antigo).
--
-- religar_referencias_legadas() troca o id antigo pelo UUID do negócio
-- correspondente, respeitando o tenant. Só age quando clientes JÁ é a
-- view (pós-virada): antes disso o frontend ainda lê a tabela antiga e o
-- id numérico é o correto.
--
-- Uso (passo 5 da sequência de virada, depois de recriar a view):
--   select * from public.religar_referencias_legadas();
--
-- IDEMPOTENTE: rodar de novo não encontra mais nada para religar.
-- Sem SECURITY DEFINER e sem EXECUTE para os papéis da API: a função
-- atravessa tenants e só deve ser rodada pelo operador (SQL Editor).
-- =====================================================================

create or replace function public.religar_referencias_legadas()
returns table(tabela text, linhas_religadas bigint)
language plpgsql
set search_path = public
as $$
declare
    v_tabela text;
    v_qtd bigint;
begin
    if not exists (
        select 1 from information_schema.views
        where table_schema = 'public' and table_name = 'clientes'
    ) then
        raise notice 'clientes ainda é tabela (pré-virada): nada a religar.';
        return;
    end if;

    foreach v_tabela in array array['tarefas', 'atividades_lead', 'documentos_lead'] loop
        if to_regclass('public.' || v_tabela) is null
           or not exists (
               select 1 from information_schema.columns
               where table_schema = 'public' and table_name = v_tabela and column_name = 'cliente_id'
           ) then
            continue;
        end if;

        execute format(
            $sql$
            update public.%1$I r
               set cliente_id = n.id::text
              from public.negocios n
             where n.legado_cliente_id is not null
               and r.cliente_id::text = n.legado_cliente_id
               and (r.tenant_id is null or n.tenant_id is null or r.tenant_id = n.tenant_id)
            $sql$,
            v_tabela
        );
        get diagnostics v_qtd = row_count;

        tabela := v_tabela;
        linhas_religadas := v_qtd;
        return next;
    end loop;
end;
$$;

comment on function public.religar_referencias_legadas() is
    'Pós-virada: troca o id legado (bigint) pelo UUID do negócio em tarefas, atividades_lead e documentos_lead. Idempotente. Rodar como operador.';

do $$
begin
    execute 'revoke all on function public.religar_referencias_legadas() from public';
    if exists (select 1 from pg_roles where rolname = 'anon') then
        execute 'revoke all on function public.religar_referencias_legadas() from anon';
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
        execute 'revoke all on function public.religar_referencias_legadas() from authenticated';
    end if;
exception when insufficient_privilege then
    raise notice 'Sem permissão para revogar EXECUTE de religar_referencias_legadas().';
end $$;

-- Executa já: em banco pré-virada é um no-op; em banco que já virou,
-- religa o que estiver pendente.
select * from public.religar_referencias_legadas();
