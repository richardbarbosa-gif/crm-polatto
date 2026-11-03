-- =====================================================================
-- CRM POLATTO — MIGRATION 10: ENDURECIMENTO DE SEGURANÇA (auditoria 2026-11)
--
-- Fecha os buracos encontrados na auditoria final. Cada bloco diz o que
-- fecha e por quê; os testes estão em database/tests/04_teste_hardening.sql
-- (para cada correção: o ataque falha E o uso legítimo continua igual).
--
--   1. INSERT pela view clientes confiava no tenant_id do payload
--      (anônimo gravava lead em qualquer tenant; usuário logado ligava o
--      próprio negócio ao contato de outro tenant e copiava o CPF dele)
--   2. fn_set_tenant_id aceitava o tenant do cliente quando o usuário não
--      tinha vínculo — porta aberta para qualquer função SECURITY DEFINER
--   3. Funções administrativas (migrar_*, backfill_*, aplicar_*,
--      provisionar_defaults_tenant, retenção...) executáveis pela chave
--      PÚBLICA (anon) e por qualquer usuário logado
--   4. Retenção/LGPD: vendedor podia configurar retenção de 0 dias e o
--      expurgo podia ser disparado anonimamente; anonimização irreversível
--      liberada para qualquer membro do tenant
--   5. tenant_features (flags da plataforma) graváveis pelo próprio tenant
--   6. provisionar_tenant "sequestrava" o funcionário de outro tenant que
--      tivesse o mesmo e-mail
--   7. registrar_erro_cliente gravava URL com hash/query (tokens do link de
--      recuperação de senha) e contexto sem limite de tamanho
--   8. utilizadores_empresas/empresas: garante RLS mesmo onde a 09 não
--      conseguiu ativar, e remove as policies do script avulso
--      fix_rls_policy_recursion (auto-vínculo a qualquer empresa)
--   9. Tabelas dos scripts avulsos (crm_employees, crm_goals, anexos_lead)
--      sem tenant_id e com using(true): trancadas para superadmin
--  10. Bucket lead-files garantido privado, só PDF, com teto de tamanho
--  11. Toda view do schema public com security_invoker e sem acesso anon
--  12. Diagnóstico: avisa o que ainda depende de ação manual
--
-- IDEMPOTENTE e segura com dados reais: não apaga nem renomeia dado,
-- não faz DROP de tabela, só CREATE OR REPLACE / ALTER / GRANT / REVOKE.
-- ORDEM: rodar depois de 00..09 e SEMPRE POR ÚLTIMO — se qualquer
-- migration antiga for reexecutada (ex.: a 01 na virada), rode a 10 de novo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. HELPER: a requisição veio da API pública (anon/authenticated)?
-- Falso no SQL Editor, com service_role e em jobs agendados.
-- ---------------------------------------------------------------------
create or replace function public.requisicao_api_publica()
returns boolean
language sql
stable
set search_path = public
as $$
    select coalesce(auth.jwt() ->> 'role', '') in ('anon', 'authenticated');
$$;

comment on function public.requisicao_api_publica() is 'true quando a chamada vem do PostgREST com JWT anon/authenticated. Contextos administrativos (SQL Editor, service_role, cron) retornam false.';

-- ---------------------------------------------------------------------
-- 1. fn_set_tenant_id — o tenant informado pelo cliente só é aceito em
-- contexto administrativo ou para superadmin. Antes, um usuário logado SEM
-- vínculo tinha o tenant_id do payload aceito; a RLS barrava o insert
-- direto, mas qualquer função SECURITY DEFINER que inserisse em nome dele
-- (view clientes, RPCs de produção) gravava no tenant que ele escolhesse.
-- ---------------------------------------------------------------------
create or replace function public.fn_set_tenant_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant uuid;
begin
    v_tenant := public.current_tenant_id();

    if v_tenant is not null then
        -- Usuário logado: o tenant é SEMPRE o do vínculo. Ignora o que veio
        -- do cliente — é isto que impede forjar tenant_id pelo frontend.
        new.tenant_id := v_tenant;
    elsif new.tenant_id is not null
          and (public.is_system_admin() or not public.requisicao_api_publica()) then
        -- Sem vínculo: só SQL Editor/service_role/cron (provisionamento,
        -- backfill) ou superadmin podem informar o tenant explicitamente.
        null;
    else
        raise exception
            'tenant_id não pôde ser resolvido: usuário sem vínculo em utilizadores_empresas. Insert em % bloqueado.',
            tg_table_name
            using errcode = '42501';
    end if;

    return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. VIEW clientes — INSERT/UPDATE (INSTEAD OF). Corpo idêntico ao da
-- migration 01 (que é reexecutada na virada); o teste 04 confere que os
-- dois arquivos carregam exatamente a mesma versão.
-- ---------------------------------------------------------------------
create or replace function public.fn_clientes_view_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant uuid;
    v_pessoa_id uuid;
    v_org_id uuid;
    v_negocio_id uuid;
    v_digits text;
