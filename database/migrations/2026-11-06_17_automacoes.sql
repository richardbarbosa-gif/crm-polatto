-- =====================================================================
-- CRM POLATTO — MIGRATION 17: AUTOMAÇÕES DO FUNIL
--
-- "Quando X, se Y, então Z", no nível do Pipedrive, 100% no Postgres
-- (Supabase gratuito, sem serviço externo).
--
--   automacoes             regra: nome, ativo, gatilho + parâmetros,
--                          condições opcionais (funil, temperatura, valor
--                          mínimo, origem). Colunas tipadas + CHECK.
--   automacoes_acoes       ações em ordem (tabela filha, validada por
--                          CHECK; FKs compostas para usuário e tipo).
--   automacoes_execucoes   log: automação, negócio, quando, ok/erro +
--                          mensagem e chave de idempotência UNIQUE.
--   automacoes_rodizio     estado do rodízio (round-robin) por regra.
--
-- Gatilhos:
--   1 negócio criado, 2 entrou na etapa X, 3 ganho, 4 perdido e
--   5 temperatura mudou para X: trigger AFTER em negocios
--   (zz_automacoes, o último dos AFTER). A view clientes e os triggers
--   dela NÃO mudam: o insert/update da tela chega em negocios.
--   6 negócio parado (regra da vw_negocios_saude / dias_para_parado) e
--   7 proposta enviada sem resposta há N dias: executar_automacoes_
--   agendadas(), só admin/cron, agendada de hora em hora pelo pg_cron
--   quando a extensão existir.
--
-- Idempotência (chave do log, por regra):
--   criado / ganho / perdido   uma vez por negócio
--   etapa / temperatura        uma vez por negócio, valor e DIA
--                              (vai-e-volta no mesmo dia não duplica)
--   parado                     uma vez por "parada" (muda quando o
--                              negócio tem atividade nova)
--   proposta sem resposta      uma vez por proposta
--
-- Segurança:
--   * só gerente (eh_admin_do_tenant) cria/edita (RLS + WITH CHECK);
--     vendedor lê; anon nada.
--   * FKs compostas (tenant_id, id) para etapa, funil, origem, tipo de
--     atividade e usuário: a regra nunca aponta para outra empresa.
--   * o motor é SECURITY DEFINER (search_path fixo, sem EXECUTE para a
--     API) e usa SEMPRE o tenant_id do próprio negócio. As ações rodam
--     em contexto de sistema (sem JWT, igual ao cron): a autoria fica
--     "sistema" no audit_log e as travas de papel não são contornadas
--     pelo usuário, porque só o motor entra nesse contexto.
--   * sem laço: ação de automação não dispara automação
--     (crm.automacao_em_execucao).
--   * falha isolada: cada regra roda num bloco próprio; o erro vai para
--     o log e o usuário salva/move o negócio normalmente.
--
-- "Notificar o gerente" = tarefa para cada gerente da empresa, com
-- vencimento imediato: aparece no sino (tarefas das próximas 24 h), no
-- Meu dia e na agenda, sem tabela nova de notificação.
--
-- Modelos prontos: 6 regras por empresa, DESATIVADAS, semeadas uma vez
-- (crm_seeds_aplicados), ligadas à etapa pelo nome quando ela existe.
--
-- Redefine vw_negocios_saude (migration 15): registro de automação na
-- timeline não conta como "contato". Se a 15 for reexecutada, rode a 17
-- de novo.
--
-- Testes: database/tests/12_teste_automacoes.sql (Suíte 12).
-- IDEMPOTENTE. ORDEM: depois da 16.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. PRÉ-REQUISITOS
-- ---------------------------------------------------------------------
do $$
begin
    if to_regprocedure('public.provisionar_defaults_pacote(uuid)') is null
       or to_regprocedure('public.provisionar_canais_origem(uuid)') is null
       or to_regprocedure('public.fn_proteger_tenant_e_carimbar()') is null
       or to_regprocedure('public.fn_guarda_exclusao()') is null
       or to_regclass('public.crm_seeds_aplicados') is null
       or to_regclass('public.canais_origem') is null
       or to_regclass('public.orcamentos') is null
       or to_regclass('public.vw_negocios_saude') is null then
        raise exception 'Migration 17 exige as migrations 12 a 16 aplicadas antes.';
    end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. ALVOS DAS FKs COMPOSTAS (id já é PK: a unicidade sempre vale)
-- ---------------------------------------------------------------------
do $$
declare
    r record;
begin
    for r in
        select * from (values
            ('pipelines', 'pipelines_tenant_id_id_uk'),
            ('pipeline_stages', 'pipeline_stages_tenant_id_id_uk'),
            ('funcionarios', 'funcionarios_tenant_id_id_uk'),
            ('tipos_atividade', 'tipos_atividade_tenant_id_id_uk'),
            ('canais_origem', 'canais_origem_tenant_id_id_uk')
        ) as t(tabela, nome)
    loop
        if not exists (
            select 1 from pg_constraint
            where conname = r.nome and conrelid = ('public.' || r.tabela)::regclass
        ) then
            execute format('alter table public.%I add constraint %I unique (tenant_id, id)', r.tabela, r.nome);
        end if;
    end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. AUTOMAÇÕES (regra)
