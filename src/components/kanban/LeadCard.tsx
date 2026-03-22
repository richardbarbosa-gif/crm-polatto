import React from "react";
import { Typography } from "antd";
import { EditOutlined, EyeOutlined } from "@ant-design/icons";
import { Button, Card, TemperatureBadge } from "../ui";
import { formatCurrencyBRL, formatDateBR } from "../../lib/formatters";
import { resolveLeadTemperature } from "../../lib/leadTemperature";

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
}

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
}) => (
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
        <Card
            size="small"
            interactive
            className="crm-lead-card"
            style={{ borderLeft: `3px solid ${accentColor}` }}
            bodyStyle={{ padding: "14px 14px 10px" }}
            actions={[
                <Button
                    key={`edit-${lead.id}`}
                    icon={<EditOutlined />}
                    size="small"
                    data-no-card-open="true"
                    onPointerDown={stopActionPropagation}
                    onClick={(e) => {
                        stopActionPropagation(e);
                        onEdit(lead.id);
                    }}
                >
                    Editar
                </Button>,
                <Button
                    key={`show-${lead.id}`}
                    icon={<EyeOutlined />}
                    size="small"
                    data-no-card-open="true"
                    onPointerDown={stopActionPropagation}
                    onClick={(e) => {
                        stopActionPropagation(e);
                        onView(lead);
                    }}
                >
                    Ver
                </Button>,
            ]}
        >
            <div style={{ marginBottom: "8px" }}>
                <Text strong className="crm-lead-card-title">{lead.nome}</Text>
            </div>
            <div style={{ marginBottom: "8px" }}>
                <TemperatureBadge value={resolveLeadTemperature(lead)} />
            </div>
            <div className="crm-lead-card-meta">
                {lead.conta_energia_media > 0 && (
                    <Text style={{ fontSize: 13, color: "var(--crm-ink-700)", fontWeight: 600, letterSpacing: "-0.01em" }}>
                        {formatCurrencyBRL(lead.conta_energia_media, "R$ 0,00")}
                    </Text>
                )}
                {lead.responsavel && (
                    <Text style={{ fontSize: 11, color: "var(--crm-ink-500)" }}>
                        Resp: {lead.responsavel}
                    </Text>
                )}
                <Text style={{ fontSize: 11, color: "var(--crm-ink-400)" }}>
                    {formatDateBR(lead.created_at, "-")}
                </Text>
            </div>
        </Card>
    </div>
);
