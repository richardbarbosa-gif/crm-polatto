import { normalizeText } from "./formatters";
import { isSupabaseMissingColumn, isSupabaseMissingRelation } from "./supabaseErrors";
import { supabaseClient } from "../utility";

export type EmployeeSourceTable = "funcionarios" | "crm_employees";

export type CrmEmployee = {
    id: string;
    nome: string;
    email?: string;
    cargo?: string;
    ativo: boolean;
    meta?: string | number; // <--- ADICIONADO
    sourceTable: EmployeeSourceTable;
    raw: Record<string, unknown>;
};

const MANAGER_ROLE_TERMS = [
    "gestor",
    "manager",
    "gerente",
    "admin",
    "diretor",
    "lider",
    "supervisor",
    "owner",
];

const toTrimmedString = (value: unknown): string | undefined => {
    if (typeof value !== "string") {
        return undefined;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
};

const firstString = (...values: unknown[]): string | undefined => {
    for (const value of values) {
        const parsed = toTrimmedString(value);
        if (parsed) {
            return parsed;
        }
    }

    return undefined;
};

const firstBoolean = (...values: unknown[]): boolean | undefined => {
    for (const value of values) {
        if (typeof value === "boolean") {
            return value;
        }
    }
    return undefined;
};

const mapEmployee = (row: Record<string, unknown>, sourceTable: EmployeeSourceTable): CrmEmployee => {
    const nome = firstString(row.nome, row.full_name, row.name, row.usuario) || "Sem nome";
    const email = firstString(row.email, row.usuario_email);
    const cargo = firstString(row.cargo, row.role, row.perfil, row.tipo);
    const ativo = firstBoolean(row.ativo, row.active, row.is_active) ?? true;
    const meta = row.meta as string | number | undefined; // <--- ADICIONADO
    const rawId = row.id;

    return {
        id: rawId === undefined || rawId === null ? `${sourceTable}-${nome}` : String(rawId),
        nome,
        email,
        cargo,
        ativo,
        meta, // <--- ADICIONADO
        sourceTable,
        raw: row,
    };
};

// ... O restante do arquivo continua igual (mapRows, fetchTableRows, etc.) ...