import { useMemo } from "react";
import { useTenant } from "../contexts/tenant";

/**
 * Quem assina as mensagens: o vendedor logado ({vendedor}, que a tela já
 * conhece pelo useCrmAccess) e a empresa ativa ({empresa}).
 */
export const useRemetente = (vendedor?: string | null): { vendedor: string; empresa: string } => {
    const { empresas, tenantId } = useTenant();
    const empresa = useMemo(
        () => empresas.find((e) => e.id === tenantId)?.nome ?? "",
        [empresas, tenantId],
    );
    return { vendedor: (vendedor ?? "").trim(), empresa };
};
