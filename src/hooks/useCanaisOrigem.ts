import { useList } from "@refinedev/core";
import { useMemo } from "react";
import { RECURSO_CANAIS, type CanalOrigem } from "../lib/origemLead";

/**
 * Canais de origem ativos da empresa (Configurações > Origens do lead).
 * Sem a migration 16 no ambiente, devolve lista vazia e o campo some.
 */
export const useCanaisOrigem = (): { canais: CanalOrigem[]; carregando: boolean } => {
    const { query, result } = useList<CanalOrigem>({
        resource: RECURSO_CANAIS,
        pagination: { mode: "off" },
        filters: [{ field: "ativo", operator: "eq", value: true }],
        sorters: [
            { field: "ordem", order: "asc" },
            { field: "nome", order: "asc" },
        ],
        meta: { select: "id,nome,ativo,ordem" },
        queryOptions: { retry: false },
    });
    const canais = useMemo(() => (query.isError ? [] : result.data ?? []), [query.isError, result.data]);
    return { canais, carregando: query.isLoading };
};
