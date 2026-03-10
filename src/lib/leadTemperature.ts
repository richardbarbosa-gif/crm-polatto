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
    record: Record<string, any> | undefined | null,
): LeadTemperatureTag | undefined => {
    if (!record) {
        return undefined;
    }

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
    record: Record<string, any> | undefined | null,
): LeadTemperatureTag | undefined => {
    const automatic = resolveAutomaticLeadTemperature(record?.status);
    if (automatic) {
        return automatic;
    }

    const fromRecord = getLeadTemperatureFromRecord(record);
    if (fromRecord) {
        return fromRecord;
    }

    return undefined;
};

export const resolveEditableLeadTemperature = (
    record: Record<string, any> | undefined | null,
): LeadTemperature | undefined => {
    const resolved = resolveLeadTemperature(record);
    return isLeadTemperature(resolved) ? resolved : undefined;
};