begin
    -- SEGURANÇA (migration 10): o tenant vem do VÍNCULO do usuário, nunca do
    -- payload. Esta função é SECURITY DEFINER e ignora a RLS: com o antigo
    -- coalesce(new.tenant_id, ...) um anônimo (ou usuário sem vínculo)
    -- gravava leads em qualquer tenant, e um usuário logado ligava o próprio
    -- negócio ao contato/organização de outro tenant pela busca de duplicata.
    -- Só superadmin ou contexto administrativo (SQL Editor, service_role,
    -- cron) pode informar o tenant explicitamente.
    v_tenant := public.current_tenant_id();
    if v_tenant is null then
        if new.tenant_id is not null
           and (public.is_system_admin() or not public.requisicao_api_publica()) then
            v_tenant := new.tenant_id;
        else
            raise exception 'tenant_id não pôde ser resolvido para o insert em clientes.'
                using errcode = '42501';
        end if;
    end if;

    v_digits := regexp_replace(coalesce(new.cpf_cnpj, ''), '\D', '', 'g');

    if length(v_digits) = 14 then
        select id into v_org_id from public.organizacoes
        where tenant_id = v_tenant
          and regexp_replace(coalesce(cnpj,''), '\D', '', 'g') = v_digits
        limit 1;
        if v_org_id is null then
            insert into public.organizacoes (tenant_id, razao_social, nome_fantasia, cnpj)
            values (v_tenant, new.nome, new.nome, new.cpf_cnpj)
            returning id into v_org_id;
        end if;
    end if;

    -- Reaproveita pessoa por CPF/telefone/email dentro do tenant (anti-duplicata)
    select id into v_pessoa_id from public.pessoas
    where tenant_id = v_tenant
      and deleted_at is null
      and (
          (length(v_digits) = 11 and regexp_replace(coalesce(cpf,''), '\D', '', 'g') = v_digits)
          or (coalesce(new.telefone,'') <> '' and telefone = new.telefone)
          or (coalesce(new.email,'') <> '' and lower(email) = lower(new.email))
      )
    limit 1;

    if v_pessoa_id is null then
        insert into public.pessoas (tenant_id, organizacao_id, nome, email, telefone, ddi, cpf)
        values (
            v_tenant, v_org_id, new.nome, new.email, new.telefone,
            coalesce(new.ddi, '+55'),
            case when length(v_digits) = 11 then new.cpf_cnpj else null end
        )
        returning id into v_pessoa_id;
    end if;

    insert into public.negocios (
        tenant_id, organizacao_id, pessoa_contato_principal_id, titulo, valor,
        stage_id, pipeline_id, status, temperatura, responsavel, responsavel_id, motivo_perda,
        fechado_em, dados_extras
    ) values (
        v_tenant, v_org_id, v_pessoa_id,
        coalesce(new.titulo, new.nome, 'Negócio sem título'),
        coalesce(new.valor, new.conta_energia_media),
        new.stage_id, new.pipeline_id, new.status, new.temperatura,
        new.responsavel, new.responsavel_id, new.motivo_perda,
        new.data_fechamento,
        jsonb_strip_nulls(coalesce(new.dados_extras, '{}'::jsonb) || jsonb_build_object(
            'cep', new.cep,
            'endereco_instalacao', new.endereco_instalacao,
            'numero', new.numero,
            'complemento', new.complemento,
            'conta_energia_media', new.conta_energia_media
        ))
    )
    returning id into v_negocio_id;

    insert into public.negocios_pessoas (tenant_id, negocio_id, pessoa_id, papel)
    values (v_tenant, v_negocio_id, v_pessoa_id, 'decisor')
    on conflict (negocio_id, pessoa_id) do nothing;

    new.id := v_negocio_id;
    new.tenant_id := v_tenant;
    return new;
end;
$$;

create or replace function public.fn_clientes_view_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_pessoa_id uuid;
    v_tenant uuid;
    v_compartilhada bigint;
    v_nova_pessoa uuid;
