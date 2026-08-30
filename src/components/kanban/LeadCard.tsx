import React from "react";
import { Dropdown, Typography } from "antd";
import {
    ClockCircleOutlined,
    EditOutlined,
    EnvironmentOutlined,
    EyeOutlined,
    PhoneOutlined,
    SwapOutlined,
} from "@ant-design/icons";
import { Button, TemperatureBadge } from "../ui";
import { formatCurrencyBRL, formatDateBR, normalizeText } from "../../lib/formatters";
import { resolveLeadTemperature } from "../../lib/leadTemperature";
import type { LeadNextTask } from "./types";
import dayjs from "dayjs";

const { Text } = Typography;

export interface LeadCardProps {
    lead: any;
    accentColor: string;
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>, leadId: string) => void;
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>, lead: any) => void;
    onPointerCancel: () => void;
    onDragStart: (e: React.DragEvent<HTMLDivElement>, lead: any) => void;
    onDragEnd: (e: React.DragEvent<HTMLDivElement>) => void;
    onEdit: (leadId: string | number) => void;
    onView: (lead: any) => void;
    stopActionPropagation: (e: React.SyntheticEvent<HTMLElement>) => void;
    nextTask?: LeadNextTask;
    /** Etapas para a ação "Mover" (alternativa por toque ao arraste) */
    stageMoveOptions?: { value: string; label: string }[];
    onMoveToStage?: (lead: any, stageId: string) => void;
}

const getNextTaskIcon = (tipo?: string | null) => {
    const normalizado = normalizeText(tipo);
    if (normalizado.includes("liga")) return <PhoneOutlined style={{ fontSize: 10 }} />;
    if (normalizado.includes("visita")) return <EnvironmentOutlined style={{ fontSize: 10 }} />;
    return <ClockCircleOutlined style={{ fontSize: 10 }} />;
};

const getNextTaskInfo = (
    nextTask?: LeadNextTask,
): { texto: string; cor: string } | null => {
    if (!nextTask) return null;

    const titulo = nextTask.titulo || "Atividade";
    const vencimento = nextTask.data_vencimento ? dayjs(nextTask.data_vencimento) : null;

    if (!vencimento || !vencimento.isValid()) {
        return { texto: titulo, cor: "var(--crm-ink-500)" };
    }

    if (vencimento.isBefore(dayjs())) {
        return { texto: `Atrasada · ${titulo}`, cor: "#dc2626" };
    }

    if (vencimento.isSame(dayjs(), "day")) {
        return { texto: `Hoje ${vencimento.format("HH:mm")} · ${titulo}`, cor: "#d97706" };
    }

    return { texto: `${vencimento.format("DD/MM")} · ${titulo}`, cor: "var(--crm-ink-500)" };
};

const getLeadAge = (createdAt?: string | null): { days: number; label: string; isStale: boolean } => {
    if (!createdAt) return { days: 0, label: "", isStale: false };
    const days = dayjs().diff(dayjs(createdAt), "day");
    if (days <= 7) return { days, label: "", isStale: false };
    if (days <= 30) return { days, label: `${days}d`, isStale: false };
    return { days, label: `${days}d`, isStale: true };
};

