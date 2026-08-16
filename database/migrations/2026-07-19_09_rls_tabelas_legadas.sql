-- =====================================================================
-- CRM POLATTO — MIGRATION 09: RLS NAS TABELAS LEGADAS
--
-- FECHA O MAIOR VAZAMENTO REMANESCENTE. As tabelas herdadas do modelo
-- antigo (tarefas, atividades_lead, documentos_lead, funcionarios, metas,
-- cliente_status_history, empresas, utilizadores_empresas) não tinham
-- isolamento por tenant: qualquer usuário autenticado de qualquer empresa
-- conseguia ler a agenda, os anexos e a equipe das outras.
--
-- A ativação é em DOIS PASSOS de propósito — ligar RLS sobre linhas com
-- tenant_id nulo faria o dado sumir da tela sem aviso:
--
--   1) select * from public.backfill_tenant_legado();     -- preenche
--   2) select * from public.diagnostico_tenant_legado();  -- confere
--   3) select public.aplicar_rls_legado();                -- ativa (só passa
--                                                            se não sobrar nulo)
--
-- IDEMPOTENTE. Executar após 01..08.
-- =====================================================================

-- Garante a coluna em todas as tabelas envolvidas
alter table if exists public.tarefas                add column if not exists tenant_id uuid;
alter table if exists public.atividades_lead        add column if not exists tenant_id uuid;
alter table if exists public.documentos_lead        add column if not exists tenant_id uuid;
alter table if exists public.funcionarios           add column if not exists tenant_id uuid;
alter table if exists public.metas                  add column if not exists tenant_id uuid;
alter table if exists public.cliente_status_history add column if not exists tenant_id uuid;

create index if not exists idx_tarefas_tenant on public.tarefas (tenant_id);
create index if not exists idx_atividades_lead_tenant on public.atividades_lead (tenant_id);
create index if not exists idx_documentos_lead_tenant on public.documentos_lead (tenant_id);
create index if not exists idx_funcionarios_tenant on public.funcionarios (tenant_id);
create index if not exists idx_metas_tenant on public.metas (tenant_id);
create index if not exists idx_cliente_status_history_tenant on public.cliente_status_history (tenant_id);

