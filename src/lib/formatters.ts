export const normalizeText = (value?: string | null): string => {
    return (value ?? "").toString().trim().toLowerCase();
};

const toNumber = (value: unknown): number | null => {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }

    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const sanitized = trimmed.replace(/[^\d,.-]/g, "");
    if (!sanitized) {
        return null;
    }

    const normalized = sanitized.includes(",")
        ? sanitized.replace(/\./g, "").replace(",", ".")
        : sanitized;

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
};

export const parseCurrencyLikeValue = (value: unknown): number | null => {
    return toNumber(value);
};

export const formatCurrencyBRL = (value: unknown, fallback = "--"): string => {
    const parsed = toNumber(value);
    if (parsed === null) {
        return fallback;
    }

    return parsed.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
    });
};

export const formatDateBR = (
    value?: string | Date | null,
    fallback = "-",
): string => {
    if (!value) {
        return fallback;
    }

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return fallback;
    }

    return date.toLocaleDateString("pt-BR");
};

export const formatCpfCnpj = (value?: string | null): string => {
    const digits = (value ?? "").replace(/\D/g, "").slice(0, 14);
    if (!digits) {
        return "";
    }

    if (digits.length <= 11) {
        if (digits.length <= 3) {
            return digits;
        }

        if (digits.length <= 6) {
            return `${digits.slice(0, 3)}.${digits.slice(3)}`;
        }

        if (digits.length <= 9) {
            return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
        }

        return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
    }

    if (digits.length <= 2) {
        return digits;
    }

    if (digits.length <= 5) {
        return `${digits.slice(0, 2)}.${digits.slice(2)}`;
    }

    if (digits.length <= 8) {
        return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
    }

    if (digits.length <= 12) {
        return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
    }

    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
};

export const isClosedStatus = (status?: string | null): boolean => {
    return normalizeText(status) === "fechado";
};
