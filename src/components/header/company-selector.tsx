import { SwapOutlined, ShopOutlined } from "@ant-design/icons";
import { Select, Typography, Tooltip, Spin } from "antd";
import { useCallback, useEffect, useState } from "react";
import { supabaseClient } from "../../utility";
import { useTenant } from "../../contexts/tenant";

const { Text } = Typography;

type EmpresaOption = {
    empresa_id: string;
    nome: string;
    segmento: string;
    logo_url: string | null;
    cor_primaria: string | null;
};

export const CompanySelector = () => {
    const { tenantId, refresh, isSystemAdmin } = useTenant();
    const [empresas, setEmpresas] = useState<EmpresaOption[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSwitching, setIsSwitching] = useState(false);

    const loadEmpresas = useCallback(async () => {
        setIsLoading(true);
        try {
            const { data, error } = await supabaseClient.rpc("listar_empresas_usuario");
            if (error) {
                console.warn("Erro ao listar empresas:", error.message);
                setEmpresas([]);
                return;
            }
            setEmpresas((data || []) as EmpresaOption[]);
        } catch {
            setEmpresas([]);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        loadEmpresas();
    }, [loadEmpresas]);

    const handleChange = async (empresaId: string) => {
        if (empresaId === tenantId) return;

        setIsSwitching(true);
        try {
            window.localStorage.setItem("crm_tenant_id", empresaId);
            await refresh();
            // Força reload para limpar caches do Refine
            window.location.reload();
        } catch {
            setIsSwitching(false);
        }
    };

    // Se só tem 1 empresa, mostra como label estático
    if (!isLoading && empresas.length <= 1) {
        const nome = empresas[0]?.nome || "Empresa";
        return (
            <Tooltip title="Empresa ativa">
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "4px 10px",
                        borderRadius: 8,
                        background: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(148,163,184,0.12)",
                        maxWidth: 200,
                    }}
                >
                    <ShopOutlined style={{ color: "#60a5fa", fontSize: 13 }} />
                    <Text
                        style={{
                            color: "#e2e8f0",
                            fontSize: 12.5,
                            fontWeight: 500,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                        }}
                    >
                        {nome}
                    </Text>
                </div>
            </Tooltip>
        );
    }

    if (isLoading) {
        return <Spin size="small" />;
    }

    return (
        <Select
            value={tenantId || undefined}
            onChange={handleChange}
            loading={isSwitching}
            disabled={isSwitching}
            suffixIcon={<SwapOutlined style={{ color: "#60a5fa", fontSize: 11 }} />}
            placeholder="Selecione a empresa"
            style={{ minWidth: 180, maxWidth: 240 }}
            popupMatchSelectWidth={260}
            dropdownStyle={{ borderRadius: 10 }}
            options={empresas.map((e) => ({
                value: e.empresa_id,
                label: (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <ShopOutlined style={{ color: e.cor_primaria || "#3b82f6", fontSize: 13 }} />
                        <span>{e.nome}</span>
                        {e.segmento && e.segmento !== "energia_solar" && (
                            <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: "auto" }}>
                                {e.segmento}
                            </span>
                        )}
                    </div>
                ),
            }))}
            className="crm-company-selector"
        />
    );
};
