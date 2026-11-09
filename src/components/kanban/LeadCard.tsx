import React from "react";
import { Dropdown, Typography } from "antd";
import {
    ClockCircleOutlined,
    EditOutlined,
    EnvironmentOutlined,
    ExclamationCircleOutlined,
    EyeOutlined,
    PhoneOutlined,
    PlusOutlined,
    SwapOutlined,
    WhatsAppOutlined,
} from "@ant-design/icons";
import { TemperatureBadge } from "../ui";
import { formatCurrencyBRL, formatDateBR, normalizeText } from "../../lib/formatters";
import { resolveLeadTemperature } from "../../lib/leadTemperature";
import { valorDoLead } from "../../lib/pipelineMetrics";
import { rotuloParado } from "../../lib/saudeNegocio";
import { telefoneWhatsApp } from "../../lib/modelosMensagem";
import type { KanbanLead, LeadNextTask } from "./types";
import dayjs from "dayjs";

const { Text } = Typography;

export interface LeadCardProps {
    lead: KanbanLead;
    accentColor: string;
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>, leadId: string) => void;
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>, lead: KanbanLead) => void;
    onPointerCancel: () => void;
    onDragStart: (e: React.DragEvent<HTMLDivElement>, lead: KanbanLead) => void;
    onDragEnd: (e: React.DragEvent<HTMLDivElement>) => void;
    onEdit: (leadId: string | number) => void;
    onView: (lead: KanbanLead) => void;
    stopActionPropagation: (e: React.SyntheticEvent<HTMLElement>) => void;
    nextTask?: LeadNextTask;
    /** Etapas para a ação "Mover" (alternativa por toque ao arraste) */
    stageMoveOptions?: { value: string; label: string }[];
    onMoveToStage?: (lead: KanbanLead, stageId: string) => void;
    /** Negócio aberto sem tarefa aberta: mostra o aviso e o botão Agendar. */
    semProximoPasso?: boolean;
    onAgendar?: (lead: KanbanLead) => void;
    /** Abre a escolha de modelo de mensagem para o WhatsApp do lead. */
    onWhatsApp?: (lead: KanbanLead) => void;
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
        return { texto: `Atrasada · ${titulo}`, cor: "var(--crm-danger-fg)" };
    }

    if (vencimento.isSame(dayjs(), "day")) {
        return { texto: `Hoje ${vencimento.format("HH:mm")} · ${titulo}`, cor: "var(--crm-warning-fg)" };
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
    semProximoPasso = false,
    onAgendar,
    onWhatsApp,
}) => {
    const temperature = resolveLeadTemperature(lead);
    const hasTemperature = Boolean(temperature);
    // Valor do negócio primeiro; a conta de luz é só o fallback do modelo solar.
    const valor = valorDoLead(lead);
    const hasValor = valor > 0;
    // Com a view de saúde, "parado" é a regra do Pipedrive (sem atividade
    // além do prazo da etapa). Sem ela, o selo antigo de idade do cadastro.
    const temSaude = typeof lead.parado === "boolean";
    const parado = lead.parado === true;
    const age = temSaude ? { days: 0, label: "", isStale: false } : getLeadAge(lead.created_at);
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
                className={`crm-lead-card${parado ? " crm-lead-card--parado" : ""}`}
                style={{
                    borderRadius: 12,
                    border: parado ? "1px solid rgba(220, 38, 38, 0.35)" : "1px solid var(--crm-border)",
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
                    {/* Linha 1: Nome + selo "Parado". O nome usa até 2 linhas: com o
                        selo ao lado, em 1 linha ele era cortado cedo ("Clínica Odontoló…"). */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6, marginBottom: 6 }}>
                        <Text
                            strong
                            className="crm-lead-card__nome"
                            title={lead.nome || undefined}
                            style={{
                                fontSize: 14,
                                fontWeight: 600,
                                color: "var(--crm-ink-900)",
                                lineHeight: 1.3,
                                letterSpacing: "-0.01em",
                                flex: 1,
                                minWidth: 0,
                            }}
                        >
                            {lead.nome || "Lead sem nome"}
                        </Text>
                        {parado && (
                            <span
                                className="crm-lead-card__selo-parado"
                                title={`Sem atividade além do prazo da etapa (${lead.dias_para_parado ?? "?"} dias)`}
                            >
                                <ClockCircleOutlined style={{ fontSize: 9 }} />
                                {rotuloParado(lead.dias_sem_atividade)}
                            </span>
                        )}
                        {age.isStale && (
                            <span className="crm-lead-card__selo-parado" title={`Lead parado há ${age.days} dias`}>
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
                        ) : semProximoPasso ? (
                            <>
                                <span style={{ color: "var(--crm-warning-fg)", display: "inline-flex", flexShrink: 0 }}>
                                    <ExclamationCircleOutlined style={{ fontSize: 11 }} />
                                </span>
                                <Text style={{ fontSize: 11, color: "var(--crm-warning-fg)", fontWeight: 600, flex: 1, whiteSpace: "nowrap" }}>
                                    Sem próximo passo
                                </Text>
                                {onAgendar ? (
                                    <button
                                        type="button"
                                        data-no-card-open="true"
                                        aria-label={`Agendar próximo passo para ${lead.nome || "o lead"}`}
                                        onPointerDown={(e) => stopActionPropagation(e)}
                                        onClick={(e) => {
                                            stopActionPropagation(e);
                                            onAgendar(lead);
                                        }}
                                        className="crm-lead-card__agendar"
                                    >
                                        <PlusOutlined style={{ fontSize: 10 }} /> Agendar
                                    </button>
                                ) : null}
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

                {/* Ações do cartão: estilo no tema (.crm-lead-card__action) */}
                <div className="crm-lead-card__actions">
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
                                type="button"
                                className="crm-lead-card__action"
                                data-no-card-open="true"
                                aria-label={`Mover ${lead.nome || "o lead"} para outra etapa`}
                                onPointerDown={(e) => stopActionPropagation(e)}
                                onClick={(e) => stopActionPropagation(e)}
                            >
                                <SwapOutlined style={{ fontSize: 12 }} /> Mover
                            </button>
                        </Dropdown>
                    ) : null}
                    {onWhatsApp && telefoneWhatsApp(lead.telefone, lead.ddi) ? (
                        <button
                            type="button"
                            className="crm-lead-card__action crm-lead-card__action--icon"
                            data-no-card-open="true"
                            aria-label={`WhatsApp para ${lead.nome || "o lead"}`}
                            title="WhatsApp com modelo de mensagem"
                            onPointerDown={(e) => stopActionPropagation(e)}
                            onClick={(e) => { stopActionPropagation(e); onWhatsApp(lead); }}
                        >
                            <WhatsAppOutlined />
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className="crm-lead-card__action"
                        data-no-card-open="true"
                        aria-label={`Editar ${lead.nome || "lead"}`}
                        onPointerDown={(e) => stopActionPropagation(e)}
                        onClick={(e) => { stopActionPropagation(e); onEdit(lead.id); }}
                    >
                        <EditOutlined style={{ fontSize: 12 }} /> Editar
                    </button>
                    <button
                        type="button"
                        className="crm-lead-card__action"
                        data-no-card-open="true"
                        aria-label={`Ver ${lead.nome || "lead"}`}
                        onPointerDown={(e) => stopActionPropagation(e)}
                        onClick={(e) => { stopActionPropagation(e); onView(lead); }}
                    >
                        <EyeOutlined style={{ fontSize: 12 }} /> Ver
                    </button>
                </div>
            </div>
        </div>
    );
};
