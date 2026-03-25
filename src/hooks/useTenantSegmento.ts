import { useCallback, useEffect, useState } from "react";
import { useTenant } from "../contexts/tenant";
import { supabaseClient } from "../utility";

export type BusinessSegment = "energia_solar" | string;

/**
 * Retorna o segmento de negócio da empresa ativa.
 * Usado para condicionar campos no frontend (ex: conta de luz só para energia solar).
 */
export const useTenantSegmento = () => {
    const { tenantId } = useTenant();
    const [segmento, setSegmento] = useState<BusinessSegment>("energia_solar");
    const [isLoading, setIsLoading] = useState(true);

    const load = useCallback(async () => {
        if (!tenantId) {
            setSegmento("energia_solar");
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        try {
            const { data, error } = await supabaseClient.rpc("get_tenant_segmento", {
                p_tenant_id: tenantId,
            });

            if (error) {
                console.warn("Erro ao buscar segmento:", error.message);
                setSegmento("energia_solar");
            } else {
                setSegmento((data as string) || "energia_solar");
            }
        } catch {
            setSegmento("energia_solar");
        } finally {
            setIsLoading(false);
        }
    }, [tenantId]);

    useEffect(() => {
        load();
    }, [load]);

    return {
        segmento,
        isEnergiaSolar: segmento === "energia_solar",
        isLoading,
    };
};