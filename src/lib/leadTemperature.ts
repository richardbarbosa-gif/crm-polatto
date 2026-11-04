import { normalizeText } from "./formatters";
import { supabaseClient } from "../utility";

export type LeadTemperature = "frio" | "morno" | "quente";
export type LeadTemperatureAuto = "fechado" | "perdido";
export type LeadTemperatureTag = LeadTemperature | LeadTemperatureAuto;

export const LEAD_TEMPERATURE_LABELS: Record<LeadTemperatureTag, string> = {
    frio: "Frio",
    morno: "Morno",
    quente: "Quente",
    fechado: "Fechado",
    perdido: "Perdido",
};

export const LEAD_TEMPERATURE_OPTIONS: Array<{
    value: LeadTemperature;
    label: string;
}> = [
    { value: "frio", label: "Frio" },
    { value: "morno", label: "Morno" },
    { value: "quente", label: "Quente" },
];

export const LEAD_AUTOMATIC_TEMPERATURE_OPTIONS: Array<{
    value: LeadTemperatureAuto;
    label: string;
}> = [
    { value: "fechado", label: "Fechado" },
    { value: "perdido", label: "Perdido" },
];

export const isLeadTemperature = (value: unknown): value is LeadTemperature => {
    return value === "frio" || value === "morno" || value === "quente";
};

export const isLeadTemperatureTag = (value: unknown): value is LeadTemperatureTag => {
    return (
        value === "frio" ||
        value === "morno" ||
        value === "quente" ||
        value === "fechado" ||
        value === "perdido"
    );
};

export const isAutomaticLeadTemperature = (
    value: LeadTemperatureTag | null | undefined,
): value is LeadTemperatureAuto => {
    return value === "fechado" || value === "perdido";
};

export const updateLeadTemperature = async (
    leadId: string | number,
    temperatura?: LeadTemperature | null,
): Promise<void> => {
    const { error } = await supabaseClient
        .from("clientes")
        .update({ temperatura: temperatura || null })
        .eq("id", leadId);
    if (error) throw error;
};

export const getLeadTemperatureFromRecord = (
    registro: object | undefined | null,
): LeadTemperatureTag | undefined => {
    if (!registro) {
        return undefined;
    }
    const record = registro as {
        temperature?: unknown;
        temperatura?: unknown;
        metadata?: { temperature?: unknown } | null;
        extra?: { temperature?: unknown } | null;
    };

    const directValue = record.temperature ?? record.temperatura;
    if (isLeadTemperatureTag(directValue)) {
        return directValue;
    }

    const metadataValue = record.metadata?.temperature ?? record.extra?.temperature;
    if (isLeadTemperatureTag(metadataValue)) {
        return metadataValue;
    }

    return undefined;
};

export const resolveAutomaticLeadTemperature = (
    status?: string | null,
): LeadTemperatureAuto | undefined => {
    const normalized = normalizeText(status);
    if (!normalized) {
        return undefined;
    }

    if (normalized.includes("fechado") || normalized.includes("ganho")) {
        return "fechado";
    }

    if (normalized.includes("perdido")) {
        return "perdido";
    }

    return undefined;
};

export const resolveLeadTemperature = (
    registro: object | undefined | null,
): LeadTemperatureTag | undefined => {
    const status = (registro as { status?: unknown } | null | undefined)?.status;
    const automatic = resolveAutomaticLeadTemperature(typeof status === "string" ? status : null);
    if (automatic) {
        return automatic;
    }

    const fromRecord = getLeadTemperatureFromRecord(registro);
    if (fromRecord) {
        return fromRecord;
    }

    return undefined;
};

export const resolveEditableLeadTemperature = (
    registro: object | undefined | null,
): LeadTemperature | undefined => {
    const resolved = resolveLeadTemperature(registro);
    return isLeadTemperature(resolved) ? resolved : undefined;
};
