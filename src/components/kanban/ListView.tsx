import React from "react";
import { Space, Table, Typography } from "antd";
import { EditOutlined, EyeOutlined } from "@ant-design/icons";
import { Badge, Button, EmptyState, TemperatureBadge } from "../ui";
import { getStatusTone } from "./types";
import { formatCurrencyBRL } from "../../lib/formatters";
import { resolveLeadTemperature } from "../../lib/leadTemperature";

const { Text } = Typography;

export interface ListViewProps {
    listData: any[];
    listTotal: number;
    listPage: number;
    isLoading: boolean;
    listError: any;
    listErrorMessage: string | null;
    onPageChange: (page: number) => void;
    resolveLeadStageName: (record: any) => string;
    onView: (lead: any) => void;
    onEdit: (leadId: string | number) => void;
}

export const ListView: React.FC<ListViewProps> = ({
    listData,
    listTotal,
    listPage,
    isLoading,
    listError,
    listErrorMessage,
    onPageChange,
    resolveLeadStageName,
    onView,
    onEdit,
}) => (
    <div className="crm-list-shell">
        {listError ? (
            <EmptyState
                title="Erro ao carregar leads"
                description={listErrorMessage || "Revise as policies RLS."}
            />
        ) : (
            <Table
                dataSource={listData}
                rowKey="id"
                size="middle"
                loading={isLoading}
                pagination={{
                    current: listPage,
                    pageSize: 12,
                    total: listTotal,
                    position: ["bottomCenter"],
                    showSizeChanger: false,
                }}
                onChange={(pagination) => {
                    onPageChange(pagination.current || 1);
                }}
                columns={[
                    {
                        title: "Nome do Lead",
                        dataIndex: "nome",
                        render: (text) => <b style={{ color: "var(--crm-ink-900)" }}>{text}</b>,
                    },
                    {
                        title: "Etapa",
                        key: "stage_id",
                        render: (_, record: any) => {
                            const stageName = resolveLeadStageName(record);
                            return <Badge tone={getStatusTone(stageName)}>{stageName}</Badge>;
                        },
                    },
                    {
                        title: "Temperatura",
                        key: "temperature",
                        render: (_, record: any) => (
                            <TemperatureBadge value={resolveLeadTemperature(record)} />
                        ),
                    },
                    {
                        title: "Responsável",
                        dataIndex: "responsavel",
                        render: (v) => v || "-",
                    },
                    {
                        title: "Valor",
                        dataIndex: "conta_energia_media",
                        render: (v) => formatCurrencyBRL(v, "R$ 0,00"),
                    },
                    { title: "Telefone", dataIndex: "telefone" },
                    {
                        title: "",
                        render: (_, record: any) => (
                            <Space>
                                <Button
                                    size="small"
                                    icon={<EyeOutlined />}
                                    onClick={() => onView(record)}
                                >
                                    Ver
                                </Button>
                                <Button
                                    size="small"
                                    icon={<EditOutlined />}
                                    onClick={() => onEdit(record.id)}
                                >
                                    Editar
                                </Button>
                            </Space>
                        ),
                    },
                ]}
            />
        )}
    </div>
);
