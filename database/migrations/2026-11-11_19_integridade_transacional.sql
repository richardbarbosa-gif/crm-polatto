-- =====================================================================
-- CRM Polatto — Migration 19: integridade transacional e histórico com
-- relógio do servidor. (Auditoria 2026-11-10: P3-01 a P3-08.)
--
--   1. RELÓGIO E AUTORIA DO SERVIDOR (P3-01, P3-06, P3-07)
--      Datas e autores deixam de vir do navegador:
--        negocios.fechado_em   — carimbado ao entrar em ganho/perda
--        atividades_lead       — created_at e autor (nome do funcionário)
--        deleted_at (lixeira)  — hora do servidor
--      e o "Motivo da perda" entra na timeline por trigger (antes era uma
--      segunda chamada do navegador, que podia falhar depois de o card
--      já ter sido movido).
--   2. OPERAÇÕES DE VÁRIAS ETAPAS VIRAM UMA TRANSAÇÃO (P3-02 a P3-05)
--        salvar_membro_equipe     — funcionário + papel + meta do mês
--        salvar_metas_mes         — metas da equipe inteira, tudo ou nada
--        registrar_documento_lead — versão + substituição + registro
--        excluir_etapa            — move os negócios e apaga a etapa
--      Todas SECURITY INVOKER: quem decide o que o usuário pode é a RLS
--      e os triggers de papel que já existem.
--   3. metas: uma meta por funcionário por mês (índice único).
--   4. AUDITORIA E LIMPEZA (P3-08): audit_log em tarefas, negocios_pessoas,
--      consentimentos, orcamento_itens e nas alterações de atividades_lead;
--      limpeza técnica e política de retenção agendadas no pg_cron.
--
-- Só cria objetos novos (nenhuma função de migration anterior é
-- redefinida): pode ser reexecutada a qualquer momento, em qualquer ordem
-- depois da 18. Idempotente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Quem é o usuário, para carimbar autoria em texto
-- ---------------------------------------------------------------------
create or replace function public.nome_do_usuario_atual()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(
        (
            select nullif(btrim(f.nome), '')
            from public.funcionarios f
            where f.user_id = auth.uid()
              and f.tenant_id = public.current_tenant_id()
            order by f.deleted_at nulls first
            limit 1
        ),
        nullif(auth.jwt() ->> 'email', ''),
        'sistema'
    );
$$;

comment on function public.nome_do_usuario_atual() is 'Nome do funcionário ligado ao login na empresa ativa (ou o e-mail do login). Usado para carimbar autoria em colunas de texto.';

-- ---------------------------------------------------------------------
-- 1a. FECHAMENTO DO NEGÓCIO — data do servidor
-- A view clientes repassa a data_fechamento que o navegador enviar. Pela
-- API o navegador só decide SE o negócio está fechado, nunca QUANDO:
--   abriu -> fechou ............................ agora
--   fechado, trocou ganho <-> perda ............ agora (é outro desfecho)
--   fechado, mesma etapa ou mesmo desfecho ..... mantém a data original
--   reabriu (nulo) ............................. nulo
-- Ninguém antedata uma venda. Contexto administrativo (SQL Editor,
-- migração de dados) não é afetado.
-- ---------------------------------------------------------------------
create or replace function public.fn_negocios_fechamento_servidor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_desfecho_novo text;
    v_desfecho_antigo text;
begin
    if not public.requisicao_api_publica() or new.fechado_em is null then
        return new;
    end if;

    if tg_op = 'INSERT' or old.fechado_em is null then
        new.fechado_em := now();
        return new;
    end if;

    if new.stage_id is distinct from old.stage_id then
        select case when s.ganho then 'ganho' when s.perdido then 'perda' end into v_desfecho_novo
        from public.pipeline_stages s where s.id = new.stage_id;
        select case when s.ganho then 'ganho' when s.perdido then 'perda' end into v_desfecho_antigo
        from public.pipeline_stages s where s.id = old.stage_id;
        if v_desfecho_novo is distinct from v_desfecho_antigo then
            new.fechado_em := now();
            return new;
        end if;
    end if;

    new.fechado_em := old.fechado_em;
    return new;
