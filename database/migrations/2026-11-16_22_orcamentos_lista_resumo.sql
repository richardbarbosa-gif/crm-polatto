-- =====================================================================
-- CRM Polatto — Migration 22: lista e resumo de orçamentos no banco.
-- (Auditoria 2026-11-10: resto do P5-01.)
--
-- A tela Orçamentos baixava TODOS os orçamentos da empresa para (a) somar
-- os cartões do topo, (b) montar o filtro de responsável e (c) buscar pelo
-- nome do cliente, que mora em outra tabela. Com estas duas views a tela
-- pagina e filtra no banco:
--
--   vw_orcamentos_lista   — o orçamento + o nome do cliente do negócio
--                           (a mesma regra de nome da view clientes).
--   vw_orcamentos_resumo  — uma linha por empresa: em aberto, aceitos,
--                           decididos e a lista de responsáveis.
--
-- security_invoker: vale a RLS de quem consulta. Só cria objetos novos.
-- Idempotente; reexecutável a qualquer momento depois da 14.
-- =====================================================================
create or replace view public.vw_orcamentos_lista
with (security_invoker = on) as
select
    o.id, o.tenant_id, o.negocio_id, o.numero, o.titulo, o.status, o.data_emissao, o.valido_ate,
    o.desconto_tipo, o.desconto_valor, o.subtotal, o.desconto_total, o.total,
    o.condicoes_pagamento, o.observacoes, o.responsavel_id, o.responsavel_nome,
    o.responsavel_email, o.responsavel_telefone, o.created_by, o.created_at, o.updated_at, o.deleted_at,
    o.versao_de, o.revisao, o.numero_original,
    -- Mesma regra de nome da view clientes (migration 01). Não usa a view:
    -- antes da virada "clientes" ainda é a tabela legada, de id numérico.
    case when n.deleted_at is null
         then coalesce(p.nome, org.nome_fantasia, org.razao_social, n.titulo)
    end as cliente_nome
from public.orcamentos o
left join public.negocios n on n.id = o.negocio_id
left join public.pessoas p on p.id = n.pessoa_contato_principal_id
left join public.organizacoes org on org.id = n.organizacao_id
where o.deleted_at is null;

comment on view public.vw_orcamentos_lista is 'Orçamentos ativos com o nome do cliente do negócio, para paginar e buscar no banco (tela Orçamentos).';

create or replace view public.vw_orcamentos_resumo
with (security_invoker = on) as
select
    o.tenant_id,
    -- Proposta com revisão em andamento conta uma vez só (pela revisão).
    count(*) filter (
        where o.status in ('rascunho', 'enviado')
          and not exists (
              select 1 from public.orcamentos r
              where r.versao_de = o.id and r.tenant_id = o.tenant_id and r.deleted_at is null
          )
    )::integer as abertos,
    coalesce(sum(o.total) filter (
        where o.status in ('rascunho', 'enviado')
          and not exists (
              select 1 from public.orcamentos r
              where r.versao_de = o.id and r.tenant_id = o.tenant_id and r.deleted_at is null
          )
    ), 0)::numeric as valor_aberto,
    count(*) filter (where o.status = 'aceito')::integer as aceitos,
    coalesce(sum(o.total) filter (where o.status = 'aceito'), 0)::numeric as valor_aceito,
    count(*) filter (where o.status in ('aceito', 'recusado'))::integer as decididos,
    coalesce(
        array_agg(distinct btrim(o.responsavel_nome)) filter (where nullif(btrim(o.responsavel_nome), '') is not null),
        '{}'
    ) as responsaveis,
    bool_or(nullif(btrim(coalesce(o.responsavel_nome, '')), '') is null) as tem_sem_responsavel
from public.orcamentos o
where o.deleted_at is null
group by o.tenant_id;

comment on view public.vw_orcamentos_resumo is 'Uma linha por empresa: propostas em aberto e aceitas (quantidade e valor), decididas (base da taxa de aceite) e responsáveis para o filtro.';

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on public.vw_orcamentos_lista, public.vw_orcamentos_resumo from anon;
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
        revoke all on public.vw_orcamentos_lista, public.vw_orcamentos_resumo from authenticated;
        grant select on public.vw_orcamentos_lista, public.vw_orcamentos_resumo to authenticated;
    end if;
end $$;
