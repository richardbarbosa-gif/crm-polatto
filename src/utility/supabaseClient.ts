import { createClient } from "@refinedev/supabase";
import type { Database } from "../types/database.generated";
import { env } from "./env";

// Interceptador que injeta a empresa ativa em todas as requisições.
// SEGURANÇA: o banco usa este header para saber QUAL das empresas do
// usuário está selecionada, mas current_tenant_id() sempre valida o valor
// contra os vínculos reais em utilizadores_empresas. Forjar este header
// para uma empresa de terceiro não dá acesso a nada — a seleção inválida
// é descartada e cai para uma empresa legítima do próprio usuário.
const customFetch = (url: RequestInfo | URL, options?: RequestInit) => {
    const headers = new Headers(options?.headers);

    const tenantId = window.localStorage.getItem("crm_tenant_id");

    if (tenantId) {
        headers.set("x-tenant-id", tenantId);
    }

    return fetch(url, { ...options, headers });
};

// Tipado pelo schema real (src/types/database.generated.ts): coluna, tabela
// ou RPC que não existe no banco vira erro de compilação.
export const supabaseClient = createClient<Database>(env.supabaseUrl, env.supabaseKey, {
    db: {
        schema: "public",
    },
    auth: {
        persistSession: true,
    },
    global: {
        fetch: customFetch,
    },
});