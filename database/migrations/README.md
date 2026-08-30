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
duas suítes de asserção. Qualquer falha aborta com a descrição do teste.

## Sequência de virada (produção)

1. Rodar 00–09 em ordem.
2. `select * from public.migrar_clientes_para_negocios(true);` — dry-run, conferir números.
3. `select * from public.migrar_clientes_para_negocios(false);` — migra de verdade.
4. `alter table public.clientes rename to clientes_legado;`
5. Rodar o arquivo 01 novamente — agora ele cria a view de compatibilidade `clientes` (o frontend atual continua funcionando sem mudança).
6. `select public.provisionar_defaults_tenant('<tenant_id>');` para cada tenant.
7. `select * from public.backfill_tenant_dados_legados('<tenant_id_polatto>');` — carimba tenant nos dados legados.
8. `select * from public.backfill_tenant_legado();` seguido de
   `select * from public.diagnostico_tenant_legado();` (deve vir vazio) e
   `select public.aplicar_rls_legado();` — fecha o isolamento das tabelas
   legadas. A migration 09 já tenta fazer isso sozinha quando é seguro.
9. `select * from public.relatorio_rls();` — deve retornar **zero linhas**.
10. `select * from public.testar_isolamento_tenant('<user_a>', '<user_b>');` — com usuários de tenants diferentes, deve dar OK.
11. Adicionar na função `criar_usuario_equipe` (primeira linha do corpo): `perform public.enforce_rate_limit('criar_usuario_equipe', 10, interval '1 hour');`

## Pós-virada

- Depois do backfill: `select public.aplicar_rls_estrita_pipeline_stages();`
- Agendar (pg_cron ou manual): `select * from public.aplicar_politica_retencao();` e `select public.limpar_erros_antigos();`
