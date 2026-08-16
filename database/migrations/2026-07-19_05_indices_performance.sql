-- =====================================================================
-- CRM POLATTO — MIGRATION 05: ÍNDICES DE PERFORMANCE
--
-- Índices para os padrões de acesso do frontend:
--   - Kanban/lista: negocios por (tenant, stage/pipeline, deleted_at)
--   - Busca: pessoas/organizacoes por nome (trigram), email, telefone
--   - Dedup: cpf/cnpj normalizados por tenant
--
-- IDEMPOTENTE. Executar após 01.
-- =====================================================================

create extension if not exists pg_trgm;

-- NEGOCIOS -------------------------------------------------------------
create index if not exists idx_negocios_tenant_ativos
    on public.negocios (tenant_id, stage_id)
    where deleted_at is null;

create index if not exists idx_negocios_tenant_pipeline
    on public.negocios (tenant_id, pipeline_id)
    where deleted_at is null;

create index if not exists idx_negocios_tenant_criacao
    on public.negocios (tenant_id, created_at desc);

create index if not exists idx_negocios_responsavel
    on public.negocios (tenant_id, responsavel_id)
    where deleted_at is null;

create index if not exists idx_negocios_legado
    on public.negocios (legado_cliente_id)
    where legado_cliente_id is not null;

create index if not exists idx_negocios_dados_extras_gin
    on public.negocios using gin (dados_extras jsonb_path_ops);

-- PESSOAS --------------------------------------------------------------
create index if not exists idx_pessoas_tenant
    on public.pessoas (tenant_id)
    where deleted_at is null;

create index if not exists idx_pessoas_nome_trgm
    on public.pessoas using gin (nome gin_trgm_ops);

create index if not exists idx_pessoas_email
    on public.pessoas (tenant_id, lower(email))
    where email is not null;

create index if not exists idx_pessoas_telefone
    on public.pessoas (tenant_id, telefone)
    where telefone is not null;

create index if not exists idx_pessoas_cpf_normalizado
    on public.pessoas (tenant_id, regexp_replace(coalesce(cpf, ''), '\D', '', 'g'))
    where cpf is not null;

create index if not exists idx_pessoas_organizacao
    on public.pessoas (organizacao_id)
    where organizacao_id is not null;

-- ORGANIZACOES ---------------------------------------------------------
create index if not exists idx_organizacoes_tenant
    on public.organizacoes (tenant_id)
    where deleted_at is null;

create index if not exists idx_organizacoes_nome_trgm
    on public.organizacoes using gin (coalesce(nome_fantasia, razao_social) gin_trgm_ops);

create index if not exists idx_organizacoes_cnpj_normalizado
    on public.organizacoes (tenant_id, regexp_replace(coalesce(cnpj, ''), '\D', '', 'g'))
    where cnpj is not null;

-- NEGOCIOS_PESSOAS -----------------------------------------------------
create index if not exists idx_negocios_pessoas_pessoa
    on public.negocios_pessoas (pessoa_id);

-- CONFIGURAÇÕES POR TENANT ---------------------------------------------
create index if not exists idx_pipelines_tenant on public.pipelines (tenant_id, ordem);
create index if not exists idx_pipeline_stages_pipeline on public.pipeline_stages (pipeline_id, ordem);
create index if not exists idx_custom_fields_tenant on public.custom_fields (tenant_id, entidade, ordem);
create index if not exists idx_motivos_perda_tenant on public.motivos_perda (tenant_id, ordem);
create index if not exists idx_tipos_atividade_tenant on public.tipos_atividade (tenant_id, ordem);

-- TAREFAS (agenda ordena por vencimento) --------------------------------
-- Sob guarda: a tabela pode não existir em um ambiente novo e o erro
-- abortaria o arquivo inteiro, deixando os índices seguintes de fora.
do $$
begin
    if to_regclass('public.tarefas') is not null then
        create index if not exists idx_tarefas_vencimento
            on public.tarefas (data_vencimento)
            where coalesce(concluido, false) = false;
    end if;
end $$;
