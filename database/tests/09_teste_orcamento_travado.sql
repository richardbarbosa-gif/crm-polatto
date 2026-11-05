-- =====================================================================
-- SUÍTE 9 — PROPOSTA TRAVADA DEPOIS DE ENVIADA + NOVA VERSÃO (migration 14)
--
-- Para cada regra: o ATAQUE falha e o USO LEGÍTIMO funciona.
--   T1  rascunho continua 100% editável (API direta, itens e salvar_orcamento)
--   T2  transições inválidas a partir do rascunho; orçamento novo nasce rascunho
--   T3  enviado trava cabeçalho e itens (API direta, salvar_orcamento, gerente)
--   T4  transições válidas funcionam; finais não mudam mais
--   T5  soft delete e restauração seguem as regras da 13
--   T6  nova versão: rascunho com número novo, ligado à original, itens
--       copiados, tenant respeitado, cadeia linear, "substituído" no envio
--   T7  DELETE físico do gerente: itens em cascata; original com revisão
--       protegida; negócio apagado leva a cadeia toda
--   T8  numeração sem buraco
--   T9  contexto administrativo isento
--   T10 privilégios das funções novas
--
-- Rodar depois de 01..07 (usa assert/login_como/login_admin da suíte 1 e
-- os helpers crm_teste.* da suíte 7, recriados aqui por garantia).
-- =====================================================================

\set ON_ERROR_STOP on

grant usage on schema crm_teste to authenticated, anon;

create or replace function crm_teste.sqlstate_de(p_sql text)
returns text
language plpgsql
as $$
begin
    execute p_sql;
    return 'OK';
exception when others then
    return sqlstate;
end;
$$;

create or replace function crm_teste.linhas(p_sql text)
returns bigint
language plpgsql
as $$
declare
    v_n bigint;
begin
    execute p_sql;
    get diagnostics v_n = row_count;
    return v_n;
end;
$$;

-- SQLSTATE e mensagem: prova que a tela recebe o texto exato do banco.
create or replace function crm_teste.erro_de(p_sql text)
returns text
language plpgsql
as $$
begin
    execute p_sql;
    return 'OK';
exception when others then
    return sqlstate || ' ' || sqlerrm;
end;
$$;

grant execute on function crm_teste.sqlstate_de(text), crm_teste.linhas(text), crm_teste.erro_de(text) to authenticated, anon;

create or replace function crm_teste.trava_msg()
returns text
language sql
immutable
as $$ select '42501 Proposta já enviada não pode ser alterada. Use “Nova versão” para revisar.' $$;
grant execute on function crm_teste.trava_msg() to authenticated, anon;

-- ---------------------------------------------------------------------
-- CENÁRIO
--   Empresa E: gerente, vendedor 1, vendedor 2 (negócios E e E2)
--   Empresa F: vendedor (o intruso)
-- ---------------------------------------------------------------------
do $$
declare
    v_te uuid;
    v_tf uuid;
    v_ger uuid := gen_random_uuid();
    v_v1 uuid := gen_random_uuid();
    v_v2 uuid := gen_random_uuid();
    v_vf uuid := gen_random_uuid();
    v_neg_e uuid;
    v_neg_e2 uuid;
    v_neg_f uuid;
    v_prod uuid;
begin
    insert into auth.users (id, email) values
        (v_ger, v_ger || '@gerente.trv'), (v_v1, v_v1 || '@vendedor1.trv'),
        (v_v2, v_v2 || '@vendedor2.trv'), (v_vf, v_vf || '@vendedor-f.trv');

    insert into public.empresas (nome) values ('Travada E') returning id into v_te;
    insert into public.empresas (nome) values ('Intrusa F') returning id into v_tf;

    insert into public.utilizadores_empresas (auth_uid, empresa_id, role) values
        (v_ger, v_te, 'gerente'), (v_v1, v_te, 'vendedor'), (v_v2, v_te, 'vendedor'), (v_vf, v_tf, 'vendedor');

    insert into public.negocios (tenant_id, titulo) values (v_te, 'Usina Travada') returning id into v_neg_e;
    insert into public.negocios (tenant_id, titulo) values (v_te, 'Negócio que será apagado') returning id into v_neg_e2;
    insert into public.negocios (tenant_id, titulo) values (v_tf, 'Negócio da F') returning id into v_neg_f;
    insert into public.produtos (tenant_id, nome, unidade, preco_padrao) values (v_te, 'Inversor 8 kW', 'un', 7000) returning id into v_prod;

    -- papel "gerente" reconhecido pela 12; sem ela, "admin" (mesma regra)
    perform public.login_como(v_ger, 'gerente.trv@e.com');
    if not public.eh_admin_do_tenant() then
        perform public.login_admin();
        update public.utilizadores_empresas set role = 'admin' where auth_uid = v_ger;
    end if;
    perform public.login_admin();

    delete from crm_teste.ctx where chave like 'trv_%';
    insert into crm_teste.ctx values
        ('trv_te', v_te), ('trv_tf', v_tf), ('trv_ger', v_ger), ('trv_v1', v_v1), ('trv_v2', v_v2), ('trv_vf', v_vf),
        ('trv_neg_e', v_neg_e), ('trv_neg_e2', v_neg_e2), ('trv_neg_f', v_neg_f), ('trv_prod', v_prod);
end $$;

-- Cria um orçamento rascunho com 2 itens (um do catálogo) como o usuário dado.
create or replace function crm_teste.novo_orcamento_trv(p_user uuid, p_negocio uuid, p_titulo text)
returns uuid
language plpgsql
as $$
declare
    v_id uuid;
    v_prod uuid := (select valor from crm_teste.ctx where chave = 'trv_prod');
