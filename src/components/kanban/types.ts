import { normalizeText } from "../../lib/formatters";
import type { SaudeDoNegocio } from "../../lib/saudeNegocio";

export type Stage = {
    id?: string | number;
    nome: string;
    cor?: string;
    ordem?: number;
    persisted?: boolean;
    pipeline_id?: string | null;
    probabilidade?: number | null;
    ganho?: boolean;
    perdido?: boolean;
};

/**
 * Negócio como chega da view `clientes` ou da `vw_negocios_saude` (campos
 * usados pelo board). Os campos de saúde só vêm da segunda.
 */
export type KanbanLead = SaudeDoNegocio & {
    id: string | number;
    nome?: string | null;
    titulo?: string | null;
    telefone?: string | null;
    ddi?: string | null;
    email?: string | null;
    responsavel?: string | null;
    status?: string | null;
    stage_id?: string | number | null;
    stageId?: string | number | null;
    pipeline_id?: string | null;
    temperatura?: string | null;
    valor?: number | string | null;
    conta_energia_media?: number | string | null;
    motivo_perda?: string | null;
    created_at?: string | null;
    endereco_instalacao?: string | null;
    [key: string]: unknown;
};

export const DEFAULT_STAGES: Stage[] = [
    { id: "novo", nome: "Novo Lead", cor: "#5d9cec", ordem: 1 },
    { id: "negociacao", nome: "Em Negociação", cor: "#3182ce", ordem: 2 },
    { id: "visita", nome: "Visita Agendada", cor: "#ed8936", ordem: 3 },
    { id: "fechado", nome: "Fechado", cor: "#82cf6e", ordem: 4 },
    { id: "perdido", nome: "Perdido", cor: "#f56565", ordem: 5 },
];

export const DEFAULT_STAGE_BLUEPRINT: Stage[] = [
    { id: "novo", nome: "Novo Lead", cor: "#5d9cec", ordem: 1 },
    { id: "visita", nome: "Visita Agendada", cor: "#ed8936", ordem: 2 },
    { id: "negociacao", nome: "Em Negociação", cor: "#3182ce", ordem: 3 },
    { id: "fechado", nome: "Fechado", cor: "#82cf6e", ordem: 4 },
    { id: "perdido", nome: "Perdido", cor: "#f56565", ordem: 5 },
];

export const getStatusAccent = (status?: string) => {
    const normalized = normalizeText(status);
    if (normalized.includes("fechado")) return "#82cf6e";
    if (normalized.includes("perdido")) return "#f56565";
    if (normalized.includes("visita")) return "#ed8936";
    if (normalized.includes("negocia")) return "#3182ce";
    return "#5d9cec";
};

export const getStatusTone = (
    status?: string,
): "success" | "danger" | "warning" | "info" => {
    const normalized = normalizeText(status);
    if (normalized.includes("fechado")) return "success";
    if (normalized.includes("perdido")) return "danger";
    if (normalized.includes("visita")) return "warning";
    return "info";
};

export const DRAG_ACTIVATION_DISTANCE = 5;

// Sem atraso: o card acompanha o ponteiro assim que o arraste começa.
export const DRAG_ACTIVATION_DELAY_MS = 0;

export const KANBAN_PAGE_SIZE = 20;
export const SEARCH_DEBOUNCE_MS = 400;

export type LeadNextTask = {
    titulo?: string | null;
    tipo?: string | null;
    data_vencimento?: string | null;
};

export type LeadPointerSession = {
    leadId: string;
    startX: number;
    startY: number;
    draggableElement: HTMLDivElement;
    isInteractiveTarget: boolean;
    hasDragged: boolean;
    timerId: number | null;
};