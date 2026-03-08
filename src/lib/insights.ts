import dayjs, { type Dayjs } from "dayjs";
import { normalizeText, parseCurrencyLikeValue } from "./formatters";
import type { TaskExecutionStatus } from "./taskExecutionStatus";

export interface InsightClienteRecord {
    id: string | number;
    nome?: string | null;
    status?: string | null;
    responsavel?: string | null;
    responsavel_id?: string | null;
    conta_energia_media?: string | number | null;
    created_at?: string | null;
    updated_at?: string | null;
    motivo_perda?: string | null;
}

export interface InsightTaskRecord {
    id: string | number;
    cliente_id?: string | number | null;
    titulo?: string | null;
    tipo?: string | null;
    descricao?: string | null;
    data_vencimento?: string | null;
    created_at?: string | null;
    responsavel?: string | null;
}

export interface InsightStatusHistoryRecord {
    id: string | number;
    cliente_id?: string | number | null;
    de_status?: string | null;
    para_status?: string | null;
    movido_em?: string | null;
    movido_por?: string | null;
}

export type OwnerPerformance = {
    owner_id: string | null;
    owner: string;
    total: number;
    ganhos: number;
    perdas: number;
    ativos: number;
    valor: number;
};

export type TaskSituation = "atrasada" | "tratada" | "hoje" | "proxima" | "futura";

const OPEN_STATUS_TERMS = ["novo", "negoci", "visita", "proposta", "qualific"];

export const isWonStatus = (status?: string | null): boolean => {
    const value = normalizeText(status);
    return value.includes("fechado") || value.includes("ganho");
};

export const isLostStatus = (status?: string | null): boolean => {
    return normalizeText(status).includes("perdido");
};

export const isOpenStatus = (status?: string | null): boolean => {
    const value = normalizeText(status);
    if (!value) return true;
    if (isWonStatus(value) || isLostStatus(value)) return false;
    return OPEN_STATUS_TERMS.some((term) => value.includes(term));
};

export const getInsightValue = (value: unknown): number => {
    return parseCurrencyLikeValue(value) ?? 0;
};

export const toSafeDayjs = (value?: string | Date | null): Dayjs | null => {
    if (!value) return null;
    const parsed = dayjs(value);
    return parsed.isValid() ? parsed : null;
};

export const isDateInLastDays = (value: string | Date | null | undefined, days: number, now = dayjs()): boolean => {
    const parsed = toSafeDayjs(value);
    if (!parsed) return false;
    return parsed.isAfter(now.subtract(days, "day"));
};

export const isDateInMonth = (value: string | Date | null | undefined, monthRef: Dayjs): boolean => {
    const parsed = toSafeDayjs(value);
    if (!parsed) return false;
    return parsed.isSame(monthRef, "month");
};

export const getMonthStart = (monthRef: Dayjs): string => {
    return monthRef.startOf("month").format("YYYY-MM-DD");
};

export const getMonthKey = (value?: string | Date | null): string | null => {
    const parsed = toSafeDayjs(value);
    if (!parsed) return null;
    return parsed.format("YYYY-MM");
};

export const toOwnerKey = (value?: string | null): string => {
    return normalizeText(value) || "sem-responsavel";
};

export const toOwnerLabel = (value?: string | null): string => {
    const normalized = normalizeText(value);
    return normalized ? (value?.trim() || "Sem responsavel") : "Sem responsavel";
};

export const buildOwnerPerformance = (clientes: InsightClienteRecord[]): OwnerPerformance[] => {
    const map = new Map<string, OwnerPerformance>();

    clientes.forEach((cliente) => {
        // Mágica: Usa o ID se existir. Se não, faz fallback para o texto antigo.
        const key = cliente.responsavel_id ? String(cliente.responsavel_id) : toOwnerKey(cliente.responsavel);
        
        const current = map.get(key) || {
            owner_id: cliente.responsavel_id ? String(cliente.responsavel_id) : null,
            owner: toOwnerLabel(cliente.responsavel),
            total: 0,
            ganhos: 0,
            perdas: 0,
            ativos: 0,
            valor: 0,
        };

        current.total += 1;
        current.valor += getInsightValue(cliente.conta_energia_media);

        if (isWonStatus(cliente.status)) {
            current.ganhos += 1;
        } else if (isLostStatus(cliente.status)) {
            current.perdas += 1;
        } else {
            current.ativos += 1;
        }

        map.set(key, current);
    });

    return Array.from(map.values()).sort((first, second) => second.valor - first.valor);
};

export const getTaskSituation = (dueDate?: string | null, now = dayjs(), executionStatus: TaskExecutionStatus = "pendente"): TaskSituation => {
    const due = toSafeDayjs(dueDate);
    if (!due) return "futura";
    if (due.isBefore(now, "minute")) {
        if (executionStatus !== "pendente") return "tratada";
        return "atrasada";
    }
    if (due.isSame(now, "day")) return "hoje";
    if (due.isBefore(now.add(2, "day"), "day")) return "proxima";
    return "futura";
};

export const isTaskOverdue = (dueDate?: string | null, now = dayjs()): boolean => {
    const due = toSafeDayjs(dueDate);
    if (!due) return false;
    return due.isBefore(now, "minute");
};

export const sortByDateDesc = <T>(records: T[], dateSelector: (record: T) => string | null | undefined): T[] => {
    return [...records].sort((first, second) => {
        const firstDate = toSafeDayjs(dateSelector(first));
        const secondDate = toSafeDayjs(dateSelector(second));
        if (!firstDate && !secondDate) return 0;
        if (!firstDate) return 1;
        if (!secondDate) return -1;
        return secondDate.valueOf() - firstDate.valueOf();
    });
};