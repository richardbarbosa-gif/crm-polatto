import type { CrudFilter } from "@refinedev/core";
import type { LeadTemperatureTag } from "./leadTemperature";

export type LeadFilterInput = {
    /** Texto já debounced da busca (nome ou telefone) */
    busca?: string;
    /** Responsável selecionado no filtro */
    responsavel?: string;
    /** Temperatura ou estado terminal selecionado */
    temperatura?: "todas" | LeadTemperatureTag;
    /** Funil ativo. Quando presente, leads e KPIs ficam restritos a ele. */
    pipelineId?: string;
    /** Falso quando o usuário só pode ver os próprios leads */
    canViewAllLeads?: boolean;
    /** Nomes/aliases do usuário, usados quando a visão é restrita */
    ownerCandidates?: string[];
};

/** Filtro por estado terminal (fechado/ganho ou perdido), comum a leads e KPIs. */
const filtroDeStatusTerminal = (
    temperatura: "todas" | LeadTemperatureTag,
): CrudFilter | null => {
    if (temperatura === "fechado") {
        return {
            operator: "or",
            value: [
                { field: "status", operator: "contains", value: "fechado" },
                { field: "status", operator: "contains", value: "ganho" },
            ],
        };
    }

    if (temperatura === "perdido") {
        return { field: "status", operator: "contains", value: "perdido" };
    }

    return null;
};

/**
 * Filtros aplicados à consulta de leads (Kanban e lista).
 */
export const buildLeadFilters = ({
    busca,
    responsavel,
    temperatura = "todas",
    pipelineId,
    canViewAllLeads = true,
    ownerCandidates = [],
}: LeadFilterInput): CrudFilter[] => {
    const filters: CrudFilter[] = [];

    if (busca) {
        filters.push({
            operator: "or",
            value: [
                { field: "nome", operator: "contains", value: busca },
                { field: "telefone", operator: "contains", value: busca },
            ],
        });
    }

    if (responsavel) {
        filters.push({ field: "responsavel", operator: "eq", value: responsavel });
    }

    if (temperatura !== "todas") {
        const terminal = filtroDeStatusTerminal(temperatura);
        filters.push(
            terminal ?? { field: "temperatura", operator: "eq", value: temperatura },
        );
    }

    if (!canViewAllLeads && ownerCandidates.length > 0) {
        filters.push({ field: "responsavel", operator: "in", value: ownerCandidates });
    }

    if (pipelineId) {
        filters.push({ field: "pipeline_id", operator: "eq", value: pipelineId });
    }

    return filters;
};

/**
 * Filtros aplicados à consulta de KPIs (view agregada vw_kanban_kpis).
 * Subconjunto do que a view materializada consegue responder.
 */
export const buildKpiFilters = ({
    temperatura = "todas",
    pipelineId,
    canViewAllLeads = true,
    ownerCandidates = [],
}: LeadFilterInput): CrudFilter[] => {
    const filters: CrudFilter[] = [];

    if (temperatura !== "todas") {
        const terminal = filtroDeStatusTerminal(temperatura);
        if (terminal) {
            filters.push(terminal);
        }
    }

    if (!canViewAllLeads && ownerCandidates.length > 0) {
        filters.push({ field: "responsavel", operator: "in", value: ownerCandidates });
    }

    if (pipelineId) {
        filters.push({ field: "pipeline_id", operator: "eq", value: pipelineId });
    }

    return filters;
};
