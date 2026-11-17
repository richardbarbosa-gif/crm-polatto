# CRM Polatto

CRM comercial multiempresa (SaaS) para operações de venda consultiva: funil
visual com próximo passo de cada negócio, agenda, propostas em PDF com a
identidade da empresa, metas, ranking e relatórios do time.

**Stack:** React 19 + [Refine](https://refine.dev) + Ant Design 5 + Supabase
(Postgres com RLS, Auth, Storage, Realtime e Edge Functions) + Vite.

## Rodar localmente

```bash
cp .env.example .env   # preencher VITE_SUPABASE_URL e VITE_SUPABASE_KEY
npm ci
npm run dev
```

`VITE_SUPABASE_KEY` é a chave **pública** (anon/publishable) do projeto.
Nunca coloque a `service_role` no frontend: ela ignora o RLS.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Type-check + build de produção em `dist/` |
| `npm start` | Serve o build com os mesmos cabeçalhos de segurança da produção |
| `npm test` | Testes unitários (Vitest) |
| `npm run lint` / `npm run typecheck` | ESLint / só o type-check |
| `npm run gerar:tipos` | Regenera `src/types/database.generated.ts` a partir do banco |

Testes do banco (migrations, RLS, isolamento entre empresas): ver
`database/tests/run-migrations-test.sh`.

## Deploy (Vercel)

O `vercel.json` já define build (`npm run build`), saída (`dist`), o
redirecionamento das rotas do app para o `index.html` e os cabeçalhos de
segurança (CSP, HSTS, X-Frame-Options). No painel da Vercel basta cadastrar:

| Variável | Obrigatória | Valor |
|---|---|---|
| `VITE_SUPABASE_URL` | sim | URL do projeto Supabase |
| `VITE_SUPABASE_KEY` | sim | chave pública (anon/publishable) |
| `VITE_CADASTRO_ABERTO` | não | `true` só quando o cadastro público de empresas for aberto |

No Supabase (Authentication → URL Configuration), inclua o domínio da Vercel
em **Site URL** e **Redirect URLs** — sem isso o link de recuperação de senha
volta para o endereço errado.

## Banco de dados

- `database/migrations/` — migrations numeradas e idempotentes; a ordem e o
  que cada uma faz estão em `database/migrations/README.md`.
- `supabase/functions/equipe-usuarios/` — Edge Function que cria e remove
  logins da equipe (precisa da `service_role`, por isso roda no servidor).

## Arquitetura em uma página

- **Multiempresa:** cada requisição leva o cabeçalho `x-tenant-id`
  (`src/utility/supabaseClient.ts`); o banco confere se o usuário pertence
  àquela empresa (`current_tenant_id()`) e as políticas de RLS isolam os dados.
- **Dados:** hooks do Refine (`useList`, `useCreate`…) sobre o cliente
  Supabase tipado; operações com várias etapas rodam em RPCs transacionais.
- **Papéis:** `src/hooks/useCrmAccess.ts` no front; a regra que vale é a do
  banco (RLS e RPCs).
- **Tema:** tokens em `src/styles/premium-theme.css` e `ConfigProvider` em
  `src/contexts/color-mode/` (claro/escuro).