begin
    perform public.login_como(p_user, 'x@trv.com');
    v_id := public.salvar_orcamento(
        jsonb_build_object('negocio_id', p_negocio, 'titulo', p_titulo, 'desconto_tipo', 'percentual', 'desconto_valor', 10,
                           'condicoes_pagamento', 'Entrada de 30%', 'observacoes', 'Obs original'),
        jsonb_build_array(
            jsonb_build_object('produto_id', v_prod,
                               'descricao', 'Inversor 8 kW', 'quantidade', 1, 'valor_unitario', 7000),
            jsonb_build_object('descricao', 'Instalação', 'unidade', 'serviço', 'quantidade', 1, 'valor_unitario', 3000,
                               'desconto_tipo', 'valor', 'desconto_valor', 500)
        )
    );
    perform public.login_admin();
    return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- T1: rascunho é editável (uso legítimo intacto)
-- ---------------------------------------------------------------------
do $$
declare
    v_v1 uuid := (select valor from crm_teste.ctx where chave = 'trv_v1');
    v_v2 uuid := (select valor from crm_teste.ctx where chave = 'trv_v2');
    v_neg uuid := (select valor from crm_teste.ctx where chave = 'trv_neg_e');
    v_id uuid;
    v_item uuid;
    v_orc record;
begin
    v_id := crm_teste.novo_orcamento_trv(v_v1, v_neg, 'Proposta T1');
    select * into v_orc from public.orcamentos where id = v_id;
    perform public.assert(v_orc.status = 'rascunho' and v_orc.revisao = 1 and v_orc.versao_de is null and v_orc.numero_original is null,
        'T1: proposta nova nasce rascunho, revisão 1, sem versão anterior');
    perform public.assert(v_orc.total = 8550.00, 'T1: total do rascunho = (7.000 + 2.500) - 10% = 8.550,00');

    perform public.login_como(v_v2, 'vendedor2.trv@e.com');
    perform public.assert(crm_teste.linhas(format(
        $q$update public.orcamentos set titulo = 'T1 editado', valido_ate = data_emissao + 30, observacoes = 'nova obs' where id = %L$q$, v_id)) = 1,
        'T1: rascunho: cabeçalho editável pela API direta (outro vendedor do tenant)');
    select id into v_item from public.orcamento_itens where orcamento_id = v_id and ordem = 2;
    perform public.assert(crm_teste.linhas(format(
        $q$update public.orcamento_itens set quantidade = 2 where id = %L$q$, v_item)) = 1,
        'T1: rascunho: item editável pela API direta');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$insert into public.orcamento_itens (orcamento_id, descricao, quantidade, valor_unitario) values (%L, 'Extra', 1, 100)$q$, v_id)) = 'OK',
        'T1: rascunho: item novo entra');
    perform public.assert(crm_teste.linhas(format(
        $q$delete from public.orcamento_itens where orcamento_id = %L and descricao = 'Extra'$q$, v_id)) = 1,
        'T1: rascunho: item sai');
    perform public.salvar_orcamento(
        jsonb_build_object('id', v_id, 'titulo', 'T1 via RPC', 'desconto_tipo', 'valor', 'desconto_valor', 0),
        jsonb_build_array(jsonb_build_object('descricao', 'Kit completo', 'quantidade', 1, 'valor_unitario', 12000)));
    perform public.login_admin();

    select * into v_orc from public.orcamentos where id = v_id;
    perform public.assert(v_orc.titulo = 'T1 via RPC' and v_orc.total = 12000.00
        and (select count(*) from public.orcamento_itens where orcamento_id = v_id) = 1,
        'T1: rascunho: salvar_orcamento regrava cabeçalho e itens (total 12.000,00)');
end $$;

-- ---------------------------------------------------------------------
-- T2: transições inválidas a partir do rascunho; insert já "enviado"
-- ---------------------------------------------------------------------
do $$
declare
    v_v1 uuid := (select valor from crm_teste.ctx where chave = 'trv_v1');
    v_neg uuid := (select valor from crm_teste.ctx where chave = 'trv_neg_e');
    v_id uuid;
    v_status text;
    v_erro text;
begin
    v_id := crm_teste.novo_orcamento_trv(v_v1, v_neg, 'Proposta T2');
    perform public.login_como(v_v1, 'vendedor1.trv@e.com');
    foreach v_status in array array['aceito', 'recusado', 'expirado'] loop
        v_erro := crm_teste.erro_de(format($q$update public.orcamentos set status = %L where id = %L$q$, v_status, v_id));
        perform public.assert(v_erro like '42501 Mudança de status não permitida: de "Rascunho" para %Marque a proposta como enviada primeiro.',
            'T2: rascunho -> ' || v_status || ' recusado (42501, mensagem clara): ' || v_erro);
    end loop;
    perform public.assert(crm_teste.erro_de(format($q$update public.orcamentos set status = 'substituido' where id = %L$q$, v_id))
        = '42501 Só uma revisão já enviada substitui a proposta: use “Nova versão” e envie a revisão.',
        'T2: rascunho -> substituido recusado (só o banco substitui)');
    perform public.assert(crm_teste.sqlstate_de(format($q$update public.orcamentos set status = 'aprovado' where id = %L$q$, v_id)) = '23514',
        'T2: status fora da lista continua barrado pelo CHECK (23514)');
    perform public.assert(crm_teste.erro_de(format(
        $q$insert into public.orcamentos (negocio_id, status) values (%L, 'enviado')$q$, v_neg))
        = '42501 Orçamento novo nasce como rascunho: salve e depois marque como enviado.',
        'T2: orçamento novo já "enviado" pela API direta recusado (pularia a trava)');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$select public.salvar_orcamento(%L::jsonb, '[]'::jsonb)$q$, jsonb_build_object('negocio_id', v_neg, 'status', 'aceito'))) = '42501',
        'T2: orçamento novo já "aceito" via salvar_orcamento recusado');
    perform public.login_admin();
    perform public.assert((select status from public.orcamentos where id = v_id) = 'rascunho', 'T2: status intacto depois das tentativas');
    insert into crm_teste.ctx values ('trv_t2', v_id);
