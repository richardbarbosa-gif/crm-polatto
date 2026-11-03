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
endurecimento). A suíte 04 recria o estado "produção suja" (policies dos
scripts avulsos, view sem `security_invoker`, bucket público), reaplica a
migration 10 por cima e prova, para cada correção, que o ataque falha **e**
que o fluxo legítimo do app continua igual. Qualquer falha aborta com a
descrição do teste. O CI roda tudo isso a cada push (job `database`).

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
