import { useGetIdentity } from "@refinedev/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTenant } from "../contexts/tenant";
import { type CrmEmployee, fetchEmployeeByEmail } from "../lib/crmEmployees";
import { normalizeText } from "../lib/formatters";
import { canDelete, ehPapelGerente, podeExcluirRegistro, type RegistroComDono } from "../lib/permissions";

type IdentityRecord = {
    email?: string | null;
    name?: string | null;
    role?: string | null;
    app_metadata?: Record<string, unknown>;
    user_metadata?: Record<string, unknown>;
    [key: string]: unknown;
};

const NON_CRM_ROLE_TERMS = new Set(["authenticated", "anon", "service_role", "supabase_admin"]);

const toStringValue = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
};

const getLocalNameFromEmail = (email?: string | null): string | undefined => {
    const normalized = toStringValue(email);
    if (!normalized || !normalized.includes("@")) return normalized || undefined;
    const [localPart] = normalized.split("@");
    return localPart || undefined;
};

const dedupeStrings = (values: Array<string | undefined>): string[] => {
    const normalizedMap = new Map<string, string>();
    values.forEach((value) => {
        if (!value) return;
        const normalized = normalizeText(value);
        if (!normalized) return;
        if (!normalizedMap.has(normalized)) normalizedMap.set(normalized, value);
    });
    return Array.from(normalizedMap.values());
};

const toBusinessRole = (value: unknown): string | undefined => {
    const parsed = toStringValue(value);
    if (!parsed) return undefined;
    const normalized = normalizeText(parsed);
    if (!normalized || NON_CRM_ROLE_TERMS.has(normalized)) return undefined;
    return parsed;
};

export const matchesLeadOwner = (
    responsavel: unknown,
    ownerCandidatesNormalized: string[],
): boolean => {
    const responsavelNormalized = normalizeText(
        typeof responsavel === "string" ? responsavel : String(responsavel ?? ""),
    );
    if (!responsavelNormalized) return false;

    return ownerCandidatesNormalized.some(
        (candidate) =>
            candidate === responsavelNormalized ||
            candidate.includes(responsavelNormalized) ||
            responsavelNormalized.includes(candidate),
    );
};

export const useCrmAccess = () => {
    const tenant = useTenant();
    const identityResult = useGetIdentity<IdentityRecord>();
    const identity = identityResult.data ?? null;
    const isIdentityLoading = Boolean(identityResult.isLoading);

    const [employee, setEmployee] = useState<CrmEmployee | null>(null);
    const [employeeError, setEmployeeError] = useState<string | null>(null);
    const [isEmployeeLoading, setIsEmployeeLoading] = useState(false);

    const identityEmail = toStringValue(identity?.email);
    
    // Agora vem do BANCO via TenantProvider → checkIsSystemAdmin()
    const isSystemAdmin = Boolean(tenant?.isSystemAdmin);

    useEffect(() => {
        let active = true;

        if (!identityEmail || isSystemAdmin) {
            setEmployee(null);
            setEmployeeError(null);
            setIsEmployeeLoading(false);
            return () => { active = false; };
        }

        setIsEmployeeLoading(true);
        setEmployeeError(null);

        fetchEmployeeByEmail(identityEmail)
            .then((employeeRecord) => {
                if (!active) return;
                setEmployee(employeeRecord);
            })
            .catch((error: unknown) => {
                if (!active) return;
                const message =
                    typeof error === "object" && error && "message" in error
                        ? String((error as { message?: unknown }).message || "Falha ao carregar acesso.")
                        : "Falha ao carregar acesso.";
                setEmployeeError(message);
                setEmployee(null);
            })
            .finally(() => {
                if (active) setIsEmployeeLoading(false);
            });

        return () => { active = false; };
    }, [identityEmail, isSystemAdmin]);

    // Papel = vínculo do usuário com a empresa ATIVA (utilizadores_empresas.role),
    // a mesma fonte que o banco usa em eh_admin_do_tenant(). funcionarios.cargo e
    // user_metadata são editáveis pelo próprio usuário e NÃO concedem permissão.
    const roleCandidate = toBusinessRole(tenant?.role);
    const isGerente = isSystemAdmin || ehPapelGerente(roleCandidate);

    // Regra do Richard (2026-11-03): todo vendedor vê os leads da empresa inteira.
    const canViewAllLeads = true;
    // Excluir QUALQUER registro e mexer na configuração: só gerente.
    const canDeleteRecords = canDelete(roleCandidate, isSystemAdmin);
    const userId = toStringValue(identity?.id) || null;

    const ownerCandidates = useMemo(() => {
        const identityName =
            toStringValue(identity?.name) ||
            toStringValue(identity?.user_metadata?.full_name) ||
            toStringValue(identity?.user_metadata?.name);

        return dedupeStrings([
            employee?.nome,
            identityName,
            identityEmail,
            employee?.email,
            getLocalNameFromEmail(identityEmail),
            getLocalNameFromEmail(employee?.email),
        ]);
    }, [employee?.email, employee?.nome, identity, identityEmail]);

    const ownerCandidatesNormalized = useMemo<string[]>(
        () =>
            ownerCandidates
                .map((value) => normalizeText(value))
                .filter((value): value is string => Boolean(value)),
        [ownerCandidates],
    );

    const ownerDisplayName = ownerCandidates[0] || "Vendedor";

    // Para decidir "é meu?" a tela usa só o que o banco também reconhece
    // (registro_eh_do_usuario): nome e e-mail do funcionário e o e-mail do login.
    const nomesDoDono = useMemo<string[]>(
        () =>
            [employee?.nome, employee?.email, identityEmail]
                .map((value) => normalizeText(value))
                .filter((value): value is string => Boolean(value)),
        [employee?.email, employee?.nome, identityEmail],
    );

    const podeExcluir = useCallback(
        (registro: RegistroComDono | null | undefined) =>
            podeExcluirRegistro(registro, {
                ehGerente: isGerente,
                userId,
                funcionarioId: employee?.id || null,
                nomesNormalizados: nomesDoDono,
            }),
        [employee?.id, isGerente, nomesDoDono, userId],
    );

    return {
        identity,
        employee,
        employeeError,
        isLoadingAccess: isIdentityLoading || isEmployeeLoading,
        isSystemAdmin,
        tenantId: tenant?.tenantId || null,
        canViewAllLeads,
        canDeleteRecords,
        isGerente,
        userId,
        podeExcluir,
        ownerDisplayName,
        ownerCandidates,
        ownerCandidatesNormalized,
        roleCandidate: isSystemAdmin ? "superadmin" : roleCandidate,
    };
};