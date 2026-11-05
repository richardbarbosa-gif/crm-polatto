# Migrations — ordem de execução

Executar no SQL Editor do Supabase, **em ordem numérica**. Todos os arquivos são idempotentes (podem rodar mais de uma vez e alinham o banco sem destruir dados existentes).

| Arquivo | O que faz |
|---|---|
| `2026-07-19_00_base.sql` | **Tabelas base** (empresas, vínculo de usuários, clientes, funil, equipe, agenda, timeline, documentos, metas). Sem ela um projeto Supabase novo não sobe. |
| `2026-07-19_01_modelo_relacional.sql` | Modelo organizacoes/pessoas/negocios, pipelines múltiplos, custom fields, motivos de perda, tipos de atividade, FKs formais, view de compatibilidade `clientes` |
| `2026-07-19_02_seguranca.sql` | `current_tenant_id()` fail-closed, trigger de tenant_id (remove default hardcoded), RLS por tenant, isolamento do Storage `lead-files`, rate limiting |
| `2026-07-19_03_lgpd.sql` | Consentimentos, exportação do titular, direito ao esquecimento, política de retenção, log de acesso a dado pessoal |
| `2026-07-19_04_auditoria_soft_delete.sql` | `audit_log` com trigger automática, timeline de mudança de etapa via trigger, soft delete + restauração |
| `2026-07-19_05_indices_performance.sql` | Índices para Kanban, busca por nome/email/telefone (trigram) e dedup por CPF/CNPJ |
| `2026-07-19_06_auditoria_rls.sql` | `relatorio_rls()` (linter de isolamento) e `testar_isolamento_tenant()` (teste formal cross-tenant) |
| `2026-07-19_07_monitoramento_erros.sql` | Tabela `client_errors` + RPC `registrar_erro_cliente` usada pelo frontend |
| `2026-07-19_08_saas_readiness.sql` | `provisionar_tenant()` (onboarding self-service), planos e limites por tenant, `vw_dashboard_kpis` |
| `2026-07-19_09_rls_tabelas_legadas.sql` | **RLS nas tabelas legadas** (tarefas, atividades, documentos, funcionários, metas, clientes): backfill do `tenant_id` + ativação guardada |
| `2026-11-02_10_hardening_seguranca.sql` | **Endurecimento de segurança** (auditoria 2026-11): view `clientes` não aceita tenant do payload, `fn_set_tenant_id` fail-closed, funções administrativas fora do alcance de `anon`/`authenticated`, retenção e anonimização LGPD só para admin, `tenant_features` só superadmin, monitoramento sem token na URL, RLS garantida em `utilizadores_empresas`/`empresas`, restos dos scripts avulsos trancados, bucket `lead-files` privado, `security_invoker` em toda view. **Rodar sempre depois da 01** (inclusive quando a 01 é reexecutada na virada). |
| `2026-11-02_11_ajustes_funcionais.sql` | `religar_referencias_legadas()`: pós-virada, religa tarefas, atividades e documentos ao UUID do negócio (só operador; sem EXECUTE para a API) |
| `2026-11-03_12_papeis_exclusao_lixeira.sql` | **Papéis e lixeira**: gerente faz tudo; vendedor vê os leads de todos, mas só exclui/restaura os seus (trigger `guarda_exclusao`, vale também para a API direta); DELETE físico só gerente; configuração, metas e equipe só gerente; `created_by`/`deleted_by`; `criar_usuario_equipe`, `excluir_usuario_equipe`, `alterar_papel_membro` e `check_feature` versionadas e seguras (antes só existiam em produção, abertas para a chave pública) |
| `2026-11-03_13_orcamentos.sql` | **Orçamentos / propostas em PDF**: `empresa_identidade` (logo, dados, cores e textos padrão por tenant; escrita só gerente/admin), `produtos` (catálogo), `orcamentos` + `orcamento_itens` ligados a `negocios`, numeração por tenant e ano (`2026-0001`, contador travado por linha: sem buraco nem duplicata), totais recalculados no banco, `salvar_orcamento()` (cabeçalho + itens numa transação, SECURITY INVOKER), soft delete só pelo criador ou gerente/admin (DELETE físico só gerente/admin), FKs compostas `(tenant_id, id)` contra referência cruzada entre tenants, bucket privado `empresa-assets` (PNG/JPEG/WEBP, 2 MB, sem SVG). Rodar depois da 10. |
| `2026-11-05_15_negocio_parado_modelos_mensagem.sql` | **Saúde do funil e modelos de mensagem**: `pipeline_stages.dias_para_parado` (prazo por etapa para o negócio ficar "parado"; nulo = não monitora; defaults só na primeira execução e em etapa nova, nunca sobrescreve o gerente; ganho/perda nunca ficam parados), `tarefas.concluido_em` (trigger), view `vw_negocios_saude` (`security_invoker`: última atividade, último contato, parado, sem próximo passo, próxima tarefa e ordem de temperatura, tudo calculado no banco), mudança de temperatura registrada na timeline por trigger ("Morno → Quente, por Fulano"), `modelos_mensagem` (WhatsApp/e-mail; leitura do tenant, escrita só gerente via RLS) com 3 modelos padrão por empresa semeados uma única vez (`crm_seeds_aplicados`), inclusive nas empresas existentes, e `provisionar_defaults_tenant` chamando o gancho `provisionar_defaults_pacote`. Não toca em `orcamentos`. Rodar depois da 13/14. |
| `2026-11-05_16_origem_primeiro_acesso_perfil.sql` | **Origem do lead, primeiro acesso e meu perfil**: `canais_origem` (Instagram, Google, Indicação, Site, Feira, Outro; leitura do tenant, escrita só gerente; semeados uma vez por empresa) com a origem do negócio em `negocios.dados_extras` (`origem_id`/`origem`, sem mexer na view `clientes`), view `vw_vendas_por_origem` (`security_invoker`, agregada no banco), `onboarding_empresa` (dispensa do checklist por empresa, só gerente) e `status_primeiro_acesso()` (só booleanos do tenant ativo), `funcionarios.telefone` e `atualizar_meu_perfil()` (SECURITY DEFINER: o usuário muda SÓ nome e telefone da própria linha) com exceção delimitada em `fn_somente_gerente` (redefinida aqui; **se a 12 for reexecutada, rode a 16 de novo**). Rodar depois da 15. |

