-- =====================================================================
-- Suíte 15 — preparo: recria o estado ANTERIOR à migration 20 (como o
-- Supabase entrega um projeto: anon com tudo em public) e objetos novos
-- criados "do jeito errado". A 20 é reaplicada em seguida pelo runner.
-- =====================================================================
grant all on public.negocios, public.pessoas, public.audit_log to anon;
grant truncate, references, trigger on public.tarefas to authenticated;
grant execute on function public.enforce_rate_limit(text, integer, interval) to authenticated;
grant execute on function public.registro_eh_do_usuario(jsonb) to authenticated;

-- função nova sem revoke: nasce executável por PUBLIC (logo, por anon)
create or replace function public.s15_funcao_esquecida()
returns integer language sql as 'select 1';

-- tabela nova com tenant_id e FK, sem nenhum índice além da PK
drop table if exists public.s15_tabela_nova;
create table public.s15_tabela_nova (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid,
    negocio_id uuid references public.negocios (id) on delete cascade
);
alter table public.s15_tabela_nova enable row level security;
create policy s15_tabela_nova_tenant on public.s15_tabela_nova
    for all to authenticated
    using (public.tenant_filter(tenant_id)) with check (public.tenant_filter(tenant_id));
