import { normalizeText } from "./formatters";

export type LeadStage = {
    id: string;
    nome: string;
    cor: string;
    ordem: number;
};

type LeadStatusOption = {
    value: string;
    label: string;
};

export type LeadStageOption = {
    value: string;
    label: string;
};

type StageRecord = {
    id?: string | number | null;
    nome?: string | null;
    name?: string | null;
    title?: string | null;
    cor?: string | null;
    color?: string | null;
    ordem?: number | null;
    order?: number | null;
    sort_order?: number | null;
};

export const DEFAULT_LEAD_STAGES: LeadStage[] = [
    { id: "novo", nome: "Novo Lead", cor: "#5d9cec", ordem: 1 },
    { id: "visita", nome: "Visita Agendada", cor: "#ed8936", ordem: 2 },
    { id: "negociacao", nome: "Em Negociacao", cor: "#3182ce", ordem: 3 },
    { id: "fechado", nome: "Fechado", cor: "#82cf6e", ordem: 4 },
    { id: "perdido", nome: "Perdido", cor: "#f56565", ordem: 5 },
];

export const DEFAULT_LEAD_STATUS_OPTIONS: LeadStatusOption[] = DEFAULT_LEAD_STAGES.map((stage) => ({
    value: stage.nome,
    label: stage.nome,
}));

const readStageName = (stage: StageRecord): string => {
    const raw = stage.nome ?? stage.name ?? stage.title;
    return typeof raw === "string" ? raw.trim() : "";
};

const readStageOrder = (stage: StageRecord): number => {
    const raw = stage.ordem ?? stage.order ?? stage.sort_order;
    return typeof raw === "number" ? raw : 0;
};

const readStageColor = (stage: StageRecord, fallbackColor: string): string => {
    const raw = stage.cor ?? stage.color;
    return typeof raw === "string" && raw.trim() ? raw : fallbackColor;
};

const dedupeStatusNames = (values: string[]): string[] => {
    const map = new Map<string, string>();

    values.forEach((value) => {
        const normalized = normalizeText(value);
        if (!normalized) {
            return;
        }

        if (!map.has(normalized)) {
            map.set(normalized, value);
        }
    });

    return Array.from(map.values());
};

export const buildLeadStatusOptions = (
    stagesData?: StageRecord[] | null,
): LeadStatusOption[] => {
    const rawStages = Array.isArray(stagesData) ? stagesData : [];

    const stageNames = rawStages
        .map((stage) => ({
            nome: readStageName(stage),
            ordem: readStageOrder(stage),
        }))
        .filter((stage) => Boolean(stage.nome))
        .sort((first, second) => first.ordem - second.ordem)
        .map((stage) => stage.nome);

    const dedupedNames = dedupeStatusNames(stageNames);
    if (!dedupedNames.length) {
        return DEFAULT_LEAD_STATUS_OPTIONS;
    }

    return dedupedNames.map((nome) => ({ value: nome, label: nome }));
};

export const buildLeadStageOptions = (stagesData?: StageRecord[] | null): LeadStageOption[] => {
    const stages = buildLeadStages(stagesData);
    return stages.map((stage) => ({
        value: String(stage.id),
        label: stage.nome,
    }));
};

export const buildLeadStages = (stagesData?: StageRecord[] | null): LeadStage[] => {
    const rawStages = Array.isArray(stagesData) ? stagesData : [];
    if (!rawStages.length) {
        return DEFAULT_LEAD_STAGES;
    }

    const fallbackByOrder = new Map<number, LeadStage>(
        DEFAULT_LEAD_STAGES.map((stage) => [stage.ordem, stage]),
    );

    const normalized = rawStages
        .map((stage) => {
            const nome = readStageName(stage);
            const ordem = readStageOrder(stage);
            if (!nome) {
                return null;
            }

            const fallback = fallbackByOrder.get(ordem);
            return {
                id: String(stage.id ?? nome),
                nome,
                cor: readStageColor(stage, fallback?.cor || "#94a3b8"),
                ordem,
            } satisfies LeadStage;
        })
        .filter((stage): stage is LeadStage => Boolean(stage))
        .sort((first, second) => first.ordem - second.ordem);

    if (!normalized.length) {
        return DEFAULT_LEAD_STAGES;
    }

    const deduped = new Map<string, LeadStage>();
    normalized.forEach((stage) => {
        const key = normalizeText(stage.nome);
        if (!key || deduped.has(key)) {
            return;
        }
        deduped.set(key, stage);
    });

    return Array.from(deduped.values());
};

export const coerceLeadStatusValue = (
    value: string | null | undefined,
    options: LeadStatusOption[],
): string => {
    const activeOptions = options.length ? options : DEFAULT_LEAD_STATUS_OPTIONS;
    const fallback = activeOptions[0]?.value || "Novo Lead";

    if (!value) {
        return fallback;
    }

    const exact = activeOptions.find((option) => option.value === value);
    if (exact) {
        return exact.value;
    }

    const normalizedValue = normalizeText(value);
    if (!normalizedValue) {
        return fallback;
    }

    const normalizedMatch = activeOptions.find(
        (option) => normalizeText(option.value) === normalizedValue,
    );
    if (normalizedMatch) {
        return normalizedMatch.value;
    }

    return value;
};

export const coerceLeadStageIdValue = (
    value: string | number | null | undefined,
    stages: LeadStage[],
): string => {
    const availableStages = stages.length ? stages : DEFAULT_LEAD_STAGES;
    const fallback = String(availableStages[0]?.id || DEFAULT_LEAD_STAGES[0].id);

    if (value === null || value === undefined || value === "") {
        return fallback;
    }

    const asString = String(value);
    const exact = availableStages.find((stage) => String(stage.id) === asString);
    if (exact) {
        return String(exact.id);
    }

    const normalizedValue = normalizeText(asString);
    if (!normalizedValue) {
        return fallback;
    }

    const byName = availableStages.find((stage) => normalizeText(stage.nome) === normalizedValue);
    if (byName) {
        return String(byName.id);
    }

    return fallback;
};

export const findLeadStageById = (
    stages: LeadStage[],
    stageId: string | number | null | undefined,
): LeadStage | undefined => {
    if (stageId === null || stageId === undefined || stageId === "") {
        return undefined;
    }
    const candidate = String(stageId);
    return stages.find((stage) => String(stage.id) === candidate);
};