end;
$$;

drop trigger if exists fechamento_servidor on public.negocios;
create trigger fechamento_servidor
    before insert or update on public.negocios
    for each row execute function public.fn_negocios_fechamento_servidor();

-- ---------------------------------------------------------------------
-- 1b. ATIVIDADES — data e autor do servidor
-- Complementa a migration 18 (que carimba created_by). Pela API:
--   INSERT: created_at = agora; criado_por/author = nome do usuário.
--   UPDATE: data e autoria não mudam.
-- data_atividade (QUANDO a ligação/visita aconteceu) continua livre: é
-- informação de negócio, não trilha de auditoria.
-- SECURITY INVOKER: current_user distingue API de trigger do sistema.
-- ---------------------------------------------------------------------
create or replace function public.fn_atividades_lead_carimbo()
returns trigger
language plpgsql
set search_path = public
as $$
declare
    v_autor text;
begin
    if current_user not in ('authenticated', 'anon') then
        return new;
    end if;

    if tg_op = 'INSERT' then
        v_autor := public.nome_do_usuario_atual();
        new.created_at := now();
        new.criado_por := v_autor;
        new.author := v_autor;
    else
        new.created_at := old.created_at;
        new.criado_por := old.criado_por;
        new.author := old.author;
    end if;
    return new;
end;
$$;

drop trigger if exists atividades_lead_carimbo on public.atividades_lead;
create trigger atividades_lead_carimbo
    before insert or update on public.atividades_lead
    for each row execute function public.fn_atividades_lead_carimbo();

-- ---------------------------------------------------------------------
-- 1c. MOTIVO DA PERDA na timeline, na MESMA transação que move o card
-- ---------------------------------------------------------------------
create or replace function public.fn_registrar_motivo_perda()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_autor text := public.nome_do_usuario_atual();
begin
    if nullif(btrim(coalesce(new.motivo_perda, '')), '') is null
       or new.motivo_perda is not distinct from old.motivo_perda then
        return new;
    end if;

    insert into public.atividades_lead (
        tenant_id, cliente_id, tipo, activity_type, titulo, title,
        descricao, notes, criado_por, author, data_atividade
    ) values (
        new.tenant_id, new.id::text, 'perda', 'perda', 'Motivo da perda', 'Motivo da perda',
        new.motivo_perda, new.motivo_perda, v_autor, v_autor, now()
    );
    return new;
exception when others then
    -- A timeline nunca impede a movimentação do negócio; o motivo continua
    -- gravado em negocios.motivo_perda.
    raise warning 'fn_registrar_motivo_perda: % (%)', sqlerrm, sqlstate;
    return new;
end;
$$;

drop trigger if exists registrar_motivo_perda on public.negocios;
create trigger registrar_motivo_perda
    after update of motivo_perda on public.negocios
    for each row execute function public.fn_registrar_motivo_perda();

-- ---------------------------------------------------------------------
-- 1d. LIXEIRA — a hora da exclusão é a do servidor
-- O trigger guarda_exclusao (migration 12) decide QUEM pode e carimba
-- deleted_by; este carimba QUANDO. (orcamentos já faz isso no próprio
-- trigger, migration 13.)
-- ---------------------------------------------------------------------
create or replace function public.fn_carimbo_exclusao()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if public.requisicao_api_publica()
       and new.deleted_at is not null
       and new.deleted_at is distinct from old.deleted_at then
        new.deleted_at := now();
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
            execute format('drop trigger if exists carimbo_exclusao on public.%I', t);
            execute format(
                'create trigger carimbo_exclusao before update of deleted_at on public.%I
                 for each row execute function public.fn_carimbo_exclusao()',
                t
            );
        end if;
    end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. METAS — uma por funcionário por mês
