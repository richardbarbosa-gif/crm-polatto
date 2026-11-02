import { useGetIdentity } from "@refinedev/core";
import { Button, Form, Input, Modal, Result, Select, Spin, message } from "antd";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { isSupabaseMissingColumn, isSupabaseMissingRelation } from "../lib/supabaseErrors";
import type { UsuarioEmpresa } from "../types/db";
import { supabaseClient } from "../utility";

type IdentityRecord = {
    id?: string | null;
    email?: string | null;
    [key: string]: unknown;
};

export type EmpresaDoUsuario = {
    id: string;
    nome: string;
    segmento?: string | null;
};

type TenantContextValue = {
    tenantId: string | null;
    /** Empresas às quais o usuário pertence (alimenta o seletor do topo) */
    empresas: EmpresaDoUsuario[];
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
    const tenantId = firstString(row.empresa_id, row.tenant_id, row.company_id, row.id_empresa);
    const role = firstString(row.role, row.perfil, row.cargo, row.tipo);
    const userId = firstString(row.auth_uid, row.user_id, row.usuario_id);
    const rawId = firstString(row.id, row.uuid) || "membership";
    return { id: rawId, tenant_id: tenantId, role, user_id: userId, email: null, raw: row };
};

/**
 * Busca TODOS os vínculos do usuário em utilizadores_empresas.
 *
 * Antes trazia apenas o primeiro (limit 1). Com isso o app não sabia que o
 * usuário pertencia a mais de uma empresa: o seletor não tinha o que listar
 * e a escolha do usuário era sobrescrita pelo primeiro vínculo a cada carga.
 */
const fetchMemberships = async (userId?: string | null): Promise<UsuarioEmpresa[]> => {
    const normalizedUserId = toStringValue(userId);
    if (!normalizedUserId) return [];

    const { data, error } = await supabaseClient
        .from("utilizadores_empresas")
        .select("*")
        .eq("auth_uid", normalizedUserId);

    if (error) {
        if (isSupabaseMissingRelation(error) || isSupabaseMissingColumn(error)) return [];
        throw error;
    }

    return ((data as Record<string, unknown>[]) || [])
        .map(mapMembership)
        .filter((m) => Boolean(m.tenant_id));
};

/** Nome das empresas às quais o usuário pertence, para o seletor do topo. */
const fetchNomesEmpresas = async (
    tenantIds: string[],
): Promise<Record<string, { nome: string; segmento?: string | null }>> => {
    if (!tenantIds.length) return {};
    try {
        const { data, error } = await supabaseClient
            .from("empresas")
            .select("id,nome,segmento")
            .in("id", tenantIds);
        if (error || !data) return {};
        return Object.fromEntries(
            (data as Array<{ id: string; nome?: string; segmento?: string }>).map((e) => [
                String(e.id),
                { nome: e.nome || "Empresa", segmento: e.segmento },
            ]),
        );
    } catch {
        return {};
    }
};

/**
 * Verifica se o email do usuário está na tabela system_admins.
 * Única fonte de verdade para superadmin — nunca hardcodar no frontend.
 */
const checkIsSystemAdmin = async (email?: string | null): Promise<boolean> => {
    const normalizedEmail = toStringValue(email)?.toLowerCase();
    if (!normalizedEmail) return false;

    try {
        const { data, error } = await supabaseClient
            .from("system_admins")
            .select("id")
            .eq("email", normalizedEmail)
            .limit(1)
            .maybeSingle();

        if (error) {
            if (isSupabaseMissingRelation(error)) return false;
            console.warn("Erro ao verificar system_admins:", error.message);
            return false;
        }

        return data !== null;
    } catch {
        return false;
    }
};

type TenantProviderProps = { children: React.ReactNode };