end $$;

-- ---------------------------------------------------------------------
-- T3: enviado trava cabeçalho e itens
-- ---------------------------------------------------------------------
do $$
declare
    v_ger uuid := (select valor from crm_teste.ctx where chave = 'trv_ger');
    v_v1 uuid := (select valor from crm_teste.ctx where chave = 'trv_v1');
    v_v2 uuid := (select valor from crm_teste.ctx where chave = 'trv_v2');
    v_vf uuid := (select valor from crm_teste.ctx where chave = 'trv_vf');
    v_te uuid := (select valor from crm_teste.ctx where chave = 'trv_te');
    v_neg uuid := (select valor from crm_teste.ctx where chave = 'trv_neg_e');
    v_id uuid;
    v_item uuid;
    v_antes jsonb;
    v_depois jsonb;
    v_itens_antes jsonb;
    v_set text;
    v_usuario uuid;
    v_quem text;
    v_orc record;
begin
    v_id := crm_teste.novo_orcamento_trv(v_v1, v_neg, 'Proposta T3');
    perform public.login_como(v_v1, 'vendedor1.trv@e.com');
    perform public.assert(crm_teste.linhas(format($q$update public.orcamentos set status = 'enviado' where id = %L$q$, v_id)) = 1,
        'T3: rascunho -> enviado funciona');
    perform public.login_admin();
    select * into v_orc from public.orcamentos where id = v_id;
    perform public.assert(v_orc.enviado_em is not null, 'T3: envio registra enviado_em');

    v_antes := (select to_jsonb(o) - array['updated_at', 'updated_by'] from public.orcamentos o where id = v_id);
    v_itens_antes := (select jsonb_agg(to_jsonb(i) order by ordem) from public.orcamento_itens i where orcamento_id = v_id);
    select id into v_item from public.orcamento_itens where orcamento_id = v_id and ordem = 1;

    -- criador, outro vendedor e gerente: ninguém altera o conteúdo
    foreach v_usuario in array array[v_v1, v_v2, v_ger] loop
        v_quem := case v_usuario when v_v1 then 'criador' when v_v2 then 'outro vendedor' else 'gerente' end;
        perform public.login_como(v_usuario, 'u.trv@e.com');
        foreach v_set in array array[
            $s$titulo = 'Alterado depois de enviado'$s$,
            $s$valido_ate = valido_ate + 30$s$,
            $s$data_emissao = data_emissao - 1$s$,
            $s$desconto_tipo = 'valor', desconto_valor = 1$s$,
            $s$desconto_valor = 50$s$,
            $s$condicoes_pagamento = 'À vista'$s$,
            $s$observacoes = 'nova'$s$,
            $s$responsavel_nome = 'Outro', responsavel_email = 'o@x.com', responsavel_telefone = '1'$s$,
            $s$responsavel_id = null$s$,
            $s$status = 'aceito', titulo = 'Aceito com outro título'$s$
        ] loop
            perform public.assert(crm_teste.erro_de(format('update public.orcamentos set %s where id = %L', v_set, v_id)) = crm_teste.trava_msg(),
                'T3 [' || v_quem || ']: enviado recusa "' || v_set || '" (42501 + mensagem exata)');
        end loop;

        perform public.assert(crm_teste.erro_de(format(
            $q$insert into public.orcamento_itens (orcamento_id, descricao, quantidade, valor_unitario) values (%L, 'Intruso', 1, 1)$q$, v_id)) = crm_teste.trava_msg(),
            'T3 [' || v_quem || ']: enviado recusa item novo');
        perform public.assert(crm_teste.erro_de(format(
            $q$update public.orcamento_itens set valor_unitario = 1 where id = %L$q$, v_item)) = crm_teste.trava_msg(),
            'T3 [' || v_quem || ']: enviado recusa alterar item');
        perform public.assert(crm_teste.erro_de(format(
            $q$update public.orcamento_itens set ordem = ordem where orcamento_id = %L$q$, v_id)) = crm_teste.trava_msg(),
            'T3 [' || v_quem || ']: enviado recusa até UPDATE sem mudança nos itens (trava por status, não por diferença)');
        perform public.assert(crm_teste.erro_de(format(
            $q$delete from public.orcamento_itens where id = %L$q$, v_item)) = crm_teste.trava_msg(),
            'T3 [' || v_quem || ']: enviado recusa remover item');
        perform public.assert(crm_teste.erro_de(format(
            $q$select public.salvar_orcamento(%L::jsonb, %L::jsonb)$q$,
            jsonb_build_object('id', v_id, 'titulo', 'Via RPC depois de enviado'),
            jsonb_build_array(jsonb_build_object('descricao', 'Novo', 'quantidade', 1, 'valor_unitario', 1)))) = crm_teste.trava_msg(),
            'T3 [' || v_quem || ']: enviado recusa salvar_orcamento (mesma mensagem do banco)');
        perform public.login_admin();
    end loop;

    -- reenviar o MESMO conteúdo pela RPC também é recusado (itens travados)
    perform public.login_como(v_v1, 'vendedor1.trv@e.com');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$select public.salvar_orcamento(%L::jsonb, %L::jsonb)$q$,
        (select to_jsonb(o) from public.orcamentos o where id = v_id),
        (select jsonb_agg(to_jsonb(i) order by ordem) from public.orcamento_itens i where orcamento_id = v_id))) = '42501',
        'T3: salvar_orcamento com o mesmo conteúdo também é recusado');

    -- colunas técnicas: total forjado é recalculado; updated_at pode ser tocado
    perform public.assert(crm_teste.linhas(format($q$update public.orcamentos set total = 1, subtotal = 1 where id = %L$q$, v_id)) = 1
        and (select total from public.orcamentos where id = v_id) = v_orc.total,
        'T3: total forjado num enviado é ignorado (banco recalcula, nada muda)');
    perform public.assert(crm_teste.linhas(format($q$update public.orcamentos set updated_at = now() where id = %L$q$, v_id)) = 1,
        'T3: coluna técnica (updated_at) continua permitida');
    perform public.login_admin();

    -- outro tenant nem enxerga (header forjado)
    perform public.login_como(v_vf, 'vendedor.trv@f.com', v_te);
    perform public.assert(crm_teste.linhas(format($q$update public.orcamentos set titulo = 'invadido' where id = %L$q$, v_id)) = 0
        and crm_teste.linhas(format($q$delete from public.orcamento_itens where orcamento_id = %L$q$, v_id)) = 0,
        'T3: tenant F não altera nem apaga itens do enviado de E (0 linhas)');
    perform public.login_admin();

    v_depois := (select to_jsonb(o) - array['updated_at', 'updated_by'] from public.orcamentos o where id = v_id);
    perform public.assert(v_depois = v_antes, 'T3: cabeçalho do enviado intacto depois de todos os ataques');
    perform public.assert((select jsonb_agg(to_jsonb(i) order by ordem) from public.orcamento_itens i where orcamento_id = v_id) = v_itens_antes,
        'T3: itens do enviado intactos depois de todos os ataques');

    -- transição inválida a partir do enviado
    perform public.login_como(v_v1, 'vendedor1.trv@e.com');
    perform public.assert(crm_teste.erro_de(format($q$update public.orcamentos set status = 'rascunho' where id = %L$q$, v_id))
        = '42501 Mudança de status não permitida: de "Enviado" para "Rascunho". Para revisar, use “Nova versão”.',
        'T3: enviado -> rascunho recusado (destravar seria editar o que o cliente já recebeu)');
    perform public.assert(crm_teste.sqlstate_de(format($q$update public.orcamentos set status = 'substituido' where id = %L$q$, v_id)) = '42501',
        'T3: enviado -> substituido manual recusado (sem revisão enviada)');
    perform public.login_admin();

    insert into crm_teste.ctx values ('trv_t3', v_id);
