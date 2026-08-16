import React, { useEffect, useMemo, useState } from "react";
import { Modal, Select, Space, Table, Typography, message } from "antd";
import { DeleteOutlined, EditOutlined, EyeOutlined } from "@ant-design/icons";
import { useDelete, useUpdate } from "@refinedev/core";
import { Badge, Button, EmptyState, TemperatureBadge } from "../ui";
import { getStatusTone } from "./types";
import { formatCurrencyBRL } from "../../lib/formatters";
import { resolveLeadTemperature } from "../../lib/leadTemperature";
import { supabaseClient } from "../../utility";

const { Text } = Typography;

export interface ListViewStageOption {
    id?: string | number;
    nome: string;
}

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
    canDeleteRecords?: boolean;
    stages?: ListViewStageOption[];
    onRefresh?: () => void;
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
    canDeleteRecords = false,
    stages,
    onRefresh,
}) => {
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
    const [fallbackStages, setFallbackStages] = useState<ListViewStageOption[]>([]);
    const [isBulkWorking, setIsBulkWorking] = useState(false);

    const { mutateAsync: updateLead } = useUpdate();
    const { mutateAsync: deleteLead } = useDelete();

    const hasStagesProp = Boolean(stages && stages.length > 0);

    useEffect(() => {
        if (hasStagesProp) {
            return;
        }

        let active = true;

        const loadStages = async () => {
            try {
                const { data, error } = await supabaseClient
                    .from("pipeline_stages")
                    .select("id,nome")
                    .order("ordem");

                if (!active || error || !Array.isArray(data)) {
                    return;
                }
                setFallbackStages(
                    data.filter((s: any) => s && s.nome) as ListViewStageOption[],
                );
            } catch {
                return;
            }
        };

        loadStages();

        return () => {
            active = false;
        };
    }, [hasStagesProp]);

    const stageOptions = useMemo(() => {
        const source = hasStagesProp ? (stages as ListViewStageOption[]) : fallbackStages;
        return source
            .filter((s) => s && s.nome)
            .map((s) => ({
                value: String(s.id ?? s.nome),
                label: s.nome,
                stage: s,
            }));
    }, [hasStagesProp, stages, fallbackStages]);

    const selectedCount = selectedRowKeys.length;

    const finishBulk = (successText: string) => {
        setSelectedRowKeys([]);
        if (onRefresh) {
            message.success(successText);
            onRefresh();
            return;
        }
        message.success(`${successText} A lista atualiza automaticamente.`);
    };

    const handleBulkMove = async (value: string) => {
        const option = stageOptions.find((opt) => opt.value === value);
        if (!option || selectedCount === 0 || isBulkWorking) {
            return;
        }

        const ids = [...selectedRowKeys];
        setIsBulkWorking(true);
        const hideLoading = message.loading(
            `Movendo ${ids.length} lead(s) para ${option.stage.nome}...`,
            0,
        );

        let failures = 0;
        for (const id of ids) {
            try {
                await updateLead({
                    resource: "clientes",
                    id: id as string | number,
                    values: {
                        stage_id: option.stage.id ?? null,
                        status: option.stage.nome,
                    },
                    successNotification: false,
                    errorNotification: false,
                });
            } catch {
                failures += 1;
            }
        }

        hideLoading();
        setIsBulkWorking(false);

        if (failures === ids.length) {
            message.error("Não foi possível mover os leads selecionados.");
            return;
        }
        if (failures > 0) {
            message.warning(`${failures} lead(s) não puderam ser movidos.`);
        }
        finishBulk(`${ids.length - failures} lead(s) movido(s) para ${option.stage.nome}.`);
    };

    const handleBulkDelete = () => {
        if (selectedCount === 0 || isBulkWorking) {
            return;
        }

        const ids = [...selectedRowKeys];

        Modal.confirm({
            title: `Excluir ${ids.length} lead(s) selecionado(s)?`,
            content: "Esta ação é permanente e não pode ser desfeita.",
            okText: "Excluir",
            okButtonProps: { danger: true },
            cancelText: "Cancelar",
            onOk: async () => {
                setIsBulkWorking(true);
                const hideLoading = message.loading(
                    `Excluindo ${ids.length} lead(s)...`,
                    0,
                );

                let failures = 0;
                for (const id of ids) {
                    try {
                        await deleteLead({
                            resource: "clientes",
                            id: id as string | number,
                            successNotification: false,
                            errorNotification: false,
                        });
                    } catch {
                        failures += 1;
                    }
                }

                hideLoading();
                setIsBulkWorking(false);

                if (failures === ids.length) {
                    message.error("Não foi possível excluir os leads selecionados.");
                    return;
                }
                if (failures > 0) {
                    message.warning(`${failures} lead(s) não puderam ser excluídos.`);
                }
                finishBulk(`${ids.length - failures} lead(s) excluído(s).`);
            },
        });
    };

    return (
        <div className="crm-list-shell">
            {listError ? (
                <EmptyState
                    title="Erro ao carregar leads"
                    description={listErrorMessage || "Revise as policies RLS."}
                />
            ) : (
                <>
                    {selectedCount > 0 && (
                        <div
                            className="crm-bulk-actions-bar"
                            style={{
                                display: "flex",
                                alignItems: "center",
                                flexWrap: "wrap",
                                gap: 12,
                                padding: "10px 14px",
                                marginBottom: 12,
                                borderRadius: 10,
                                border: "1px solid var(--crm-border)",
                                background: "var(--crm-surface-1)",
                            }}
                        >
                            <Text strong style={{ color: "var(--crm-ink-900)" }}>
                                {selectedCount} selecionado{selectedCount > 1 ? "s" : ""}
                            </Text>
                            <Select
                                placeholder="Mover para etapa..."
                                style={{ minWidth: 200 }}
                                size="small"
                                value={undefined}
                                options={stageOptions.map(({ value, label }) => ({ value, label }))}
                                onChange={handleBulkMove}
                                disabled={isBulkWorking || stageOptions.length === 0}
                            />
                            {canDeleteRecords && (
                                <Button
                                    size="small"
                                    danger
                                    icon={<DeleteOutlined />}
                                    onClick={handleBulkDelete}
                                    disabled={isBulkWorking}
                                >
                                    Excluir selecionados
                                </Button>
                            )}
                            <Button
                                size="small"
                                type="text"
                                onClick={() => setSelectedRowKeys([])}
                                disabled={isBulkWorking}
                            >
                                Limpar seleção
                            </Button>
                        </div>
                    )}
                    <Table
                        dataSource={listData}
                        rowKey="id"
                        size="middle"
                        loading={isLoading}
                        rowSelection={{
                            selectedRowKeys,
                            onChange: setSelectedRowKeys,
                            preserveSelectedRowKeys: true,
                        }}
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
                </>
            )}
        </div>
    );
};