export const LeadCard: React.FC<LeadCardProps> = ({
    lead,
    accentColor,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onDragStart,
    onDragEnd,
    onEdit,
    onView,
    stopActionPropagation,
    nextTask,
    stageMoveOptions,
    onMoveToStage,
}) => {
    const temperature = resolveLeadTemperature(lead);
    const hasTemperature = Boolean(temperature);
    const valor = Number(lead.conta_energia_media || lead.valor || 0);
    const hasValor = valor > 0;
    const age = getLeadAge(lead.created_at);
    const nextTaskInfo = getNextTaskInfo(nextTask);

    return (
        <div
            data-pan-ignore="true"
            draggable
            onPointerDown={(e) => onPointerDown(e, String(lead.id))}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => onPointerUp(e, lead)}
            onPointerCancel={onPointerCancel}
            onDragStart={(e) => onDragStart(e, lead)}
            onDragEnd={onDragEnd}
            style={{ cursor: "grab", touchAction: "pan-y" }}
        >
            <div
                className="crm-lead-card"
                style={{
                    borderRadius: 12,
                    border: "1px solid var(--crm-border)",
                    borderLeft: `3px solid ${accentColor}`,
                    background: "var(--crm-surface-1)",
                    boxShadow: "var(--crm-shadow-xs)",
                    marginBottom: 8,
                    overflow: "hidden",
                    transition: "transform 0.15s cubic-bezier(0.2,0,0,1), box-shadow 0.15s ease",
                }}
            >
                {/* Corpo principal */}
                <div style={{ padding: "12px 14px 10px" }}>
                    {/* Linha 1: Nome + Idade */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                        <Text
                            strong
                            style={{
                                fontSize: 14,
                                fontWeight: 600,
                                color: "var(--crm-ink-900)",
                                lineHeight: 1.3,
                                letterSpacing: "-0.01em",
                                flex: 1,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                            }}
                        >
                            {lead.nome || "Lead sem nome"}
                        </Text>
                        {age.isStale && (
                            <span
                                title={`Lead parado há ${age.days} dias`}
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 3,
                                    fontSize: 10,
                                    fontWeight: 600,
                                    color: "#ef4444",
                                    background: "rgba(239,68,68,0.06)",
                                    padding: "2px 6px",
                                    borderRadius: 4,
                                    marginLeft: 6,
                                    flexShrink: 0,
                                }}
                            >
                                <ClockCircleOutlined style={{ fontSize: 9 }} />
                                {age.label}
                            </span>
                        )}
                    </div>

                    {/* Linha 2: Valor destacado + Temperatura */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        {hasValor ? (
                            <Text
                                style={{
                                    fontSize: 15,
                                    fontWeight: 700,
                                    color: "var(--crm-ink-900)",
                                    fontFamily: "'Sora','Inter',sans-serif",
                                    letterSpacing: "-0.02em",
                                }}
                            >
                                {formatCurrencyBRL(valor, "R$ 0")}
                            </Text>
                        ) : (
                            <Text style={{ fontSize: 12, color: "var(--crm-ink-400)" }}>Sem valor</Text>
                        )}
                        {hasTemperature && <TemperatureBadge value={temperature} />}
                    </div>

                    {/* Linha 3: Responsável + Data */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <Text style={{ fontSize: 11.5, color: "var(--crm-ink-500)", fontWeight: 450 }}>
                            {lead.responsavel || "Sem responsável"}
                        </Text>
                        <Text style={{ fontSize: 11, color: "var(--crm-ink-400)" }}>
                            {formatDateBR(lead.created_at, "")}
                        </Text>
                    </div>

                    {/* Linha 4: Próxima atividade — card sem atividade é alerta visual */}
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            marginTop: 8,
                            paddingTop: 7,
                            borderTop: "1px dashed var(--crm-border-subtle)",
                            minWidth: 0,
                            pointerEvents: "none",
                        }}
                    >
                        {nextTaskInfo ? (
                            <>
                                <span style={{ color: nextTaskInfo.cor, display: "inline-flex", flexShrink: 0 }}>
                                    {getNextTaskIcon(nextTask?.tipo)}
                                </span>
                                <Text
                                    style={{
                                        fontSize: 11,
                                        color: nextTaskInfo.cor,
                                        fontWeight: 500,
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                    }}
                                    title={nextTaskInfo.texto}
                                >
                                    {nextTaskInfo.texto}
                                </Text>
                            </>
                        ) : (
                            <Text
                                style={{
                                    fontSize: 11,
                                    color: "var(--crm-ink-300)",
                                    fontStyle: "italic",
                                }}
                            >
                                Sem próxima atividade
                            </Text>
                        )}
                    </div>
                </div>

                {/* Actions — compacto, só ícones */}
                <div
                    style={{
                        display: "flex",
                        borderTop: "1px solid var(--crm-border-subtle)",
                        background: "rgba(248,250,252,0.4)",
                    }}
                >
                    {stageMoveOptions && stageMoveOptions.length > 0 && onMoveToStage ? (
                        <Dropdown
                            trigger={["click"]}
                            menu={{
                                items: stageMoveOptions.map((opcao) => ({
                                    key: opcao.value,
                                    label: opcao.label,
                                    onClick: () => onMoveToStage(lead, opcao.value),
                                })),
                            }}
                        >
                            <button
                                data-no-card-open="true"
                                aria-label="Mover para outra etapa"
                                onPointerDown={(e) => stopActionPropagation(e)}
                                onClick={(e) => stopActionPropagation(e)}
                                style={{
                                    flex: 1,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: 5,
                                    padding: "7px 0",
                                    fontSize: 12,
                                    fontWeight: 500,
                                    color: "var(--crm-ink-500)",
                                    background: "transparent",
                                    border: "none",
                                    borderRight: "1px solid var(--crm-border-subtle)",
                                    cursor: "pointer",
                                    transition: "color 0.15s, background 0.15s",
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(59,130,246,0.04)"; e.currentTarget.style.color = "#3b82f6"; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--crm-ink-500)"; }}
                            >
                                <SwapOutlined style={{ fontSize: 12 }} /> Mover
                            </button>
                        </Dropdown>
                    ) : null}
                    <button
                        data-no-card-open="true"
                        onPointerDown={(e) => stopActionPropagation(e)}
                        onClick={(e) => { stopActionPropagation(e); onEdit(lead.id); }}
                        style={{
                            flex: 1,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 5,
                            padding: "7px 0",
                            fontSize: 12,
                            fontWeight: 500,
                            color: "var(--crm-ink-500)",
                            background: "transparent",
                            border: "none",
                            borderRight: "1px solid var(--crm-border-subtle)",
                            cursor: "pointer",
                            transition: "color 0.15s, background 0.15s",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(59,130,246,0.04)"; e.currentTarget.style.color = "#3b82f6"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--crm-ink-500)"; }}
                    >
                        <EditOutlined style={{ fontSize: 12 }} /> Editar
                    </button>
                    <button
                        data-no-card-open="true"
                        onPointerDown={(e) => stopActionPropagation(e)}
                        onClick={(e) => { stopActionPropagation(e); onView(lead); }}
                        style={{
                            flex: 1,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 5,
                            padding: "7px 0",
                            fontSize: 12,
                            fontWeight: 500,
                            color: "var(--crm-ink-500)",
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            transition: "color 0.15s, background 0.15s",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(59,130,246,0.04)"; e.currentTarget.style.color = "#3b82f6"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--crm-ink-500)"; }}
                    >
                        <EyeOutlined style={{ fontSize: 12 }} /> Ver
                    </button>
                </div>
            </div>
        </div>
    );
};