-- ---------------------------------------------------------------------
-- Duplicatas antigas (o app fazia "update; se não achou, insert" sem
-- índice único): fica a mais recente de cada (empresa, funcionário, mês).
delete from public.metas m
using public.metas mais_nova
where m.tenant_id is not distinct from mais_nova.tenant_id
  and m.funcionario_id = mais_nova.funcionario_id
  and m.mes_referencia = mais_nova.mes_referencia
  and (m.created_at, m.id) < (mais_nova.created_at, mais_nova.id);

create unique index if not exists uq_metas_funcionario_mes
    on public.metas (tenant_id, funcionario_id, mes_referencia);

-- Grava a meta de UM funcionário no mês. Interna às RPCs abaixo.
-- Regra da tela: valor zerado não cria meta, mas zera a que existir.
create or replace function public.definir_meta_mensal(
    p_funcionario_id uuid,
    p_mes date,
    p_valor numeric,
    p_ganhos integer default null
)
returns void
language plpgsql
set search_path = public
as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_mes date := date_trunc('month', p_mes)::date;
    v_valor numeric := greatest(coalesce(p_valor, 0), 0);
    v_ganhos integer := greatest(coalesce(p_ganhos, 0), 0);
begin
    if v_tenant is null then
        raise exception 'Empresa não identificada.' using errcode = '42501';
    end if;
    if p_funcionario_id is null or not exists (
        select 1 from public.funcionarios f where f.id = p_funcionario_id and f.tenant_id = v_tenant
    ) then
        raise exception 'Funcionário não encontrado nesta empresa.' using errcode = 'P0001';
    end if;

    if v_valor > 0 or v_ganhos > 0 then
        insert into public.metas (tenant_id, funcionario_id, mes_referencia, valor_meta, target_wins)
        values (v_tenant, p_funcionario_id, v_mes, v_valor, v_ganhos)
        on conflict (tenant_id, funcionario_id, mes_referencia)
        do update set
            valor_meta = excluded.valor_meta,
            -- p_ganhos nulo = a tela não mexe na meta de quantidade
            target_wins = case when p_ganhos is null then public.metas.target_wins else excluded.target_wins end;
    else
        update public.metas
        set valor_meta = 0,
            target_wins = case when p_ganhos is null then target_wins else 0 end
        where tenant_id = v_tenant and funcionario_id = p_funcionario_id and mes_referencia = v_mes;
    end if;
end;
$$;

-- Metas da equipe inteira no mês: tudo ou nada.
-- p_metas: [{"funcionario_id": uuid, "valor_meta": number, "target_wins": number}, ...]
create or replace function public.salvar_metas_mes(p_mes date, p_metas jsonb)
returns integer
language plpgsql
set search_path = public
as $$
declare
    v_item jsonb;
    v_total integer := 0;
begin
    if p_mes is null then
        raise exception 'Informe o mês de referência.' using errcode = 'P0001';
    end if;
    if p_metas is null or jsonb_typeof(p_metas) <> 'array' then
        raise exception 'Lista de metas inválida.' using errcode = 'P0001';
    end if;
    if not public.eh_admin_do_tenant() then
        raise exception 'Somente o gerente pode definir metas.' using errcode = '42501';
    end if;

    for v_item in select * from jsonb_array_elements(p_metas) loop
        perform public.definir_meta_mensal(
            (v_item ->> 'funcionario_id')::uuid,
            p_mes,
            public.to_numeric_seguro(v_item ->> 'valor_meta'),
            coalesce(public.to_numeric_seguro(v_item ->> 'target_wins'), 0)::integer
        );
        v_total := v_total + 1;
    end loop;

    return v_total;
end;
$$;

comment on function public.salvar_metas_mes(date, jsonb) is 'Grava as metas (valor e quantidade de ganhos) de vários funcionários no mês, numa transação. Só gerente.';