## Testes automatizados

As migrations são executadas e validadas contra um PostgreSQL real antes de
qualquer deploy. A suíte cobre isolamento entre tenants, migração de dados,
LGPD, limites de plano e a virada para a view de compatibilidade.

```bash
# Sobe um Postgres de teste (exemplo com instância local na porta 5433)
PGHOST=/var/tmp/crmpg PGPORT=5433 PGUSER=postgres \
  bash database/tests/run-migrations-test.sh
```

O runner: recria o banco, carrega `database/tests/00_harness_supabase.sql`
(simula schemas `auth`/`storage`, roles e as tabelas legadas), executa as
migrations em ordem, **repete a execução para provar idempotência** e roda as
suítes de asserção (01 isolamento, 02 virada, 03 correções do PR #1, 04
endurecimento, 05 religar referências, 07 orçamentos, 10 saúde do funil e modelos de mensagem, 11 origem, primeiro acesso e perfil). A Suíte 7b abre várias
conexões em paralelo (inclusive transações que desistem com ROLLBACK) e prova
que a numeração de orçamentos sai sem buraco e sem duplicata. A suíte 04 recria o estado "produção suja" (policies dos
scripts avulsos, view sem `security_invoker`, bucket público), reaplica a
migration 10 por cima e prova, para cada correção, que o ataque falha **e**
que o fluxo legítimo do app continua igual. Qualquer falha aborta com a
descrição do teste. O CI roda tudo isso a cada push (job `database`).

## Banco novo (instalação do zero)

