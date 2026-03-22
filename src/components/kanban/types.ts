import { normalizeText } from "../../lib/formatters";

export type Stage = {
    id?: string | number;
    nome: string;
    cor?: string;
    ordem?: number;
    persisted?: boolean;
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
    { id: "negociacao", nome: "Em Negociacao", cor: "#3182ce", ordem: 3 },
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

// 🔥 MÁGICA 1: Reduzimos o atraso de 250ms para 0! O cartão "cola" no rato instantaneamente.
export const DRAG_ACTIVATION_DELAY_MS = 0; 

export const KANBAN_PAGE_SIZE = 20;
export const SEARCH_DEBOUNCE_MS = 400;

export type LeadPointerSession = {
    leadId: string;
    startX: number;
    startY: number;
    draggableElement: HTMLDivElement;
    isInteractiveTarget: boolean;
    hasDragged: boolean;
    timerId: number | null;
};