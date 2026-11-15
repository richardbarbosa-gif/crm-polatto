-- =====================================================================
-- CRM Polatto — Migration 21: importação de leads com deduplicação no
-- banco. (Auditoria 2026-11-10: P4-07.)
--
-- Antes: o navegador consultava os telefones/e-mails/documentos já
-- cadastrados e DEPOIS inseria. Duas importações ao mesmo tempo (duas
-- abas, dois vendedores com a mesma planilha) não se enxergavam e
-- duplicavam a base inteira.
--
-- importar_leads(p_linhas): uma importação por empresa de cada vez (trava
-- transacional), conferência de duplicata e inserção linha a linha no
-- banco — a linha seguinte já enxerga a anterior. Linha com erro não
-- derruba o lote: volta na lista de erros com o número da linha.
-- SECURITY INVOKER: insere pela view clientes, com a RLS, os limites do
-- plano e os triggers de sempre.
--
-- Só cria objeto novo. Idempotente; reexecutável a qualquer momento.
-- =====================================================================
create or replace function public.importar_leads(p_linhas jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    c_maximo constant integer := 500;
    v_tenant uuid := public.current_tenant_id();
    v_item jsonb;
    v_telefones text[];
    v_documentos text[];
    v_email text;
    v_importadas integer := 0;
    v_existentes integer := 0;
    v_erros jsonb := '[]'::jsonb;
begin
    if v_tenant is null then
        raise exception 'Empresa não identificada.' using errcode = '42501';
    end if;
    if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then
        raise exception 'Lista de leads inválida.' using errcode = 'P0001';
    end if;
    if jsonb_array_length(p_linhas) > c_maximo then
        raise exception 'Envie no máximo % leads por chamada.', c_maximo using errcode = 'P0001';
    end if;

    -- Uma importação por empresa de cada vez.
    perform pg_advisory_xact_lock(hashtextextended('importar_leads|' || v_tenant::text, 0));

    for v_item in select * from jsonb_array_elements(p_linhas) loop
        v_telefones := array(select jsonb_array_elements_text(coalesce(v_item -> 'telefones', '[]'::jsonb)));
        v_documentos := array(select jsonb_array_elements_text(coalesce(v_item -> 'documentos', '[]'::jsonb)));
        v_email := nullif(lower(btrim(coalesce(v_item ->> 'email', ''))), '');

        if exists (
            select 1 from public.clientes c
            where (cardinality(v_telefones) > 0 and c.telefone = any(v_telefones))
               or (v_email is not null and lower(btrim(c.email)) = v_email)
               or (cardinality(v_documentos) > 0 and c.cpf_cnpj = any(v_documentos))
        ) then
            v_existentes := v_existentes + 1;
            continue;
        end if;

        begin
            insert into public.clientes (
                tenant_id, nome, email, telefone, cpf_cnpj, responsavel,
                conta_energia_media, valor, status, stage_id, pipeline_id, temperatura
            ) values (
                nullif(v_item ->> 'tenant_id', '')::uuid,
                v_item ->> 'nome',
                nullif(btrim(coalesce(v_item ->> 'email', '')), ''),
                v_item ->> 'telefone',
                nullif(v_item ->> 'cpf_cnpj', ''),
                nullif(v_item ->> 'responsavel', ''),
                public.to_numeric_seguro(v_item ->> 'conta_energia_media'),
                public.to_numeric_seguro(v_item ->> 'valor'),
                coalesce(nullif(v_item ->> 'status', ''), 'Novo Lead'),
                nullif(v_item ->> 'stage_id', '')::bigint,
                nullif(v_item ->> 'pipeline_id', '')::uuid,
                nullif(v_item ->> 'temperatura', '')
            );
            v_importadas := v_importadas + 1;
        exception when others then
            v_erros := v_erros || jsonb_build_object(
                'linha', coalesce((v_item ->> 'linha')::integer, 0),
                'motivo', sqlerrm
            );
        end;
    end loop;

    return jsonb_build_object('importadas', v_importadas, 'ja_existiam', v_existentes, 'erros', v_erros);
end;
$$;

comment on function public.importar_leads(jsonb) is 'Importa um lote de leads (até 500) com deduplicação por telefone, e-mail ou documento feita no banco, uma importação por empresa de cada vez. Devolve {importadas, ja_existiam, erros:[{linha, motivo}]}.';

revoke execute on function public.importar_leads(jsonb) from public;
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke execute on function public.importar_leads(jsonb) from anon;
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
        grant execute on function public.importar_leads(jsonb) to authenticated;
    end if;
end $$;