export const TenantProvider = ({ children }: TenantProviderProps) => {
    const identityResult = useGetIdentity<IdentityRecord>() as any;
    const identity = (identityResult?.data || null) as IdentityRecord | null;
    const isIdentityLoading = Boolean(identityResult?.isLoading);

    const identityEmail = toStringValue(identity?.email)?.toLowerCase() || null;
    const identityUserId = toStringValue(identity?.id);

    const [membership, setMembership] = useState<UsuarioEmpresa | null>(null);
    const [empresas, setEmpresas] = useState<EmpresaDoUsuario[]>([]);
    const [isMembershipLoading, setIsMembershipLoading] = useState(false);
    const [membershipError, setMembershipError] = useState<string | null>(null);
    const [isSystemAdmin, setIsSystemAdmin] = useState(false);

    const loadMembership = async () => {
        if (!identityEmail && !identityUserId) {
            setMembership(null);
            setEmpresas([]);
            setMembershipError(null);
            setIsMembershipLoading(false);
            setIsSystemAdmin(false);
            window.localStorage.removeItem("crm_tenant_id");
            return;
        }

        setIsMembershipLoading(true);
        setMembershipError(null);

        try {
            const adminCheck = await checkIsSystemAdmin(identityEmail);
            setIsSystemAdmin(adminCheck);

            const vinculos = await fetchMemberships(identityUserId);

            // Respeita a empresa que o usuário escolheu no seletor, DESDE QUE
            // ela seja realmente dele. Antes o vínculo era sempre sobrescrito
            // pelo primeiro da lista e a troca de empresa não durava um reload.
            const escolhida = window.localStorage.getItem("crm_tenant_id");
            const valida = vinculos.find((v) => v.tenant_id === escolhida);
            const ordenados = [...vinculos].sort((a, b) =>
                String(a.tenant_id).localeCompare(String(b.tenant_id)),
            );
            const nextMembership = valida || ordenados[0] || null;

            setMembership(nextMembership);

            if (nextMembership?.tenant_id) {
                window.localStorage.setItem("crm_tenant_id", nextMembership.tenant_id);
            } else {
                window.localStorage.removeItem("crm_tenant_id");
            }

            // Nomes para o seletor do topo (a RPC listar_empresas_usuario
            // não existe no schema; a lista é montada aqui)
            const ids = vinculos.map((v) => String(v.tenant_id));
            const nomes = await fetchNomesEmpresas(ids);
            setEmpresas(
                vinculos.map((v) => ({
                    id: String(v.tenant_id),
                    nome: nomes[String(v.tenant_id)]?.nome || "Empresa",
                    segmento: nomes[String(v.tenant_id)]?.segmento ?? null,
                })),
            );
        } catch (error: unknown) {
            const message = typeof error === "object" && error && "message" in error
                ? String((error as { message?: unknown }).message || "Falha ao carregar vinculo do tenant.")
                : "Falha ao carregar vinculo do tenant.";
            setMembershipError(message);
            setMembership(null);
            setEmpresas([]);
            setIsSystemAdmin(false);
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
    const canAccessTenant = isSystemAdmin || Boolean(tenantId);

    const value = useMemo<TenantContextValue>(
        () => ({
            tenantId, role, membership, isSystemAdmin, empresas,
            isLoading: isIdentityLoading || isMembershipLoading,
            error: membershipError, canAccessTenant, identityEmail, identityUserId,
            refresh: loadMembership,
        }),
        [canAccessTenant, empresas, identityEmail, identityUserId, isIdentityLoading, isMembershipLoading, isSystemAdmin, membership, membershipError, role, tenantId]
    );

    return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
};

export const useTenant = (): TenantContextValue => {
    const context = useContext(TenantContext);
    if (!context) throw new Error("useTenant deve ser usado dentro de TenantProvider.");
    return context;
};

const SEGMENTO_OPTIONS = [
    { value: "energia_solar", label: "Energia Solar" },
    { value: "software", label: "Software / Tecnologia" },
    { value: "consultoria", label: "Consultoria / Serviços" },
    { value: "outro", label: "Outro" },
];

/**
 * Onboarding self-service: usuário autenticado sem vínculo cria a própria
 * empresa via RPC provisionar_tenant (empresa + vínculo admin + pipeline
 * default + plano Starter, tudo no servidor).
 */
const CriarEmpresaOnboarding = ({ onProvisionado }: { onProvisionado: () => Promise<void> }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [form] = Form.useForm<{ nome_empresa: string; segmento: string }>();

    const criarEmpresa = async () => {
        const values = await form.validateFields();
        setIsCreating(true);
        try {
            const { error } = await supabaseClient.rpc("provisionar_tenant", {
                p_nome_empresa: values.nome_empresa,
                p_segmento: values.segmento,
            });
            if (error) {
                message.error(`Não foi possível criar a empresa: ${error.message}`);
                return;
            }
            message.success("Empresa criada! Preparando seu CRM...");
            setIsModalOpen(false);
            await onProvisionado();
        } finally {
            setIsCreating(false);
        }
    };

    return (
        <>
            <Button type="primary" onClick={() => setIsModalOpen(true)}>
                Criar minha empresa
            </Button>
            <Modal
                title="Criar sua empresa no CRM"
                open={isModalOpen}
                onOk={criarEmpresa}
                onCancel={() => setIsModalOpen(false)}
                okText="Criar empresa"
                cancelText="Cancelar"
                okButtonProps={{ loading: isCreating }}
                destroyOnHidden
            >
                <Form form={form} layout="vertical">
                    <Form.Item
                        label="Nome da empresa"
                        name="nome_empresa"
                        rules={[{ required: true, message: "Informe o nome da empresa." }]}
                    >
                        <Input placeholder="Ex.: Polatto Energia Solar" />
                    </Form.Item>
                    <Form.Item
                        label="Segmento"
                        name="segmento"
                        initialValue="energia_solar"
                        rules={[{ required: true }]}
                    >
                        <Select options={SEGMENTO_OPTIONS} />
                    </Form.Item>
                </Form>
            </Modal>
        </>
    );
};

export const RequireTenant = ({ children }: { children: React.ReactNode }) => {
    const { canAccessTenant, error, isLoading, isSystemAdmin, refresh } = useTenant();

    if (isLoading) {
        return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}><Spin size="large" tip="Validando acesso do tenant..." /></div>;
    }

    if (!canAccessTenant) {
        return (
            <div style={{ padding: 24 }}>
                <Result
                    status="403"
                    title="Bem-vindo! Falta configurar sua empresa"
                    subTitle="Seu usuário ainda não está vinculado a nenhuma empresa. Crie a sua agora mesmo ou solicite o convite ao administrador da sua equipe."
                    extra={
                        <div style={{ display: "grid", gap: 12, justifyItems: "center" }}>
                            <CriarEmpresaOnboarding onProvisionado={refresh} />
                            {error ? (
                                <span style={{ color: "#b42318", fontSize: 12 }}>Detalhe técnico: {error}</span>
                            ) : null}
                        </div>
                    }
                />
            </div>
        );
    }

    if (error && !isSystemAdmin) {
        return <div style={{ padding: 24 }}><Result status="warning" title="Falha ao validar acesso" subTitle={error} /></div>;
    }

    return <>{children}</>;
};
