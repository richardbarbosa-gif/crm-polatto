import { createClient } from "@refinedev/supabase";
import { env } from "./env";

// Interceptador que injeta o tenant em todas as requisições.
// IMPORTANTE (segurança): este header é apenas informativo/telemetria.
// O isolamento real é feito no banco via RLS com current_tenant_id(),
// que deriva o tenant do usuário AUTENTICADO (auth.uid()) — forjar este
// header não dá acesso a dados de outro tenant.
const customFetch = (url: RequestInfo | URL, options?: RequestInit) => {
    const headers = new Headers(options?.headers);

    const tenantId = window.localStorage.getItem("crm_tenant_id");

    if (tenantId) {
        headers.set("x-tenant-id", tenantId);
    }

    return fetch(url, { ...options, headers });
};

export const supabaseClient = createClient(env.supabaseUrl, env.supabaseKey, {
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