-- ---------------------------------------------------------------------
create table if not exists public.automacoes (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    nome text not null,
    ativo boolean not null default false,
    gatilho text not null,
    gatilho_etapa_id bigint,
    gatilho_temperatura text,
    gatilho_dias integer,
    cond_pipeline_id uuid,
    cond_temperatura text,
    cond_valor_minimo numeric(14,2),
    cond_origem_id uuid,
    modelo_chave text,
    personalizado boolean not null default false,
    created_by uuid default auth.uid(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

do $$
declare
    r record;
begin
    for r in
        select * from (values
            ('automacoes_tenant_id_uk', 'unique (tenant_id, id)'),
            ('automacoes_nome_uk', 'unique (tenant_id, nome)'),
            ('automacoes_nome_ck', $c$check (length(btrim(nome)) between 1 and 80)$c$),
            ('automacoes_gatilho_ck', $c$check (gatilho in ('negocio_criado', 'etapa_entrou', 'negocio_ganho',
                'negocio_perdido', 'temperatura_mudou', 'negocio_parado', 'proposta_sem_resposta'))$c$),
            ('automacoes_gatilho_temperatura_ck', $c$check (gatilho_temperatura is null or gatilho_temperatura in ('quente', 'morno', 'frio'))$c$),
            ('automacoes_gatilho_dias_ck', $c$check (gatilho_dias is null or gatilho_dias between 1 and 365)$c$),
            ('automacoes_cond_temperatura_ck', $c$check (cond_temperatura is null or cond_temperatura in ('quente', 'morno', 'frio'))$c$),
            ('automacoes_cond_valor_ck', $c$check (cond_valor_minimo is null or cond_valor_minimo between 0 and 999999999999)$c$),
            -- Parâmetro obrigatório por gatilho (a etapa é checada na ativação:
            -- a FK zera a etapa excluída e a regra é desligada sozinha)
            ('automacoes_param_temperatura_ck', $c$check (gatilho <> 'temperatura_mudou' or gatilho_temperatura is not null)$c$),
            ('automacoes_param_dias_ck', $c$check (gatilho <> 'proposta_sem_resposta' or gatilho_dias is not null)$c$),
            ('automacoes_modelo_ck', $c$check (modelo_chave is null or length(modelo_chave) <= 40)$c$),
            ('automacoes_etapa_fk', 'foreign key (tenant_id, gatilho_etapa_id) references public.pipeline_stages (tenant_id, id) on delete set null (gatilho_etapa_id)'),
            ('automacoes_pipeline_fk', 'foreign key (tenant_id, cond_pipeline_id) references public.pipelines (tenant_id, id) on delete set null (cond_pipeline_id)'),
            ('automacoes_origem_fk', 'foreign key (tenant_id, cond_origem_id) references public.canais_origem (tenant_id, id) on delete set null (cond_origem_id)')
        ) as t(nome, definicao)
    loop
        if not exists (
            select 1 from pg_constraint
            where conname = r.nome and conrelid = 'public.automacoes'::regclass
        ) then
            execute format('alter table public.automacoes add constraint %I %s', r.nome, r.definicao);
        end if;
    end loop;
end $$;

create index if not exists idx_automacoes_disparo
    on public.automacoes (tenant_id, gatilho)
    where ativo;

comment on table public.automacoes is
    'Automações do funil ("quando X, se Y, então Z"). Leitura: tenant; escrita: gerente. Modelos prontos nascem desativados.';
comment on column public.automacoes.personalizado is
    'true quando o gerente já mexeu na regra pela tela/API: o vínculo automático de etapa dos modelos não a altera mais.';

-- ---------------------------------------------------------------------
-- 3. AÇÕES (lista ordenada, validada no banco)
-- ---------------------------------------------------------------------
create table if not exists public.automacoes_acoes (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    automacao_id uuid not null,
    ordem integer not null default 1,
    tipo text not null,
    titulo text,
    tipo_atividade_id uuid,
    prazo_quantidade integer,
    prazo_unidade text,
    responsavel_modo text,
    usuario_id uuid,
    temperatura text,
    atribuicao_modo text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

do $$
declare
    r record;
begin
    for r in
        select * from (values
            ('automacoes_acoes_ordem_uk', 'unique (automacao_id, ordem)'),
            ('automacoes_acoes_tipo_ck', $c$check (tipo in ('criar_tarefa', 'mudar_temperatura', 'atribuir_responsavel', 'notificar_gerente'))$c$),
            ('automacoes_acoes_ordem_ck', $c$check (ordem between 1 and 10)$c$),
            ('automacoes_acoes_titulo_ck', $c$check (titulo is null or length(btrim(titulo)) between 1 and 200)$c$),
            ('automacoes_acoes_prazo_ck', $c$check (prazo_quantidade is null or prazo_quantidade between 0 and 3650)$c$),
            ('automacoes_acoes_unidade_ck', $c$check (prazo_unidade is null or prazo_unidade in ('horas', 'dias'))$c$),
            ('automacoes_acoes_resp_modo_ck', $c$check (responsavel_modo is null or responsavel_modo in ('responsavel_negocio', 'usuario_fixo'))$c$),
            ('automacoes_acoes_temperatura_ck', $c$check (temperatura is null or temperatura in ('quente', 'morno', 'frio'))$c$),
            ('automacoes_acoes_atrib_modo_ck', $c$check (atribuicao_modo is null or atribuicao_modo in ('usuario_fixo', 'rodizio'))$c$),
            -- Campos obrigatórios por tipo (o usuário fixo é checado na
            -- ativação e na execução: a FK zera usuário excluído)
            ('automacoes_acoes_completa_ck', $c$check (
                (tipo = 'criar_tarefa' and titulo is not null and prazo_quantidade is not null
                    and prazo_unidade is not null and responsavel_modo is not null)
                or (tipo = 'mudar_temperatura' and temperatura is not null)
                or (tipo = 'atribuir_responsavel' and atribuicao_modo is not null)
                or (tipo = 'notificar_gerente' and titulo is not null)
            )$c$),
            ('automacoes_acoes_automacao_fk', 'foreign key (tenant_id, automacao_id) references public.automacoes (tenant_id, id) on delete cascade'),
            ('automacoes_acoes_usuario_fk', 'foreign key (tenant_id, usuario_id) references public.funcionarios (tenant_id, id) on delete set null (usuario_id)'),
            ('automacoes_acoes_tipo_atividade_fk', 'foreign key (tenant_id, tipo_atividade_id) references public.tipos_atividade (tenant_id, id) on delete set null (tipo_atividade_id)')
        ) as t(nome, definicao)
    loop
        if not exists (
            select 1 from pg_constraint
            where conname = r.nome and conrelid = 'public.automacoes_acoes'::regclass
        ) then
            execute format('alter table public.automacoes_acoes add constraint %I %s', r.nome, r.definicao);
        end if;
    end loop;
end $$;

create index if not exists idx_automacoes_acoes_automacao
    on public.automacoes_acoes (tenant_id, automacao_id, ordem);

comment on table public.automacoes_acoes is
    'Ações de uma automação, em ordem: criar_tarefa, mudar_temperatura, atribuir_responsavel (usuário fixo ou rodízio) e notificar_gerente.';

-- ---------------------------------------------------------------------
-- 4. LOG DE EXECUÇÕES (idempotência)
-- ---------------------------------------------------------------------
create table if not exists public.automacoes_execucoes (
    id bigint generated by default as identity primary key,
    tenant_id uuid not null,
    automacao_id uuid not null,
    negocio_id uuid,
    negocio_nome text,
    evento text not null,
    chave_idempotencia text not null,
    resultado text not null default 'executando',
    mensagem text,
    detalhes jsonb not null default '[]'::jsonb,
    executado_em timestamptz not null default now()
);

do $$
declare
    r record;
begin
    for r in
        select * from (values
            ('automacoes_execucoes_chave_uk', 'unique (tenant_id, chave_idempotencia)'),
            ('automacoes_execucoes_resultado_ck', $c$check (resultado in ('executando', 'ok', 'erro'))$c$),
            ('automacoes_execucoes_mensagem_ck', $c$check (mensagem is null or length(mensagem) <= 1000)$c$),
            ('automacoes_execucoes_chave_ck', $c$check (length(chave_idempotencia) between 1 and 300)$c$),
            ('automacoes_execucoes_automacao_fk', 'foreign key (tenant_id, automacao_id) references public.automacoes (tenant_id, id) on delete cascade'),
            ('automacoes_execucoes_negocio_fk', 'foreign key (tenant_id, negocio_id) references public.negocios (tenant_id, id) on delete set null (negocio_id)')
        ) as t(nome, definicao)
    loop
        if not exists (
            select 1 from pg_constraint
            where conname = r.nome and conrelid = 'public.automacoes_execucoes'::regclass
        ) then
            execute format('alter table public.automacoes_execucoes add constraint %I %s', r.nome, r.definicao);
        end if;
    end loop;
end $$;

create index if not exists idx_automacoes_execucoes_historico
    on public.automacoes_execucoes (tenant_id, automacao_id, executado_em desc);

comment on table public.automacoes_execucoes is
    'Histórico das automações (ok/erro + mensagem). Só o motor grava; o tenant lê. chave_idempotencia impede o mesmo evento de rodar duas vezes.';

-- ---------------------------------------------------------------------
-- 5. ESTADO DO RODÍZIO (round-robin por regra)
-- ---------------------------------------------------------------------
create table if not exists public.automacoes_rodizio (
    tenant_id uuid not null,
    automacao_id uuid not null,
    ultimo_funcionario_id uuid,
    ultima_chave text,
    atribuicoes bigint not null default 0,
    updated_at timestamptz not null default now(),
    primary key (tenant_id, automacao_id)
);

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'automacoes_rodizio_automacao_fk' and conrelid = 'public.automacoes_rodizio'::regclass
    ) then
        alter table public.automacoes_rodizio
            add constraint automacoes_rodizio_automacao_fk
            foreign key (tenant_id, automacao_id) references public.automacoes (tenant_id, id) on delete cascade;
    end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. TRIGGERS DE PROTEÇÃO E VALIDAÇÃO
-- ---------------------------------------------------------------------
do $$
declare
    t text;
begin
    foreach t in array array['automacoes', 'automacoes_acoes', 'automacoes_execucoes', 'automacoes_rodizio'] loop
        execute format('drop trigger if exists set_tenant_id on public.%I', t);
        execute format(
            'create trigger set_tenant_id before insert on public.%I for each row execute function public.fn_set_tenant_id()', t);
        execute format('drop trigger if exists trg_proteger_tenant on public.%I', t);
        if t <> 'automacoes_execucoes' then
            execute format(
                'create trigger trg_proteger_tenant before update on public.%I for each row execute function public.fn_proteger_tenant_e_carimbar()', t);
        end if;
    end loop;

    if to_regprocedure('public.fn_audit_trigger()') is not null then
        foreach t in array array['automacoes', 'automacoes_acoes'] loop
            execute format('drop trigger if exists audit_changes on public.%I', t);
            execute format(
                'create trigger audit_changes after insert or update or delete on public.%I for each row execute function public.fn_audit_trigger()', t);
        end loop;
    end if;
end $$;

-- O log não tem updated_at: tenant imutável sem carimbo
create or replace function public.fn_automacoes_execucoes_imutavel()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.tenant_id is distinct from old.tenant_id
       or new.automacao_id is distinct from old.automacao_id
       or new.chave_idempotencia is distinct from old.chave_idempotencia then
        raise exception 'Histórico de automação não pode ser reescrito.' using errcode = '42501';
    end if;
    return new;
end;
$$;

drop trigger if exists trg_proteger_tenant on public.automacoes_execucoes;
create trigger trg_proteger_tenant
    before update on public.automacoes_execucoes
    for each row execute function public.fn_automacoes_execucoes_imutavel();

-- O que falta para a regra poder ficar ativa (vazio = pronta). Recebe a
-- linha (NEW no trigger) e lê as ações já gravadas.
create or replace function public.automacao_pendencias(p_aut public.automacoes)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_pend text[] := '{}';
begin
    if p_aut.gatilho = 'etapa_entrou' and p_aut.gatilho_etapa_id is null then
        v_pend := v_pend || 'Escolha a etapa do gatilho.'::text;
    end if;
    if p_aut.gatilho = 'temperatura_mudou' and p_aut.gatilho_temperatura is null then
        v_pend := v_pend || 'Escolha a temperatura do gatilho.'::text;
    end if;
    if p_aut.gatilho = 'proposta_sem_resposta' and p_aut.gatilho_dias is null then
        v_pend := v_pend || 'Informe em quantos dias sem resposta.'::text;
    end if;
    if not exists (
        select 1 from public.automacoes_acoes a
        where a.automacao_id = p_aut.id and a.tenant_id = p_aut.tenant_id
    ) then
        v_pend := v_pend || 'Inclua pelo menos uma ação.'::text;
    end if;
    if exists (
        select 1 from public.automacoes_acoes a
        where a.automacao_id = p_aut.id and a.tenant_id = p_aut.tenant_id
          and a.usuario_id is null
          and ((a.tipo = 'criar_tarefa' and a.responsavel_modo = 'usuario_fixo')
               or (a.tipo = 'atribuir_responsavel' and a.atribuicao_modo = 'usuario_fixo'))
    ) then
        v_pend := v_pend || 'Escolha o usuário fixo da ação.'::text;
    end if;
    return v_pend;
end;
$$;

-- BEFORE na regra:
--   * pela tela/API (profundidade 1): regra ativa precisa estar completa;
--     edição marca a regra como personalizada.
--   * em cascata (FK zerou a etapa excluída, profundidade > 1): regra
--     ativa que perdeu a etapa é desligada, nunca passa a valer para
--     qualquer etapa.
create or replace function public.fn_automacoes_validar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_pend text[];
begin
    if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then
        if new.ativo and (
            (old.gatilho_etapa_id is not null and new.gatilho_etapa_id is null)
            or (old.cond_pipeline_id is not null and new.cond_pipeline_id is null)
            or (old.cond_origem_id is not null and new.cond_origem_id is null)
        ) then
            new.ativo := false;
        end if;
        return new;
    end if;

    if public.requisicao_api_publica() and tg_op = 'UPDATE' then
        new.personalizado := true;
    end if;

    if new.ativo then
        if tg_op = 'INSERT' then
            raise exception 'Salve a automação com as ações antes de ativá-la.' using errcode = '23514';
        end if;
        v_pend := public.automacao_pendencias(new);
        if cardinality(v_pend) > 0 then
            raise exception 'Automação incompleta: %', array_to_string(v_pend, ' ') using errcode = '23514';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_automacoes_validar on public.automacoes;
create trigger trg_automacoes_validar
    before insert or update on public.automacoes
    for each row execute function public.fn_automacoes_validar();

-- Na ação: usuário fixo excluído (FK zerou) desliga a regra.
create or replace function public.fn_automacoes_acoes_usuario_removido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if pg_trigger_depth() > 1
       and old.usuario_id is not null and new.usuario_id is null
       and ((new.tipo = 'criar_tarefa' and new.responsavel_modo = 'usuario_fixo')
            or (new.tipo = 'atribuir_responsavel' and new.atribuicao_modo = 'usuario_fixo')) then
        update public.automacoes set ativo = false
        where id = new.automacao_id and tenant_id = new.tenant_id and ativo;
    end if;
    return new;
end;
$$;

-- BEFORE: na cascada da FK o BEFORE roda em profundidade 2 (o AFTER
-- ficaria para o fim do comando externo, em profundidade 1)
drop trigger if exists trg_automacoes_acoes_usuario_removido on public.automacoes_acoes;
create trigger trg_automacoes_acoes_usuario_removido
    before update of usuario_id on public.automacoes_acoes
    for each row execute function public.fn_automacoes_acoes_usuario_removido();

-- ---------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------
alter table public.automacoes enable row level security;
alter table public.automacoes_acoes enable row level security;
alter table public.automacoes_execucoes enable row level security;
alter table public.automacoes_rodizio enable row level security;

do $$
declare
    t text;
begin
    foreach t in array array['automacoes', 'automacoes_acoes'] loop
        execute format('drop policy if exists %I on public.%I', t || '_leitura', t);
        execute format(
            'create policy %I on public.%I for select to authenticated using (public.tenant_filter(tenant_id))',
            t || '_leitura', t);
        execute format('drop policy if exists %I on public.%I', t || '_escrita_gerente', t);
        execute format(
            'create policy %I on public.%I for all to authenticated
             using (public.tenant_filter(tenant_id) and public.eh_admin_do_tenant(tenant_id))
             with check (public.tenant_filter(tenant_id) and public.eh_admin_do_tenant(tenant_id))',
            t || '_escrita_gerente', t);
    end loop;

    -- Log e rodízio: leitura do tenant; escrita só pelo motor (sem policy)
    foreach t in array array['automacoes_execucoes', 'automacoes_rodizio'] loop
        execute format('drop policy if exists %I on public.%I', t || '_leitura', t);
        execute format(
            'create policy %I on public.%I for select to authenticated using (public.tenant_filter(tenant_id))',
            t || '_leitura', t);
    end loop;
end $$;

-- ---------------------------------------------------------------------
-- 8. RESUMO PARA A LISTA (contadores) — security_invoker
-- ---------------------------------------------------------------------
create or replace view public.vw_automacoes_resumo
with (security_invoker = on)
as
select
    a.id as automacao_id,
    a.tenant_id,
    count(e.id)::bigint as total_execucoes,
    count(e.id) filter (where e.resultado = 'erro')::bigint as total_erros,
    max(e.executado_em) as ultima_execucao_em,
    max(e.executado_em) filter (where e.resultado = 'erro') as ultimo_erro_em
from public.automacoes a
left join public.automacoes_execucoes e
    on e.tenant_id = a.tenant_id and e.automacao_id = a.id
group by a.id, a.tenant_id;

comment on view public.vw_automacoes_resumo is
    'Execuções e erros por automação (security_invoker: respeita a RLS do usuário).';

-- ---------------------------------------------------------------------
-- 9. MOTOR
-- ---------------------------------------------------------------------

-- Contexto de sistema (igual ao cron): sem JWT, auth.uid() nulo e
-- requisicao_api_publica() falso. Guarda e devolve os valores da sessão
-- (inclusive os GUCs legados request.jwt.claim.*). Só o motor usa.
create or replace function public.automacao_entrar_contexto_sistema()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_salvo jsonb := jsonb_build_object(
        'claims', current_setting('request.jwt.claims', true),
        'sub', current_setting('request.jwt.claim.sub', true),
        'role', current_setting('request.jwt.claim.role', true));
begin
    perform set_config('request.jwt.claims', '', true);
    if v_salvo ->> 'sub' is not null then
        perform set_config('request.jwt.claim.sub', '', true);
    end if;
    if v_salvo ->> 'role' is not null then
        perform set_config('request.jwt.claim.role', '', true);
    end if;
    return v_salvo;
end;
$$;

create or replace function public.automacao_sair_contexto_sistema(p_salvo jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    perform set_config('request.jwt.claims', coalesce(p_salvo ->> 'claims', ''), true);
    if p_salvo ->> 'sub' is not null then
        perform set_config('request.jwt.claim.sub', p_salvo ->> 'sub', true);
    end if;
    if p_salvo ->> 'role' is not null then
        perform set_config('request.jwt.claim.role', p_salvo ->> 'role', true);
    end if;
end;
$$;

-- Situação do negócio pela etapa (mesma regra da vw_negocios_saude)
create or replace function public.automacao_situacao(p_stage_id bigint, p_status text)
returns text
language sql
stable
security definer
set search_path = public
as $$
    select case
        when coalesce(ps.ganho, false) then 'ganho'
        when coalesce(ps.perdido, false) then 'perdido'
        when lower(coalesce(ps.nome, p_status, '')) ~ 'perdid' then 'perdido'
        when lower(coalesce(ps.nome, p_status, '')) ~ '(fechad|ganh)' then 'ganho'
        else 'aberto'
    end
    from (select 1) as x
    left join public.pipeline_stages ps on ps.id = p_stage_id;
$$;

-- Valor de tarefas.tipo igual ao que a agenda grava (nome sem acento, minúsculo)
create or replace function public.automacao_tipo_tarefa(p_nome text)
returns text
language sql
immutable
set search_path = public
as $$
    select coalesce(
        nullif(translate(lower(btrim(coalesce(p_nome, ''))),
            'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), ''),
        'tarefa');
$$;

create or replace function public.automacao_condicoes_ok(p_aut public.automacoes, p_neg public.negocios)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_pipeline uuid;
begin
    if p_aut.cond_pipeline_id is not null then
        v_pipeline := p_neg.pipeline_id;
        if v_pipeline is null and p_neg.stage_id is not null then
            select ps.pipeline_id into v_pipeline
            from public.pipeline_stages ps
            where ps.id = p_neg.stage_id and ps.tenant_id = p_neg.tenant_id;
        end if;
        if v_pipeline is distinct from p_aut.cond_pipeline_id then
            return false;
        end if;
    end if;
    if p_aut.cond_temperatura is not null
       and lower(btrim(coalesce(p_neg.temperatura, ''))) is distinct from p_aut.cond_temperatura then
        return false;
    end if;
    if p_aut.cond_valor_minimo is not null and coalesce(p_neg.valor, 0) < p_aut.cond_valor_minimo then
        return false;
    end if;
    if p_aut.cond_origem_id is not null
       and (p_neg.dados_extras ->> 'origem_id') is distinct from p_aut.cond_origem_id::text then
        return false;
    end if;
    return true;
end;
$$;

-- Registro na timeline do lead (mesmo mecanismo das migrations 04/15:
-- insert só com as colunas que atividades_lead tem)
create or replace function public.automacao_registrar_timeline(
    p_tenant_id uuid,
    p_negocio_id uuid,
    p_automacao_nome text,
    p_titulo text,
    p_descricao text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_autor text := format('Automação «%s»', p_automacao_nome);
    v_payload jsonb;
    v_cols text;
    v_vals text;
begin
    v_payload := jsonb_strip_nulls(jsonb_build_object(
        'cliente_id',    p_negocio_id::text,
        'tenant_id',     p_tenant_id::text,
        'activity_type', 'automacao',
        'tipo',          'automacao',
        'titulo',        p_titulo,
        'title',         p_titulo,
        'descricao',     coalesce(p_descricao, p_titulo),
        'notes',         coalesce(p_descricao, p_titulo),
        'criado_por',    v_autor,
        'author',        v_autor
    ));

    select string_agg(quote_ident(k), ', '), string_agg(quote_literal(v), ', ')
    into v_cols, v_vals
    from jsonb_each_text(v_payload) as e(k, v)
    where public.tem_coluna('atividades_lead', k);

    if v_cols is null then
        return;
    end if;
    if public.tem_coluna('atividades_lead', 'data_atividade') then
        v_cols := v_cols || ', data_atividade';
        v_vals := v_vals || ', now()';
    end if;
    execute format('insert into public.atividades_lead (%s) values (%s)', v_cols, v_vals);
end;
$$;

-- Próximo vendedor do rodízio: fila em ordem estável (nome, id); o
-- próximo é o primeiro depois do último sorteado, com volta ao início.
-- Linha de estado travada (FOR UPDATE): duas atribuições simultâneas
-- nunca escolhem o mesmo vendedor fora da vez.
create or replace function public.automacao_proximo_rodizio(p_tenant_id uuid, p_automacao_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ultima text;
    v_id uuid;
    v_chave text;
begin
    insert into public.automacoes_rodizio (tenant_id, automacao_id)
    values (p_tenant_id, p_automacao_id)
    on conflict do nothing;

    select r.ultima_chave into v_ultima
    from public.automacoes_rodizio r
    where r.tenant_id = p_tenant_id and r.automacao_id = p_automacao_id
    for update;

    with fila as (
        select f.id, (lower(btrim(f.nome)) || '|' || f.id::text) collate "C" as chave
        from public.funcionarios f
        where f.tenant_id = p_tenant_id
          and f.deleted_at is null
          and coalesce(f.ativo, true)
          and not exists (
              select 1 from public.utilizadores_empresas ue
              where ue.empresa_id = p_tenant_id
                and f.user_id is not null
                and ue.auth_uid = f.user_id
                and lower(coalesce(ue.role::text, '')) ~ '(admin|owner|gerente|gestor|manager)'
          )
    )
    select x.id, x.chave into v_id, v_chave
    from (
        select fila.id, fila.chave, 0 as prioridade from fila
        where v_ultima is not null and fila.chave > (v_ultima collate "C")
        union all
        select fila.id, fila.chave, 1 from fila
    ) as x
    order by x.prioridade, x.chave
    limit 1;

    if v_id is null then
        raise exception 'Nenhum vendedor ativo para o rodízio.';
    end if;

    update public.automacoes_rodizio
    set ultimo_funcionario_id = v_id,
        ultima_chave = v_chave,
        atribuicoes = atribuicoes + 1
    where tenant_id = p_tenant_id and automacao_id = p_automacao_id;

    return v_id;
end;
$$;

-- Executa UMA ação. Erro = exceção (o chamador desfaz a regra inteira e
-- grava o erro no log).
create or replace function public.automacao_executar_acao(
    p_aut public.automacoes,
    p_acao public.automacoes_acoes,
    p_negocio_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_neg public.negocios%rowtype;
    v_func public.funcionarios%rowtype;
    v_resp text;
    v_tipo text;
    v_vence timestamptz;
    v_tarefa_id bigint;
    v_tarefa_tenant uuid;
    v_gerentes text[] := '{}';
    v_proximo uuid;
    r record;
begin
    -- Sempre o tenant da regra = tenant do negócio (relido a cada ação:
    -- uma atribuição anterior muda o responsável da próxima tarefa)
    select * into v_neg from public.negocios
    where id = p_negocio_id and tenant_id = p_aut.tenant_id and deleted_at is null;
    if not found then
        raise exception 'Negócio não encontrado nesta empresa.';
    end if;

    if p_acao.tipo = 'criar_tarefa' then
        if p_acao.responsavel_modo = 'usuario_fixo' then
            select * into v_func from public.funcionarios f
            where f.id = p_acao.usuario_id and f.tenant_id = p_aut.tenant_id
              and f.deleted_at is null and coalesce(f.ativo, true);
            if not found then
                raise exception 'O usuário escolhido na ação não está ativo nesta empresa.';
            end if;
            v_resp := v_func.nome;
        else
            if v_neg.responsavel_id is not null then
                select f.nome into v_resp from public.funcionarios f
                where f.id = v_neg.responsavel_id and f.tenant_id = p_aut.tenant_id;
            end if;
            v_resp := coalesce(nullif(btrim(v_resp), ''), nullif(btrim(v_neg.responsavel), ''));
        end if;

        select public.automacao_tipo_tarefa(ta.nome) into v_tipo
        from public.tipos_atividade ta
        where ta.id = p_acao.tipo_atividade_id and ta.tenant_id = p_aut.tenant_id;
        v_tipo := coalesce(v_tipo, 'tarefa');

        v_vence := now() + case p_acao.prazo_unidade
            when 'horas' then make_interval(hours => p_acao.prazo_quantidade)
            else make_interval(days => p_acao.prazo_quantidade)
        end;

        -- created_by nulo: a tarefa é do responsável (dono = responsável),
        -- como as demais tarefas do negócio (guarda_exclusao, migration 12)
        insert into public.tarefas (tenant_id, titulo, descricao, tipo, data_vencimento, cliente_id, responsavel, concluido, created_by)
        values (
            p_aut.tenant_id, btrim(p_acao.titulo),
            format('Criada pela automação «%s».', p_aut.nome),
            v_tipo, v_vence, v_neg.id::text, v_resp, false, null
        )
        returning id, tenant_id into v_tarefa_id, v_tarefa_tenant;
        if v_tarefa_tenant is distinct from p_aut.tenant_id then
            raise exception 'Isolamento: tarefa fora da empresa do negócio.';
        end if;

        perform public.automacao_registrar_timeline(
            p_aut.tenant_id, v_neg.id, p_aut.nome,
            format('Automação «%s» criou a tarefa «%s»', p_aut.nome, btrim(p_acao.titulo)),
            format('Prazo: %s. Responsável: %s.',
                to_char(v_vence at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
                coalesce(v_resp, 'sem responsável')));
        return jsonb_build_object('acao', 'criar_tarefa', 'tarefa_id', v_tarefa_id,
            'titulo', btrim(p_acao.titulo), 'responsavel', v_resp, 'vencimento', v_vence);

    elsif p_acao.tipo = 'mudar_temperatura' then
        if lower(btrim(coalesce(v_neg.temperatura, ''))) = p_acao.temperatura then
            return jsonb_build_object('acao', 'mudar_temperatura', 'temperatura', p_acao.temperatura, 'sem_mudanca', true);
        end if;
        update public.negocios set temperatura = p_acao.temperatura
        where id = v_neg.id and tenant_id = p_aut.tenant_id;
        perform public.automacao_registrar_timeline(
            p_aut.tenant_id, v_neg.id, p_aut.nome,
            format('Automação «%s» mudou a temperatura para %s', p_aut.nome, public.rotulo_temperatura(p_acao.temperatura)));
        return jsonb_build_object('acao', 'mudar_temperatura', 'de', v_neg.temperatura, 'para', p_acao.temperatura);

    elsif p_acao.tipo = 'atribuir_responsavel' then
        if p_acao.atribuicao_modo = 'rodizio' then
            v_proximo := public.automacao_proximo_rodizio(p_aut.tenant_id, p_aut.id);
            select * into v_func from public.funcionarios f
            where f.id = v_proximo and f.tenant_id = p_aut.tenant_id;
        else
            select * into v_func from public.funcionarios f
            where f.id = p_acao.usuario_id and f.tenant_id = p_aut.tenant_id
              and f.deleted_at is null and coalesce(f.ativo, true);
            if not found then
                raise exception 'O usuário escolhido na ação não está ativo nesta empresa.';
            end if;
        end if;
        if v_neg.responsavel_id is distinct from v_func.id or v_neg.responsavel is distinct from v_func.nome then
            update public.negocios set responsavel_id = v_func.id, responsavel = v_func.nome
            where id = v_neg.id and tenant_id = p_aut.tenant_id;
        end if;
        perform public.automacao_registrar_timeline(
            p_aut.tenant_id, v_neg.id, p_aut.nome,
            format('Automação «%s» atribuiu o negócio a %s', p_aut.nome, v_func.nome),
            case when p_acao.atribuicao_modo = 'rodizio' then 'Rodízio entre os vendedores ativos.' end);
        return jsonb_build_object('acao', 'atribuir_responsavel', 'modo', p_acao.atribuicao_modo,
            'funcionario_id', v_func.id, 'responsavel', v_func.nome);

    elsif p_acao.tipo = 'notificar_gerente' then
        for r in
            select f.nome
            from public.funcionarios f
            where f.tenant_id = p_aut.tenant_id
              and f.deleted_at is null
              and coalesce(f.ativo, true)
              and (p_acao.usuario_id is null or f.id = p_acao.usuario_id)
              and (p_acao.usuario_id is not null or exists (
                  select 1 from public.utilizadores_empresas ue
                  where ue.empresa_id = p_aut.tenant_id
                    and f.user_id is not null
                    and ue.auth_uid = f.user_id
                    and lower(coalesce(ue.role::text, '')) ~ '(admin|owner|gerente|gestor|manager)'
              ))
            order by lower(f.nome), f.id
            limit 5
        loop
            insert into public.tarefas (tenant_id, titulo, descricao, tipo, data_vencimento, cliente_id, responsavel, concluido, created_by)
            values (
                p_aut.tenant_id, btrim(p_acao.titulo),
                format('Aviso da automação «%s».', p_aut.nome),
                'tarefa', now(), v_neg.id::text, r.nome, false, null
            )
            returning tenant_id into v_tarefa_tenant;
            if v_tarefa_tenant is distinct from p_aut.tenant_id then
                raise exception 'Isolamento: aviso fora da empresa do negócio.';
            end if;
            v_gerentes := v_gerentes || r.nome;
        end loop;
        if cardinality(v_gerentes) = 0 then
            raise exception 'Nenhum gerente ativo na equipe para avisar.';
        end if;
        perform public.automacao_registrar_timeline(
            p_aut.tenant_id, v_neg.id, p_aut.nome,
            format('Automação «%s» avisou o gerente: «%s»', p_aut.nome, btrim(p_acao.titulo)),
            'Aviso para ' || array_to_string(v_gerentes, ', ') || '.');
        return jsonb_build_object('acao', 'notificar_gerente', 'gerentes', to_jsonb(v_gerentes));
    end if;

    raise exception 'Ação desconhecida: %', p_acao.tipo;
end;
$$;

-- Executa UMA regra para UM negócio. Nunca lança erro para o chamador.
-- Retorna: ok | erro | duplicado | filtrado | ignorado.
create or replace function public.automacao_executar(
    p_automacao_id uuid,
    p_negocio_id uuid,
    p_evento text,
    p_chave text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_neg public.negocios%rowtype;
    v_aut public.automacoes%rowtype;
    v_acao public.automacoes_acoes%rowtype;
    v_exec_id bigint;
    v_contexto jsonb;
    v_resumo jsonb := '[]'::jsonb;
    v_nome text;
    v_resultado text;
begin
    select * into v_neg from public.negocios where id = p_negocio_id and deleted_at is null;
    if not found or v_neg.tenant_id is null then
        return 'ignorado';
    end if;
    -- A regra precisa ser do MESMO tenant do negócio
    select * into v_aut from public.automacoes
    where id = p_automacao_id and tenant_id = v_neg.tenant_id and ativo;
    if not found then
        return 'ignorado';
    end if;
    if not public.automacao_condicoes_ok(v_aut, v_neg) then
        return 'filtrado';
    end if;

    select coalesce(nullif(btrim(p.nome), ''), nullif(btrim(o.nome_fantasia), ''), nullif(btrim(o.razao_social), ''), v_neg.titulo)
    into v_nome
    from (select 1) as x
    left join public.pessoas p on p.id = v_neg.pessoa_contato_principal_id and p.tenant_id = v_neg.tenant_id
    left join public.organizacoes o on o.id = v_neg.organizacao_id and o.tenant_id = v_neg.tenant_id;

    -- Contexto de sistema (igual ao cron) + trava de laço
    v_contexto := public.automacao_entrar_contexto_sistema();
    perform set_config('crm.automacao_em_execucao', 'on', true);
    begin
        insert into public.automacoes_execucoes (tenant_id, automacao_id, negocio_id, negocio_nome, evento, chave_idempotencia)
        values (v_neg.tenant_id, v_aut.id, v_neg.id, left(v_nome, 200), p_evento, left(p_chave, 300))
        on conflict (tenant_id, chave_idempotencia) do nothing
        returning id into v_exec_id;

        if v_exec_id is null then
            v_resultado := 'duplicado';
        else
            begin
                if not exists (
                    select 1 from public.automacoes_acoes a
                    where a.automacao_id = v_aut.id and a.tenant_id = v_aut.tenant_id
                ) then
                    raise exception 'A automação não tem ações configuradas.';
                end if;
                for v_acao in
                    select * from public.automacoes_acoes a
                    where a.automacao_id = v_aut.id and a.tenant_id = v_aut.tenant_id
                    order by a.ordem, a.id
                loop
                    v_resumo := v_resumo || jsonb_build_array(
                        public.automacao_executar_acao(v_aut, v_acao, v_neg.id));
                end loop;
                update public.automacoes_execucoes
                set resultado = 'ok', detalhes = v_resumo
                where id = v_exec_id;
                v_resultado := 'ok';
            exception when others then
                -- Desfaz só as ações desta regra; o negócio segue salvo
                update public.automacoes_execucoes
                set resultado = 'erro', mensagem = left(sqlerrm, 1000)
                where id = v_exec_id;
                v_resultado := 'erro';
            end;
        end if;
    exception when others then
        raise warning 'Automação % não registrada: %', p_automacao_id, sqlerrm;
        v_resultado := 'erro';
    end;
    perform set_config('crm.automacao_em_execucao', 'off', true);
    perform public.automacao_sair_contexto_sistema(v_contexto);
    return v_resultado;
end;
$$;

-- Dispara as regras ativas de um gatilho para um negócio
create or replace function public.automacoes_disparar(
    p_negocio_id uuid,
    p_tenant_id uuid,
    p_gatilho text,
    p_parametro text,
    p_chave_evento text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    r record;
    v_total integer := 0;
begin
    for r in
        select a.id from public.automacoes a
        where a.tenant_id = p_tenant_id
          and a.ativo
          and a.gatilho = p_gatilho
          and (p_gatilho <> 'etapa_entrou' or a.gatilho_etapa_id::text = p_parametro)
          and (p_gatilho <> 'temperatura_mudou' or a.gatilho_temperatura = p_parametro)
        order by a.created_at, a.id
    loop
        if public.automacao_executar(r.id, p_negocio_id, p_gatilho, r.id::text || '|' || p_chave_evento) = 'ok' then
            v_total := v_total + 1;
        end if;
    end loop;
    return v_total;
end;
$$;

-- Trigger AFTER em negocios: gatilhos 1 a 5
create or replace function public.fn_automacoes_negocio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_dia text;
    v_sit_old text := 'aberto';
    v_sit_new text;
    v_etapa_mudou boolean;
    v_temp text := nullif(lower(btrim(coalesce(new.temperatura, ''))), '');
    v_temp_mudou boolean;
begin
    -- Sem laço: mudança feita por automação não dispara automação
    if coalesce(current_setting('crm.automacao_em_execucao', true), '') = 'on' then
        return null;
    end if;
    if new.tenant_id is null or new.deleted_at is not null then
        return null;
    end if;

    begin
        if not exists (
            select 1 from public.automacoes a
            where a.tenant_id = new.tenant_id and a.ativo
              and a.gatilho in ('negocio_criado', 'etapa_entrou', 'negocio_ganho', 'negocio_perdido', 'temperatura_mudou')
        ) then
            return null;
        end if;

        v_dia := to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD');
        v_sit_new := public.automacao_situacao(new.stage_id, new.status);

        if tg_op = 'INSERT' then
            v_etapa_mudou := new.stage_id is not null;
            v_temp_mudou := v_temp is not null;
            perform public.automacoes_disparar(new.id, new.tenant_id, 'negocio_criado', null,
                'criado|' || new.id::text);
        else
            v_sit_old := public.automacao_situacao(old.stage_id, old.status);
            v_etapa_mudou := new.stage_id is not null and new.stage_id is distinct from old.stage_id;
            v_temp_mudou := v_temp is not null
                and v_temp is distinct from nullif(lower(btrim(coalesce(old.temperatura, ''))), '');
        end if;

        if v_etapa_mudou then
            perform public.automacoes_disparar(new.id, new.tenant_id, 'etapa_entrou', new.stage_id::text,
                format('etapa|%s|%s|%s', new.id, new.stage_id, v_dia));
        end if;
        if v_sit_new = 'ganho' and v_sit_old <> 'ganho' then
            perform public.automacoes_disparar(new.id, new.tenant_id, 'negocio_ganho', null,
                'ganho|' || new.id::text);
        end if;
        if v_sit_new = 'perdido' and v_sit_old <> 'perdido' then
            perform public.automacoes_disparar(new.id, new.tenant_id, 'negocio_perdido', null,
                'perdido|' || new.id::text);
        end if;
        if v_temp_mudou then
            perform public.automacoes_disparar(new.id, new.tenant_id, 'temperatura_mudou', v_temp,
                format('temperatura|%s|%s|%s', new.id, v_temp, v_dia));
        end if;
    exception when others then
        -- Automação nunca impede salvar ou mover o negócio
        raise warning 'Automações não executadas para o negócio %: %', new.id, sqlerrm;
    end;
    return null;
end;
$$;

drop trigger if exists zz_automacoes on public.negocios;
create trigger zz_automacoes
    after insert or update of stage_id, status, temperatura on public.negocios
    for each row execute function public.fn_automacoes_negocio();

-- Gatilhos 6 e 7 (por tempo). Só admin/cron. Idempotente pela chave.
create or replace function public.executar_automacoes_agendadas()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    r record;
    c record;
    v_res text;
    v_regras integer := 0;
    v_ok integer := 0;
    v_erros integer := 0;
    v_duplicadas integer := 0;
begin
    if public.requisicao_api_publica() and not public.is_system_admin() then
        raise exception 'Somente o agendador (cron) ou o administrador do sistema executa automações agendadas.'
            using errcode = '42501';
    end if;

    for r in
        select a.* from public.automacoes a
        where a.ativo and a.gatilho in ('negocio_parado', 'proposta_sem_resposta')
        order by a.tenant_id, a.created_at, a.id
    loop
        v_regras := v_regras + 1;
        begin
            if r.gatilho = 'negocio_parado' then
                for c in
                    select s.id as negocio_id,
                           format('%s|parado|%s|%s', r.id, s.id,
                               to_char(s.ultima_atividade_em at time zone 'UTC', 'YYYYMMDDHH24MISSUS')) as chave
                    from public.vw_negocios_saude s
                    where s.tenant_id = r.tenant_id and s.parado
                    order by s.ultima_atividade_em, s.id
                    limit 500
                loop
                    v_res := public.automacao_executar(r.id, c.negocio_id, 'negocio_parado', c.chave);
                    v_ok := v_ok + (v_res = 'ok')::int;
                    v_erros := v_erros + (v_res = 'erro')::int;
                    v_duplicadas := v_duplicadas + (v_res = 'duplicado')::int;
                end loop;
            else
                for c in
                    select o.negocio_id, format('%s|proposta|%s', r.id, o.id) as chave
                    from public.orcamentos o
                    join public.negocios n
                        on n.tenant_id = o.tenant_id and n.id = o.negocio_id and n.deleted_at is null
                    where o.tenant_id = r.tenant_id
                      and o.status = 'enviado'
                      and o.deleted_at is null
                      and o.enviado_em is not null
                      and o.enviado_em <= now() - make_interval(days => r.gatilho_dias)
                      and public.automacao_situacao(n.stage_id, n.status) = 'aberto'
                      and not exists (
                          select 1 from public.orcamentos o2
                          where o2.tenant_id = o.tenant_id
                            and o2.negocio_id = o.negocio_id
                            and o2.deleted_at is null
                            and o2.status in ('aceito', 'recusado')
                      )
                    order by o.enviado_em, o.id
                    limit 500
                loop
                    v_res := public.automacao_executar(r.id, c.negocio_id, 'proposta_sem_resposta', c.chave);
                    v_ok := v_ok + (v_res = 'ok')::int;
                    v_erros := v_erros + (v_res = 'erro')::int;
                    v_duplicadas := v_duplicadas + (v_res = 'duplicado')::int;
                end loop;
            end if;
        exception when others then
            v_erros := v_erros + 1;
            raise warning 'Automação agendada % falhou: %', r.id, sqlerrm;
        end;
    end loop;

    return jsonb_build_object('regras', v_regras, 'executadas', v_ok, 'erros', v_erros, 'duplicadas', v_duplicadas);
end;
$$;

comment on function public.executar_automacoes_agendadas() is
    'Gatilhos por tempo (negócio parado, proposta sem resposta). Só cron/admin; idempotente pela chave do log. pg_cron: de hora em hora.';

-- ---------------------------------------------------------------------
-- 10. SALVAR (tela) — regra + ações numa transação. SECURITY INVOKER:
-- a RLS (só gerente) e as FKs compostas valem.
-- ---------------------------------------------------------------------
create or replace function public.salvar_automacao(p_automacao jsonb, p_acoes jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_id uuid := nullif(p_automacao ->> 'id', '')::uuid;
    v_ativo boolean := coalesce((p_automacao ->> 'ativo')::boolean, false);
    v_acao jsonb;
    v_ordem integer := 0;
begin
    if not public.eh_admin_do_tenant() then
        raise exception 'Somente o gerente pode criar ou editar automações.' using errcode = '42501';
    end if;
    if jsonb_typeof(p_acoes) is distinct from 'array' or jsonb_array_length(p_acoes) not between 1 and 10 then
        raise exception 'Inclua de 1 a 10 ações.' using errcode = '23514';
    end if;

    if v_id is null then
        insert into public.automacoes (
            nome, ativo, gatilho, gatilho_etapa_id, gatilho_temperatura, gatilho_dias,
            cond_pipeline_id, cond_temperatura, cond_valor_minimo, cond_origem_id, personalizado
        ) values (
            btrim(p_automacao ->> 'nome'), false, p_automacao ->> 'gatilho',
            nullif(p_automacao ->> 'gatilho_etapa_id', '')::bigint,
            nullif(p_automacao ->> 'gatilho_temperatura', ''),
            nullif(p_automacao ->> 'gatilho_dias', '')::integer,
            nullif(p_automacao ->> 'cond_pipeline_id', '')::uuid,
            nullif(p_automacao ->> 'cond_temperatura', ''),
            nullif(p_automacao ->> 'cond_valor_minimo', '')::numeric,
            nullif(p_automacao ->> 'cond_origem_id', '')::uuid,
            true
        )
        returning id into v_id;
    else
        update public.automacoes set
            nome = btrim(p_automacao ->> 'nome'),
            ativo = false,
            gatilho = p_automacao ->> 'gatilho',
            gatilho_etapa_id = nullif(p_automacao ->> 'gatilho_etapa_id', '')::bigint,
            gatilho_temperatura = nullif(p_automacao ->> 'gatilho_temperatura', ''),
            gatilho_dias = nullif(p_automacao ->> 'gatilho_dias', '')::integer,
            cond_pipeline_id = nullif(p_automacao ->> 'cond_pipeline_id', '')::uuid,
            cond_temperatura = nullif(p_automacao ->> 'cond_temperatura', ''),
            cond_valor_minimo = nullif(p_automacao ->> 'cond_valor_minimo', '')::numeric,
            cond_origem_id = nullif(p_automacao ->> 'cond_origem_id', '')::uuid
        where id = v_id;
        if not found then
            raise exception 'Automação não encontrada.' using errcode = 'P0002';
        end if;
        delete from public.automacoes_acoes where automacao_id = v_id;
    end if;

    for v_acao in select value from jsonb_array_elements(p_acoes) loop
        v_ordem := v_ordem + 1;
        insert into public.automacoes_acoes (
            automacao_id, ordem, tipo, titulo, tipo_atividade_id, prazo_quantidade, prazo_unidade,
            responsavel_modo, usuario_id, temperatura, atribuicao_modo
        ) values (
            v_id, v_ordem, v_acao ->> 'tipo',
            nullif(btrim(coalesce(v_acao ->> 'titulo', '')), ''),
            nullif(v_acao ->> 'tipo_atividade_id', '')::uuid,
            nullif(v_acao ->> 'prazo_quantidade', '')::integer,
            nullif(v_acao ->> 'prazo_unidade', ''),
            nullif(v_acao ->> 'responsavel_modo', ''),
            nullif(v_acao ->> 'usuario_id', '')::uuid,
            nullif(v_acao ->> 'temperatura', ''),
            nullif(v_acao ->> 'atribuicao_modo', '')
        );
    end loop;

    if v_ativo then
        update public.automacoes set ativo = true where id = v_id;
    end if;
    return v_id;
end;
$$;

comment on function public.salvar_automacao(jsonb, jsonb) is
    'Cria/edita uma automação e suas ações numa transação (SECURITY INVOKER: só gerente, pela RLS). Ativa só se estiver completa.';

-- ---------------------------------------------------------------------
-- 11. MODELOS PRONTOS (por empresa, uma vez, desativados)
-- ---------------------------------------------------------------------

-- Liga os modelos de "entrou na etapa" à etapa pelo nome (só os que o
-- gerente ainda não mexeu e estão sem etapa)
create or replace function public.automacoes_vincular_etapas_modelo(p_tenant_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_total integer;
begin
    update public.automacoes a
    set gatilho_etapa_id = (
        select ps.id from public.pipeline_stages ps
        where ps.tenant_id = a.tenant_id
          and not coalesce(ps.ganho, false)
          and not coalesce(ps.perdido, false)
          and lower(coalesce(ps.nome, '')) ~ case a.modelo_chave
              when 'visita_agendada' then 'visita'
              when 'proposta_enviada' then 'proposta'
          end
        order by ps.ordem nulls last, ps.id
        limit 1
    )
    where a.tenant_id = p_tenant_id
      and a.modelo_chave in ('visita_agendada', 'proposta_enviada')
      and a.gatilho = 'etapa_entrou'
      and a.gatilho_etapa_id is null
      and not a.ativo
      and not a.personalizado
      and exists (
          select 1 from public.pipeline_stages ps
          where ps.tenant_id = a.tenant_id
            and not coalesce(ps.ganho, false)
            and not coalesce(ps.perdido, false)
            and lower(coalesce(ps.nome, '')) ~ case a.modelo_chave
                when 'visita_agendada' then 'visita'
                when 'proposta_enviada' then 'proposta'
            end
      );
    get diagnostics v_total = row_count;
    return v_total;
end;
$$;

-- Etapa criada depois dos modelos (provisionar_tenant cria as etapas
-- depois dos defaults): liga o modelo correspondente.
create or replace function public.fn_automacoes_etapa_nova()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_contexto jsonb;
begin
    if new.tenant_id is null then
        return null;
    end if;
    v_contexto := public.automacao_entrar_contexto_sistema();
    begin
        perform public.automacoes_vincular_etapas_modelo(new.tenant_id);
    exception when others then
        raise warning 'Vínculo de etapa dos modelos de automação não aplicado: %', sqlerrm;
    end;
    perform public.automacao_sair_contexto_sistema(v_contexto);
    return null;
end;
$$;

drop trigger if exists trg_automacoes_etapa_nova on public.pipeline_stages;
create trigger trg_automacoes_etapa_nova
    after insert on public.pipeline_stages
    for each row execute function public.fn_automacoes_etapa_nova();

create or replace function public.provisionar_automacoes_modelo(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_contexto jsonb;
    v_ligacao uuid;
    v_tarefa uuid;
    v_followup uuid;
    v_id uuid;
    m record;
begin
    if p_tenant_id is null then
        return;
    end if;
    insert into public.crm_seeds_aplicados (tenant_id, chave)
    values (p_tenant_id, 'automacoes_modelos_v1')
    on conflict do nothing;
    if not found then
        return;
    end if;

    -- Contexto de sistema: o tenant é o informado (nunca o da sessão)
    v_contexto := public.automacao_entrar_contexto_sistema();

    select id into v_ligacao from public.tipos_atividade
    where tenant_id = p_tenant_id and lower(nome) in ('ligação', 'ligacao') order by ordem limit 1;
    select id into v_tarefa from public.tipos_atividade
    where tenant_id = p_tenant_id and lower(nome) = 'tarefa' order by ordem limit 1;
    select id into v_followup from public.tipos_atividade
    where tenant_id = p_tenant_id and lower(nome) in ('follow-up', 'followup') order by ordem limit 1;

    for m in
        select * from (values
            ('visita_agendada', 'Visita agendada: confirmar no dia seguinte', 'etapa_entrou', null::text, null::integer,
             'Confirmar visita com o cliente', v_ligacao, 1, 'dias', false),
            ('proposta_enviada', 'Proposta enviada: ligar em 2 dias', 'etapa_entrou', null, null,
             'Ligar para saber o que achou', v_ligacao, 2, 'dias', false),
            ('ganho', 'Negócio ganho: agendar instalação', 'negocio_ganho', null, null,
             'Agendar instalação', v_tarefa, 1, 'dias', true),
            ('perdido', 'Negócio perdido: retomar em 180 dias', 'negocio_perdido', null, null,
             'Retomar contato', v_followup, 180, 'dias', false),
            ('entrou_quente', 'Lead quente: ligar em até 1 hora', 'temperatura_mudou', 'quente', null,
             'Ligar em até 1 hora', v_ligacao, 1, 'horas', false),
            ('proposta_sem_resposta', 'Proposta sem resposta há 3 dias: follow-up', 'proposta_sem_resposta', null, 3,
             'Fazer follow-up da proposta', v_followup, 2, 'horas', false)
        ) as t(chave, nome, gatilho, temperatura, dias, tarefa, tipo_id, prazo, unidade, avisa_gerente)
    loop
        if exists (
            select 1 from public.automacoes a
            where a.tenant_id = p_tenant_id and (a.modelo_chave = m.chave or a.nome = m.nome)
        ) then
            continue;
        end if;
        insert into public.automacoes (tenant_id, nome, ativo, gatilho, gatilho_temperatura, gatilho_dias, modelo_chave, created_by)
        values (p_tenant_id, m.nome, false, m.gatilho, m.temperatura, m.dias, m.chave, null)
        returning id into v_id;
        insert into public.automacoes_acoes (tenant_id, automacao_id, ordem, tipo, titulo, tipo_atividade_id,
                                             prazo_quantidade, prazo_unidade, responsavel_modo)
        values (p_tenant_id, v_id, 1, 'criar_tarefa', m.tarefa, m.tipo_id, m.prazo, m.unidade, 'responsavel_negocio');
        if m.avisa_gerente then
            insert into public.automacoes_acoes (tenant_id, automacao_id, ordem, tipo, titulo)
            values (p_tenant_id, v_id, 2, 'notificar_gerente', 'Negócio ganho: acompanhar a instalação');
        end if;
    end loop;

    perform public.automacoes_vincular_etapas_modelo(p_tenant_id);
    perform public.automacao_sair_contexto_sistema(v_contexto);
end;
$$;

comment on function public.provisionar_automacoes_modelo(uuid) is
    'Semeia os 6 modelos de automação (desativados) uma única vez por empresa (crm_seeds_aplicados). Administrativa: sem EXECUTE para a API.';

-- Gancho dos pacotes (migrations 15/16) agora cobre as automações.
create or replace function public.provisionar_defaults_pacote(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.provisionar_modelos_mensagem(p_tenant_id);
    perform public.provisionar_canais_origem(p_tenant_id);
    perform public.provisionar_automacoes_modelo(p_tenant_id);
end;
$$;

-- Empresas que já existem recebem os modelos agora (uma vez só)
do $$
declare
    r record;
begin
    for r in select e.id from public.empresas e loop
        perform public.provisionar_automacoes_modelo(r.id);
        perform public.automacoes_vincular_etapas_modelo(r.id);
    end loop;
end $$;

-- ---------------------------------------------------------------------
-- 12. vw_negocios_saude (migration 15) — registro de automação na
-- timeline não é "contato" com o cliente. Mesmas colunas, mesma ordem.
-- ---------------------------------------------------------------------
create or replace view public.vw_negocios_saude
with (security_invoker = on)
as
select
    n.id,
    n.tenant_id,
    coalesce(p.nome, o.nome_fantasia, o.razao_social, n.titulo) as nome,
    n.titulo,
    p.telefone,
    coalesce(p.ddi, '+55') as ddi,
    p.email,
    n.dados_extras ->> 'endereco_instalacao' as endereco_instalacao,
    public.to_numeric_seguro(n.dados_extras ->> 'conta_energia_media') as conta_energia_media,
    n.valor,
    n.status,
    n.stage_id,
    n.pipeline_id,
    ps.nome as etapa_nome,
    n.temperatura,
    case lower(btrim(coalesce(n.temperatura, '')))
        when 'quente' then 3
        when 'morno' then 2
        when 'frio' then 1
        else 0
    end as temperatura_ordem,
    n.responsavel,
    n.responsavel_id,
    n.motivo_perda,
    n.created_by,
    n.created_at,
    n.updated_at,
    calc.aberto,
    calc.ultima_atividade_em,
    calc.ultimo_contato_em,
    floor(extract(epoch from (now() - calc.ultima_atividade_em)) / 86400)::integer as dias_sem_atividade,
    floor(extract(epoch from (now() - calc.ultimo_contato_em)) / 86400)::integer as dias_sem_contato,
    case when calc.aberto then ps.dias_para_parado end as dias_para_parado,
    (
        calc.aberto
        and ps.dias_para_parado is not null
        and calc.ultima_atividade_em < now() - make_interval(days => ps.dias_para_parado)
    ) as parado,
    prox.data_vencimento as proxima_tarefa_em,
    prox.titulo as proxima_tarefa_titulo,
    prox.tipo as proxima_tarefa_tipo,
    (prox.data_vencimento is not null and prox.data_vencimento < now()) as proxima_tarefa_atrasada,
    (calc.aberto and prox.tem_tarefa is null) as sem_proximo_passo
from public.negocios n
left join public.pessoas p on p.id = n.pessoa_contato_principal_id
left join public.organizacoes o on o.id = n.organizacao_id
left join public.pipeline_stages ps on ps.id = n.stage_id
left join lateral (
    select
        max(greatest(t.created_at, t.concluido_em)) as ultima_tarefa_em,
        max(coalesce(t.concluido_em, t.created_at)) filter (where t.concluido is true) as ultima_conclusao_em
    from public.tarefas t
    where t.tenant_id = n.tenant_id
      and t.cliente_id = n.id::text
      and t.deleted_at is null
) tt on true
left join lateral (
    select
        max(a.created_at) as ultimo_registro_em,
        max(a.created_at) filter (
            where lower(coalesce(a.tipo, a.activity_type, '')) not in ('status', 'temperatura', 'perda', 'upload', 'arquivo', 'automacao')
        ) as ultimo_contato_registro_em
    from public.atividades_lead a
    where a.tenant_id = n.tenant_id
      and a.cliente_id = n.id::text
) aa on true
left join lateral (
    select true as tem_tarefa, t.data_vencimento, t.titulo, t.tipo
    from public.tarefas t
    where t.tenant_id = n.tenant_id
      and t.cliente_id = n.id::text
      and t.deleted_at is null
      and t.concluido is not true
    order by t.data_vencimento asc nulls last, t.id asc
    limit 1
) prox on true
cross join lateral (
    select
        not (
            coalesce(ps.ganho, false)
            or coalesce(ps.perdido, false)
            or lower(coalesce(ps.nome, n.status, '')) ~ '(fechad|ganh|perdid)'
        ) as aberto,
        greatest(n.created_at, n.updated_at, tt.ultima_tarefa_em, aa.ultimo_registro_em) as ultima_atividade_em,
        greatest(n.created_at, tt.ultima_conclusao_em, aa.ultimo_contato_registro_em) as ultimo_contato_em
) calc
where n.deleted_at is null;

comment on view public.vw_negocios_saude is
    'Saúde de cada negócio vivo (parado, sem próximo passo, última atividade/contato, ordem de temperatura). security_invoker: respeita a RLS do usuário.';

-- ---------------------------------------------------------------------
-- 13. AGENDAMENTO (pg_cron, só se a extensão existir)
-- ---------------------------------------------------------------------
do $$
begin
    begin
        create extension if not exists pg_cron;
    exception when others then
        raise warning 'pg_cron indisponível (%): habilite a extensão e agende "select public.executar_automacoes_agendadas();" de hora em hora.', sqlerrm;
        return;
    end;
    begin
        if exists (select 1 from pg_namespace where nspname = 'cron') then
            execute $q$select cron.unschedule(jobid) from cron.job where jobname = 'crm_automacoes_agendadas'$q$;
            execute $q$select cron.schedule('crm_automacoes_agendadas', '17 * * * *', 'select public.executar_automacoes_agendadas();')$q$;
        end if;
    exception when others then
        raise warning 'Agendamento das automações não criado (%): agende manualmente.', sqlerrm;
    end;
end $$;

-- ---------------------------------------------------------------------
-- 14. GRANTS
-- ---------------------------------------------------------------------
do $$
declare
    v_anon boolean := exists (select 1 from pg_roles where rolname = 'anon');
    v_auth boolean := exists (select 1 from pg_roles where rolname = 'authenticated');
    v_service boolean := exists (select 1 from pg_roles where rolname = 'service_role');
    t text;
    r record;
begin
    foreach t in array array['automacoes', 'automacoes_acoes', 'automacoes_execucoes', 'automacoes_rodizio', 'vw_automacoes_resumo'] loop
        execute format('revoke all on public.%I from public', t);
        if v_anon then
            execute format('revoke all on public.%I from anon', t);
        end if;
        if v_auth then
            execute format('revoke all on public.%I from authenticated', t);
            if t in ('automacoes', 'automacoes_acoes') then
                execute format('grant select, insert, update, delete on public.%I to authenticated', t);
            else
                execute format('grant select on public.%I to authenticated', t);
            end if;
        end if;
        if v_service then
            execute format('grant all on public.%I to service_role', t);
        end if;
    end loop;

    if v_auth then
        grant select on public.vw_negocios_saude to authenticated;
    end if;
    if v_anon then
        revoke all on public.vw_negocios_saude from anon;
    end if;

    -- Motor e triggers: sem EXECUTE para a API. salvar_automacao é a única
    -- chamada pela tela (SECURITY INVOKER, só gerente pela RLS).
    for r in
        select p.oid::regprocedure as fn, p.proname::text as nome
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public'
          and p.proname in (
              'fn_automacoes_execucoes_imutavel', 'automacao_pendencias',
              'automacao_entrar_contexto_sistema', 'automacao_sair_contexto_sistema', 'fn_automacoes_validar',
              'fn_automacoes_acoes_usuario_removido', 'automacao_situacao', 'automacao_tipo_tarefa',
              'automacao_condicoes_ok', 'automacao_registrar_timeline', 'automacao_proximo_rodizio',
              'automacao_executar_acao', 'automacao_executar', 'automacoes_disparar', 'fn_automacoes_negocio',
              'executar_automacoes_agendadas', 'salvar_automacao', 'automacoes_vincular_etapas_modelo',
              'fn_automacoes_etapa_nova', 'provisionar_automacoes_modelo', 'provisionar_defaults_pacote'
          )
    loop
        execute format('revoke execute on function %s from public', r.fn);
        if v_anon then
            execute format('revoke execute on function %s from anon', r.fn);
        end if;
        if v_auth then
            if r.nome = 'salvar_automacao' then
                execute format('grant execute on function %s to authenticated', r.fn);
            else
                execute format('revoke execute on function %s from authenticated', r.fn);
            end if;
        end if;
        if v_service then
            execute format('grant execute on function %s to service_role', r.fn);
        end if;
    end loop;
end $$;
