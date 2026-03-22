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
import { Button, StatCard } from "../ui";
import {
    type LeadTemperatureTag,
    LEAD_AUTOMATIC_TEMPERATURE_OPTIONS,
    LEAD_TEMPERATURE_OPTIONS,
} from "../../lib/leadTemperature";

const { Text, Title } = Typography;

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
    canDeleteRecords,
    canViewAllLeads,
    ownerDisplayName,
    onOpenStageManager,
    kpis,
}) => (
    <div className="crm-opportunities-header">
        <div className="crm-opportunities-header-main">
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <Title level={4} className="crm-opportunities-title" style={{ fontSize: 18 }}>
                    Oportunidades
                </Title>
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
            </div>

            <div className="crm-opportunities-filters">
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

            <CreateButton type="primary" icon={<PlusOutlined />} className="crm-focusable">
                Novo Lead
            </CreateButton>
            <ImportLeadsButton />
            <Button
                icon={<SettingOutlined />}
                onClick={onOpenStageManager}
                disabled={!canDeleteRecords}
                aria-label="Gerenciar colunas"
            >
                Colunas
            </Button>
        </div>

        {!canViewAllLeads ? (
            <div style={{ padding: "0 20px 8px 20px" }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                    Visão restrita: exibindo apenas leads vinculados a {ownerDisplayName}.
                </Text>
            </div>
        ) : null}

        <div className="crm-opportunities-kpis">
            <div className="crm-kpi-grid">
                <StatCard
                    title="Previsao de receita"
                    value={kpis.totalValor}
                    prefix={<DollarCircleOutlined style={{ color: "#3b82f6" }} />}
                    accentColor="#3b82f6"
                />
                <StatCard
                    title="Conversao"
                    value={kpis.taxaConversao}
                    suffix="%"
                    prefix={<CheckCircleOutlined style={{ color: "#10b981" }} />}
                    accentColor="#10b981"
                    valueStyle={{ color: "#059669" }}
                />
                <StatCard
                    title="Leads Ativos"
                    value={kpis.totalLeads}
                    prefix={<ArrowUpOutlined style={{ color: "#f59e0b" }} />}
                    accentColor="#f59e0b"
                />
            </div>
            <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 10 }}>
                Dica: clique e arraste no fundo do kanban para navegar horizontalmente.
            </Text>
        </div>
    </div>
);
