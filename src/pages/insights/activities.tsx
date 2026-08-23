import {
    CalendarOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    DownloadOutlined,
    MessageOutlined,
    PhoneOutlined,
} from "@ant-design/icons";
import { useList } from "@refinedev/core";
import { Col, Row, Select, Skeleton, Space, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { Button, Card, EmptyState, StatCard } from "../../components/ui";
import { exportRowsToCsv } from "../../lib/exportCsv";
import {
    getTaskSituation,
    isDateInLastDays,
    toSafeDayjs,
    type TaskSituation,
    type InsightClienteRecord,
    type InsightTaskRecord,
} from "../../lib/insights";
import {
    resolveTaskExecutionStatus,
    subscribeTaskExecutionStatusUpdates,
    TASK_EXECUTION_STATUS_LABELS,
    type TaskExecutionStatus,
} from "../../lib/taskExecutionStatus";
import { InsightsHeader, IntroCard } from "./shared";

const PERIOD_OPTIONS = [
    { label: "7 dias", value: 7 },
    { label: "30 dias", value: 30 },
    { label: "90 dias", value: 90 },
];

const TYPE_OPTIONS = [
    { value: "todos", label: "Todos os tipos" },
    { value: "visita", label: "Visitas" },
    { value: "ligacao", label: "Ligacoes" },
    { value: "whatsapp", label: "WhatsApp" },
    { value: "email", label: "Email" },
];

const getTypeTagColor = (type?: string | null) => {
    if (type === "visita") return "blue";
    if (type === "ligacao") return "purple";
    if (type === "whatsapp") return "green";
    if (type === "email") return "orange";
    return "default";
};

const TASK_EXECUTION_STATUS_COLORS: Record<TaskExecutionStatus, string> = {
    pendente: "default",
    resolvido: "success",
    ligar_novamente: "purple",
    voltar_outro_dia: "gold",
};

const getSituationTag = (
    situation: TaskSituation,
    executionStatus: TaskExecutionStatus,
) => {
    if (executionStatus !== "pendente") {
        return (
            <Tag color={TASK_EXECUTION_STATUS_COLORS[executionStatus]}>
                {TASK_EXECUTION_STATUS_LABELS[executionStatus]}
            </Tag>
        );
    }

    if (situation === "atrasada") return <Tag color="red">Atrasada</Tag>;
    if (situation === "tratada") return <Tag color="green">Tratada</Tag>;
    if (situation === "hoje") return <Tag color="blue">Hoje</Tag>;
    if (situation === "proxima") return <Tag color="gold">Proxima</Tag>;
    return <Tag>Pendente</Tag>;
};

export const InsightsActivitiesPage = () => {
    const [, setExecutionStatusRevision] = useState(0);
    const [periodDays, setPeriodDays] = useState<number>(30);
    const [typeFilter, setTypeFilter] = useState<string>("todos");

    useEffect(() => {
        return subscribeTaskExecutionStatusUpdates(() => {
            setExecutionStatusRevision((previous) => previous + 1);
        });
    }, []);

    const tarefasResult = useList<InsightTaskRecord>({
        resource: "tarefas",
        pagination: { mode: "off" },
        sorters: [{ field: "data_vencimento", order: "asc" }],
    }) as any;
    const clientesResult = useList<InsightClienteRecord>({
        resource: "clientes",
        pagination: { mode: "off" },
    }) as any;

    const tarefasQuery = tarefasResult.query || tarefasResult;
    const clientesQuery = clientesResult.query || clientesResult;
    const tarefas = (tarefasQuery?.data?.data || []) as InsightTaskRecord[];
    const clientes = (clientesQuery?.data?.data || []) as InsightClienteRecord[];
    const isLoading = Boolean(tarefasQuery?.isLoading || clientesQuery?.isLoading);

    const clienteById = useMemo(() => {
        const map = new Map<string, string>();
        clientes.forEach((cliente) => {
            map.set(String(cliente.id), cliente.nome?.trim() || `Cliente #${cliente.id}`);
        });
        return map;
    }, [clientes]);

    const filteredTasks = useMemo(() => {
        return tarefas.filter((task) => {
            const taskDate = task.data_vencimento || task.created_at;
            if (!isDateInLastDays(taskDate, periodDays)) {
                return false;
            }

            if (typeFilter !== "todos" && task.tipo !== typeFilter) {
                return false;
            }

            return true;
        });
    }, [periodDays, tarefas, typeFilter]);

    const metrics = useMemo(() => {
        const now = dayjs();
        const overdue = filteredTasks.filter(
            (task) =>
                getTaskSituation(
                    task.data_vencimento,
                    now,
                    resolveTaskExecutionStatus(task as Record<string, any>),
                ) === "atrasada",
        ).length;
        const today = filteredTasks.filter(
            (task) =>
                getTaskSituation(
                    task.data_vencimento,
                    now,
                    resolveTaskExecutionStatus(task as Record<string, any>),
                ) === "hoje",
        ).length;
        const visits = filteredTasks.filter((task) => task.tipo === "visita").length;
        const calls = filteredTasks.filter((task) => task.tipo === "ligacao").length;
        const whatsapp = filteredTasks.filter((task) => task.tipo === "whatsapp").length;

        return {
            overdue,
            today,
            visits,
            calls,
            whatsapp,
            total: filteredTasks.length,
        };
    }, [filteredTasks]);

    if (isLoading) {
        return <Skeleton active />;
    }

    return (
        <div style={{ padding: 20 }}>
            <InsightsHeader
                title="Relatorio de atividades"
                subtitle="Controle produtividade, SLA e ritmo de contatos do time comercial."
                extra={
                    <Space wrap>
                        <Select
                            value={periodDays}
                            options={PERIOD_OPTIONS}
                            onChange={(value) => setPeriodDays(value)}
                            style={{ width: 120 }}
                        />
                        <Select
                            value={typeFilter}
                            options={TYPE_OPTIONS}
                            onChange={(value) => setTypeFilter(value)}
                            style={{ width: 150 }}
                        />
                        <Button
                            icon={<DownloadOutlined />}
                            disabled={filteredTasks.length === 0}
                            onClick={() =>
                                exportRowsToCsv(
                                    "relatorio-atividades",
                                    filteredTasks.map((task) => ({
                                        titulo: task.titulo ?? "",
                                        tipo: task.tipo ?? "",
                                        vencimento: task.data_vencimento ?? "",
                                        concluida: task.concluido ? "sim" : "nao",
                                        criada_em: task.created_at ?? "",
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
                title="Producao de atividades em alta visibilidade"
                description="Mostre rapidamente onde ha gargalo de execucao e quais contatos aceleram fechamentos."
            />

            <Row gutter={[12, 12]}>
                <Col xs={24} md={12} xl={6}>
                    <StatCard
                        title="Total de atividades"
                        value={metrics.total}
                        prefix={<CheckCircleOutlined style={{ color: "#2563eb" }} />}
                        accentColor="#2563eb"
                        subtitle="Dentro dos filtros aplicados"
                    />
                </Col>
                <Col xs={24} md={12} xl={6}>
                    <StatCard
                        title="Pendencias"
                        value={metrics.overdue}
                        prefix={<ClockCircleOutlined style={{ color: "#ef4444" }} />}
                        accentColor="#ef4444"
                        subtitle="Atividades atrasadas"
                        valueStyle={{ color: "#b91c1c" }}
                    />
                </Col>
                <Col xs={24} md={12} xl={6}>
                    <StatCard
                        title="Visitas"
                        value={metrics.visits}
                        prefix={<CalendarOutlined style={{ color: "#0f766e" }} />}
                        accentColor="#0f766e"
                        subtitle={`${metrics.today} para hoje`}
                    />
                </Col>
                <Col xs={24} md={12} xl={6}>
                    <StatCard
                        title="Contato ativo"
                        value={metrics.calls + metrics.whatsapp}
                        prefix={<MessageOutlined style={{ color: "#16a34a" }} />}
                        accentColor="#16a34a"
                        subtitle={`${metrics.calls} ligacoes + ${metrics.whatsapp} WhatsApp`}
                    />
                </Col>
            </Row>

            <Card title="Detalhamento de atividades" style={{ marginTop: 12 }}>
                {filteredTasks.length === 0 ? (
                    <EmptyState
                        title="Nenhuma atividade encontrada"
                        description="Ajuste filtros ou lance novas tarefas para alimentar o relatorio."
                    />
                ) : (
                    <Table
                        rowKey={(record) => String(record.id)}
                        size="small"
                        pagination={{ pageSize: 12 }}
                        dataSource={filteredTasks}
                        columns={[
                            {
                                title: "Data",
                                dataIndex: "data_vencimento",
                                width: 140,
                                render: (value?: string | null) =>
                                    toSafeDayjs(value)?.format("DD/MM/YYYY HH:mm") || "-",
                            },
                            {
                                title: "Atividade",
                                dataIndex: "titulo",
                                render: (value?: string | null) => (
                                    <Typography.Text strong>{value || "Sem titulo"}</Typography.Text>
                                ),
                            },
                            {
                                title: "Tipo",
                                dataIndex: "tipo",
                                width: 120,
                                render: (value?: string | null) => (
                                    <Tag color={getTypeTagColor(value)}>
                                        {value === "ligacao" ? (
                                            <PhoneOutlined />
                                        ) : value === "whatsapp" ? (
                                            <MessageOutlined />
                                        ) : null}{" "}
                                        {value || "tipo"}
                                    </Tag>
                                ),
                            },
                            {
                                title: "Cliente",
                                width: 200,
                                render: (_, record: InsightTaskRecord) =>
                                    record.cliente_id
                                        ? clienteById.get(String(record.cliente_id)) ||
                                          `Cliente #${record.cliente_id}`
                                        : "Sem cliente",
                            },
                            {
                                title: "Status",
                                width: 110,
                                render: (_, record: InsightTaskRecord) => {
                                    const executionStatus = resolveTaskExecutionStatus(
                                        record as Record<string, any>,
                                    );
                                    return getSituationTag(
                                        getTaskSituation(
                                            record.data_vencimento,
                                            dayjs(),
                                            executionStatus,
                                        ),
                                        executionStatus,
                                    );
                                },
                            },
                        ]}
                    />
                )}
            </Card>
        </div>
    );
};
