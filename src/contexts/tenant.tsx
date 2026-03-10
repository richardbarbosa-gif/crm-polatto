import { useGetIdentity } from "@refinedev/core";
import { Result, Spin } from "antd";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { isSupabaseMissingColumn, isSupabaseMissingRelation } from "../lib/supabaseErrors";
import type { UsuarioEmpresa } from "../types/db";
import { supabaseClient } from "../utility";

// A CONSTANTE COM SEU E-MAIL FOI DELETADA DAQUI!

type IdentityRecord = {
    id?: string | null;
    email?: string | null;
    [key: string]: unknown;
};

type TenantContextValue = {
    tenantId: string | null;
    role: string | null;
    membership: UsuarioEmpresa | null;
    isSystemAdmin: boolean;
    isLoading: boolean;
    error: string | null;
    canAccessTenant: boolean;
    identityEmail: string | null;
    identityUserId: string | null;
    refresh: () => Promise<void>;
};

const TenantContext = createContext<TenantContextValue | null>(null);

const toStringValue = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
};

const firstString = (...values: unknown[]): string | null => {
    for (const value of values) {
        const parsed = toStringValue(value);
        if (parsed) return parsed;
    }
    return null;
};

const mapMembership = (row: Record<string, unknown>): UsuarioEmpresa => {
    const tenantId = firstString(
        row.tenant_id, row.empresa_id, row.company_id, row.organizacao_id, row.id_empresa, row.id_tenant
    );
    const role = firstString(row.role, row.perfil, row.cargo, row.tipo, row.funcao);
    const userId = firstString(row.user_id, row.usuario_id, row.utilizador_id, row.id_usuario);
    const email = firstString(row.email, row.usuario_email, row.utilizador_email);
    const rawId = firstString(row.id, row.uuid) || "membership";

    return { id: rawId, tenant_id: tenantId, role, user_id: userId, email, raw: row };
};

const findMembershipByColumn = async (column: string, value: string): Promise<UsuarioEmpresa | null> => {
    const { data, error } = await supabaseClient
        .from("utilizadores_empresas")
        .select("*")
        .eq(column, value)
        .limit(1)
        .maybeSingle();

    if (error) {
        if (isSupabaseMissingRelation(error) || isSupabaseMissingColumn(error)) return null;
        throw error;
    }

    return data ? mapMembership(data as Record<string, unknown>) : null;
};

const fetchMembership = async (userId?: string | null, email?: string | null): Promise<UsuarioEmpresa | null> => {
    const userIdColumns = ["user_id", "usuario_id", "utilizador_id", "id_usuario", "id_utilizador"];
    const emailColumns = ["email", "usuario_email", "utilizador_email"];

    const normalizedUserId = toStringValue(userId);
    if (normalizedUserId) {
        for (const column of userIdColumns) {
            const member = await findMembershipByColumn(column, normalizedUserId);
            if (member) return member;
        }
    }

    const normalizedEmail = toStringValue(email)?.toLowerCase();
    if (normalizedEmail) {
        for (const column of emailColumns) {
            const member = await findMembershipByColumn(column, normalizedEmail);
            if (member) return member;
        }
    }

    return null;
};

type TenantProviderProps = { children: React.ReactNode };

export const TenantProvider = ({ children }: TenantProviderProps) => {
    const identityResult = useGetIdentity<IdentityRecord>() as any;
    const identity = (identityResult?.data || null) as IdentityRecord | null;
    const isIdentityLoading = Boolean(identityResult?.isLoading);

    const identityEmail = toStringValue(identity?.email)?.toLowerCase() || null;
    const identityUserId = toStringValue(identity?.id);

    const [membership, setMembership] = useState<UsuarioEmpresa | null>(null);
    const [isMembershipLoading, setIsMembershipLoading] = useState(false);
    const [membershipError, setMembershipError] = useState<string | null>(null);

    const loadMembership = async () => {
        if (!identityEmail && !identityUserId) {
            setMembership(null);
            setMembershipError(null);
            setIsMembershipLoading(false);
            window.localStorage.removeItem("crm_tenant_id"); // Limpa tenant_id global
            return;
        }

        setIsMembershipLoading(true);
        setMembershipError(null);

        try {
            const nextMembership = await fetchMembership(identityUserId, identityEmail);
            setMembership(nextMembership);
            
            // Registra o tenant_id globalmente para o interceptador do Supabase ler
            if (nextMembership?.tenant_id) {
                window.localStorage.setItem("crm_tenant_id", nextMembership.tenant_id);
            } else {
                window.localStorage.removeItem("crm_tenant_id");
            }

        } catch (error: unknown) {
            const message = typeof error === "object" && error && "message" in error
                ? String((error as { message?: unknown }).message || "Falha ao carregar vinculo do tenant.")
                : "Falha ao carregar vinculo do tenant.";
            setMembershipError(message);
            setMembership(null);
            window.localStorage.removeItem("crm_tenant_id");
        } finally {
            setIsMembershipLoading(false);
        }
    };

    useEffect(() => {
        void loadMembership();
    }, [identityEmail, identityUserId]);

    const tenantId = membership?.tenant_id || null;
    const role = membership?.role || null;
    
    // AGORA O ADMIN VEM EXCLUSIVAMENTE DO BANCO (ROLE)
    const isSystemAdmin = role === 'superadmin'; 
    const canAccessTenant = isSystemAdmin || Boolean(tenantId);

    const value = useMemo<TenantContextValue>(
        () => ({
            tenantId, role, membership, isSystemAdmin,
            isLoading: isIdentityLoading || isMembershipLoading,
            error: membershipError, canAccessTenant, identityEmail, identityUserId,
            refresh: loadMembership,
        }),
        [canAccessTenant, identityEmail, identityUserId, isIdentityLoading, isMembershipLoading, isSystemAdmin, membership, membershipError, role, tenantId]
    );

    return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
};

export const useTenant = (): TenantContextValue => {
    const context = useContext(TenantContext);
    if (!context) throw new Error("useTenant deve ser usado dentro de TenantProvider.");
    return context;
};

export const RequireTenant = ({ children }: { children: React.ReactNode }) => {
    const { canAccessTenant, error, isLoading, isSystemAdmin } = useTenant();

    if (isLoading) {
        return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}><Spin size="large" tip="Validando acesso do tenant..." /></div>;
    }

    if (!canAccessTenant) {
        return (
            <div style={{ padding: 24 }}>
                <Result
                    status="403"
                    title="Acesso nao configurado"
                    subTitle="Seu usuario nao possui vinculo com empresa/tenant. Solicite vinculacao ao administrador."
                    extra={error ? <span style={{ color: "#b42318", fontSize: 12 }}>Detalhe tecnico: {error}</span> : undefined}
                />
            </div>
        );
    }

    if (error && !isSystemAdmin) {
        return <div style={{ padding: 24 }}><Result status="warning" title="Falha ao validar acesso" subTitle={error} /></div>;
    }

    return <>{children}</>;
};