-- ---------------------------------------------------------------------
-- 3. EQUIPE — editar membro (dados + papel + meta do mês) numa transação
-- A criação do login continua na Edge Function equipe-usuarios.
-- ---------------------------------------------------------------------
create or replace function public.salvar_membro_equipe(
    p_funcionario_id uuid,
    p_nome text,
    p_email text default null,
    p_cargo text default null,
    p_ativo boolean default true,
    p_papel text default null,
    p_meta_mensal numeric default null
)
returns void
language plpgsql
set search_path = public
as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_nome text := btrim(coalesce(p_nome, ''));
    v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
    v_user uuid;
    v_papel_atual text;
    v_papel_novo text;
    r jsonb;
begin
    if v_tenant is null or not public.eh_admin_do_tenant() then
        raise exception 'Somente o gerente pode alterar a equipe.' using errcode = '42501';
    end if;
    if v_nome = '' then
        raise exception 'Informe o nome.' using errcode = 'P0001';
    end if;
    if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        raise exception 'E-mail inválido.' using errcode = 'P0001';
    end if;

    select f.user_id into v_user
    from public.funcionarios f
    where f.id = p_funcionario_id and f.tenant_id = v_tenant
    for update;
    if not found then
        raise exception 'Membro não encontrado nesta empresa.' using errcode = 'P0001';
    end if;

    update public.funcionarios
    set nome = v_nome,
        -- Quem tem login entra com este e-mail: ele só muda pelo Auth.
        email = case when v_user is null then v_email else email end,
        cargo = nullif(btrim(coalesce(p_cargo, '')), ''),
        ativo = coalesce(p_ativo, true)
    where id = p_funcionario_id and tenant_id = v_tenant;

    if p_papel is not null and v_user is not null then
        v_papel_novo := public.normalizar_papel(p_papel);
        select public.normalizar_papel(ue.role) into v_papel_atual
        from public.utilizadores_empresas ue
        where ue.auth_uid = v_user and ue.empresa_id = v_tenant;

        if v_papel_atual is not null and v_papel_atual <> v_papel_novo then
            r := public.alterar_papel_membro(v_user, v_papel_novo);
            if not coalesce((r ->> 'success')::boolean, false) then
                -- Desfaz também o que já foi alterado acima.
                raise exception '%', coalesce(r ->> 'error', 'O nível de acesso não pôde ser alterado.')
                    using errcode = 'P0001';
            end if;
        end if;
    end if;

    if p_meta_mensal is not null then
        perform public.definir_meta_mensal(p_funcionario_id, current_date, p_meta_mensal, null);
    end if;
end;
$$;

comment on function public.salvar_membro_equipe(uuid, text, text, text, boolean, text, numeric) is 'Gerente edita um membro: dados, papel (via alterar_papel_membro) e meta do mês corrente, tudo numa transação — se uma parte é recusada, nada é gravado.';

