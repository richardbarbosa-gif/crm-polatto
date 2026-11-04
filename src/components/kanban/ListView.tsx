import React, { useEffect, useMemo, useState } from "react";
import { Modal, Select, Space, Table, Typography, message } from "antd";
import { DeleteOutlined, EditOutlined, EyeOutlined } from "@ant-design/icons";
import { useDelete, useUpdate } from "@refinedev/core";
import { Badge, Button, EmptyState, TemperatureBadge } from "../ui";
import { getStatusTone, type KanbanLead } from "./types";
import { formatCurrencyBRL } from "../../lib/formatters";
import { resolveLeadTemperature } from "../../lib/leadTemperature";
import { valorDoLead } from "../../lib/pipelineMetrics";
import { supabaseClient } from "../../utility";

const { Text } = Typography;

export interface ListViewStageOption {
    id?: string | number;
    nome: string;
    pipeline_id?: string | null;
}

export interface ListViewProps {
    listData: KanbanLead[];
    listTotal: number;
    listPage: number;
    isLoading: boolean;
    listError: unknown;
    listErrorMessage: string | null;
    onPageChange: (page: number) => void;
    resolveLeadStageName: (record: KanbanLead) => string;
    onView: (lead: KanbanLead) => void;
    onEdit: (leadId: string | number) => void;
    /** Gerente exclui qualquer lead; vendedor só os seus (regra garantida no banco). */
    podeExcluir?: (lead: KanbanLead) => boolean;
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
    podeExcluir = () => false,
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
                    (data as ListViewStageOption[]).filter((s) => s && s.nome),
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
    const podeExcluirAlgum = useMemo(
        () => listData.some((lead) => selectedRowKeys.includes(lead.id as React.Key) && podeExcluir(lead)),
        [listData, podeExcluir, selectedRowKeys],
    );

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
                        // Mesmo critério do arraste: o negócio passa ao funil da etapa.
                        ...(option.stage.pipeline_id ? { pipeline_id: option.stage.pipeline_id } : {}),
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

        const selecionados = listData.filter((lead) => selectedRowKeys.includes(lead.id as React.Key));
        const ids = selecionados.filter((lead) => podeExcluir(lead)).map((lead) => lead.id as React.Key);
        const deOutros = selectedRowKeys.length - ids.length;

        if (ids.length === 0) {
            message.warning("Você só pode excluir os seus leads. Peça ao gerente para excluir os de outros vendedores.");
            return;
        }

        Modal.confirm({
            title: `Excluir ${ids.length} lead(s)?`,
            content:
                "Os negócios saem do funil e dos relatórios e vão para a Lixeira, de onde podem ser restaurados." +
                (deOutros > 0 ? ` ${deOutros} lead(s) de outros vendedores ficam de fora: só o gerente exclui.` : ""),
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
                            {podeExcluirAlgum && (
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
                                render: (_, record: KanbanLead) => {
                                    const stageName = resolveLeadStageName(record);
                                    return <Badge tone={getStatusTone(stageName)}>{stageName}</Badge>;
                                },
                            },
                            {
                                title: "Temperatura",
                                key: "temperature",
                                render: (_, record: KanbanLead) => (
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
                                key: "valor",
                                render: (_, record: KanbanLead) =>
                                    formatCurrencyBRL(valorDoLead(record), "R$ 0,00"),
                            },
                            { title: "Telefone", dataIndex: "telefone" },
                            {
                                title: "",
                                render: (_, record: KanbanLead) => (
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
