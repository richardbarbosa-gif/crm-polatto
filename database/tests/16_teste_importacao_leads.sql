-- =====================================================================
-- Suíte 16 — migration 21: importação de leads com deduplicação no banco.
-- (A corrida entre duas importações simultâneas é provada pelo runner,
-- Suíte 16b, com duas conexões.)
-- =====================================================================
\set ON_ERROR_STOP on

-- Auxiliar de teste: a migration 20 (reaplicada na suíte 15) tirou de anon o
-- EXECUTE de toda função de public — inclusive o "voltar a ser admin" dos testes.
grant execute on function public.login_admin() to anon;

do $$
declare
    v_user_a uuid := (select valor from crm_teste.ctx where chave = 'user_a');
    v_user_b uuid := (select valor from crm_teste.ctx where chave = 'user_b');
    v_tenant_a uuid := (select valor from crm_teste.ctx where chave = 'tenant_a');
    v_tenant_b uuid := (select valor from crm_teste.ctx where chave = 'tenant_b');
    r1 jsonb;
    r2 jsonb;
    r3 jsonb;
    v_grande boolean := false;
    v_anon boolean := false;
begin
    perform public.login_como(v_user_a, 'vendedor.a@teste.com');
    r1 := public.importar_leads(jsonb_build_array(
        jsonb_build_object('linha', 2, 'nome', 'Importado Um', 'telefone', '(11) 91111-0001',
                           'telefones', jsonb_build_array('(11) 91111-0001', '11911110001'), 'email', 'um@importado.com'),
        -- mesma pessoa repetida no MESMO lote (o navegador já filtra; o banco também)
        jsonb_build_object('linha', 3, 'nome', 'Importado Um de novo', 'telefone', '11911110001',
                           'telefones', jsonb_build_array('(11) 91111-0001', '11911110001')),
        jsonb_build_object('linha', 4, 'nome', 'Importado Dois', 'telefone', '(11) 91111-0002',
                           'telefones', jsonb_build_array('(11) 91111-0002'), 'valor', '12.500,00'),
        -- linha inválida: etapa que não é número -> erro só dela
        jsonb_build_object('linha', 5, 'nome', 'Linha Quebrada', 'telefone', '(11) 91111-0003',
                           'telefones', jsonb_build_array('(11) 91111-0003'), 'stage_id', 'abc')
    ));
    -- segunda importação da mesma planilha
    r2 := public.importar_leads(jsonb_build_array(
        jsonb_build_object('linha', 2, 'nome', 'Importado Um', 'telefone', '(11) 91111-0001',
                           'telefones', jsonb_build_array('(11) 91111-0001'), 'email', 'UM@importado.com'),
        jsonb_build_object('linha', 4, 'nome', 'Importado Dois', 'telefone', '(11) 91111-0002',
                           'telefones', jsonb_build_array('(11) 91111-0002'))
    ));
    begin
        perform public.importar_leads((select jsonb_agg(jsonb_build_object('linha', g, 'nome', 'x')) from generate_series(1, 501) g));
    exception when sqlstate 'P0001' then
        v_grande := true;
    end;
    perform public.login_admin();

    perform public.assert((r1 ->> 'importadas')::int = 2 and (r1 ->> 'ja_existiam')::int = 1
        and jsonb_array_length(r1 -> 'erros') = 1 and (r1 -> 'erros' -> 0 ->> 'linha')::int = 5,
        'IM1: lote importa as linhas boas, pula a repetida e devolve o erro só da linha quebrada');
    perform public.assert((r2 ->> 'importadas')::int = 0 and (r2 ->> 'ja_existiam')::int = 2,
        'IM2: reimportar a mesma planilha não duplica (telefone ou e-mail, sem diferenciar maiúsculas)');
    perform public.assert(
        (select count(*) from public.negocios n
          where n.tenant_id = v_tenant_a and n.titulo in ('Importado Um', 'Importado Dois')) = 2
        and not exists (select 1 from public.negocios n where n.titulo in ('Importado Um de novo', 'Linha Quebrada')),
        'IM3: os leads importados caem na empresa do usuário, um de cada');
    perform public.assert(v_grande, 'IM4: lote acima de 500 linhas é recusado');

    -- outra empresa importa o MESMO telefone: não é duplicata para ela, e não vaza
    perform public.login_como(v_user_b, 'vendedor.b@teste.com', v_tenant_a);
    r3 := public.importar_leads(jsonb_build_array(
        jsonb_build_object('linha', 2, 'nome', 'Mesmo telefone no B', 'telefone', '(11) 91111-0001',
                           'telefones', jsonb_build_array('(11) 91111-0001'), 'tenant_id', v_tenant_a)));
    perform public.login_admin();
    perform public.assert((r3 ->> 'importadas')::int = 1
        and exists (select 1 from public.negocios where tenant_id = v_tenant_b and titulo = 'Mesmo telefone no B')
        and not exists (select 1 from public.negocios where tenant_id = v_tenant_a and titulo = 'Mesmo telefone no B'),
        'IM5: a deduplicação é por empresa e o tenant_id do payload não planta lead em outra');

    perform public.login_anon();
    begin
        perform public.importar_leads('[]'::jsonb);
    exception when insufficient_privilege then
        v_anon := true;
    end;
    perform public.login_admin();
    perform public.assert(v_anon, 'IM6: a chave pública não executa importar_leads');
end $$;
