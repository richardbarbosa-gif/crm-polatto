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
    /**
     * Etapas (já gravadas no banco) que o board exibe para o funil ativo.
     * Um negócio pertence ao funil se tiver pipeline_id = funil OU estiver
     * numa dessas etapas — ver filtroDeFunil.
     */
    etapasDoFunil?: Array<string | number>;
    /** Falso quando o usuário só pode ver os próprios leads */
    canViewAllLeads?: boolean;
    /** Nomes/aliases do usuário, usados quando a visão é restrita */
    ownerCandidates?: string[];
};

/**
 * O provider do Refine monta o filtro `.or()` do PostgREST colocando o
 * texto entre aspas duplas sem escapar nada. Aspas ou barra invertida
 * digitadas na busca quebravam a sintaxe e a consulta inteira falhava.
 */
export const sanitizarBusca = (texto?: string | null): string =>
    (texto ?? "").replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();

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

const filtroDeTemperatura = (temperatura: "todas" | LeadTemperatureTag): CrudFilter | null => {
    if (temperatura === "todas") return null;
    return filtroDeStatusTerminal(temperatura) ?? {
        field: "temperatura",
        operator: "eq",
        value: temperatura,
    };
};

const ehIdDeEtapaGravada = (id: string | number): boolean => /^\d+$/.test(String(id));

/**
 * Pertencer ao funil = pipeline_id do negócio igual ao funil, OU o negócio
 * estar numa etapa do funil.
 *
 * Só pipeline_id não basta: negócios migrados da tabela antiga e os
 * criados sem funil têm pipeline_id nulo. Depois da virada e do
 * provisionamento do funil padrão, o filtro "pipeline_id = funil" escondia
 * TODOS esses negócios do Kanban — enquanto os KPIs (que usam o funil da
 * etapa) continuavam contando: board vazio com contador cheio.
 */
export const filtroDeFunil = (
    pipelineId?: string,
    etapasDoFunil?: Array<string | number>,
): CrudFilter | null => {
    if (!pipelineId) return null;
    const etapas = (etapasDoFunil ?? []).filter(ehIdDeEtapaGravada).map(String);
    if (!etapas.length) {
        return { field: "pipeline_id", operator: "eq", value: pipelineId };
    }
    return {
        operator: "or",
        value: [
            { field: "pipeline_id", operator: "eq", value: pipelineId },
            { field: "stage_id", operator: "in", value: etapas },
        ],
    };
};

/**
 * Filtros aplicados à consulta de leads (Kanban e lista).
 */
export const buildLeadFilters = ({
    busca,
    responsavel,
    temperatura = "todas",
    pipelineId,
    etapasDoFunil,
    canViewAllLeads = true,
    ownerCandidates = [],
}: LeadFilterInput): CrudFilter[] => {
    const filters: CrudFilter[] = [];

    const termo = sanitizarBusca(busca);
    if (termo) {
        filters.push({
            operator: "or",
            value: [
                { field: "nome", operator: "contains", value: termo },
                { field: "telefone", operator: "contains", value: termo },
            ],
        });
    }

    if (responsavel) {
        filters.push({ field: "responsavel", operator: "eq", value: responsavel });
    }

    const porTemperatura = filtroDeTemperatura(temperatura);
    if (porTemperatura) filters.push(porTemperatura);

    if (!canViewAllLeads && ownerCandidates.length > 0) {
        filters.push({ field: "responsavel", operator: "in", value: ownerCandidates });
    }

    const porFunil = filtroDeFunil(pipelineId, etapasDoFunil);
    if (porFunil) filters.push(porFunil);

    return filters;
};

/**
 * Filtros aplicados à consulta de KPIs (view agregada vw_kanban_kpis).
 *
 * A view tem as colunas responsavel, temperatura, stage_id e pipeline_id,
 * então responde a TODOS os filtros do board, exceto a busca por texto.
 * Antes o filtro de responsável e o de temperatura (quente/morno/frio) eram
 * ignorados aqui: o vendedor filtrava "Ana" e os KPIs continuavam somando o
 * time inteiro.
 */
export const buildKpiFilters = ({
    responsavel,
    temperatura = "todas",
    pipelineId,
    etapasDoFunil,
    canViewAllLeads = true,
    ownerCandidates = [],
}: LeadFilterInput): CrudFilter[] => {
    const filters: CrudFilter[] = [];

    if (responsavel) {
        filters.push({ field: "responsavel", operator: "eq", value: responsavel });
    }

    const porTemperatura = filtroDeTemperatura(temperatura);
    if (porTemperatura) filters.push(porTemperatura);

    if (!canViewAllLeads && ownerCandidates.length > 0) {
        filters.push({ field: "responsavel", operator: "in", value: ownerCandidates });
    }

    const porFunil = filtroDeFunil(pipelineId, etapasDoFunil);
    if (porFunil) filters.push(porFunil);

    return filters;
};
