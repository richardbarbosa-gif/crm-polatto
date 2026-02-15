export type LeadTemperature = "frio" | "morno" | "quente";

const STORAGE_KEY = "crm-polatto:lead-temperature:v1";

export const LEAD_TEMPERATURE_LABELS: Record<LeadTemperature, string> = {
    frio: "Frio",
    morno: "Morno",
    quente: "Quente",
};

export const LEAD_TEMPERATURE_OPTIONS: Array<{
    value: LeadTemperature;
    label: string;
}> = [
    { value: "frio", label: "Frio" },
    { value: "morno", label: "Morno" },
    { value: "quente", label: "Quente" },
];

type TemperatureMap = Record<string, LeadTemperature>;

export const isLeadTemperature = (value: unknown): value is LeadTemperature => {
    return value === "frio" || value === "morno" || value === "quente";
};

const toStorageKey = (id?: string | number | null): string | undefined => {
    if (id === null || id === undefined) {
        return undefined;
    }
    return String(id);
};

const readStorage = (): TemperatureMap => {
    if (typeof window === "undefined") {
        return {};
    }

    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return {};
        }

        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const safeMap: TemperatureMap = {};

        Object.entries(parsed).forEach(([key, value]) => {
            if (isLeadTemperature(value)) {
                safeMap[key] = value;
            }
        });

        return safeMap;
    } catch {
        return {};
    }
};

const writeStorage = (map: TemperatureMap): void => {
    if (typeof window === "undefined") {
        return;
    }

    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
        // Ignore write failures to avoid blocking UI.
    }
};

export const getLeadTemperatureMap = (): TemperatureMap => {
    return readStorage();
};

export const getLeadTemperature = (
    id?: string | number | null,
): LeadTemperature | undefined => {
    const key = toStorageKey(id);
    if (!key) {
        return undefined;
    }

    const map = readStorage();
    return map[key];
};

export const setLeadTemperature = (
    id: string | number,
    value?: LeadTemperature | null,
): void => {
    const key = toStorageKey(id);
    if (!key) {
        return;
    }

    const map = readStorage();

    if (value && isLeadTemperature(value)) {
        map[key] = value;
    } else {
        delete map[key];
    }

    writeStorage(map);
};

export const getLeadTemperatureFromRecord = (
    record: Record<string, any> | undefined | null,
): LeadTemperature | undefined => {
    if (!record) {
        return undefined;
    }

    const directValue = record.temperature ?? record.temperatura;
    if (isLeadTemperature(directValue)) {
        return directValue;
    }

    const metadataValue = record.metadata?.temperature ?? record.extra?.temperature;
    if (isLeadTemperature(metadataValue)) {
        return metadataValue;
    }

    return undefined;
};

export const resolveLeadTemperature = (
    record: Record<string, any> | undefined | null,
): LeadTemperature | undefined => {
    const fromRecord = getLeadTemperatureFromRecord(record);
    if (fromRecord) {
        return fromRecord;
    }

    return getLeadTemperature(record?.id);
};
