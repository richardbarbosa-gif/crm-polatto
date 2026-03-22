import React from "react";
import { Input, Select, Tooltip, Typography } from "antd";
import {
    AppstoreOutlined,
    ArrowUpOutlined,
    BarsOutlined,
    CheckCircleOutlined,
    DollarCircleOutlined,
    PlusOutlined,
    SearchOutlined,
    SettingOutlined,
} from "@ant-design/icons";
import { CreateButton } from "@refinedev/antd";
import { ImportLeadsButton } from "../import-leads";
import { Button } from "../ui";
import {
    type LeadTemperatureTag,
    LEAD_AUTOMATIC_TEMPERATURE_OPTIONS,
    LEAD_TEMPERATURE_OPTIONS,
} from "../../lib/leadTemperature";
import { formatCurrencyBRL } from "../../lib/formatters";

const { Text } = Typography;

export interface KanbanHeaderProps {
    viewType: "kanban" | "list";
    onViewTypeChange: (type: "kanban" | "list") => void;
    searchText: string;
    onSearchChange: (value: string) => void;
    responsavelFiltro: string | undefined;
    onResponsavelChange: (value: string | undefined) => void;
    responsaveisDisponiveis: string[];
    temperaturaFiltro: "todas" | LeadTemperatureTag;
    onTemperaturaChange: (value: "todas" | LeadTemperatureTag) => void;
    canDeleteRecords: boolean;
    canViewAllLeads: boolean;
    ownerDisplayName: string | undefined;
    onOpenStageManager: () => void;
    kpis: { totalLeads: number; totalValor: number; taxaConversao: string };
}

export const KanbanHeader: React.FC<KanbanHeaderProps> = ({
    viewType,
    onViewTypeChange,
    searchText,
    onSearchChange,
    responsavelFiltro,
    onResponsavelChange,
    responsaveisDisponiveis,
    temperaturaFiltro,
    onTemperaturaChange,
    canViewAllLeads,
    ownerDisplayName,
    onOpenStageManager,
    kpis,
}) => (
    <div className="crm-opportunities-header" style={{ padding: "12px 24px", display: "flex", flexDirection: "column", gap: "12px" }}>
        
        {/* LINHA PRINCIPAL: Filtros à esquerda/centro, Ações à direita */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "16px" }}>
            
            {/* GRUPO ESQUERDO: Alternador de Visão e Filtros */}
            <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
                
                <div className="crm-view-toggle">
                    <Tooltip title="Kanban">
                        <Button
                            type="text"
                            icon={<AppstoreOutlined />}
                            aria-label="Exibir em kanban"
                            style={{
                                color: viewType === "kanban" ? "#3b82f6" : "#94a3b8",
                                background: viewType === "kanban" ? "rgba(59, 130, 246, 0.08)" : "transparent",
                                borderRadius: 8,
                            }}
                            onClick={() => onViewTypeChange("kanban")}
                        />
                    </Tooltip>
                    <Tooltip title="Lista">
                        <Button
                            type="text"
                            icon={<BarsOutlined />}
                            aria-label="Exibir em lista"
                            style={{
                                color: viewType === "list" ? "#3b82f6" : "#94a3b8",
                                background: viewType === "list" ? "rgba(59, 130, 246, 0.08)" : "transparent",
                                borderRadius: 8,
                            }}
                            onClick={() => onViewTypeChange("list")}
                        />
                    </Tooltip>
                </div>

                <div className="crm-opportunities-filters" style={{ display: "flex", gap: "8px" }}>
                    <Input
                        placeholder="Buscar leads..."
                        prefix={<SearchOutlined style={{ color: "#94a3b8", fontSize: 13 }} />}
                        value={searchText}
                        onChange={(e) => onSearchChange(e.target.value)}
                        aria-label="Buscar lead"
                        style={{
                            width: 220,
                            backgroundColor: "rgba(241, 245, 249, 0.8)",
                            border: "1px solid rgba(148, 163, 184, 0.15)",
                            borderRadius: 10,
                            height: 36,
                            fontSize: 13,
                        }}
                    />
                    <Select
                        placeholder="Responsável"
                        allowClear
                        value={responsavelFiltro}
                        onChange={(v) => onResponsavelChange(v)}
                        aria-label="Filtrar por responsavel"
                        options={responsaveisDisponiveis.map((r) => ({ value: r, label: r }))}
                        style={{ width: "180px" }}
                        disabled={responsaveisDisponiveis.length === 0}
                    />
                    <Select
                        value={temperaturaFiltro}
                        onChange={(v) => onTemperaturaChange(v)}
                        aria-label="Filtrar por temperatura"
                        style={{ width: "170px" }}
                        options={[
                            { value: "todas", label: "Temperatura: Todas" },
                            ...LEAD_TEMPERATURE_OPTIONS.map((o) => ({
                                value: o.value,
                                label: `Temperatura: ${o.label}`,
                            })),
                            ...LEAD_AUTOMATIC_TEMPERATURE_OPTIONS.map((o) => ({
                                value: o.value,
                                label: `Temperatura: ${o.label}`,
                            })),
                        ]}
                    />
                </div>
            </div>

            {/* GRUPO DIREITO: Botões de Ação Amarrados e Alinhados */}
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <CreateButton type="primary" icon={<PlusOutlined />} className="crm-focusable">
                    Novo Lead
                </CreateButton>
                <ImportLeadsButton />
                {/* A trava disabled={!canDeleteRecords} foi removida para ser sempre clicável */}
                <Button
                    icon={<SettingOutlined />}
                    onClick={onOpenStageManager}
                    aria-label="Gerenciar colunas"
                >
                    Colunas
                </Button>
            </div>
        </div>

        {/* LINHA SECUNDÁRIA: Avisos e KPIs Compactos */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
            <div>
                {!canViewAllLeads ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                        Visão restrita: exibindo apenas leads vinculados a {ownerDisplayName}.
                    </Text>
                ) : <div />} {/* Div vazia para manter o layout flex-between caso não haja aviso */}
            </div>

            {/* KPIs Compactos (Inline) para economizar MUITO espaço vertical */}
            <div style={{ display: "flex", gap: "24px", background: "var(--crm-surface-2)", padding: "6px 16px", borderRadius: "8px", border: "1px solid var(--crm-border-subtle)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <DollarCircleOutlined style={{ color: "#3b82f6" }} />
                    <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Receita:</Text>
                    <Text strong style={{ fontSize: 13 }}>{formatCurrencyBRL(kpis.totalValor, "R$ 0,00")}</Text>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <CheckCircleOutlined style={{ color: "#10b981" }} />
                    <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Conversão:</Text>
                    <Text strong style={{ fontSize: 13, color: "#059669" }}>{kpis.taxaConversao}%</Text>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <ArrowUpOutlined style={{ color: "#f59e0b" }} />
                    <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Ativos:</Text>
                    <Text strong style={{ fontSize: 13 }}>{kpis.totalLeads}</Text>
                </div>
            </div>
        </div>
    </div>
);