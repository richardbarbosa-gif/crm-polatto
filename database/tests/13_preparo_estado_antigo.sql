-- =====================================================================
-- Suíte 13 — preparo: recria o estado ANTERIOR à migration 18, como num
-- banco de produção que ainda não a recebeu (ou que reexecutou uma
-- migration antiga depois dela). A 18 é reaplicada em seguida pelo runner.
-- =====================================================================

-- RPCs antigas que gravavam em auth.users (corpo irrelevante: têm de sumir)
create or replace function public.criar_usuario_equipe(
    p_email text, p_senha text, p_nome text, p_cargo text, p_role text
) returns jsonb language sql security definer set search_path = public
as 'select jsonb_build_object(''success'', false)';

create or replace function public.excluir_usuario_equipe(p_user_id uuid)
returns jsonb language sql security definer set search_path = public
as 'select jsonb_build_object(''success'', false)';

-- Policies no formato lento, como as migrations antigas as criam
drop policy if exists tarefas_tenant_isolation on public.tarefas;
create policy tarefas_tenant_isolation on public.tarefas
    for all to authenticated
    using (public.tenant_filter(tenant_id))
    with check (public.tenant_filter(tenant_id));

-- Par leitura + escrita FOR ALL recriado por reexecução de migration antiga
drop policy if exists produtos_escrita_admin on public.produtos;
drop policy if exists produtos_escrita_admin_insert on public.produtos;
drop policy if exists produtos_escrita_admin_update on public.produtos;
drop policy if exists produtos_escrita_admin_delete on public.produtos;
create policy produtos_escrita_admin on public.produtos
    for all to authenticated
    using (public.tenant_filter(tenant_id) and public.eh_admin_do_tenant(tenant_id))
    with check (public.tenant_filter(tenant_id) and public.eh_admin_do_tenant(tenant_id));

-- Histórico reaberto para escrita, como antes da 18
drop policy if exists cliente_status_history_tenant_isolation on public.cliente_status_history;
create policy cliente_status_history_tenant_isolation on public.cliente_status_history
    for all to authenticated
    using (public.tenant_filter(tenant_id))
    with check (public.tenant_filter(tenant_id));
grant insert, update, delete on public.cliente_status_history to authenticated;
