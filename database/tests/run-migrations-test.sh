#!/usr/bin/env bash
# =====================================================================
# Executa as migrations em um Postgres limpo e valida o resultado.
# Requer: PGHOST/PGPORT/PGUSER apontando para uma instância de teste.
#
# Uso: PGHOST=/var/tmp/crmpg PGPORT=5433 PGUSER=postgres \
#        bash database/tests/run-migrations-test.sh
# =====================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB="${TEST_DB:-crmtest}"
export PGDATABASE=postgres

echo "==> Recriando banco de teste '$DB'"
psql -q -c "drop database if exists $DB;" >/dev/null
psql -q -c "create database $DB;" >/dev/null

export PGDATABASE="$DB"

echo "==> Carregando harness (simulação do ambiente Supabase)"
psql -v ON_ERROR_STOP=1 -q -f "$REPO_DIR/database/tests/00_harness_supabase.sql" >/dev/null

echo "==> Executando migrations em ordem"
for f in "$REPO_DIR"/database/migrations/*.sql; do
    name="$(basename "$f")"
    if ! out="$(psql -v ON_ERROR_STOP=1 -f "$f" 2>&1)"; then
        echo "FALHOU: $name"
        echo "$out" | grep -E "ERROR|FATAL" | head -5
        exit 1
    fi
    # Erros engolidos por blocos EXCEPTION aparecem como NOTICE — sinaliza
    if echo "$out" | grep -qE "^psql.*ERROR"; then
        echo "  ! $name executou com ERROR interno:"
        echo "$out" | grep -E "ERROR" | head -3
    fi
    echo "  ok $name"
done

echo "==> Segunda execução (idempotência)"
for f in "$REPO_DIR"/database/migrations/*.sql; do
    name="$(basename "$f")"
    if ! out="$(psql -v ON_ERROR_STOP=1 -f "$f" 2>&1)"; then
        echo "FALHOU NA REEXECUÇÃO (não idempotente): $name"
        echo "$out" | grep -E "ERROR|FATAL" | head -5
        exit 1
    fi
done
echo "  ok — todas as migrations são idempotentes"

echo "==> Suíte 1: isolamento multi-tenant, migração, LGPD"
psql -v ON_ERROR_STOP=1 -f "$REPO_DIR/database/tests/01_testes_isolamento.sql"

echo "==> Suíte 2: virada da tabela clientes para a view de compatibilidade"
psql -v ON_ERROR_STOP=1 -f "$REPO_DIR/database/tests/02_teste_virada_view.sql"

echo "==> Suíte 3: correções apontadas na revisão do PR #1"
psql -v ON_ERROR_STOP=1 -f "$REPO_DIR/database/tests/03_teste_correcoes_pr.sql"
