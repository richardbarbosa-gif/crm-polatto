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

type TaskExecutionStatusMap = Record<string, TaskExecutionStatus>;

const STORAGE_KEY = "crm-polatto:task-execution-status:v1";
const UPDATE_EVENT = "crm-polatto:task-execution-status-updated";

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

const toStorageKey = (id?: string | number | null): string | undefined => {
    if (id === null || id === undefined) {
        return undefined;
    }
    return String(id);
};

const readStorage = (): TaskExecutionStatusMap => {
    if (typeof window === "undefined") {
        return {};
    }

    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return {};
        }

        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const safeMap: TaskExecutionStatusMap = {};

        Object.entries(parsed).forEach(([key, value]) => {
            const normalized = normalizeTaskExecutionStatus(value);
            if (normalized) {
                safeMap[key] = normalized;
            }
        });

        return safeMap;
    } catch {
        return {};
    }
};

const writeStorage = (map: TaskExecutionStatusMap) => {
    if (typeof window === "undefined") {
        return;
    }

    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
        // Ignore persistence failures and keep UI responsive.
    }
};

const emitStatusUpdate = () => {
    if (typeof window === "undefined") {
        return;
    }

    window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
};

export const subscribeTaskExecutionStatusUpdates = (onUpdate: () => void) => {
    if (typeof window === "undefined") {
        return () => undefined;
    }

    const handler = () => onUpdate();
    window.addEventListener(UPDATE_EVENT, handler);
    window.addEventListener("storage", handler);

    return () => {
        window.removeEventListener(UPDATE_EVENT, handler);
        window.removeEventListener("storage", handler);
    };
};

export const getTaskExecutionStatus = (
    taskId?: string | number | null,
): TaskExecutionStatus => {
    const key = toStorageKey(taskId);
    if (!key) {
        return "pendente";
    }

    const map = readStorage();
    return map[key] || "pendente";
};

export const setTaskExecutionStatus = (
    taskId: string | number,
    status: TaskExecutionStatus,
): void => {
    const key = toStorageKey(taskId);
    if (!key) {
        return;
    }

    const map = readStorage();

    if (status === "pendente") {
        delete map[key];
    } else {
        map[key] = status;
    }

    writeStorage(map);
    emitStatusUpdate();
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
    const resolved = normalizedDirect || getTaskExecutionStatus(record.id);

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
