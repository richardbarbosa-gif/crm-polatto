# Migrations — ordem de execução

Executar no SQL Editor do Supabase, **em ordem numérica**. Todos os arquivos são idempotentes (podem rodar mais de uma vez e alinham o banco sem destruir dados existentes).

| Arquivo | O que faz |
|---|---|
| `2026-07-19_01_modelo_relacional.sql` | Modelo organizacoes/pessoas/negocios, pipelines múltiplos, custom fields, motivos de perda, tipos de atividade, FKs formais, view de compatibilidade `clientes` |
| `2026-07-19_02_seguranca.sql` | `current_tenant_id()` fail-closed, trigger de tenant_id (remove default hardcoded), RLS por tenant, isolamento do Storage `lead-files`, rate limiting |
| `2026-07-19_03_lgpd.sql` | Consentimentos, exportação do titular, direito ao esquecimento, política de retenção, log de acesso a dado pessoal |
| `2026-07-19_04_auditoria_soft_delete.sql` | `audit_log` com trigger automática, timeline de mudança de etapa via trigger, soft delete + restauração |
| `2026-07-19_05_indices_performance.sql` | Índices para Kanban, busca por nome/email/telefone (trigram) e dedup por CPF/CNPJ |
| `2026-07-19_06_auditoria_rls.sql` | `relatorio_rls()` (linter de isolamento) e `testar_isolamento_tenant()` (teste formal cross-tenant) |
| `2026-07-19_07_monitoramento_erros.sql` | Tabela `client_errors` + RPC `registrar_erro_cliente` usada pelo frontend |

## Sequência de virada (produção)

1. Rodar 01–07 em ordem.
2. `select * from public.migrar_clientes_para_negocios(true);` — dry-run, conferir números.
3. `select * from public.migrar_clientes_para_negocios(false);` — migra de verdade.
4. `alter table public.clientes rename to clientes_legado;`
5. Rodar o arquivo 01 novamente — agora ele cria a view de compatibilidade `clientes` (o frontend atual continua funcionando sem mudança).
6. `select public.provisionar_defaults_tenant('<tenant_id>');` para cada tenant.
7. `select * from public.backfill_tenant_dados_legados('<tenant_id_polatto>');` — carimba tenant nos dados legados.
8. `select * from public.relatorio_rls();` — deve retornar **zero linhas**.
9. `select * from public.testar_isolamento_tenant('<user_a>', '<user_b>');` — com usuários de tenants diferentes, deve dar OK.
10. Adicionar na função `criar_usuario_equipe` (primeira linha do corpo): `perform public.enforce_rate_limit('criar_usuario_equipe', 10, interval '1 hour');`

## Pós-virada

- Depois do backfill: `select public.aplicar_rls_estrita_pipeline_stages();`
- Agendar (pg_cron ou manual): `select * from public.aplicar_politica_retencao();` e `select public.limpar_erros_antigos();`