begin
    select pessoa_contato_principal_id, tenant_id into v_pessoa_id, v_tenant
    from public.negocios where id = old.id;

    -- Defesa em profundidade: esta função é SECURITY DEFINER e ignora a RLS.
    -- A view já filtra por tenant (security_invoker), mas a checagem explícita
    -- garante que nenhum caminho futuro permita editar negócio de outro tenant.
    if v_tenant is null or not public.tenant_filter(v_tenant) then
        raise exception 'Registro fora do seu tenant.' using errcode = '42501';
    end if;

    -- SEGURANÇA (migration 10): o contato principal precisa ser do MESMO
    -- tenant do negócio. Sem isto, um negócio apontado para a pessoa de
    -- outro tenant faria o fork-on-write abaixo COPIAR o CPF/cargo/campos
    -- dela para cá, ou o update gravar por cima dela (tudo como definer).
    if v_pessoa_id is not null and not exists (
        select 1 from public.pessoas p
        where p.id = v_pessoa_id and p.tenant_id = v_tenant
    ) then
        v_pessoa_id := null;
    end if;

    -- FORK-ON-WRITE: a mesma pessoa pode estar em vários negócios (é o
    -- comportamento correto em B2B). Mas a tela antiga edita "o cliente"
    -- como se fosse exclusivo do lead — sem esta cópia, renomear um lead
    -- renomearia silenciosamente os outros negócios do mesmo contato.
    if v_pessoa_id is not null then
        select count(*) into v_compartilhada
        from public.negocios
        where pessoa_contato_principal_id = v_pessoa_id
          and deleted_at is null;

        if v_compartilhada > 1 then
            insert into public.pessoas (tenant_id, organizacao_id, nome, email, telefone, ddi, cpf, cargo, dados_extras)
            select tenant_id, organizacao_id,
                   coalesce(new.nome, nome), new.email, new.telefone,
                   coalesce(new.ddi, ddi),
                   case when length(regexp_replace(coalesce(new.cpf_cnpj,''), '\D', '', 'g')) = 11
                        then new.cpf_cnpj else cpf end,
                   cargo, dados_extras
            from public.pessoas where id = v_pessoa_id
            returning id into v_nova_pessoa;

            update public.negocios set pessoa_contato_principal_id = v_nova_pessoa where id = old.id;

            update public.negocios_pessoas
            set pessoa_id = v_nova_pessoa
            where negocio_id = old.id and pessoa_id = v_pessoa_id;

            v_pessoa_id := null;  -- já gravado na cópia
        end if;
    end if;

    -- Campos de pessoa
    if v_pessoa_id is not null then
        update public.pessoas set
            nome = coalesce(new.nome, nome),
            email = new.email,
            telefone = new.telefone,
            ddi = coalesce(new.ddi, ddi),
            cpf = case
                when length(regexp_replace(coalesce(new.cpf_cnpj,''), '\D', '', 'g')) = 11 then new.cpf_cnpj
                else cpf
            end
        where id = v_pessoa_id;
    end if;

    -- Campos de negócio
    update public.negocios set
        titulo = coalesce(new.titulo, new.nome, titulo),
        valor = coalesce(new.valor, valor),
        stage_id = new.stage_id,
        pipeline_id = coalesce(new.pipeline_id, pipeline_id),
        status = new.status,
        temperatura = new.temperatura,
        responsavel = new.responsavel,
        responsavel_id = coalesce(new.responsavel_id, responsavel_id),
        motivo_perda = new.motivo_perda,
        -- O frontend manda data_fechamento ao mover o card; quando não manda,
        -- a etapa terminal (ganho/perdido) define o fechamento automaticamente.
        fechado_em = case
            when new.data_fechamento is not null then new.data_fechamento
            when exists (
                select 1 from public.pipeline_stages ps
                where ps.id = new.stage_id and (ps.ganho or ps.perdido)
            ) and fechado_em is null then now()
            when exists (
                select 1 from public.pipeline_stages ps
                where ps.id = new.stage_id and not ps.ganho and not ps.perdido
            ) then null
            else fechado_em
        end,
        -- Preserva o que já existe, aplica os campos customizados que o
        -- cliente enviou (new.dados_extras) e por último os campos fixos do
        -- formulário legado. Sem o new.dados_extras aqui, todo valor de campo
        -- customizado editado pela tela era descartado em silêncio.
        dados_extras = jsonb_strip_nulls(
            coalesce(dados_extras, '{}'::jsonb)
            || coalesce(new.dados_extras, '{}'::jsonb)
            || jsonb_build_object(
                'cep', new.cep,
                'endereco_instalacao', new.endereco_instalacao,
                'numero', new.numero,
                'complemento', new.complemento,
                'conta_energia_media', new.conta_energia_media
            )
        )
    where id = old.id;

    return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. eh_admin_do_tenant() — papel ADMIN no tenant, derivado no servidor.
--
-- Fonte: utilizadores_empresas.role (o usuário não consegue alterar: a
-- tabela só tem policy de leitura). Mesmos termos do frontend
-- (src/lib/permissions.ts): admin, superadmin, administrador, owner.
-- NÃO usa funcionarios.cargo nem user_metadata: os dois são editáveis
-- pelo próprio usuário e não servem como prova de papel.
-- Coluna de tenant/papel detectada dinamicamente, como em current_tenant_id().
-- ---------------------------------------------------------------------
do $$
declare
    v_col text;
    v_role_col text;
begin
    select column_name into v_col
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'utilizadores_empresas'
      and column_name in ('empresa_id', 'tenant_id', 'company_id', 'id_empresa')
    order by array_position(array['empresa_id', 'tenant_id', 'company_id', 'id_empresa'], column_name)
    limit 1;

    select column_name into v_role_col
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'utilizadores_empresas'
      and column_name in ('role', 'perfil', 'cargo', 'tipo')
    order by array_position(array['role', 'perfil', 'cargo', 'tipo'], column_name)
    limit 1;

    if v_col is null or v_role_col is null then
        -- Fail-closed: sem coluna de papel, só o superadmin é admin.
        create or replace function public.eh_admin_do_tenant(p_tenant_id uuid default null)
        returns boolean language sql stable security definer set search_path = public
        as 'select public.is_system_admin()';
        raise warning 'utilizadores_empresas sem coluna de tenant/papel reconhecida: eh_admin_do_tenant() só reconhece superadmin.';
        return;
    end if;

    execute format($fn$
        create or replace function public.eh_admin_do_tenant(p_tenant_id uuid default null)
        returns boolean
        language sql
        stable
        security definer
        set search_path = public
        as $body$
            select public.is_system_admin()
                or (
                    auth.uid() is not null
                    and exists (
                        select 1
                        from public.utilizadores_empresas ue
                        where ue.auth_uid = auth.uid()
                          and ue.%1$I::uuid = coalesce(p_tenant_id, public.current_tenant_id())
                          and lower(coalesce(ue.%2$I::text, '')) ~ '(admin|owner)'
                    )
                );
        $body$;
    $fn$, v_col, v_role_col);
end $$;

comment on function public.eh_admin_do_tenant(uuid) is 'Usuário autenticado é admin (admin/administrador/superadmin/owner em utilizadores_empresas) do tenant informado — ou do tenant ativo — ou superadmin da plataforma.';