end $$;

-- ---------------------------------------------------------------------
-- T4: transições válidas; aceito, recusado e expirado são finais
-- ---------------------------------------------------------------------
do $$
declare
    v_v1 uuid := (select valor from crm_teste.ctx where chave = 'trv_v1');
    v_v2 uuid := (select valor from crm_teste.ctx where chave = 'trv_v2');
    v_neg uuid := (select valor from crm_teste.ctx where chave = 'trv_neg_e');
    v_final text;
    v_destino text;
    v_id uuid;
    v_erro text;
begin
    foreach v_final in array array['aceito', 'recusado', 'expirado'] loop
        v_id := crm_teste.novo_orcamento_trv(v_v1, v_neg, 'Proposta T4 ' || v_final);
        perform public.login_como(v_v2, 'vendedor2.trv@e.com');
        update public.orcamentos set status = 'enviado' where id = v_id;
        perform public.assert(crm_teste.linhas(format($q$update public.orcamentos set status = %L where id = %L$q$, v_final, v_id)) = 1,
            'T4: enviado -> ' || v_final || ' funciona');
        foreach v_destino in array array['rascunho', 'enviado', 'aceito', 'recusado', 'expirado'] loop
            continue when v_destino = v_final;
            v_erro := crm_teste.erro_de(format($q$update public.orcamentos set status = %L where id = %L$q$, v_destino, v_id));
            perform public.assert(v_erro like '42501 Proposta "%" é final: o status não muda mais. Use “Nova versão” para revisar.',
                'T4: ' || v_final || ' é final (-> ' || v_destino || ' recusado)');
        end loop;
        perform public.assert(crm_teste.erro_de(format($q$update public.orcamentos set titulo = 'x' where id = %L$q$, v_id)) = crm_teste.trava_msg(),
            'T4: ' || v_final || ' também trava o conteúdo');
        perform public.login_admin();
        perform public.assert((select status from public.orcamentos where id = v_id) = v_final, 'T4: ' || v_final || ' gravado');
        if v_final = 'aceito' then
            perform public.assert((select decidido_em is not null from public.orcamentos where id = v_id), 'T4: aceito registra decidido_em');
        end if;
        insert into crm_teste.ctx values ('trv_t4_' || v_final, v_id);
    end loop;
end $$;

-- ---------------------------------------------------------------------
-- T5: soft delete e restauração continuam com as regras da 13
-- ---------------------------------------------------------------------
do $$
declare
    v_ger uuid := (select valor from crm_teste.ctx where chave = 'trv_ger');
    v_v1 uuid := (select valor from crm_teste.ctx where chave = 'trv_v1');
    v_v2 uuid := (select valor from crm_teste.ctx where chave = 'trv_v2');
    v_t3 uuid := (select valor from crm_teste.ctx where chave = 'trv_t3');
    v_aceito uuid := (select valor from crm_teste.ctx where chave = 'trv_t4_aceito');
