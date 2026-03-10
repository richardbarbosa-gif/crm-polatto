import { createClient } from "@refinedev/supabase";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;

// Interceptador para injetar o Tenant ID em TODAS as requisições ao Supabase
const customFetch = (url: RequestInfo | URL, options?: RequestInit) => {
    const headers = new Headers(options?.headers);
    
    // Pega o tenant_id armazenado globalmente
    const tenantId = window.localStorage.getItem("crm_tenant_id");
    
    if (tenantId) {
        headers.set("x-tenant-id", tenantId);
    }
    
    return fetch(url, { ...options, headers });
};

export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
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