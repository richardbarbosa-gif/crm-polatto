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
    const rawId = row.id;

    return {
        id: rawId === undefined || rawId === null ? `${sourceTable}-${nome}` : String(rawId),
        nome,
        email,
        cargo,
        ativo,
        sourceTable,
        raw: row,
    };
};

const mapRows = (rows: Record<string, unknown>[], sourceTable: EmployeeSourceTable): CrmEmployee[] => {
    return rows.map((row) => mapEmployee(row, sourceTable));
};

const fetchTableRows = async (
    table: EmployeeSourceTable,
): Promise<{ rows: Record<string, unknown>[]; missing: boolean }> => {
    const { data, error } = await supabaseClient.from(table).select("*");

    if (error) {
        if (isSupabaseMissingRelation(error)) {
            return { rows: [], missing: true };
        }
        throw error;
    }

    return { rows: (data || []) as Record<string, unknown>[], missing: false };
};

export const fetchEmployeesDirectory = async (): Promise<{
    employees: CrmEmployee[];
    sourceTable: EmployeeSourceTable | null;
}> => {
    const primary = await fetchTableRows("funcionarios");
    if (!primary.missing) {
        return {
            employees: mapRows(primary.rows, "funcionarios"),
            sourceTable: "funcionarios",
        };
    }

    const legacy = await fetchTableRows("crm_employees");
    if (!legacy.missing) {
        return {
            employees: mapRows(legacy.rows, "crm_employees"),
            sourceTable: "crm_employees",
        };
    }

    return { employees: [], sourceTable: null };
};

const lookupByEmailInTable = async (
    table: EmployeeSourceTable,
    email: string,
): Promise<CrmEmployee | null> => {
    const emailColumns = ["email", "usuario_email"];

    for (const column of emailColumns) {
        const { data, error } = await supabaseClient
            .from(table)
            .select("*")
            .eq(column, email)
            .limit(1)
            .maybeSingle();

        if (error) {
            if (isSupabaseMissingRelation(error)) {
                return null;
            }
            if (isSupabaseMissingColumn(error)) {
                continue;
            }
            throw error;
        }

        if (data) {
            return mapEmployee(data as Record<string, unknown>, table);
        }
    }

    return null;
};

export const fetchEmployeeByEmail = async (email?: string | null): Promise<CrmEmployee | null> => {
    const normalizedEmail = toTrimmedString(email)?.toLowerCase();
    if (!normalizedEmail) {
        return null;
    }

    const fromPrimary = await lookupByEmailInTable("funcionarios", normalizedEmail);
    if (fromPrimary) {
        return fromPrimary;
    }

    const fromLegacy = await lookupByEmailInTable("crm_employees", normalizedEmail);
    if (fromLegacy) {
        return fromLegacy;
    }

    return null;
};

export const isManagerRole = (role?: string | null): boolean => {
    const normalized = normalizeText(role);
    if (!normalized) {
        return false;
    }

    return MANAGER_ROLE_TERMS.some((term) => normalized.includes(term));
};