begin
    perform public.login_como(v_v2, 'vendedor2.trv@e.com');
    perform public.assert(crm_teste.sqlstate_de(format($q$update public.orcamentos set deleted_at = now() where id = %L$q$, v_t3)) = '42501',
        'T5: vendedor que não criou NÃO exclui o enviado (regra da 13)');
    perform public.login_admin();

    perform public.login_como(v_v1, 'vendedor1.trv@e.com');
    perform public.assert(crm_teste.linhas(format($q$update public.orcamentos set deleted_at = now() where id = %L$q$, v_t3)) = 1,
        'T5: criador exclui (soft delete) o próprio enviado');
    perform public.assert(crm_teste.sqlstate_de(format($q$update public.orcamentos set titulo = 'na lixeira' where id = %L$q$, v_t3)) = '55000',
        'T5: na lixeira continua respondendo "restaure antes" (55000)');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$update public.orcamentos set deleted_at = null, titulo = 'restaurado e mudado' where id = %L$q$, v_t3)) = '42501',
        'T5: restaurar não serve de brecha para mudar o conteúdo');
    perform public.assert(public.restaurar_registro('orcamentos', v_t3::text),
        'T5: criador restaura o próprio enviado pela Lixeira (restaurar_registro)');
    perform public.assert(crm_teste.erro_de(format($q$update public.orcamentos set titulo = 'x' where id = %L$q$, v_t3)) = crm_teste.trava_msg(),
        'T5: restaurado continua travado');
    perform public.login_admin();
    perform public.assert((select status = 'enviado' and deleted_at is null from public.orcamentos where id = v_t3),
        'T5: restaurado volta como estava (enviado)');

    perform public.login_como(v_ger, 'gerente.trv@e.com');
    perform public.assert(crm_teste.linhas(format($q$update public.orcamentos set deleted_at = now() where id = %L$q$, v_aceito)) = 1,
        'T5: gerente exclui o aceito de outro vendedor');
    perform public.assert(crm_teste.linhas(format($q$update public.orcamentos set deleted_at = null where id = %L$q$, v_aceito)) = 1,
        'T5: gerente restaura');
    perform public.login_admin();
end $$;

-- ---------------------------------------------------------------------
-- T6: nova versão
-- ---------------------------------------------------------------------
do $$
declare
    v_te uuid := (select valor from crm_teste.ctx where chave = 'trv_te');
    v_v1 uuid := (select valor from crm_teste.ctx where chave = 'trv_v1');
    v_v2 uuid := (select valor from crm_teste.ctx where chave = 'trv_v2');
    v_vf uuid := (select valor from crm_teste.ctx where chave = 'trv_vf');
    v_neg uuid := (select valor from crm_teste.ctx where chave = 'trv_neg_e');
    v_neg_f uuid := (select valor from crm_teste.ctx where chave = 'trv_neg_f');
    v_prod uuid := (select valor from crm_teste.ctx where chave = 'trv_prod');
    v_t2 uuid := (select valor from crm_teste.ctx where chave = 'trv_t2');
    v_t3 uuid := (select valor from crm_teste.ctx where chave = 'trv_t3');
    v_aceito uuid := (select valor from crm_teste.ctx where chave = 'trv_t4_aceito');
    v_recusado uuid := (select valor from crm_teste.ctx where chave = 'trv_t4_recusado');
    v_expirado uuid := (select valor from crm_teste.ctx where chave = 'trv_t4_expirado');
    v_orig record;
    v_rev record;
    v_rev_id uuid;
    v_rev2_id uuid;
    v_rev3_id uuid;
    v_outro uuid;
    v_ultimo int;
    v_itens_orig jsonb;
    v_itens_rev jsonb;