-- ---------------------------------------------------------------------
-- 4. DOCUMENTOS DO LEAD — registrar o arquivo já enviado ao Storage
-- Calcula a versão com trava (dois envios simultâneos não repetem o
-- número), marca os anteriores como substituídos e insere o novo, tudo
-- ou nada. O caminho tem de estar na pasta da empresa ativa.
-- ---------------------------------------------------------------------
create or replace function public.registrar_documento_lead(
    p_cliente_id text,
    p_tipo text,
    p_nome_arquivo text,
    p_caminho_storage text,
    p_tamanho_bytes bigint
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_cliente text := nullif(btrim(coalesce(p_cliente_id, '')), '');
    v_tipo text := nullif(btrim(coalesce(p_tipo, '')), '');
    v_caminho text := coalesce(p_caminho_storage, '');
    v_versao integer;
    v_id uuid;
begin
    if v_tenant is null then
        raise exception 'Empresa não identificada.' using errcode = '42501';
    end if;
    if v_cliente is null or v_tipo is null or nullif(btrim(coalesce(p_nome_arquivo, '')), '') is null then
        raise exception 'Dados do documento incompletos.' using errcode = 'P0001';
    end if;
    if position(v_tenant::text || '/' in v_caminho) <> 1 or v_caminho like '%..%' then
        raise exception 'Caminho do arquivo fora da pasta da empresa.' using errcode = '42501';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || '|' || v_cliente || '|' || v_tipo, 0));

    select coalesce(max(d.versao), 0) + 1 into v_versao
    from public.documentos_lead d
    where d.tenant_id = v_tenant and d.cliente_id = v_cliente and d.tipo = v_tipo;

    update public.documentos_lead d
    set status = 'substituido'
    where d.tenant_id = v_tenant and d.cliente_id = v_cliente and d.tipo = v_tipo
      and lower(coalesce(d.status, '')) not in ('excluido', 'substituido');

    insert into public.documentos_lead (
        tenant_id, cliente_id, tipo, nome_arquivo, caminho_storage, tamanho_bytes, versao, status, enviado_por
    ) values (
        v_tenant, v_cliente, v_tipo, btrim(p_nome_arquivo), v_caminho, greatest(coalesce(p_tamanho_bytes, 0), 0),
        v_versao, 'ativo', public.nome_do_usuario_atual()
    )
    returning id into v_id;

    return jsonb_build_object('id', v_id, 'versao', v_versao);
end;
$$;

comment on function public.registrar_documento_lead(text, text, text, text, bigint) is 'Registra um PDF já enviado ao bucket lead-files: nova versão, anteriores viram "substituido", autor carimbado pelo banco — numa transação.';

-- ---------------------------------------------------------------------
-- 5. EXCLUIR ETAPA DO FUNIL — move os negócios e apaga, sem órfãos
-- A FK negocios.stage_id é "on delete set null": apagar a etapa com um
-- negócio dentro o deixava sem etapa (some do Kanban). Aqui a etapa é
-- travada, os negócios vão para o destino e só então ela é apagada; um
-- negócio que tente entrar nela no meio do caminho espera e é recusado.
-- ---------------------------------------------------------------------
create or replace function public.excluir_etapa(p_stage_id bigint, p_destino_id bigint default null)
returns integer
language plpgsql
set search_path = public
as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_etapa public.pipeline_stages;
    v_destino public.pipeline_stages;
    v_movidos integer := 0;
begin
    if v_tenant is null or not public.eh_admin_do_tenant() then
        raise exception 'Somente o gerente pode excluir etapas.' using errcode = '42501';
    end if;

    select * into v_etapa from public.pipeline_stages
    where id = p_stage_id and tenant_id = v_tenant
    for update;
    if not found then
        raise exception 'Etapa não encontrada.' using errcode = 'P0001';
    end if;

    if p_destino_id is not null then
        if p_destino_id = p_stage_id then
            raise exception 'A etapa de destino precisa ser diferente da excluída.' using errcode = 'P0001';
        end if;
        select * into v_destino from public.pipeline_stages
        where id = p_destino_id and tenant_id = v_tenant
        for share;
        if not found then
            raise exception 'Etapa de destino não encontrada.' using errcode = 'P0001';
        end if;

        update public.negocios n
        set stage_id = v_destino.id,
            status = v_destino.nome,
            pipeline_id = coalesce(v_destino.pipeline_id, n.pipeline_id),
            fechado_em = case
                when coalesce(v_destino.ganho, false) or coalesce(v_destino.perdido, false)
                    then coalesce(n.fechado_em, now())
                else null
            end
        where n.tenant_id = v_tenant and n.stage_id = p_stage_id;
        get diagnostics v_movidos = row_count;
    end if;

    if exists (select 1 from public.negocios n where n.tenant_id = v_tenant and n.stage_id = p_stage_id) then
        raise exception 'Esta etapa ainda tem negócios. Escolha uma etapa de destino para movê-los.'
            using errcode = 'P0001';
    end if;

    delete from public.pipeline_stages where id = p_stage_id and tenant_id = v_tenant;
    return v_movidos;
