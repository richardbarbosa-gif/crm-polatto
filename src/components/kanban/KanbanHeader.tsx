import React from "react";
import { Input, Select, Tooltip, Typography } from "antd";
import {
    AppstoreOutlined,
    BarsOutlined,
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
    pipelineOptions?: { value: string; label: string }[];
    pipelineSelecionado?: string;
    onPipelineChange?: (pipelineId: string) => void;
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
    pipelineOptions,
    pipelineSelecionado,
    onPipelineChange,
}) => (
    <div
        className="crm-opportunities-header"
        style={{
            padding: "10px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            borderBottom: "1px solid var(--crm-border)",
            background: "var(--crm-surface-1)",
        }}
    >
        {/* LINHA ÚNICA: Tudo junto */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>

            {/* Esquerda: View toggle + Filtros */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {/* Seletor de funil (só aparece com pipelines configurados) */}
                {pipelineOptions && pipelineOptions.length > 0 && onPipelineChange ? (
                    <Select
                        value={pipelineSelecionado}
                        onChange={onPipelineChange}
                        options={pipelineOptions}
                        style={{ minWidth: 150, height: 32 }}
                        size="small"
                        aria-label="Funil ativo"
                    />
                ) : null}

                {/* View toggle */}
                <div style={{ display: "flex", gap: 2, background: "var(--crm-surface-2)", borderRadius: 8, padding: 2 }}>
                    <Tooltip title="Kanban">
                        <Button
                            type="text"
                            icon={<AppstoreOutlined />}
                            aria-label="Kanban"
                            style={{
                                color: viewType === "kanban" ? "#3b82f6" : "#94a3b8",
                                background: viewType === "kanban" ? "rgba(59,130,246,0.08)" : "transparent",
                                borderRadius: 6,
                                width: 32,
                                height: 32,
                                padding: 0,
                            }}
                            onClick={() => onViewTypeChange("kanban")}
                        />
                    </Tooltip>
                    <Tooltip title="Lista">
                        <Button
                            type="text"
                            icon={<BarsOutlined />}
                            aria-label="Lista"
                            style={{
                                color: viewType === "list" ? "#3b82f6" : "#94a3b8",
                                background: viewType === "list" ? "rgba(59,130,246,0.08)" : "transparent",
                                borderRadius: 6,
                                width: 32,
                                height: 32,
                                padding: 0,
                            }}
                            onClick={() => onViewTypeChange("list")}
                        />
                    </Tooltip>
                </div>

                {/* Search */}
                <Input
                    placeholder="Buscar..."
                    prefix={<SearchOutlined style={{ color: "#94a3b8", fontSize: 12 }} />}
                    value={searchText}
                    onChange={(e) => onSearchChange(e.target.value)}
                    style={{
                        width: 180,
                        backgroundColor: "var(--crm-surface-2)",
                        border: "1px solid var(--crm-border-subtle)",
                        borderRadius: 8,
                        height: 32,
                        fontSize: 12.5,
                    }}
                />

                {/* Filters */}
                <Select
                    placeholder="Responsável"
                    allowClear
                    value={responsavelFiltro}
                    onChange={(v) => onResponsavelChange(v)}
                    options={responsaveisDisponiveis.map((r) => ({ value: r, label: r }))}
                    style={{ width: 150, height: 32 }}
                    size="small"
                    disabled={responsaveisDisponiveis.length === 0}
                />
                <Select
                    value={temperaturaFiltro}
                    onChange={(v) => onTemperaturaChange(v)}
                    style={{ width: 140, height: 32 }}
                    size="small"
                    options={[
                        { value: "todas", label: "Todas temp." },
                        ...LEAD_TEMPERATURE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
                        ...LEAD_AUTOMATIC_TEMPERATURE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
                    ]}
                />
            </div>

            {/* Centro: KPIs inline */}
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                    <Text style={{ fontSize: 11, color: "var(--crm-ink-400)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Receita</Text>
                    <Text style={{ fontSize: 14, fontWeight: 700, fontFamily: "'Sora','Inter',sans-serif", color: "var(--crm-ink-900)" }}>
                        {formatCurrencyBRL(kpis.totalValor, "R$ 0")}
                    </Text>
                </div>
                <div style={{ width: 1, height: 16, background: "var(--crm-border)" }} />
                <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                    <Text style={{ fontSize: 11, color: "var(--crm-ink-400)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Conv.</Text>
                    <Text style={{ fontSize: 14, fontWeight: 700, fontFamily: "'Sora','Inter',sans-serif", color: "#059669" }}>
                        {kpis.taxaConversao}%
                    </Text>
                </div>
                <div style={{ width: 1, height: 16, background: "var(--crm-border)" }} />
                <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                    <Text style={{ fontSize: 11, color: "var(--crm-ink-400)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Ativos</Text>
                    <Text style={{ fontSize: 14, fontWeight: 700, fontFamily: "'Sora','Inter',sans-serif", color: "var(--crm-ink-900)" }}>
                        {kpis.totalLeads}
                    </Text>
                </div>
            </div>

            {/* Direita: Actions */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <CreateButton type="primary" icon={<PlusOutlined />} size="small" className="crm-focusable" style={{ height: 32, fontSize: 12.5, borderRadius: 8 }}>
                    Novo Lead
                </CreateButton>
                <ImportLeadsButton />
                <Button
                    icon={<SettingOutlined />}
                    onClick={onOpenStageManager}
                    aria-label="Gerenciar colunas"
                    size="small"
                    style={{ height: 32, fontSize: 12.5, borderRadius: 8 }}
                >
                    Colunas
                </Button>
            </div>
        </div>

        {/* Aviso de visão restrita (só aparece se necessário) */}
        {!canViewAllLeads && (
            <Text type="secondary" style={{ fontSize: 11 }}>
                Visão restrita: exibindo leads de {ownerDisplayName}.
            </Text>
        )}
    </div>
);