-- ---------------------------------------------------------------------
-- 4. LGPD
-- Exportação: qualquer membro do tenant (ele já lê os mesmos dados pela
-- API; a função só monta o pacote e registra o acesso). Agora filtra por
-- tenant tudo o que junta, para não arrastar negócio de outro tenant que
-- aponte para a mesma pessoa.
-- Anonimização: IRREVERSÍVEL — passa a exigir admin do tenant (a tela já
-- só mostra o botão para admin; o banco agora garante o mesmo).
-- ---------------------------------------------------------------------
create or replace function public.lgpd_exportar_dados_titular(p_pessoa_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant uuid;
    v_resultado jsonb;
begin
    select tenant_id into v_tenant from public.pessoas where id = p_pessoa_id;

    if v_tenant is null or not public.tenant_filter(v_tenant) then
        raise exception 'Pessoa não encontrada ou fora do seu tenant.';
    end if;

    perform public.enforce_rate_limit('lgpd_exportar_dados_titular', 30, interval '1 hour');
    perform public.log_acesso_titular(p_pessoa_id, 'exportacao_lgpd');

    select jsonb_build_object(
        'gerado_em', now(),
        'pessoa', to_jsonb(p) - 'tenant_id',
        'organizacao', (
            select to_jsonb(o) - 'tenant_id' from public.organizacoes o
            where o.id = p.organizacao_id and o.tenant_id = v_tenant
        ),
        'negocios', coalesce((
            select jsonb_agg(to_jsonb(n) - 'tenant_id')
            from public.negocios n
            where n.tenant_id = v_tenant
              and (
                  n.pessoa_contato_principal_id = p.id
                  or exists (select 1 from public.negocios_pessoas np where np.pessoa_id = p.id and np.negocio_id = n.id)
              )
        ), '[]'::jsonb),
        'consentimentos', coalesce((
            select jsonb_agg(to_jsonb(c) - 'tenant_id')
            from public.consentimentos c
            where c.pessoa_id = p.id and c.tenant_id = v_tenant
        ), '[]'::jsonb)
    )
    into v_resultado
    from public.pessoas p
    where p.id = p_pessoa_id;

    return v_resultado;
end;
$$;

create or replace function public.lgpd_apagar_dados_titular(p_pessoa_id uuid)
returns table(resultado text, storage_paths_para_excluir text[])
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant uuid;
    v_paths text[];
begin
    select tenant_id into v_tenant from public.pessoas where id = p_pessoa_id;

    if v_tenant is null or not public.tenant_filter(v_tenant) then
        raise exception 'Pessoa não encontrada ou fora do seu tenant.';
    end if;

    if not public.eh_admin_do_tenant(v_tenant) then
        raise exception 'Apenas administradores do tenant podem anonimizar titulares (LGPD).'
            using errcode = '42501';
    end if;

    perform public.enforce_rate_limit('lgpd_apagar_dados_titular', 10, interval '1 hour');
    perform public.log_acesso_titular(p_pessoa_id, 'exclusao_lgpd');

    -- Coleta paths de documentos dos negócios do titular (para exclusão no Storage)
    select coalesce(array_agg(distinct d.caminho_storage), array[]::text[])
    into v_paths
    from public.documentos_lead d
    where d.caminho_storage is not null
      and exists (
          select 1 from public.negocios n
          where n.pessoa_contato_principal_id = p_pessoa_id
            and n.tenant_id = v_tenant
            and (d.cliente_id::text = n.id::text or d.cliente_id::text = n.legado_cliente_id)
      );

    -- Anonimiza a pessoa
    update public.pessoas set
        nome = 'Titular removido (LGPD)',
        email = null,
        telefone = null,
        cpf = null,
        cargo = null,
        dados_extras = '{}'::jsonb,
        anonimizada_em = now()
    where id = p_pessoa_id;

    -- O nome do titular é COPIADO para outros lugares no fluxo normal do CRM
    -- (título do negócio, razão social de PF, timeline). Sem limpar aqui, o
    -- "direito ao esquecimento" seria apenas cosmético. Tudo restrito ao
    -- tenant do titular.
    update public.negocios set titulo = 'Negócio de titular removido (LGPD)'
    where pessoa_contato_principal_id = p_pessoa_id
      and tenant_id = v_tenant;

    update public.organizacoes o set
        razao_social = 'Organização de titular removido (LGPD)',
        nome_fantasia = null,
        email = null,
        telefone = null
    where o.tenant_id = v_tenant
      and exists (
        select 1 from public.pessoas p
        where p.id = p_pessoa_id and p.organizacao_id = o.id
      )
      and not exists (
        -- Só anonimiza a organização se ela não tiver outros contatos ativos
        select 1 from public.pessoas outra
        where outra.organizacao_id = o.id
          and outra.id <> p_pessoa_id
          and outra.anonimizada_em is null
          and outra.deleted_at is null
      );

    -- Timeline e auditoria: remove o conteúdo textual que possa conter dado
    -- pessoal, preservando o registro de que a ação existiu.
    if to_regclass('public.atividades_lead') is not null then
        update public.atividades_lead a set
            titulo = 'Registro anonimizado (LGPD)',
            descricao = null
        where exists (
            select 1 from public.negocios n
            where n.pessoa_contato_principal_id = p_pessoa_id
              and n.tenant_id = v_tenant
              and (a.cliente_id = n.id::text or a.cliente_id = n.legado_cliente_id)
        );
    end if;

    update public.audit_log set
        dados_antes = jsonb_build_object('anonimizado', true),
        dados_depois = jsonb_build_object('anonimizado', true)
    where tabela = 'pessoas' and registro_id = p_pessoa_id::text;

    -- Revoga consentimentos
    update public.consentimentos set revogado_em = coalesce(revogado_em, now())
    where pessoa_id = p_pessoa_id;

    resultado := 'Titular anonimizado. Excluir no Storage os paths retornados e revisar anotações manuais em atividades.';
    storage_paths_para_excluir := v_paths;
    return next;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. POLÍTICA DE RETENÇÃO — só admin do tenant configura.
-- Antes qualquer membro gravava dias_retencao = 0 e, no próximo expurgo,
-- todos os negócios do tenant iam para a lixeira e os contatos eram
-- anonimizados (irreversível). A leitura continua aberta ao tenant.
-- O frontend não usa esta tabela.
-- ---------------------------------------------------------------------
do $$
begin
    if to_regclass('public.politicas_retencao') is not null then
        alter table public.politicas_retencao enable row level security;
        drop policy if exists politicas_retencao_tenant_isolation on public.politicas_retencao;
        drop policy if exists politicas_retencao_leitura on public.politicas_retencao;
        drop policy if exists politicas_retencao_escrita_admin on public.politicas_retencao;
        create policy politicas_retencao_leitura on public.politicas_retencao
            for select to authenticated
            using (public.tenant_filter(tenant_id));
        create policy politicas_retencao_escrita_admin on public.politicas_retencao
            for all to authenticated
            using (public.tenant_filter(tenant_id) and public.eh_admin_do_tenant(tenant_id))
            with check (public.tenant_filter(tenant_id) and public.eh_admin_do_tenant(tenant_id));
    end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. TENANT_FEATURES — flags de ativação gradual são da PLATAFORMA.
-- O tenant lê as próprias flags; só o superadmin liga/desliga (antes
-- qualquer membro podia se dar recurso que não contratou).
-- O frontend só lê (via RPC check_feature).
-- ---------------------------------------------------------------------
do $$
begin
    if to_regclass('public.tenant_features') is not null then
        alter table public.tenant_features enable row level security;
        drop policy if exists tenant_features_tenant_isolation on public.tenant_features;
        drop policy if exists tenant_features_leitura on public.tenant_features;
        drop policy if exists tenant_features_escrita_superadmin on public.tenant_features;
        create policy tenant_features_leitura on public.tenant_features
            for select to authenticated
            using (public.tenant_filter(tenant_id));
        create policy tenant_features_escrita_superadmin on public.tenant_features
            for all to authenticated
            using (public.is_system_admin())
            with check (public.is_system_admin());
    end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. MONITORAMENTO DE ERROS — sem token e sem payload gigante.
-- A URL chegava com hash/query: no retorno do link de recuperação de
-- senha/OAuth o hash traz access_token e refresh_token, e client_errors é
-- legível por todo o tenant. Guarda só origem + caminho. O contexto livre
-- passa a ter teto de 8 KB (antes era ilimitado).
-- ---------------------------------------------------------------------
create or replace function public.registrar_erro_cliente(
    p_mensagem text,
    p_stack text default null,
    p_url text default null,
    p_user_agent text default null,
    p_origem text default 'manual',
    p_contexto jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_url text;
    v_contexto jsonb;
begin
    -- Protege contra flood: 60 erros/usuário/hora é suficiente para diagnóstico
    begin
        perform public.enforce_rate_limit('registrar_erro_cliente', 60, interval '1 hour');
    exception when others then
        return; -- estourou o limite: descarta silenciosamente
    end;

    v_url := nullif(split_part(split_part(coalesce(p_url, ''), '#', 1), '?', 1), '');

    v_contexto := coalesce(p_contexto, '{}'::jsonb);
    if octet_length(v_contexto::text) > 8192 then
        v_contexto := jsonb_build_object('descartado', 'contexto acima de 8 KB');
    end if;

    insert into public.client_errors (tenant_id, user_id, email_usuario, mensagem, stack, url, user_agent, origem, contexto)
    values (
        public.current_tenant_id(),
        auth.uid(),
        coalesce(auth.jwt() ->> 'email', 'anon'),
        left(coalesce(p_mensagem, 'erro sem mensagem'), 2000),
        left(p_stack, 8000),
        left(v_url, 1000),
        left(p_user_agent, 500),
        left(coalesce(p_origem, 'manual'), 50),
        v_contexto
    );
exception when others then
    null; -- monitoramento nunca pode quebrar a aplicação
end;
$$;

-- ---------------------------------------------------------------------
-- 8. PROVISIONAR_TENANT — não toma o funcionário de outro tenant.
-- funcionarios.email é único no banco inteiro. O antigo
-- "on conflict (email) do update set tenant_id" MOVIA para a empresa nova
-- o funcionário de outra empresa que tivesse o mesmo e-mail (bastava se
-- cadastrar com aquele e-mail). Agora só adota linha órfã (tenant nulo).
-- Único trecho alterado em relação à migration 08.
-- ---------------------------------------------------------------------
create or replace function public.provisionar_tenant(
    p_nome_empresa text,
    p_segmento text default 'energia_solar'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid;
    v_email text;
    v_tenant uuid;
    v_col text;
    v_role_col text;
    v_nome text;
    v_pipeline_id uuid;
begin
    v_user := auth.uid();
    if v_user is null then
        raise exception 'Usuário não autenticado.';
    end if;

    v_nome := trim(coalesce(p_nome_empresa, ''));
    if v_nome = '' then
        raise exception 'Informe o nome da empresa.';
    end if;

    -- Idempotência: usuário já vinculado não cria outra empresa
    v_tenant := public.current_tenant_id();
    if v_tenant is not null then
        return v_tenant;
    end if;

    perform public.enforce_rate_limit('provisionar_tenant', 3, interval '1 day');

    v_email := coalesce(auth.jwt() ->> 'email', '');

    insert into public.empresas (nome, segmento)
    values (v_nome, coalesce(nullif(trim(p_segmento), ''), 'energia_solar'))
    returning id into v_tenant;

    -- Vínculo do usuário como admin (coluna de tenant detectada dinamicamente)
    select column_name into v_col
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'utilizadores_empresas'
      and column_name in ('empresa_id', 'tenant_id', 'company_id', 'id_empresa')
    order by array_position(array['empresa_id', 'tenant_id', 'company_id', 'id_empresa'], column_name)
    limit 1;

    if v_col is null then
        raise exception 'Tabela utilizadores_empresas sem coluna de tenant reconhecida.';
    end if;

    select column_name into v_role_col
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'utilizadores_empresas'
      and column_name in ('role', 'perfil', 'cargo', 'tipo')
    order by array_position(array['role', 'perfil', 'cargo', 'tipo'], column_name)
    limit 1;

    if v_role_col is null then
        execute format(
            'insert into public.utilizadores_empresas (auth_uid, %I) values ($1, $2)',
            v_col
        ) using v_user, v_tenant;
    else
        execute format(
            'insert into public.utilizadores_empresas (auth_uid, %I, %I) values ($1, $2, $3)',
            v_col, v_role_col
        ) using v_user, v_tenant, 'admin';
    end if;

    -- Primeiro funcionário (admin) do tenant
    if to_regclass('public.funcionarios') is not null then
        begin
            insert into public.funcionarios (user_id, tenant_id, nome, email, cargo, ativo)
            values (
                v_user, v_tenant,
                coalesce(nullif(split_part(v_email, '@', 1), ''), 'Administrador'),
                v_email, 'admin', true
            )
            on conflict (email) do update set tenant_id = excluded.tenant_id
            where public.funcionarios.tenant_id is null;
        exception when others then
            null; -- funcionário é conveniência; o vínculo acima é o que importa
        end;
    end if;

    -- Defaults do CRM (pipeline Vendas, etapas, motivos, tipos de atividade)
    perform public.provisionar_defaults_tenant(v_tenant);

    -- Etapas default do pipeline (se o tenant não herdou nenhuma).
    if not exists (
        select 1 from public.pipeline_stages ps where ps.tenant_id = v_tenant
    ) then
        select id into v_pipeline_id
        from public.pipelines
        where tenant_id = v_tenant
        order by ordem, created_at
        limit 1;

        if v_pipeline_id is not null then
            insert into public.pipeline_stages (tenant_id, pipeline_id, nome, cor, ordem, probabilidade, ganho, perdido)
            select v_tenant, v_pipeline_id, s.nome, s.cor, s.ordem, s.prob, s.ganho, s.perdido
            from (values
                     ('Novo Lead', '#5d9cec', 1, 10, false, false),
                     ('Contato Feito', '#8b5cf6', 2, 25, false, false),
                     ('Proposta Enviada', '#ed8936', 3, 50, false, false),
                     ('Em Negociação', '#3182ce', 4, 70, false, false),
                     ('Fechado', '#82cf6e', 5, 100, true, false),
                     ('Perdido', '#f56565', 6, 0, false, true)
                 ) as s(nome, cor, ordem, prob, ganho, perdido);
        end if;
    end if;

    -- Plano inicial: Starter
    insert into public.tenant_planos (tenant_id, plano_id)
    select v_tenant, pl.id from public.planos pl where pl.nome = 'Starter'
    on conflict (tenant_id) do nothing;

    return v_tenant;
end;
$$;

-- ---------------------------------------------------------------------
-- 9. QUEM PODE EXECUTAR CADA FUNÇÃO
--
-- Postgres e Supabase dão EXECUTE em função nova para PUBLIC/anon. Como
-- estas funções são SECURITY DEFINER, isso deixava a chave pública (que
-- está no bundle do frontend) chamar /rest/v1/rpc/migrar_clientes_para_negocios,
-- aplicar_politica_retencao, provisionar_defaults_tenant (que reatribuía
-- as etapas de outro tenant a um funil alheio) etc.
--
--   administrativas  → só postgres/service_role (SQL Editor, cron)
--   do usuário       → authenticated (+ service_role), nunca anon
--
-- CREATE OR REPLACE preserva estes privilégios, então reexecutar as
-- migrations antigas não desfaz o que está aqui. Funções que só existem
-- em produção (criar_usuario_equipe, excluir_usuario_equipe,
-- check_feature) também perdem o acesso anônimo, se existirem.
-- ---------------------------------------------------------------------
do $$
declare
    r record;
    v_admin text[] := array[
        'provisionar_defaults_tenant', 'migrar_clientes_para_negocios',
        'backfill_tenant_dados_legados', 'aplicar_rls_estrita_pipeline_stages',
        'backfill_tenant_legado', 'diagnostico_tenant_legado', 'aplicar_rls_legado',
        'aplicar_politica_retencao', 'limpar_erros_antigos',
        'relatorio_rls', 'testar_isolamento_tenant'
    ];
    v_usuario text[] := array[
        'provisionar_tenant', 'log_acesso_titular',
        'lgpd_exportar_dados_titular', 'lgpd_apagar_dados_titular',
        'get_tenant_segmento', 'uso_do_tenant', 'restaurar_registro',
        'registrar_erro_cliente', 'enforce_rate_limit', 'eh_admin_do_tenant',
        'criar_usuario_equipe', 'excluir_usuario_equipe', 'check_feature'
    ];
    v_anon boolean := exists (select 1 from pg_roles where rolname = 'anon');
    v_auth boolean := exists (select 1 from pg_roles where rolname = 'authenticated');
    v_service boolean := exists (select 1 from pg_roles where rolname = 'service_role');
begin
    for r in
        select p.oid::regprocedure as fn, p.proname::text as nome
        from pg_proc p
        join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public'
          and p.proname = any(v_admin || v_usuario)
    loop
        execute format('revoke execute on function %s from public', r.fn);
        if v_anon then
            execute format('revoke execute on function %s from anon', r.fn);
        end if;

        if r.nome = any(v_admin) then
            if v_auth then
                execute format('revoke execute on function %s from authenticated', r.fn);
            end if;
        elsif v_auth then
            execute format('grant execute on function %s to authenticated', r.fn);
        end if;

        if v_service then
            execute format('grant execute on function %s to service_role', r.fn);
        end if;
    end loop;
end $$;

-- ---------------------------------------------------------------------
-- 10. UTILIZADORES_EMPRESAS e EMPRESAS — RLS garantida.
--
-- A 09 só ativa a RLS legada quando não sobra linha órfã; nesses bancos
-- estas duas tabelas ficariam abertas com GRANT de escrita para
-- authenticated: qualquer usuário inseria um vínculo "admin" em qualquer
-- empresa. Elas não dependem do backfill, então são fechadas sempre.
--
-- Remove também as policies do script avulso
-- database/fix_rls_policy_recursion_utilizadores_empresas.sql: ue_insert e
-- ue_update deixavam o usuário criar/alterar o PRÓPRIO vínculo para
-- qualquer empresa e papel (e havia e-mail de admin hardcoded).
-- Escrita direta fica só com o superadmin (system_admins); o resto passa
-- pelas funções SECURITY DEFINER (provisionar_tenant, criar_usuario_equipe).
-- ---------------------------------------------------------------------
do $$
declare
    r record;
begin
    if to_regclass('public.utilizadores_empresas') is not null then
        alter table public.utilizadores_empresas enable row level security;

        drop policy if exists ue_insert on public.utilizadores_empresas;
        drop policy if exists ue_update on public.utilizadores_empresas;
        drop policy if exists ue_delete on public.utilizadores_empresas;
        drop policy if exists ue_select on public.utilizadores_empresas;
        drop policy if exists ue_admin_only_all on public.utilizadores_empresas;

        drop policy if exists utilizadores_empresas_proprio on public.utilizadores_empresas;
        create policy utilizadores_empresas_proprio on public.utilizadores_empresas
            for select to authenticated
            using (auth_uid = auth.uid() or public.is_system_admin());

        drop policy if exists utilizadores_empresas_superadmin_escrita on public.utilizadores_empresas;
        create policy utilizadores_empresas_superadmin_escrita on public.utilizadores_empresas
            for all to authenticated
            using (public.is_system_admin())
            with check (public.is_system_admin());

        -- Qualquer outra policy de escrita aqui é suspeita: só avisa (não
        -- apago o que não conheço).
        for r in
            select policyname, cmd from pg_policies
            where schemaname = 'public' and tablename = 'utilizadores_empresas'
              and policyname not in ('utilizadores_empresas_proprio', 'utilizadores_empresas_superadmin_escrita')
        loop
            raise warning 'REVISAR: policy % (%) em utilizadores_empresas não é do repositório.', r.policyname, r.cmd;
        end loop;
    end if;

    if to_regclass('public.empresas') is not null then
        alter table public.empresas enable row level security;
        drop policy if exists empresas_proprio_tenant on public.empresas;
        create policy empresas_proprio_tenant on public.empresas
            for select to authenticated
            using (id = public.current_tenant_id() or public.is_system_admin());
    end if;
end $$;

-- ---------------------------------------------------------------------
-- 11. RESTOS DOS SCRIPTS AVULSOS (database/*.sql)
--
-- a) crm_employees, crm_goals (insights_schema.sql) e anexos_lead
--    (supabase_phase34_repair.sql) não têm tenant_id e nasceram com
--    using(true): qualquer usuário de qualquer empresa lia e gravava tudo.
--    Não dá para isolar por tenant sem a coluna, então ficam trancadas
--    para o superadmin (dados preservados). O frontend só cai nelas quando
--    a tabela funcionarios não existe — o que a migration 00 impede.
-- b) Nas tabelas legadas que JÁ têm a policy de isolamento, remove a
--    policy using(true) do script avulso (se alguém o reexecutou, ela
--    anulava o isolamento — policies permissivas se somam com OR).
-- ---------------------------------------------------------------------
do $$
declare
    v_tabela text;
begin
    foreach v_tabela in array array['crm_employees', 'crm_goals', 'anexos_lead'] loop
        if to_regclass('public.' || v_tabela) is not null then
            execute format('alter table public.%I enable row level security', v_tabela);
            execute format('drop policy if exists %I on public.%I', v_tabela || '_authenticated_all', v_tabela);
            execute format('drop policy if exists %I on public.%I', v_tabela || '_somente_superadmin', v_tabela);
            execute format(
                'create policy %I on public.%I for all to authenticated using (public.is_system_admin()) with check (public.is_system_admin())',
                v_tabela || '_somente_superadmin', v_tabela
            );
            if exists (select 1 from pg_roles where rolname = 'anon') then
                execute format('revoke all on public.%I from anon', v_tabela);
            end if;
        end if;
    end loop;

    -- "Já isolada" = existe policy filtrando por tenant_filter(). Não dá
    -- para usar o nome: policy mantém o nome antigo quando a tabela é
    -- renomeada (clientes → clientes_legado na virada).
    foreach v_tabela in array array[
        'tarefas', 'atividades_lead', 'documentos_lead', 'funcionarios', 'metas',
        'cliente_status_history', 'clientes', 'clientes_legado'
    ] loop
        if exists (
            select 1 from pg_policies
            where schemaname = 'public' and tablename = v_tabela
              and coalesce(qual, '') like '%tenant_filter(tenant_id)%'
        ) then
            execute format('drop policy if exists %I on public.%I', v_tabela || '_authenticated_all', v_tabela);
            if v_tabela = 'clientes_legado' then
                execute 'drop policy if exists clientes_authenticated_all on public.clientes_legado';
            end if;
        end if;
    end loop;
end $$;

-- ---------------------------------------------------------------------
-- 12. STORAGE lead-files — bucket privado, só PDF, teto de 10 MB.
-- As migrations nunca criavam o bucket (projeto novo ficava sem upload) e
-- nada garantia que ele não estivesse público. O frontend só usa URL
-- assinada, só envia PDF e limita a 5 MB, então nada muda para o usuário.
-- Também remove as policies "bucket inteiro" do script avulso, desde que
-- as policies por tenant (migration 02) existam.
-- ---------------------------------------------------------------------
do $$
begin
    if to_regclass('storage.buckets') is not null then
        insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        values ('lead-files', 'lead-files', false, 10485760, array['application/pdf'])
        on conflict (id) do update set
            public = false,
            file_size_limit = least(coalesce(storage.buckets.file_size_limit, 10485760), 10485760),
            allowed_mime_types = array['application/pdf'];
    end if;
exception when others then
    -- Versões do schema storage variam entre projetos: nunca derruba a migration.
    raise warning 'storage.buckets não ajustado (%): no painel, deixe o bucket lead-files PRIVADO, 10 MB, apenas application/pdf.', sqlerrm;
end $$;

do $$
begin
    if exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and policyname = 'lead_files_tenant_select'
    ) then
        drop policy if exists lead_files_select on storage.objects;
        drop policy if exists lead_files_insert on storage.objects;
        drop policy if exists lead_files_update on storage.objects;
        drop policy if exists lead_files_delete on storage.objects;
    end if;
exception when others then
    raise warning 'Policies de storage não ajustadas (%): remova no painel lead_files_select/insert/update/delete (bucket inteiro).', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 13. VIEWS — security_invoker em TODAS as views do schema public.
-- Sem ela a view roda com o privilégio do dono e ignora a RLS (vazamento
-- entre tenants). As do repositório já nascem assim; isto pega as criadas
-- à mão em produção. O role anon perde acesso a todas as views (nenhuma
-- tela pública usa view; clientes tem triggers INSTEAD OF).
-- ---------------------------------------------------------------------
do $$
declare
    r record;
    v_anon boolean := exists (select 1 from pg_roles where rolname = 'anon');
begin
    for r in
        select c.oid::regclass as visao,
               coalesce((
                   select lower(o.option_value) in ('true', 'on', '1', 'yes')
                   from pg_options_to_table(c.reloptions) as o(option_name, option_value)
                   where o.option_name = 'security_invoker'
               ), false) as invoker
        from pg_class c
        join pg_namespace ns on ns.oid = c.relnamespace
        where ns.nspname = 'public'
          and c.relkind = 'v'
          and not exists (
              select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e'
          )
    loop
        begin
            if not r.invoker then
                execute format('alter view %s set (security_invoker = on)', r.visao);
                raise warning 'View % estava SEM security_invoker (ignorava a RLS) — corrigida.', r.visao;
            end if;
            if v_anon then
                execute format('revoke all on %s from anon', r.visao);
            end if;
        exception when others then
            raise warning 'Não foi possível endurecer a view %: %', r.visao, sqlerrm;
        end;
    end loop;
end $$;

-- ---------------------------------------------------------------------
-- 14. DIAGNÓSTICO — o que ainda depende de ação manual (só avisa).
-- ---------------------------------------------------------------------
do $$
declare
    r record;
    v_tabela text;
begin
    -- RLS legada ainda não aplicada (a 09 recusou por haver linha órfã)
    foreach v_tabela in array array[
        'tarefas', 'atividades_lead', 'documentos_lead', 'funcionarios', 'metas',
        'cliente_status_history', 'clientes', 'clientes_legado'
    ] loop
        if exists (
            select 1 from information_schema.tables
            where table_schema = 'public' and table_name = v_tabela and table_type = 'BASE TABLE'
        ) and (
            not exists (
                select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
                where ns.nspname = 'public' and c.relname = v_tabela and c.relrowsecurity
            )
            or not exists (
                select 1 from pg_policies
                where schemaname = 'public' and tablename = v_tabela
                  and coalesce(qual, '') like '%tenant_filter(tenant_id)%'
            )
            or exists (
                select 1 from pg_policies
                where schemaname = 'public' and tablename = v_tabela
                  and btrim(coalesce(qual, '')) = 'true'
            )
        ) then
            raise warning 'AÇÃO MANUAL: % ainda SEM isolamento por tenant. Rode backfill_tenant_legado(), diagnostico_tenant_legado() e aplicar_rls_legado() (README, passo 8).', v_tabela;
        end if;
    end loop;

    -- SECURITY DEFINER sem search_path fixo (sequestro por search_path)
    for r in
        select p.oid::regprocedure as fn
        from pg_proc p
        join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public'
          and p.prosecdef
          and not exists (
              select 1 from unnest(coalesce(p.proconfig, array[]::text[])) as cfg(valor)
              where cfg.valor like 'search_path=%'
          )
    loop
        raise warning 'REVISAR: % é SECURITY DEFINER sem search_path fixo.', r.fn;
    end loop;
end $$;
