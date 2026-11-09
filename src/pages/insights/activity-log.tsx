import {
    DownloadOutlined,
    HistoryOutlined,
    ProfileOutlined,
    ReloadOutlined,
} from "@ant-design/icons";
import { useList } from "@refinedev/core";
import { Alert, Select, Skeleton, Space, Table, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, EmptyState } from "../../components/ui";
import {
    sortByDateDesc,
    toSafeDayjs,
    type InsightStatusHistoryRecord,
    type InsightTaskRecord,
} from "../../lib/insights";
import { exportRowsToCsv } from "../../lib/exportCsv";
import { isSupabaseMissingRelation } from "../../lib/supabaseErrors";
import { supabaseClient } from "../../utility";
import { useNomesDeClientes } from "../../lib/nomesDeClientes";
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

/** Quantos eventos de cada tipo (mudança de etapa, atividade) o registro exibe. */
const LIMITE_EVENTOS = 500;

const OBJECT_FILTER_OPTIONS = [
    { value: "todos", label: "Todos os objetos" },
    { value: "Lead", label: "Leads" },
    { value: "Atividade", label: "Atividades" },
];

export const InsightsActivityLogPage = () => {
    const [objectFilter, setObjectFilter] = useState<string>("todos");
    const [historyItems, setHistoryItems] = useState<InsightStatusHistoryRecord[]>([]);
    const [historyError, setHistoryError] = useState<{ message?: string } | null>(null);
    const [isHistoryUnavailable, setIsHistoryUnavailable] = useState(false);
    const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(true);

    // O registro mostra os eventos mais recentes: limita no servidor em vez
    // de baixar todas as tarefas, todo o histórico e a base de leads inteira.
    const { query: tarefasQuery } = useList<InsightTaskRecord>({
        resource: "tarefas",
        pagination: { currentPage: 1, pageSize: LIMITE_EVENTOS },
        filters: [{ field: "deleted_at", operator: "null", value: true }],
        sorters: [{ field: "created_at", order: "desc" }],
    });

    const tarefas = useMemo(() => tarefasQuery?.data?.data ?? [], [tarefasQuery?.data?.data]);
    const isLoading = Boolean(isLoadingHistory || tarefasQuery?.isLoading);

    const loadHistory = useCallback(async () => {
        setIsLoadingHistory(true);
        setHistoryError(null);
        setIsHistoryUnavailable(false);

        try {
            const { data, error } = await supabaseClient
                .from("cliente_status_history")
                .select("id,cliente_id,de_status,para_status,movido_em,movido_por")
                .order("movido_em", { ascending: false })
                .limit(LIMITE_EVENTOS);

            if (error) {
                throw error;
            }

            setHistoryItems((data || []) as InsightStatusHistoryRecord[]);
        } catch (error: unknown) {
            if (isSupabaseMissingRelation(error)) {
                setHistoryItems([]);
                setHistoryError(null);
                setIsHistoryUnavailable(true);
                return;
            }

            setHistoryItems([]);
            setHistoryError(error as { message?: string });
        } finally {
            setIsLoadingHistory(false);
        }
    }, []);

    useEffect(() => {
        loadHistory();
    }, [loadHistory]);

    const idsDosClientes = useMemo(
        () => [...historyItems.map((item) => item.cliente_id), ...tarefas.map((task) => task.cliente_id)],
        [historyItems, tarefas],
    );
    const clienteNames = useNomesDeClientes(idsDosClientes);

    const rows = useMemo(() => {
        const statusRows: LogRow[] = historyItems.map((item) => {
            const clienteLabel = item.cliente_id
                ? clienteNames.get(String(item.cliente_id)) || `Cliente #${item.cliente_id}`
                : "Lead sem referência";
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
                icon={<ProfileOutlined />}
                title="Registro de atividades"
                subtitle="Auditoria de alterações no funil e eventos operacionais."
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
                        <Button
                            icon={<DownloadOutlined />}
                            disabled={rows.length === 0}
                            onClick={() =>
                                exportRowsToCsv(
                                    "registro-de-atividades",
                                    rows.map((row) => ({
                                        data: row.date ?? "",
                                        usuario: row.user,
                                        tipo_objeto: row.objectType,
                                        objeto: row.objectName,
                                        evento: row.event,
                                        antes: row.before,
                                        depois: row.after,
                                    })),
                                )
                            }
                        >
                            Exportar CSV
                        </Button>
                    </Space>
                }
            />

            <IntroCard
                title="Trilha de auditoria comercial"
                description="Rastreie quem alterou etapas, quando a mudança ocorreu e qual impacto ela trouxe."
                extra={<HistoryOutlined style={{ color: "#d7e5f7", fontSize: 24 }} />}
            />

            {historyError ? (
                <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="Não foi possível consultar o histórico de etapas."
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
                    message="Histórico de etapas ainda não configurado no banco."
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
                                className: "crm-nowrap",
                                dataIndex: "date",
                                width: 150,
                                render: (value?: string | null) =>
                                    toSafeDayjs(value)?.format("DD/MM/YYYY HH:mm") || "-",
                            },
                            { title: "Usuário", dataIndex: "user", width: 180 },
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