-- ---------------------------------------------------------------------
-- PASSO 1 — BACKFILL
-- Deriva o tenant de cada linha a partir do negócio/funcionário
-- relacionado. Se o banco tiver um único tenant, ele vira o padrão para
-- o que sobrar órfão (caso da instalação atual, single-tenant).
-- ---------------------------------------------------------------------
create or replace function public.backfill_tenant_legado()
returns table(tabela text, linhas_preenchidas bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant_unico uuid;
    v_qtd bigint;
begin
    -- Único tenant existente? Ele é o fallback dos órfãos.
    -- (não existe min(uuid) no Postgres — daí o count + limit 1)
    if (select count(*) from public.empresas) = 1 then
        select id into v_tenant_unico from public.empresas limit 1;
    end if;

    -- tarefas: pelo negócio vinculado (id novo ou id legado)
    update public.tarefas t set tenant_id = n.tenant_id
    from public.negocios n
    where t.tenant_id is null
      and t.cliente_id is not null
      and (t.cliente_id = n.id::text or t.cliente_id = n.legado_cliente_id);
    get diagnostics v_qtd = row_count;
    tabela := 'tarefas (por negócio)'; linhas_preenchidas := v_qtd; return next;

    -- atividades_lead
    update public.atividades_lead a set tenant_id = n.tenant_id
    from public.negocios n
    where a.tenant_id is null
      and a.cliente_id is not null
      and (a.cliente_id = n.id::text or a.cliente_id = n.legado_cliente_id);
    get diagnostics v_qtd = row_count;
    tabela := 'atividades_lead (por negócio)'; linhas_preenchidas := v_qtd; return next;

    -- documentos_lead
    update public.documentos_lead d set tenant_id = n.tenant_id
    from public.negocios n
    where d.tenant_id is null
      and d.cliente_id is not null
      and (d.cliente_id = n.id::text or d.cliente_id = n.legado_cliente_id);
    get diagnostics v_qtd = row_count;
    tabela := 'documentos_lead (por negócio)'; linhas_preenchidas := v_qtd; return next;

    -- cliente_status_history
    update public.cliente_status_history h set tenant_id = n.tenant_id
    from public.negocios n
    where h.tenant_id is null
      and h.cliente_id is not null
      and h.cliente_id::text = n.legado_cliente_id;
    get diagnostics v_qtd = row_count;
    tabela := 'cliente_status_history (por negócio)'; linhas_preenchidas := v_qtd; return next;

    -- funcionarios: pelo vínculo do usuário, quando houver
    update public.funcionarios f set tenant_id = t.tenant_id
    from (
        select ue.auth_uid, coalesce(
            to_jsonb(ue) ->> 'empresa_id',
            to_jsonb(ue) ->> 'tenant_id',
            to_jsonb(ue) ->> 'company_id',
            to_jsonb(ue) ->> 'id_empresa'
        )::uuid as tenant_id
        from public.utilizadores_empresas ue
    ) t
    where f.tenant_id is null and f.user_id = t.auth_uid and t.tenant_id is not null;
    get diagnostics v_qtd = row_count;
    tabela := 'funcionarios (por vínculo)'; linhas_preenchidas := v_qtd; return next;

    -- metas: pelo funcionário
    update public.metas m set tenant_id = f.tenant_id
    from public.funcionarios f
    where m.tenant_id is null and m.funcionario_id = f.id and f.tenant_id is not null;
    get diagnostics v_qtd = row_count;
    tabela := 'metas (por funcionário)'; linhas_preenchidas := v_qtd; return next;

    -- Fallback single-tenant para tudo que sobrou
    if v_tenant_unico is not null then
        update public.tarefas set tenant_id = v_tenant_unico where tenant_id is null;
        get diagnostics v_qtd = row_count;
        tabela := 'tarefas (fallback tenant único)'; linhas_preenchidas := v_qtd; return next;

        update public.atividades_lead set tenant_id = v_tenant_unico where tenant_id is null;
        get diagnostics v_qtd = row_count;
        tabela := 'atividades_lead (fallback)'; linhas_preenchidas := v_qtd; return next;

        update public.documentos_lead set tenant_id = v_tenant_unico where tenant_id is null;
        get diagnostics v_qtd = row_count;
        tabela := 'documentos_lead (fallback)'; linhas_preenchidas := v_qtd; return next;

        update public.cliente_status_history set tenant_id = v_tenant_unico where tenant_id is null;
        get diagnostics v_qtd = row_count;
        tabela := 'cliente_status_history (fallback)'; linhas_preenchidas := v_qtd; return next;

        update public.funcionarios set tenant_id = v_tenant_unico where tenant_id is null;
        get diagnostics v_qtd = row_count;
        tabela := 'funcionarios (fallback)'; linhas_preenchidas := v_qtd; return next;

        update public.metas set tenant_id = v_tenant_unico where tenant_id is null;
        get diagnostics v_qtd = row_count;
        tabela := 'metas (fallback)'; linhas_preenchidas := v_qtd; return next;

        update public.pipeline_stages set tenant_id = v_tenant_unico where tenant_id is null;
        get diagnostics v_qtd = row_count;
        tabela := 'pipeline_stages (fallback)'; linhas_preenchidas := v_qtd; return next;

        -- clientes ainda como tabela física (produção antes da virada)
        if exists (
            select 1 from information_schema.tables
            where table_schema = 'public' and table_name = 'clientes' and table_type = 'BASE TABLE'
        ) then
            execute 'update public.clientes set tenant_id = $1 where tenant_id is null'
                using v_tenant_unico;
            get diagnostics v_qtd = row_count;
            tabela := 'clientes (fallback)'; linhas_preenchidas := v_qtd; return next;
        end if;
    else
        tabela := 'AVISO: mais de um tenant — órfãos exigem revisão manual';
        linhas_preenchidas := 0;
        return next;
    end if;
end;
$$;

-- ---------------------------------------------------------------------
-- PASSO 2 — DIAGNÓSTICO: o que ainda ficaria invisível ao ligar a RLS
-- ---------------------------------------------------------------------
create or replace function public.diagnostico_tenant_legado()
returns table(tabela text, linhas_sem_tenant bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tabela text;
    v_qtd bigint;
begin
    foreach v_tabela in array array[
        'tarefas', 'atividades_lead', 'documentos_lead',
        'funcionarios', 'metas', 'cliente_status_history', 'pipeline_stages',
        'clientes', 'clientes_legado'
    ] loop
        -- Só tabelas físicas: a view de compatibilidade não tem linhas próprias
        if to_regclass('public.' || v_tabela) is not null and exists (
            select 1 from information_schema.tables
            where table_schema = 'public' and table_name = v_tabela and table_type = 'BASE TABLE'
        ) then
            execute format('select count(*) from public.%I where tenant_id is null', v_tabela)
                into v_qtd;
            if v_qtd > 0 then
                tabela := v_tabela;
                linhas_sem_tenant := v_qtd;
                return next;
            end if;
        end if;
    end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- PASSO 3 — ATIVAÇÃO DA RLS
-- Recusa ativar se ainda houver linha sem tenant (evita dado sumir da tela).
-- ---------------------------------------------------------------------
create or replace function public.aplicar_rls_legado(p_forcar boolean default false)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_pendentes text;
    v_tabela text;
begin
    select string_agg(tabela || ': ' || linhas_sem_tenant, ', ')
    into v_pendentes
    from public.diagnostico_tenant_legado();

    if v_pendentes is not null and not p_forcar then
        raise exception
            'Ainda há linhas sem tenant_id (%). Rode backfill_tenant_legado() antes, ou chame aplicar_rls_legado(true) assumindo que essas linhas ficarão inacessíveis.',
            v_pendentes;
    end if;

    foreach v_tabela in array array[
        'tarefas', 'atividades_lead', 'documentos_lead',
        'funcionarios', 'metas', 'cliente_status_history',
        -- "clientes" entra aqui enquanto ainda for TABELA FÍSICA: é o que a
        -- produção usa hoje e precisa de isolamento agora, não só depois da
        -- virada para o modelo novo. Quando virar view, é ignorada abaixo.
        'clientes', 'clientes_legado'
    ] loop
        if to_regclass('public.' || v_tabela) is null then
            continue;
        end if;

        -- Views não aceitam RLS (a segurança delas vem do security_invoker)
        if not exists (
            select 1 from information_schema.tables
            where table_schema = 'public' and table_name = v_tabela and table_type = 'BASE TABLE'
        ) then
            continue;
        end if;

        execute format('alter table public.%I enable row level security', v_tabela);

        -- Remove as policies antigas permissivas (using(true))
        execute format(
            'drop policy if exists %I on public.%I',
            v_tabela || '_authenticated_all', v_tabela
        );
        execute format('drop policy if exists %I on public.%I', v_tabela || '_tenant_isolation', v_tabela);

        execute format(
            'create policy %I on public.%I for all to authenticated using (public.tenant_filter(tenant_id)) with check (public.tenant_filter(tenant_id))',
            v_tabela || '_tenant_isolation', v_tabela
        );

        -- Preenchimento automático do tenant no insert
        execute format('drop trigger if exists set_tenant_id on public.%I', v_tabela);
        execute format(
            'create trigger set_tenant_id before insert on public.%I for each row execute function public.fn_set_tenant_id()',
            v_tabela
        );
    end loop;

    -- empresas: o usuário só enxerga a própria empresa
    if to_regclass('public.empresas') is not null then
        execute 'alter table public.empresas enable row level security';
        execute 'drop policy if exists empresas_proprio_tenant on public.empresas';
        execute 'create policy empresas_proprio_tenant on public.empresas for select to authenticated using (id = public.current_tenant_id() or public.is_system_admin())';
    end if;

    -- utilizadores_empresas: cada um enxerga apenas o próprio vínculo.
    -- current_tenant_id() é SECURITY DEFINER, então continua funcionando.
    if to_regclass('public.utilizadores_empresas') is not null then
        execute 'alter table public.utilizadores_empresas enable row level security';
        execute 'drop policy if exists utilizadores_empresas_proprio on public.utilizadores_empresas';
        execute 'create policy utilizadores_empresas_proprio on public.utilizadores_empresas for select to authenticated using (auth_uid = auth.uid() or public.is_system_admin())';
    end if;

    return 'RLS aplicada nas tabelas legadas.'
        || case when v_pendentes is not null then ' ATENÇÃO: linhas sem tenant ficaram inacessíveis (' || v_pendentes || ').' else '' end;
end;
$$;

-- ---------------------------------------------------------------------
-- Execução automática quando é SEGURO (instalação single-tenant):
-- faz o backfill e ativa a RLS. Em base multi-tenant com órfãos, apenas
-- avisa e deixa a ativação para o operador.
-- ---------------------------------------------------------------------
do $$
declare
    v_pendentes text;
begin
    -- O backfill é seguro em qualquer estado: em banco vazio não faz nada,
    -- em banco com dados deriva o tenant das relações existentes.
    perform public.backfill_tenant_legado();

    select string_agg(tabela || ': ' || linhas_sem_tenant, ', ')
    into v_pendentes
    from public.diagnostico_tenant_legado();

    if v_pendentes is null then
        -- Nenhuma linha ficaria órfã: ativar agora é seguro. Banco recém
        -- instalado cai aqui (nada a perder), e é o melhor momento possível.
        perform public.aplicar_rls_legado();
        raise notice 'RLS das tabelas legadas ATIVADA.';
    else
        raise notice
            'RLS legada NÃO ativada: há linhas sem tenant (%). Resolva e rode: select public.aplicar_rls_legado();',
            v_pendentes;
    end if;
end $$;
