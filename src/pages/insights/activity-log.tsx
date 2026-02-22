import { HistoryOutlined, ReloadOutlined } from "@ant-design/icons";
import { useList } from "@refinedev/core";
import { Alert, Select, Skeleton, Space, Table, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, EmptyState } from "../../components/ui";
import {
    sortByDateDesc,
    toSafeDayjs,
    type InsightClienteRecord,
    type InsightStatusHistoryRecord,
    type InsightTaskRecord,
} from "../../lib/insights";
import { isSupabaseMissingRelation } from "../../lib/supabaseErrors";
import { supabaseClient } from "../../utility";
import { InsightsHeader, IntroCard } from "./shared";

type LogRow = {
    key: string;
    date?: string | null;
    user: string;
    objectType: "Lead" | "Atividade";
    objectName: string;
    event: string;
    before: string;
    after: string;
};

const OBJECT_FILTER_OPTIONS = [
    { value: "todos", label: "Todos os objetos" },
    { value: "Lead", label: "Leads" },
    { value: "Atividade", label: "Atividades" },
];

export const InsightsActivityLogPage = () => {
    const [objectFilter, setObjectFilter] = useState<string>("todos");
    const [historyItems, setHistoryItems] = useState<InsightStatusHistoryRecord[]>([]);
    const [historyError, setHistoryError] = useState<any>(null);
    const [isHistoryUnavailable, setIsHistoryUnavailable] = useState(false);
    const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(true);

    const tarefasResult = useList<InsightTaskRecord>({
        resource: "tarefas",
        pagination: { mode: "off" },
        sorters: [{ field: "created_at", order: "desc" }],
    }) as any;
    const clientesResult = useList<InsightClienteRecord>({
        resource: "clientes",
        pagination: { mode: "off" },
    }) as any;

    const tarefasQuery = tarefasResult.query || tarefasResult;
    const clientesQuery = clientesResult.query || clientesResult;

    const tarefas = (tarefasQuery?.data?.data || []) as InsightTaskRecord[];
    const clientes = (clientesQuery?.data?.data || []) as InsightClienteRecord[];
    const isLoading = Boolean(
        isLoadingHistory || tarefasQuery?.isLoading || clientesQuery?.isLoading,
    );

    const loadHistory = useCallback(async () => {
        setIsLoadingHistory(true);
        setHistoryError(null);
        setIsHistoryUnavailable(false);

        try {
            const { data, error } = await supabaseClient
                .from("cliente_status_history")
                .select("id,cliente_id,de_status,para_status,movido_em,movido_por")
                .order("movido_em", { ascending: false });

            if (error) {
                throw error;
            }

            setHistoryItems((data || []) as InsightStatusHistoryRecord[]);
        } catch (error: any) {
            if (isSupabaseMissingRelation(error)) {
                setHistoryItems([]);
                setHistoryError(null);
                setIsHistoryUnavailable(true);
                return;
            }

            setHistoryItems([]);
            setHistoryError(error);
        } finally {
            setIsLoadingHistory(false);
        }
    }, []);

    useEffect(() => {
        loadHistory();
    }, [loadHistory]);

    const clienteNames = useMemo(() => {
        const map = new Map<string, string>();
        clientes.forEach((cliente) => {
            map.set(String(cliente.id), cliente.nome?.trim() || `Cliente #${cliente.id}`);
        });
        return map;
    }, [clientes]);

    const rows = useMemo(() => {
        const statusRows: LogRow[] = historyItems.map((item) => {
            const clienteLabel = item.cliente_id
                ? clienteNames.get(String(item.cliente_id)) || `Cliente #${item.cliente_id}`
                : "Lead sem referencia";
            return {
                key: `status-${item.id}`,
                date: item.movido_em,
                user: item.movido_por || "Sistema",
                objectType: "Lead",
                objectName: clienteLabel,
                event: "Etapa de vendas alterada",
                before: item.de_status || "-",
                after: item.para_status || "-",
            };
        });

        const taskRows: LogRow[] = tarefas.map((task) => {
            const clienteLabel = task.cliente_id
                ? clienteNames.get(String(task.cliente_id)) || `Cliente #${task.cliente_id}`
                : "Sem cliente";
            return {
                key: `task-${task.id}`,
                date: task.created_at || task.data_vencimento,
                user: task.responsavel || "Time comercial",
                objectType: "Atividade",
                objectName: clienteLabel,
                event: task.titulo ? `Atividade registrada: ${task.titulo}` : "Atividade registrada",
                before: "-",
                after: task.tipo || "-",
            };
        });

        const merged = sortByDateDesc([...statusRows, ...taskRows], (row) => row.date);
        if (objectFilter === "todos") {
            return merged;
        }

        return merged.filter((row) => row.objectType === objectFilter);
    }, [historyItems, tarefas, clienteNames, objectFilter]);

    if (isLoading) {
        return <Skeleton active />;
    }

    return (
        <div style={{ padding: 20 }}>
            <InsightsHeader
                title="Registro de atividades"
                subtitle="Auditoria de alteracoes no funil e eventos operacionais."
                extra={
                    <Space wrap>
                        <Select
                            value={objectFilter}
                            onChange={(value) => setObjectFilter(value)}
                            options={OBJECT_FILTER_OPTIONS}
                            style={{ width: 180 }}
                        />
                        <Button
                            icon={<ReloadOutlined />}
                            onClick={() => {
                                loadHistory();
                                tarefasQuery?.refetch?.();
                            }}
                        >
                            Atualizar
                        </Button>
                    </Space>
                }
            />

            <IntroCard
                title="Trilha de auditoria comercial"
                description="Rastreie quem alterou etapas, quando a mudanca ocorreu e qual impacto ela trouxe."
                extra={<HistoryOutlined style={{ color: "#d7e5f7", fontSize: 24 }} />}
            />

            {historyError ? (
                <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="Nao foi possivel consultar o historico de status."
                    description={
                        historyError?.message ||
                        "Verifique se a tabela cliente_status_history existe no banco."
                    }
                />
            ) : null}

            {isHistoryUnavailable ? (
                <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="Historico de etapas ainda nao configurado no banco."
                    description="Enquanto isso, o registro segue mostrando os eventos de atividades."
                />
            ) : null}

            <Card title="Eventos">
                {rows.length === 0 ? (
                    <EmptyState
                        title="Sem eventos para os filtros atuais"
                        description="A trilha aparece automaticamente conforme o time opera o CRM."
                    />
                ) : (
                    <Table
                        rowKey={(record) => record.key}
                        size="small"
                        pagination={{ pageSize: 15 }}
                        dataSource={rows}
                        columns={[
                            {
                                title: "Data",
                                dataIndex: "date",
                                width: 150,
                                render: (value?: string | null) =>
                                    toSafeDayjs(value)?.format("DD/MM/YYYY HH:mm") || "-",
                            },
                            { title: "Usuario", dataIndex: "user", width: 180 },
                            { title: "Tipo", dataIndex: "objectType", width: 100 },
                            {
                                title: "Objeto",
                                dataIndex: "objectName",
                                render: (value: string) => (
                                    <Typography.Text strong>{value}</Typography.Text>
                                ),
                            },
                            { title: "Evento", dataIndex: "event" },
                            { title: "Valor antes", dataIndex: "before", width: 180 },
                            { title: "Valor depois", dataIndex: "after", width: 180 },
                        ]}
                    />
                )}
            </Card>
        </div>
    );
};
