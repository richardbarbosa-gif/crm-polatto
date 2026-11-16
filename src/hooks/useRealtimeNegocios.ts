import { useInvalidate } from "@refinedev/core";
import { useEffect } from "react";
import { useTenant } from "../contexts/tenant";
import { supabaseClient } from "../utility";

/**
 * O Supabase Realtime só emite eventos de TABELAS — uma view não gera
 * notificação. Quando "clientes" passa a ser a view de compatibilidade
 * sobre "negocios", o liveMode do Refine para de atualizar sozinho.
 *
 * Este hook escuta a tabela real (negocios) e invalida os recursos que a
 * tela usa, restaurando o comportamento em tempo real. Enquanto "clientes"
 * ainda for tabela física, o liveMode continua funcionando e este hook
 * apenas não recebe eventos — sem duplicidade nem efeito colateral.
 */
export const useRealtimeNegocios = (
    resources: string[] = ["clientes"],
    onInsert?: (registro: Record<string, unknown>) => void,
) => {
    const invalidate = useInvalidate();
    const { tenantId } = useTenant();
    const chave = resources.join(",");

    useEffect(() => {
        if (!tenantId) return;
        const lista = chave.split(",").filter(Boolean);

        const channel = supabaseClient
            .channel(`crm-negocios-realtime-${tenantId}-${chave}`)
            .on(
                "postgres_changes",
                // O filtro por empresa poupa o servidor de avaliar (e descartar
                // pela RLS) os eventos de todas as outras empresas.
                { event: "*", schema: "public", table: "negocios", filter: `tenant_id=eq.${tenantId}` },
                (payload) => {
                    lista.forEach((resource) => {
                        // "resourceAll": inclui as colunas do Kanban, que são
                        // consultas infinitas e não entram em "list"/"many".
                        void invalidate({ resource, invalidates: ["resourceAll"] });
                    });

                    if (payload.eventType === "INSERT" && onInsert) {
                        onInsert((payload.new || {}) as Record<string, unknown>);
                    }
                },
            )
            .subscribe();

        return () => {
            void supabaseClient.removeChannel(channel);
        };
        // onInsert é intencionalmente omitido: recriar o canal a cada render
        // derrubaria a inscrição do realtime.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chave, invalidate, tenantId]);
};
