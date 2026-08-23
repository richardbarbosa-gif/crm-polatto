# Contribuindo — CRM Polatto

## Estratégia de branches

- `main` — produção. Só recebe merge via Pull Request com CI verde.
- `dev` — integração. Base para novas branches de trabalho.
- `feat/<descricao-curta>` — nova funcionalidade (ex: `feat/multiplos-pipelines`)
- `fix/<descricao-curta>` — correção de bug (ex: `fix/kanban-drag-mobile`)
- `db/<descricao-curta>` — mudança de schema/migration (ex: `db/rls-storage`)

Regras:
1. Nunca commitar direto na `main`.
2. Toda PR precisa passar no CI (type-check + testes + build).
3. Migrations SQL entram em `database/migrations/` com prefixo de data e são **idempotentes**.
4. Mudança de schema e mudança de frontend que dependem uma da outra entram na MESMA PR, com a migration numerada.

## Setup local

```bash
cp .env.example .env   # preencher com as chaves do Supabase
npm install
npm run dev
```

## Comandos

```bash
npm run dev        # servidor de desenvolvimento
npm run build      # type-check + build de produção
npm test           # testes (Vitest)
npm run typecheck  # apenas type-check
npm run lint       # ESLint
```
