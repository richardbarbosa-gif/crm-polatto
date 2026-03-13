import { supabaseClient } from "../utility";

export type TaskExecutionStatus =
    | "pendente"
    | "resolvido"
    | "ligar_novamente"
    | "voltar_outro_dia";

export const TASK_EXECUTION_STATUS_LABELS: Record<TaskExecutionStatus, string> = {
    pendente: "Em andamento",
    resolvido: "Resolvido",
    ligar_novamente: "Ligar de novo",
    voltar_outro_dia: "Voltar outro dia",
};

export const TASK_EXECUTION_STATUS_OPTIONS: Array<{
    value: TaskExecutionStatus;
    label: string;
}> = [
    { value: "pendente", label: TASK_EXECUTION_STATUS_LABELS.pendente },
    { value: "resolvido", label: TASK_EXECUTION_STATUS_LABELS.resolvido },
    { value: "ligar_novamente", label: TASK_EXECUTION_STATUS_LABELS.ligar_novamente },
    { value: "voltar_outro_dia", label: TASK_EXECUTION_STATUS_LABELS.voltar_outro_dia },
];

const normalizeTaskExecutionStatus = (value: unknown): TaskExecutionStatus | undefined => {
    if (value === "pendente" || value === "resolvido" || value === "ligar_novamente" || value === "voltar_outro_dia") {
        return value;
    }

    if (typeof value !== "string") {
        return undefined;
    }

    const normalized = value
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, "_");

    if (normalized === "ligar_de_novo" || normalized === "ligar_novamente") {
        return "ligar_novamente";
    }

    if (normalized === "voltar_outro_dia") {
        return "voltar_outro_dia";
    }

    if (
        normalized === "resolvido" ||
        normalized === "corrigido" ||
        normalized === "concluido" ||
        normalized === "concluida" ||
        normalized === "finalizado" ||
        normalized === "finalizada"
    ) {
        return "resolvido";
    }

    if (
        normalized === "pendente" ||
        normalized === "em_andamento" ||
        normalized === "em-andamento" ||
        normalized === "andamento"
    ) {
        return "pendente";
    }

    return undefined;
};

export const updateTaskExecutionStatus = async (
    taskId: string | number,
    status: TaskExecutionStatus,
): Promise<void> => {
    const { error } = await supabaseClient
        .from("tarefas")
        .update({ execucao_status: status })
        .eq("id", taskId);
    if (error) throw error;
};

export const resolveTaskExecutionStatus = (
    record: Record<string, any> | undefined | null,
): TaskExecutionStatus => {
    if (!record) {
        return "pendente";
    }

    const direct =
        record.execucao_status ??
        record.execution_status ??
        record.status_execucao ??
        record.status_atividade;
    const normalizedDirect = normalizeTaskExecutionStatus(direct);
    const resolved = normalizedDirect || "pendente";

    const dueDate = record.data_vencimento ?? record.due_date ?? record.data ?? record.date;
    if (resolved !== "pendente" && dueDate) {
        const due = new Date(dueDate);
        if (!Number.isNaN(due.getTime()) && due.getTime() > Date.now()) {
            return "pendente";
        }
    }

    return resolved;
};

export const hasTaskExecutionAction = (status: TaskExecutionStatus): boolean => {
    return status !== "pendente";
};

const statusListeners = new Set<() => void>();

export const subscribeTaskExecutionStatusUpdates = (callback: () => void): (() => void) => {
    statusListeners.add(callback);
    return () => {
        statusListeners.delete(callback);
    };
};

export const notifyTaskExecutionStatusUpdate = (): void => {
    statusListeners.forEach((cb) => cb());
};
