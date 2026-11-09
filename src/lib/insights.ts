import dayjs, { type Dayjs } from "dayjs";
import { normalizeText, parseCurrencyLikeValue } from "./formatters";
import { classificarDesfecho, valorDoLead, type EtapaFunil } from "./pipelineMetrics";
import type { TaskExecutionStatus } from "./taskExecutionStatus";

export interface InsightClienteRecord {
    id: string | number;
    nome?: string | null;
    status?: string | null;
    stage_id?: string | number | null;
    responsavel?: string | null;
    responsavel_id?: string | null;
    valor?: string | number | null;
    conta_energia_media?: string | number | null;
    created_at?: string | null;
    updated_at?: string | null;
    data_fechamento?: string | null;
    motivo_perda?: string | null;
}

/** Colunas que os relatórios usam (evita select * da base inteira). */
export const COLUNAS_INSIGHT_CLIENTE =
    "id,nome,status,stage_id,responsavel,responsavel_id,valor,conta_energia_media,created_at,data_fechamento,motivo_perda";

/**
 * Data em que o negócio foi decidido (ganho/perdido). Sem data de
 * fechamento gravada, cai para a criação.
 */
export const dataDeDecisao = (cliente: InsightClienteRecord): string | null | undefined =>
    cliente.data_fechamento || cliente.created_at;

export interface InsightTaskRecord {
    id: string | number;
    cliente_id?: string | number | null;
    titulo?: string | null;
    tipo?: string | null;
    descricao?: string | null;
    data_vencimento?: string | null;
    created_at?: string | null;
    responsavel?: string | null;
    concluido?: boolean | null;
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
    /** Valor de todos os negócios do responsável (carteira). */
    valor: number;
    /** Valor só dos negócios ganhos (receita). */
    valorGanho: number;
};

export type TaskSituation = "atrasada" | "tratada" | "hoje" | "proxima" | "futura";


export const isWonStatus = (status?: string | null): boolean => {
    const value = normalizeText(status);
    return value.includes("fechado") || value.includes("ganho");
};

export const isLostStatus = (status?: string | null): boolean => {
    return normalizeText(status).includes("perdido");
};

/**
 * Em aberto = nem ganho nem perdido. Antes exigia que o nome da etapa
 * contivesse "novo", "negoci", "visita"...: etapas personalizadas como
 * "Contato inicial" ficavam fora do pipeline aberto do painel.
 */
export const isOpenStatus = (status?: string | null): boolean =>
    !isWonStatus(status) && !isLostStatus(status);

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
    return normalized ? (value?.trim() || "Sem responsável") : "Sem responsável";
};

/**
 * Desempenho por responsável. O desfecho usa os flags ganho/perdido da
 * etapa quando `etapasPorId` é informado (sem ele, o texto do status) e o
 * valor é o do negócio (valorDoLead), não a conta de luz.
 */
export const buildOwnerPerformance = (
    clientes: InsightClienteRecord[],
    etapasPorId: Map<string, EtapaFunil> = new Map(),
): OwnerPerformance[] => {
    const map = new Map<string, OwnerPerformance>();

    clientes.forEach((cliente) => {
        // Usa o id do responsável quando existe; senão, o nome (dado antigo).
        const key = cliente.responsavel_id ? String(cliente.responsavel_id) : toOwnerKey(cliente.responsavel);

        const current = map.get(key) || {
            owner_id: cliente.responsavel_id ? String(cliente.responsavel_id) : null,
            owner: toOwnerLabel(cliente.responsavel),
            total: 0,
            ganhos: 0,
            perdas: 0,
            ativos: 0,
            valor: 0,
            valorGanho: 0,
        };

        const valor = valorDoLead(cliente);
        current.total += 1;
        current.valor += valor;

        const desfecho = classificarDesfecho(cliente, etapasPorId);
        if (desfecho === "ganho") {
            current.ganhos += 1;
            current.valorGanho += valor;
        } else if (desfecho === "perdido") {
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