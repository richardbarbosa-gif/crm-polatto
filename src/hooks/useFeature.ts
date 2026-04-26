import { useCallback, useEffect, useState } from "react";
import { useTenant } from "../contexts/tenant";
import { supabaseClient } from "../utility";

/**
 * Hook para checar se uma feature flag está ativa para o tenant atual.
 * 
 * Uso:
 *   const { enabled, isLoading } = useFeature("negocios_v2");
 *   if (enabled) { ... mostrar UI nova ... }
 */
export const useFeature = (featureKey: string) => {
    const { tenantId, isSystemAdmin } = useTenant();
    const [enabled, setEnabled] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    const load = useCallback(async () => {
        if (!tenantId && !isSystemAdmin) {
            setEnabled(false);
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        try {
            const { data, error } = await supabaseClient.rpc("check_feature", {
                p_feature_key: featureKey,
                p_tenant_id: tenantId,
            });

            if (error) {
                console.warn(`useFeature("${featureKey}"):`, error.message);
                setEnabled(false);
            } else {
                setEnabled(Boolean(data));
            }
        } catch {
            setEnabled(false);
        } finally {
            setIsLoading(false);
        }
    }, [featureKey, tenantId, isSystemAdmin]);

    useEffect(() => {
        load();
    }, [load]);

    return { enabled, isLoading };
};