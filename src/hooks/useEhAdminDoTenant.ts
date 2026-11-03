import { useEffect, useState } from "react";
import { useTenant } from "../contexts/tenant";
import { supabaseClient } from "../utility";

/**
 * Gerente/admin do tenant ativo segundo o BANCO (eh_admin_do_tenant(),
 * a mesma função que as policies usam). A tela só esconde botões; quem
 * barra de verdade é a RLS. Enquanto carrega ou se a chamada falhar,
 * responde false (nunca mostra ação que o banco vai recusar).
 */
export const useEhAdminDoTenant = () => {
    const { tenantId, isSystemAdmin } = useTenant();
    const [estado, setEstado] = useState<{ chave: string | null; ehAdmin: boolean }>({ chave: null, ehAdmin: false });

    useEffect(() => {
        if (!tenantId) return;
        let ativo = true;
        supabaseClient
            .rpc("eh_admin_do_tenant", { p_tenant_id: tenantId })
            .then(({ data, error }) => {
                if (ativo) setEstado({ chave: tenantId, ehAdmin: !error && data === true });
            });
        return () => {
            ativo = false;
        };
    }, [tenantId]);

    const carregado = estado.chave === tenantId;
    return {
        ehAdmin: isSystemAdmin || (carregado && estado.ehAdmin),
        carregando: Boolean(tenantId) && !carregado && !isSystemAdmin,
    };
};
