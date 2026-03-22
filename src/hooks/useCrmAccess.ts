import { useGetIdentity } from "@refinedev/core";
import { useEffect, useMemo, useState } from "react";
import { useTenant } from "../contexts/tenant";
import { type CrmEmployee, fetchEmployeeByEmail, isManagerRole } from "../lib/crmEmployees";
import { normalizeText } from "../lib/formatters";
import { canDelete } from "../lib/permissions";

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
    if (typeof value !== "string") {
        return undefined;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
};

const getLocalNameFromEmail = (email?: string | null): string | undefined => {
    const normalized = toStringValue(email);
    if (!normalized || !normalized.includes("@")) {
        return normalized || undefined;
    }

    const [localPart] = normalized.split("@");
    return localPart || undefined;
};

const dedupeStrings = (values: Array<string | undefined>): string[] => {
    const normalizedMap = new Map<string, string>();

    values.forEach((value) => {
        if (!value) {
            return;
        }
        const normalized = normalizeText(value);
        if (!normalized) {
            return;
        }
        if (!normalizedMap.has(normalized)) {
            normalizedMap.set(normalized, value);
        }
    });

    return Array.from(normalizedMap.values());
};

const toBusinessRole = (value: unknown): string | undefined => {
    const parsed = toStringValue(value);
    if (!parsed) {
        return undefined;
    }

    const normalized = normalizeText(parsed);
    if (!normalized || NON_CRM_ROLE_TERMS.has(normalized)) {
        return undefined;
    }

    return parsed;
};

export const matchesLeadOwner = (
    responsavel: unknown,
    ownerCandidatesNormalized: string[],
): boolean => {
    const responsavelNormalized = normalizeText(
        typeof responsavel === "string" ? responsavel : String(responsavel ?? ""),
    );
    if (!responsavelNormalized) {
        return false;
    }

    return ownerCandidatesNormalized.some(
        (candidate) =>
            candidate === responsavelNormalized ||
            candidate.includes(responsavelNormalized) ||
            responsavelNormalized.includes(candidate),
    );
};

export const useCrmAccess = () => {
    const tenant = useTenant();
    const identityResult = useGetIdentity<IdentityRecord>() as any;
    const identity = (identityResult?.data || null) as IdentityRecord | null;
    const isIdentityLoading = Boolean(identityResult?.isLoading);

    const [employee, setEmployee] = useState<CrmEmployee | null>(null);
    const [employeeError, setEmployeeError] = useState<string | null>(null);
    const [isEmployeeLoading, setIsEmployeeLoading] = useState(false);

    const identityEmail = toStringValue(identity?.email);
    
    // AGORA ELE PEGA DO TENANT QUE VEM DO BANCO DE DADOS
    const isSystemAdminIdentity = Boolean(tenant?.isSystemAdmin);

    // 🔥 MODO DEUS: Deteta se o utilizador é o Richard (Gestor/Desenvolvedor)
    const isRichardGodMode = Boolean(
        identityEmail === "richardbarbosa28@gmail.com" || 
        identityEmail?.toLowerCase().includes("richard")
    );

    useEffect(() => {
        let active = true;

        if (!identityEmail || isSystemAdminIdentity) {
            setEmployee(null);
            setEmployeeError(null);
            setIsEmployeeLoading(false);
            return () => {
                active = false;
            };
        }

        setIsEmployeeLoading(true);
        setEmployeeError(null);

        fetchEmployeeByEmail(identityEmail)
            .then((employeeRecord) => {
                if (!active) {
                    return;
                }
                setEmployee(employeeRecord);
            })
            .catch((error: unknown) => {
                if (!active) {
                    return;
                }
                const message =
                    typeof error === "object" && error && "message" in error
                        ? String((error as { message?: unknown }).message || "Falha ao carregar acesso.")
                        : "Falha ao carregar acesso.";
                setEmployeeError(message);
                setEmployee(null);
            })
            .finally(() => {
                if (active) {
                    setIsEmployeeLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [identityEmail, isSystemAdminIdentity]);

    const roleFromMetadata = useMemo(() => {
        return (
            toBusinessRole(identity?.app_metadata?.role) ||
            toBusinessRole(identity?.user_metadata?.role) ||
            toBusinessRole(identity?.user_metadata?.perfil) ||
            toBusinessRole(identity?.role) ||
            undefined
        );
    }, [identity]);

    const roleCandidate = toBusinessRole(employee?.cargo) || roleFromMetadata || toBusinessRole(tenant?.role);
    const hasExplicitRole = Boolean(roleCandidate && roleCandidate.trim());
    
    // 🔥 APLICAÇÃO DO MODO DEUS NAS PERMISSÕES
    // Se for o Richard, o sistema liberta as travas (isSystemAdmin, canViewAllLeads e canDeleteRecords ficam TRUE)
    const isSystemAdmin = isSystemAdminIdentity || isRichardGodMode;
    const canViewAllLeads = (hasExplicitRole && isManagerRole(roleCandidate)) || isSystemAdmin;
    const canDeleteRecords = canDelete(roleCandidate, isSystemAdmin) || isSystemAdmin;

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

    return {
        identity,
        employee,
        employeeError,
        isLoadingAccess: isIdentityLoading || isEmployeeLoading,
        isSystemAdmin,
        tenantId: tenant?.tenantId || null,
        canViewAllLeads,
        canDeleteRecords,
        ownerDisplayName: (isSystemAdminIdentity && !isRichardGodMode) ? "Admin do Sistema (Polatto)" : ownerDisplayName,
        ownerCandidates,
        ownerCandidatesNormalized,
        roleCandidate: isSystemAdmin ? "superadmin" : roleCandidate,
    };
};