begin
    -- rascunho não precisa de versão
    perform public.login_como(v_v1, 'vendedor1.trv@e.com');
    perform public.assert(crm_teste.erro_de(format($q$select public.nova_versao_orcamento(%L)$q$, v_t2))
        = '55000 Rascunho ainda pode ser editado: não precisa de nova versão.',
        'T6: nova versão de rascunho recusada (55000, edite o rascunho)');
    perform public.login_admin();

    -- a partir do enviado (T3), por OUTRO vendedor do tenant
    select * into v_orig from public.orcamentos where id = v_t3;
    v_ultimo := (select ultimo from public.orcamento_contadores where tenant_id = v_te and ano = v_orig.numero_ano);
    perform public.login_como(v_v2, 'vendedor2.trv@e.com');
    v_rev_id := public.nova_versao_orcamento(v_t3);
    perform public.login_admin();

    select * into v_rev from public.orcamentos where id = v_rev_id;
    perform public.assert(v_rev.status = 'rascunho', 'T6: nova versão nasce RASCUNHO (editável)');
    perform public.assert(v_rev.numero_seq = v_ultimo + 1 and v_rev.numero <> v_orig.numero,
        'T6: nova versão recebe número NOVO da sequência normal (' || v_rev.numero || ')');
    perform public.assert(v_rev.versao_de = v_t3 and v_rev.revisao = 2 and v_rev.numero_original = v_orig.numero,
        'T6: nova versão ligada à original: versao_de, revisão 2 e "de ' || v_orig.numero || '"');
    perform public.assert(v_rev.tenant_id = v_te and v_rev.negocio_id = v_orig.negocio_id and v_rev.created_by = v_v2,
        'T6: nova versão no mesmo tenant e negócio, criada por quem pediu');
    perform public.assert(v_rev.titulo = v_orig.titulo and v_rev.desconto_tipo = v_orig.desconto_tipo
        and v_rev.desconto_valor = v_orig.desconto_valor and v_rev.condicoes_pagamento = v_orig.condicoes_pagamento
        and v_rev.observacoes = v_orig.observacoes and v_rev.responsavel_nome is not distinct from v_orig.responsavel_nome
        and v_rev.valido_ate - v_rev.data_emissao = v_orig.valido_ate - v_orig.data_emissao
        and v_rev.data_emissao = (now() at time zone 'America/Sao_Paulo')::date,
        'T6: cabeçalho copiado; emitida hoje com a mesma janela de validade');
    select jsonb_agg(jsonb_build_array(produto_id, descricao, detalhes, unidade, quantidade, valor_unitario, desconto_tipo, desconto_valor, total, ordem) order by ordem)
        into v_itens_orig from public.orcamento_itens where orcamento_id = v_t3;
    select jsonb_agg(jsonb_build_array(produto_id, descricao, detalhes, unidade, quantidade, valor_unitario, desconto_tipo, desconto_valor, total, ordem) order by ordem)
        into v_itens_rev from public.orcamento_itens where orcamento_id = v_rev_id;
    perform public.assert(v_itens_rev = v_itens_orig and jsonb_array_length(v_itens_rev) = 2
        and (v_itens_rev -> 0 ->> 0)::uuid = v_prod,
        'T6: itens copiados (inclusive o vínculo com o catálogo)');
    perform public.assert(v_rev.total = v_orig.total and v_rev.subtotal = v_orig.subtotal,
        'T6: totais da nova versão iguais aos da original');
    perform public.assert((select status from public.orcamentos where id = v_t3) = 'enviado',
        'T6: original continua ENVIADA enquanto a revisão é rascunho (cliente ainda pode aceitá-la)');

    -- clique duplo não gasta número
    perform public.login_como(v_v1, 'vendedor1.trv@e.com');
    perform public.assert(public.nova_versao_orcamento(v_t3) = v_rev_id,
        'T6: "Nova versão" de novo devolve o MESMO rascunho (sem duplicar)');
    perform public.assert(crm_teste.erro_de(format(
        $q$insert into public.orcamentos (negocio_id, versao_de) values (%L, %L)$q$, v_neg, v_t3))
        like '55000 Esta proposta já tem a revisão 2 (%): continue por ela.',
        'T6: segunda revisão ativa da mesma proposta pela API direta recusada (cadeia linear)');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$update public.orcamentos set versao_de = null where id = %L$q$, v_rev_id)) = '42501'
        and crm_teste.sqlstate_de(format($q$update public.orcamentos set revisao = 7 where id = %L$q$, v_rev_id)) = '42501'
        and crm_teste.sqlstate_de(format($q$update public.orcamentos set numero_original = '1999-0001' where id = %L$q$, v_rev_id)) = '42501',
        'T6: vínculo de versão (versao_de, revisao, numero_original) imutável pela API');
    perform public.login_admin();
    perform public.assert((select ultimo from public.orcamento_contadores where tenant_id = v_te and ano = v_orig.numero_ano) = v_ultimo + 1,
        'T6: o contador andou só uma vez');

    -- a revisão é editável normalmente
    perform public.login_como(v_v2, 'vendedor2.trv@e.com');
    perform public.salvar_orcamento(
        jsonb_build_object('id', v_rev_id, 'titulo', 'Proposta T3 (revisada)', 'desconto_tipo', 'percentual', 'desconto_valor', 5),
        jsonb_build_array(
            jsonb_build_object('produto_id', v_prod, 'descricao', 'Inversor 8 kW', 'quantidade', 1, 'valor_unitario', 6500),
            jsonb_build_object('descricao', 'Instalação', 'quantidade', 1, 'valor_unitario', 3000)));
    perform public.login_admin();
    perform public.assert((select total from public.orcamentos where id = v_rev_id) = 9025.00,
        'T6: revisão rascunho editável (9.500 - 5% = 9.025,00)');
    perform public.assert((select total from public.orcamentos where id = v_t3) = v_orig.total
        and (select count(*) from public.orcamento_itens where orcamento_id = v_t3) = 2,
        'T6: editar a revisão não toca a original');

    -- tenant: F não cria versão de proposta de E, nem por RPC nem pela API
    perform public.login_como(v_vf, 'vendedor.trv@f.com', v_te);
    perform public.assert(crm_teste.sqlstate_de(format($q$select public.nova_versao_orcamento(%L)$q$, v_t3)) = 'P0002',
        'T6: tenant F não cria nova versão de proposta de E (não encontrada, header forjado)');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$insert into public.orcamentos (negocio_id, versao_de) values (%L, %L)$q$, v_neg_f, v_t3)) = '23503',
        'T6: tenant F não liga orçamento próprio a proposta de E (FK composta)');
    perform public.login_admin();
    perform public.assert((select count(*) from public.orcamentos where versao_de = v_t3) = 1,
        'T6: nenhuma revisão cruzada entre tenants');

    -- ENVIAR a revisão substitui a original
    perform public.login_como(v_v2, 'vendedor2.trv@e.com');
    update public.orcamentos set status = 'enviado' where id = v_rev_id;
    perform public.login_admin();
    perform public.assert((select status from public.orcamentos where id = v_t3) = 'substituido',
        'T6: revisão enviada marca a original (enviada) como SUBSTITUÍDA');
    perform public.login_como(v_v1, 'vendedor1.trv@e.com');
    perform public.assert(crm_teste.erro_de(format($q$update public.orcamentos set status = 'aceito' where id = %L$q$, v_t3))
        = '42501 Proposta "Substituído" é final: o status não muda mais. Use “Nova versão” para revisar.',
        'T6: substituída é final');
    perform public.assert(crm_teste.erro_de(format($q$select public.nova_versao_orcamento(%L)$q$, v_t3))
        = '55000 Esta proposta já foi substituída por uma revisão mais nova: crie a nova versão a partir da mais recente.',
        'T6: nova versão de substituída recusada (cadeia segue pela mais recente)');
    v_rev2_id := public.nova_versao_orcamento(v_rev_id);
    perform public.login_admin();
    perform public.assert((select revisao = 3 and numero_original = v_orig.numero and versao_de = v_rev_id
        from public.orcamentos where id = v_rev2_id),
        'T6: revisão da revisão = revisão 3, ainda "de ' || v_orig.numero || '"');

    -- restaurar revisão quando outra já está ativa
    perform public.login_como(v_v1, 'vendedor1.trv@e.com');
    update public.orcamentos set deleted_at = now() where id = v_rev2_id;
    v_rev3_id := public.nova_versao_orcamento(v_rev_id);
    perform public.assert(v_rev3_id <> v_rev2_id, 'T6: com a revisão anterior na lixeira, "Nova versão" cria outra');
    perform public.assert(crm_teste.erro_de(format($q$update public.orcamentos set deleted_at = null where id = %L$q$, v_rev2_id))
        like '55000 Já existe a revisão 3 (%) ativa desta proposta: exclua-a antes de restaurar esta.',
        'T6: restaurar revisão concorrente recusado com mensagem clara (cadeia linear)');
    perform public.login_admin();

    -- aceita a anterior enquanto a revisão é rascunho; enviar a revisão não mexe no aceito
    v_outro := crm_teste.novo_orcamento_trv(v_v1, v_neg, 'Proposta T6 aceita na versão 1');
    perform public.login_como(v_v1, 'vendedor1.trv@e.com');
    update public.orcamentos set status = 'enviado' where id = v_outro;
    v_rev_id := public.nova_versao_orcamento(v_outro);
    perform public.assert(crm_teste.linhas(format($q$update public.orcamentos set status = 'aceito' where id = %L$q$, v_outro)) = 1,
        'T6: cliente aceita a versão 1 enquanto a 2 é rascunho: aceito funciona');
    update public.orcamentos set status = 'enviado' where id = v_rev_id;
    perform public.login_admin();
    perform public.assert((select status from public.orcamentos where id = v_outro) = 'aceito',
        'T6: revisão enviada NÃO substitui proposta já aceita');

    -- expirada vira substituída; recusada e aceita aceitam nova versão
    perform public.login_como(v_v1, 'vendedor1.trv@e.com');
    v_rev_id := public.nova_versao_orcamento(v_expirado);
    update public.orcamentos set status = 'enviado' where id = v_rev_id;
    v_outro := public.nova_versao_orcamento(v_recusado);
    perform public.assert(v_outro is not null, 'T6: recusada aceita nova versão (proposta refeita)');
    v_outro := public.nova_versao_orcamento(v_aceito);
    perform public.assert(v_outro is not null, 'T6: aceita aceita nova versão (aditivo)');
    perform public.login_admin();
    perform public.assert((select status from public.orcamentos where id = v_expirado) = 'substituido',
        'T6: revisão enviada marca a original EXPIRADA como substituída');
    perform public.assert((select status from public.orcamentos where id = v_recusado) = 'recusado'
        and (select status from public.orcamentos where id = v_aceito) = 'aceito',
        'T6: criar revisão não muda o status da anterior');

    -- duplicar (salvar_orcamento sem versao_de) continua solto
    perform public.login_como(v_v1, 'vendedor1.trv@e.com');
    v_outro := public.salvar_orcamento(
        jsonb_build_object('negocio_id', v_neg, 'titulo', 'Cópia', 'status', 'rascunho'),
        (select jsonb_agg(to_jsonb(i) - 'id' order by ordem) from public.orcamento_itens i where orcamento_id = v_t3));
    perform public.login_admin();
    perform public.assert((select versao_de is null and revisao = 1 and numero_original is null from public.orcamentos where id = v_outro),
        'T6: Duplicar continua criando cópia SEM vínculo de versão');

    insert into crm_teste.ctx values ('trv_rev', (select id from public.orcamentos where versao_de = v_t3));
