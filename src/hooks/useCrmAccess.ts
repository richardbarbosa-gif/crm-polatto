import { useGetIdentity } from "@refinedev/core";
import { useEffect, useMemo, useState } from "react";
import { type CrmEmployee, fetchEmployeeByEmail, isManagerRole } from "../lib/crmEmployees";
import { normalizeText } from "../lib/formatters";

type IdentityRecord = {
    email?: string | null;
    name?: string | null;
    role?: string | null;
    app_metadata?: Record<string, unknown>;
    user_metadata?: Record<string, unknown>;
    [key: string]: unknown;
};

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
    const identityResult = useGetIdentity<IdentityRecord>() as any;
    const identity = (identityResult?.data || null) as IdentityRecord | null;
    const isIdentityLoading = Boolean(identityResult?.isLoading);

    const [employee, setEmployee] = useState<CrmEmployee | null>(null);
    const [employeeError, setEmployeeError] = useState<string | null>(null);
    const [isEmployeeLoading, setIsEmployeeLoading] = useState(false);

    const identityEmail = toStringValue(identity?.email);

    useEffect(() => {
        let active = true;

        if (!identityEmail) {
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
    }, [identityEmail]);

    const roleFromMetadata = useMemo(() => {
        return (
            toStringValue(identity?.role) ||
            toStringValue(identity?.app_metadata?.role) ||
            toStringValue(identity?.user_metadata?.role) ||
            toStringValue(identity?.user_metadata?.perfil) ||
            undefined
        );
    }, [identity]);

    const roleCandidate = employee?.cargo || roleFromMetadata;
    const canViewAllLeads = isManagerRole(roleCandidate);

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
        canViewAllLeads,
        ownerDisplayName,
        ownerCandidates,
        ownerCandidatesNormalized,
        roleCandidate,
    };
};
