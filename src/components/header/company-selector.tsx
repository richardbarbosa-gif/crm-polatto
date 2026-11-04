import { SwapOutlined, ShopOutlined } from "@ant-design/icons";
import { Select, Spin, Typography, Tooltip } from "antd";
import { useState } from "react";
import { useTenant } from "../../contexts/tenant";

const { Text } = Typography;

/**
 * Seletor de empresa do topo.
 *
 * A lista vem do TenantProvider, que já carregou os vínculos do usuário.
 * Antes vinha da RPC listar_empresas_usuario, que não existe no schema —
 * a chamada falhava, a lista ficava vazia e o topo exibia sempre a palavra
 * genérica "Empresa", mesmo para quem tem acesso a várias.
 */
export const CompanySelector = () => {
    const { tenantId, refresh, empresas, isLoading } = useTenant();
    const [isSwitching, setIsSwitching] = useState(false);

    const handleChange = async (empresaId: string) => {
        if (empresaId === tenantId) return;

        setIsSwitching(true);
        try {
            // O TenantProvider respeita esta escolha na próxima carga, e o
            // banco valida contra os vínculos reais antes de aplicá-la.
            window.localStorage.setItem("crm_tenant_id", empresaId);
            await refresh();
            // Reload para limpar os caches de query do Refine
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
                value: e.id,
                label: (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <ShopOutlined style={{ color: "#3b82f6", fontSize: 13 }} />
                        <span>{e.nome}</span>
                    </div>
                ),
            }))}
            className="crm-company-selector"
        />
    );
};