end $$;

-- ---------------------------------------------------------------------
-- T7: DELETE físico do gerente
-- ---------------------------------------------------------------------
do $$
declare
    v_ger uuid := (select valor from crm_teste.ctx where chave = 'trv_ger');
    v_v1 uuid := (select valor from crm_teste.ctx where chave = 'trv_v1');
    v_neg_e2 uuid := (select valor from crm_teste.ctx where chave = 'trv_neg_e2');
    v_t3 uuid := (select valor from crm_teste.ctx where chave = 'trv_t3');
    v_rev uuid := (select valor from crm_teste.ctx where chave = 'trv_rev');
    v_id uuid;
    v_p uuid;
    v_q uuid;
begin
    v_id := crm_teste.novo_orcamento_trv(v_v1, (select valor from crm_teste.ctx where chave = 'trv_neg_e'), 'Proposta T7');
    perform public.login_como(v_v1, 'vendedor1.trv@e.com');
    update public.orcamentos set status = 'enviado' where id = v_id;
    perform public.assert(crm_teste.linhas(format($q$delete from public.orcamentos where id = %L$q$, v_id)) = 0,
        'T7: vendedor não apaga de vez (0 linhas, regra da 13)');
    perform public.login_admin();

    perform public.login_como(v_ger, 'gerente.trv@e.com');
    perform public.assert(crm_teste.linhas(format($q$delete from public.orcamentos where id = %L$q$, v_id)) = 1,
        'T7: gerente apaga de vez um orçamento ENVIADO');
    perform public.assert(crm_teste.sqlstate_de(format($q$delete from public.orcamentos where id = %L$q$, v_t3)) = '23503',
        'T7: original com revisão não some por baixo dela (histórico preservado, FK)');
    perform public.login_admin();
    perform public.assert(not exists (select 1 from public.orcamento_itens where orcamento_id = v_id),
        'T7: itens do enviado apagado foram junto (cascata não é barrada pela trava)');
    perform public.assert(exists (select 1 from public.orcamentos where id = v_t3) and exists (select 1 from public.orcamentos where id = v_rev),
        'T7: original e revisão intactas');

    -- negócio apagado de vez leva a cadeia inteira (original + revisão + itens)
    v_p := crm_teste.novo_orcamento_trv(v_v1, v_neg_e2, 'Cadeia P');
    perform public.login_como(v_v1, 'vendedor1.trv@e.com');
    update public.orcamentos set status = 'enviado' where id = v_p;
    v_q := public.nova_versao_orcamento(v_p);
    update public.orcamentos set status = 'enviado' where id = v_q;
    perform public.login_admin();
    perform public.login_como(v_ger, 'gerente.trv@e.com');
    perform public.assert(crm_teste.sqlstate_de(format($q$delete from public.negocios where id = %L$q$, v_neg_e2)) = 'OK',
        'T7: gerente apaga de vez o negócio com cadeia de propostas enviadas');
    perform public.login_admin();
    perform public.assert(not exists (select 1 from public.orcamentos where id in (v_p, v_q))
        and not exists (select 1 from public.orcamento_itens where orcamento_id in (v_p, v_q)),
        'T7: original, revisão e itens apagados em cascata com o negócio');
