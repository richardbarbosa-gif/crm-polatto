# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start development server
npm run build    # Type-check and build for production (tsc && refine build)
npm start        # Serve production build
```

There are no test commands configured in this project.

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
| `/clientes` | Leads/Opportunities (CRUD) |
| `/agenda` | Calendar |
| `/base-clientes` | Customer Database |
| `/equipe` | Team/Employees |
| `/metas` | Goals |
| `/insights/*` | Analytics sub-pages (painel, roi, ganhos-perdas, atividades, logs) |
| `/configuracoes` | Settings |

### Data Layer

- **`src/utility/supabaseClient.ts`** — Supabase client singleton with tenant header interceptor
- **`src/lib/`** — Business logic helpers (lead status, temperature, timeline, insights, formatters, etc.)
- **`src/types/db.ts`** — TypeScript types mirroring the Supabase schema
- **`database/`** — SQL migration files for schema changes and RLS policies

### UI

- Ant Design (`antd`) components throughout, configured via `ConfigProvider` in `App.tsx`
- Custom theme tokens and `src/styles/premium-theme.css`
- `@hello-pangea/dnd` for drag-and-drop (Kanban board on `testes-kanban` branch)
- `@uiw/react-md-editor` for markdown editing

### Environment

Requires a `.env` file:
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_KEY=...
```

### Access Control

`src/hooks/useCrmAccess.ts` — custom hook for role-based feature gating within the CRM.