Para um projeto Supabase vazio — inclusive a reconstrução da produção de
2026-11, que estava vazia e num schema de outra geração:

1. Rodar **todas** as migrations em ordem (00 → última).
2. `alter table public.clientes rename to clientes_legado;` (a 00 cria a tabela legada vazia).
3. Rodar de novo a **01** e, depois, todas a partir da **10** (10, 11, 12, …). A 01
   cria a view `clientes` do modelo novo; as demais reaplicam as travas sobre ela.
4. `select * from public.relatorio_rls();` — nenhuma linha CRÍTICA.
5. Quem se cadastrar pelo app cria a empresa e vira gerente (`provisionar_tenant`).

O CI ensaia exatamente essa sequência (fase 2 do `run-migrations-test.sh`,
suíte `08_teste_banco_novo.sql`).

## Sequência de virada (produção)

1. Rodar 00–10 em ordem (a 10 **sempre por último**; se qualquer migration
   antiga for reexecutada depois, rode a 10 de novo — ela é idempotente).
2. `select * from public.migrar_clientes_para_negocios(true);` — dry-run, conferir números.
3. `select * from public.migrar_clientes_para_negocios(false);` — migra de verdade.
4. `alter table public.clientes rename to clientes_legado;`
5. Rodar o arquivo 01 novamente — agora ele cria a view de compatibilidade `clientes` (o frontend atual continua funcionando sem mudança). Em seguida, rodar a 10 de novo (endurece a view recém-criada).
   Depois: `select * from public.religar_referencias_legadas();` (migration 11) — troca o id antigo pelo UUID do negócio em tarefas, timeline e documentos. Sem isso a agenda, a timeline e os anexos dos leads migrados somem da tela.
6. `select public.provisionar_defaults_tenant('<tenant_id>');` para cada tenant.
7. `select * from public.backfill_tenant_dados_legados('<tenant_id_polatto>');` — carimba tenant nos dados legados.
8. `select * from public.backfill_tenant_legado();` seguido de
   `select * from public.diagnostico_tenant_legado();` (deve vir vazio) e
   `select public.aplicar_rls_legado();` — fecha o isolamento das tabelas
   legadas. A migration 09 já tenta fazer isso sozinha quando é seguro.
9. `select * from public.relatorio_rls();` — deve retornar **zero linhas**.
10. Teste de isolamento com usuários reais, no SQL Editor (a função
    `testar_isolamento_tenant()` NÃO funciona: o Postgres proíbe `SET ROLE`
    dentro de função SECURITY DEFINER e ela sempre aborta). Faça assim:
    ```sql
    begin;
    set local role authenticated;
    select set_config('request.jwt.claims', '{"sub":"<user_a>","role":"authenticated"}', true);
    select set_config('request.headers', '{"x-tenant-id":"<tenant_do_user_b>"}', true);
    select public.current_tenant_id();                                        -- tenant do user_a
    select count(*) from public.negocios where tenant_id = '<tenant_do_user_b>'; -- 0
    select count(*) from public.clientes where tenant_id = '<tenant_do_user_b>'; -- 0
    rollback;
    ```
11. Adicionar na função `criar_usuario_equipe` (primeira linha do corpo): `perform public.enforce_rate_limit('criar_usuario_equipe', 10, interval '1 hour');`

## Scripts avulsos em `database/*.sql`

`fix_rls_policy_recursion_utilizadores_empresas.sql`, `insights_schema.sql` e
`supabase_phase34_repair.sql` são **históricos e não devem ser executados**:
recriam policies `using(true)`, storage sem prefixo de tenant e
auto-vínculo a qualquer empresa. Cada um aborta logo na primeira linha. Se
algum deles já rodou em produção, a migration 10 desfaz o estrago.

## Pós-virada

- Depois do backfill: `select public.aplicar_rls_estrita_pipeline_stages();`
- Agendar (pg_cron ou manual): `select * from public.aplicar_politica_retencao();` e `select public.limpar_erros_antigos();`