end $$;

-- ---------------------------------------------------------------------
-- T8: numeração sem buraco
-- ---------------------------------------------------------------------
do $$
declare
    v_te uuid := (select valor from crm_teste.ctx where chave = 'trv_te');
    v_ano int := extract(year from (now() at time zone 'America/Sao_Paulo'))::int;
    v_seqs int[];
    v_ultimo int;
    v_apagados int := 3; -- T7: o enviado apagado e a cadeia P/Q do negócio apagado
begin
    select array_agg(numero_seq order by numero_seq) into v_seqs from public.orcamentos where tenant_id = v_te;
    v_ultimo := (select ultimo from public.orcamento_contadores where tenant_id = v_te and ano = v_ano);
    perform public.assert(cardinality(v_seqs) + v_apagados = v_ultimo
        and (select count(distinct s) from unnest(v_seqs) s) = cardinality(v_seqs)
        and v_seqs[cardinality(v_seqs)] <= v_ultimo,
        'T8: numeração do tenant E sem duplicata e sem número perdido (recusas não gastaram número): '
        || cardinality(v_seqs) || ' ativos + ' || v_apagados || ' apagados de vez = ' || v_ultimo);
    perform public.assert(
        (select bool_and(numero = v_ano || '-' || lpad(numero_seq::text, 4, '0')) from public.orcamentos where tenant_id = v_te),
        'T8: número no formato ' || v_ano || '-NNNN em todas as versões');
end $$;

-- ---------------------------------------------------------------------
-- T9: contexto administrativo (SQL Editor/cron) isento
-- ---------------------------------------------------------------------
do $$
declare
    v_t3 uuid := (select valor from crm_teste.ctx where chave = 'trv_t3');
    v_aceito uuid := (select valor from crm_teste.ctx where chave = 'trv_t4_aceito');
begin
    perform public.login_admin();
    perform public.assert(not public.requisicao_api_publica(), 'T9: login_admin é contexto administrativo');
    perform public.assert(crm_teste.linhas(format($q$update public.orcamentos set observacoes = 'ajuste do operador' where id = %L$q$, v_aceito)) = 1,
        'T9: operador corrige conteúdo de proposta aceita (isento)');
    perform public.assert(crm_teste.sqlstate_de(format(
        $q$insert into public.orcamento_itens (tenant_id, orcamento_id, descricao, quantidade, valor_unitario) values (%L, %L, 'Ajuste', 1, 1)$q$,
        (select valor from crm_teste.ctx where chave = 'trv_te'), v_aceito)) = 'OK',
        'T9: operador inclui item em proposta aceita (isento)');
    perform public.assert(crm_teste.linhas(format($q$update public.orcamentos set status = 'enviado' where id = %L$q$, v_t3)) = 1,
        'T9: operador corrige status (isento)');
end $$;

-- ---------------------------------------------------------------------
-- T10: privilégios
-- ---------------------------------------------------------------------
do $$
begin
    perform public.assert(
        has_function_privilege('authenticated', 'public.nova_versao_orcamento(uuid)', 'execute')
        and not has_function_privilege('anon', 'public.nova_versao_orcamento(uuid)', 'execute')
        and not (select prosecdef from pg_proc where oid = 'public.nova_versao_orcamento(uuid)'::regprocedure),
        'T10: nova_versao_orcamento é SECURITY INVOKER, executável só por authenticated');
    perform public.assert(
        not exists (
            select 1 from pg_proc
            where oid in ('public.fn_orcamentos_travar()'::regprocedure, 'public.fn_orcamento_itens_travar()'::regprocedure,
                          'public.fn_orcamentos_substituir_anterior()'::regprocedure)
              and (prosecdef
                   or has_function_privilege('authenticated', oid, 'execute')
                   or has_function_privilege('anon', oid, 'execute'))
        ),
        'T10: triggers da trava rodam como invoker e não são chamáveis pela API');

    perform public.login_anon();
    perform public.assert(crm_teste.sqlstate_de(format($q$select public.nova_versao_orcamento(%L)$q$, gen_random_uuid())) = '42501',
        'T10: anon não chama nova_versao_orcamento');
    perform public.login_admin();
end $$;

-- Rascunho usado pela Suíte 9b do runner (item gravado no mesmo instante
-- em que outra conexão envia a proposta).
do $$
begin
    insert into crm_teste.ctx values ('trv_corrida', crm_teste.novo_orcamento_trv(
        (select valor from crm_teste.ctx where chave = 'trv_v1'),
        (select valor from crm_teste.ctx where chave = 'trv_neg_e'),
        'Proposta da corrida'));
end $$;

do $$
begin
    raise notice 'MIGRATION 14 (proposta travada + nova versão) VALIDADA';
end $$;
