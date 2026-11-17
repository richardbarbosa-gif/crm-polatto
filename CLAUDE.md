# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start development server
npm run build      # Type-check and build for production (tsc && refine build)
npm start          # Serve production build (same security headers as Vercel)
npm test           # Unit tests (Vitest, src/**/__tests__)
npm run lint       # ESLint
npm run gerar:tipos  # Regenerate src/types/database.generated.ts from the DB
```

Database tests (migrations, RLS, tenant isolation) run against a local
Postgres: `PGHOST=... PGPORT=... PGUSER=postgres bash database/tests/run-migrations-test.sh`.

## Architecture

This is a **multi-tenant CRM** built with React + [Refine.dev](https://refine.dev/) + Supabase + Ant Design.

### Key Concepts

**Refine Framework:** Provides the CRUD data layer, routing integration, auth, and UI scaffolding. Data fetching uses Refine's `useList`, `useOne`, `useCreate`, `useUpdate`, `useDelete` hooks rather than direct Supabase calls. Resources are declared in `src/App.tsx`.

**Multi-Tenancy:** Every Supabase request is intercepted in `src/utility/supabaseClient.ts` to inject an `x-tenant-id` header from `localStorage`. The `TenantProvider` context (`src/contexts/tenant.tsx`) manages tenant state. The `RequireTenant` component gates routes that require an active tenant.

**Authentication:** Handled by `src/authProvider.ts` using Supabase Auth (email/password + OAuth). Refine's `<Authenticated>` wrapper protects routes.

### Routing (`src/App.tsx`)

Routes are declared as Refine resources and map to page components:

| Path | Feature |
|------|---------|
| `/` | Dashboard |
| `/meu-dia` | Salesperson's day (default home for vendedor) |
| `/clientes` | Leads/Opportunities (Kanban + CRUD) |
| `/orcamentos` | Quotes/proposals (PDF) |
| `/agenda` | Calendar |
| `/base-clientes` | Customer Database |
| `/organizacoes`, `/pessoas` | Companies and contacts |
| `/historico` | Won/lost history |
| `/equipe` | Team/Employees |
| `/metas` | Goals |
| `/lixeira` | Trash (restore soft-deleted records) |
| `/insights/*` | Analytics sub-pages (painel, roi, gains-losses, origens, activities, logs) |
| `/perfil` | My profile |
| `/configuracoes` | Settings (section in `?aba=`) |

### Data Layer

- **`src/utility/supabaseClient.ts`** — Supabase client singleton with tenant header interceptor
- **`src/lib/`** — Business logic helpers (lead status, temperature, timeline, insights, formatters, etc.)
- **`src/types/db.ts`** — TypeScript types mirroring the Supabase schema
- **`database/`** — SQL migration files for schema changes and RLS policies

### UI

- Ant Design (`antd`) components throughout, configured via `ConfigProvider` in `App.tsx`
- Custom theme tokens and `src/styles/premium-theme.css`
- Kanban drag-and-drop uses native HTML5 drag events (`src/components/kanban/`)
- `@uiw/react-md-editor` for markdown editing

### Conventions that prevent regressions

- `src/utility/antdReact19.ts` must stay the first import in `src/index.tsx`: without it antd's static APIs (`message.*`, `Modal.confirm`, `notification.*`) silently render nothing under React 19. Static dialogs get theme and pt-BR locale via `ConfigProvider.config({ holderRender })` in `src/contexts/color-mode/`.
- Counts with nouns use `contar(n, "lead", "leads")` (`src/lib/formatters.ts`), never `lead(s)`.
- Phones are displayed with `exibirTelefone()` (`src/lib/documentos.ts`).
- A missing table/feature shows `<RecursoIndisponivel recurso="..." />` — never migration/table names to end users.
- Infinite queries (Kanban) are not refreshed by `invalidates: ["list"]`; use `["resourceAll"]`.
- Business rules live in the database (RLS, triggers, transactional RPCs); the frontend checks are UX only.

### Environment

Requires a `.env` file:
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_KEY=...        # public anon/publishable key only
# VITE_CADASTRO_ABERTO=true  # optional: shows public sign-up
```

Production is deployed on Vercel (`vercel.json`: SPA rewrite + security headers, kept in sync with `public/serve.json` by a unit test).

### Access Control

`src/hooks/useCrmAccess.ts` — custom hook for role-based feature gating within the CRM.
