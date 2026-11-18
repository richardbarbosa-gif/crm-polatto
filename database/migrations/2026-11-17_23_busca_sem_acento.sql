-- =====================================================================
-- CRM Polatto — Migration 23: busca que ignora acentos.
-- (AUDITORIA.md, notas da Fase 2: "joao" não encontrava "João".)
--
-- As buscas da tela rodam no banco com ILIKE, que diferencia acento: o
-- vendedor digita "joao" ou "conceicao" (no celular quase ninguém acentua)
-- e não acha "João" nem "Conceição".
--
-- Solução sem alterar nenhuma tabela nem view existente: uma "coluna
-- calculada" do PostgREST — a função busca_sem_acento(<linha>) — em cada
-- fonte que as telas pesquisam. O front filtra por ela com o termo também
-- sem acento. Ela junta os MESMOS campos que cada busca já consultava, e
-- sem_acento() só troca letra acentuada pela letra base (maiúscula continua
-- maiúscula; o ILIKE segue cuidando de maiúsculas/minúsculas). Por isso tudo
-- o que a busca antiga encontrava continua sendo encontrado; ela só passa a
-- achar também o que diferia apenas no acento, nos dois sentidos.
--
--   clientes            nome, telefone          (Kanban em modo lista, busca global, agenda)
--   vw_negocios_saude   nome, telefone          (colunas do Kanban)
--   pessoas             nome, email, telefone, cargo
--   organizacoes        nome_fantasia, razao_social, cnpj, setor
--   vw_orcamentos_lista numero, titulo, cliente_nome
--
-- Os campos são separados por quebra de linha: o termo de busca é uma linha
-- só, então nunca casa "pedaço de um campo + pedaço do outro".
--
-- A função de clientes só é criada quando clientes já é a view do modelo
-- novo (depois da virada). Por isso, como as demais a partir da 10, esta
-- migration roda de novo depois da virada. A migration 15 apaga a função de
-- vw_negocios_saude antes de recriar a view: se a 15 for reexecutada, rode a
-- 17 e esta de novo.
--
-- Mesmo mapa de letras do front: src/lib/buscaSemAcento.ts.
-- Idempotente. Só cria objetos novos.
-- =====================================================================

create or replace function public.sem_acento(p_texto text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
    select pg_catalog.translate(
        p_texto,
        'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇÑÝçñýÿ',
        'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCNYcnyy'
    );
$$;

comment on function public.sem_acento(text) is 'Troca letra acentuada pela letra base, mantendo maiúscula/minúscula. Mesmo mapa de src/lib/buscaSemAcento.ts.';

create or replace function public.busca_sem_acento(p_linha public.pessoas)
returns text
language sql
stable
set search_path = ''
as $$
    select public.sem_acento(pg_catalog.concat_ws(E'\n', p_linha.nome, p_linha.email, p_linha.telefone, p_linha.cargo));
$$;

create or replace function public.busca_sem_acento(p_linha public.organizacoes)
returns text
language sql
stable
set search_path = ''
as $$
    select public.sem_acento(pg_catalog.concat_ws(E'\n', p_linha.nome_fantasia, p_linha.razao_social, p_linha.cnpj, p_linha.setor));
$$;

do $$
begin
    if to_regclass('public.vw_negocios_saude') is not null then
        execute $f$
            create or replace function public.busca_sem_acento(p_linha public.vw_negocios_saude)
            returns text
            language sql
            stable
            set search_path = ''
            as $body$
                select public.sem_acento(pg_catalog.concat_ws(E'\n', p_linha.nome, p_linha.telefone));
            $body$
        $f$;
    end if;

    if to_regclass('public.vw_orcamentos_lista') is not null then
        execute $f$
            create or replace function public.busca_sem_acento(p_linha public.vw_orcamentos_lista)
            returns text
            language sql
            stable
            set search_path = ''
            as $body$
                select public.sem_acento(pg_catalog.concat_ws(E'\n', p_linha.numero, p_linha.titulo, p_linha.cliente_nome));
            $body$
        $f$;
    end if;

    -- Antes da virada, clientes ainda é a tabela legada: não cria (a função
    -- ficaria presa à tabela renomeada para clientes_legado).
    if exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'clientes' and c.relkind = 'v'
    ) then
        execute $f$
            create or replace function public.busca_sem_acento(p_linha public.clientes)
            returns text
            language sql
            stable
            set search_path = ''
            as $body$
                select public.sem_acento(pg_catalog.concat_ws(E'\n', p_linha.nome, p_linha.telefone));
            $body$
        $f$;
    else
        raise notice 'clientes ainda não é a view do modelo novo: rode esta migration de novo depois da virada.';
    end if;
end $$;

-- Privilégios: nada para a chave pública; usuário logado executa (a função
-- só lê a linha que a RLS já liberou para ele).
do $$
declare
    r record;
begin
    for r in
        select p.oid::regprocedure as fn
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public' and p.proname in ('sem_acento', 'busca_sem_acento')
    loop
        execute format('revoke execute on function %s from public', r.fn);
        if exists (select 1 from pg_roles where rolname = 'anon') then
            execute format('revoke execute on function %s from anon', r.fn);
        end if;
        if exists (select 1 from pg_roles where rolname = 'authenticated') then
            execute format('grant execute on function %s to authenticated', r.fn);
        end if;
    end loop;
end $$;

-- O PostgREST passa a enxergar a coluna calculada sem esperar o próximo ciclo.
notify pgrst, 'reload schema';