end;
$$;

comment on function public.excluir_etapa(bigint, bigint) is 'Gerente exclui uma etapa do funil movendo antes os negócios (inclusive os da lixeira) para a etapa de destino, numa transação. Devolve quantos negócios foram movidos.';

-- ---------------------------------------------------------------------
-- 6. AUDITORIA — tabelas que ficaram de fora
-- atividades_lead: só UPDATE e DELETE (as inserções SÃO o histórico;
-- auditá-las dobraria o volume sem informação nova).
-- ---------------------------------------------------------------------
do $$
declare
    t text;
begin
    foreach t in array array['tarefas', 'negocios_pessoas', 'consentimentos', 'orcamento_itens'] loop
        if to_regclass('public.' || t) is not null then
            execute format('drop trigger if exists audit_changes on public.%I', t);
            execute format(
                'create trigger audit_changes after insert or update or delete on public.%I
                 for each row execute function public.fn_audit_trigger()',
                t
            );
        end if;
    end loop;

    drop trigger if exists audit_changes on public.atividades_lead;
    create trigger audit_changes after update or delete on public.atividades_lead
        for each row execute function public.fn_audit_trigger();
end $$;

-- ---------------------------------------------------------------------
-- 7. LIMPEZA AGENDADA
-- ---------------------------------------------------------------------
create or replace function public.limpar_registros_tecnicos()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.limpar_erros_antigos();
    delete from public.rate_limit_hits where criado_em < now() - interval '7 days';
end;
$$;

comment on function public.limpar_registros_tecnicos() is 'Rotina diária (pg_cron): apaga erros de cliente com mais de 90 dias e marcas de rate limit com mais de 7.';

do $$
begin
    if not exists (select 1 from pg_namespace where nspname = 'cron') then
        raise warning 'pg_cron não instalado: agende manualmente "select public.limpar_registros_tecnicos();" e "select public.aplicar_politica_retencao();" uma vez por dia.';
        return;
    end if;
    begin
        execute $q$select cron.unschedule(jobid) from cron.job where jobname in ('crm_limpeza_tecnica', 'crm_retencao_lgpd')$q$;
        execute $q$select cron.schedule('crm_limpeza_tecnica', '41 6 * * *', 'select public.limpar_registros_tecnicos();')$q$;
        -- Só age onde o gerente ativou uma política em politicas_retencao.
        execute $q$select cron.schedule('crm_retencao_lgpd', '53 6 * * *', 'select public.aplicar_politica_retencao();')$q$;
    exception when others then
        raise warning 'Agendamento da limpeza não criado (%): agende manualmente.', sqlerrm;
    end;
end $$;

-- ---------------------------------------------------------------------
-- 8. PRIVILÉGIOS (por último: todas as funções já existem)
-- ---------------------------------------------------------------------
-- Quem executa as RPCs deste arquivo: só usuário logado.
do $$
declare
    r record;
begin
    for r in
        select p.oid::regprocedure as fn, p.proname
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public'
          and p.proname in ('salvar_metas_mes', 'salvar_membro_equipe', 'registrar_documento_lead',
                            'excluir_etapa', 'definir_meta_mensal', 'nome_do_usuario_atual',
                            'limpar_registros_tecnicos')
    loop
        execute format('revoke execute on function %s from public', r.fn);
        if exists (select 1 from pg_roles where rolname = 'anon') then
            execute format('revoke execute on function %s from anon', r.fn);
        end if;
        if exists (select 1 from pg_roles where rolname = 'authenticated') then
            -- definir_meta_mensal é SECURITY INVOKER e é chamada de dentro
            -- das RPCs com o papel do usuário: precisa do EXECUTE.
            if r.proname = 'limpar_registros_tecnicos' then
                execute format('revoke execute on function %s from authenticated', r.fn);
            else
                execute format('grant execute on function %s to authenticated', r.fn);
            end if;
        end if;
    end loop;
end $$;
