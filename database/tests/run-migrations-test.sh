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

echo "==> Suíte 4: endurecimento de segurança (migration 10) — ataque falha, uso legítimo segue"
psql -v ON_ERROR_STOP=1 -f "$REPO_DIR/database/tests/04_teste_hardening.sql"

echo "==> Suíte 5: migration 11 (religar referências legadas após a virada)"
psql -v ON_ERROR_STOP=1 -f "$REPO_DIR/database/tests/05_teste_ajustes_funcionais.sql"

echo "==> Suíte 6: papéis, exclusão, lixeira e equipe (migration 12)"
psql -v ON_ERROR_STOP=1 -f "$REPO_DIR/database/tests/06_teste_papeis_exclusao.sql"

# ---------------------------------------------------------------------
# FASE 2 — BANCO NOVO (instalação do zero / reconstrução de produção):
# 00..N, virada (clientes -> view) e 01 + 10 em diante de novo.
# ---------------------------------------------------------------------
DB_NOVO="${DB}_novo"
export PGDATABASE=postgres
echo "==> Fase 2: banco novo '$DB_NOVO' (sequência de instalação do zero)"
psql -q -c "drop database if exists $DB_NOVO;" >/dev/null
psql -q -c "create database $DB_NOVO;" >/dev/null
export PGDATABASE="$DB_NOVO"
psql -v ON_ERROR_STOP=1 -q -f "$REPO_DIR/database/tests/00_harness_supabase.sql" >/dev/null
for f in "$REPO_DIR"/database/migrations/*.sql; do
    psql -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null 2>&1 || { echo "FALHOU (banco novo): $(basename "$f")"; psql -v ON_ERROR_STOP=1 -f "$f" 2>&1 | grep -E "ERROR" | head -3; exit 1; }
done
psql -v ON_ERROR_STOP=1 -q -c "alter table public.clientes rename to clientes_legado;" >/dev/null
for f in "$REPO_DIR"/database/migrations/2026-07-19_01_*.sql "$REPO_DIR"/database/migrations/2026-1[1-9]-*.sql; do
    psql -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null 2>&1 || { echo "FALHOU (virada do banco novo): $(basename "$f")"; exit 1; }
done
echo "  ok — virada do banco novo concluída"
psql -v ON_ERROR_STOP=1 -f "$REPO_DIR/database/tests/08_teste_banco_novo.sql"
