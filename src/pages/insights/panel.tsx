import {
    CalendarOutlined,
    FlagOutlined,
    RiseOutlined,
    TeamOutlined,
} from "@ant-design/icons";
import { useList } from "@refinedev/core";
import { Col, List, Progress, Row, Skeleton, Space, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button, Card, EmptyState, StatCard } from "../../components/ui";
import { formatCurrencyBRL } from "../../lib/formatters";
import {
    buildOwnerPerformance,
    getInsightValue,
    getTaskSituation,
    isDateInMonth,
    isOpenStatus,
    isWonStatus,
    sortByDateDesc,
    toSafeDayjs,
    type InsightClienteRecord,
    type InsightStatusHistoryRecord,
    type InsightTaskRecord,
} from "../../lib/insights";
import {
    resolveTaskExecutionStatus,
    subscribeTaskExecutionStatusUpdates,
} from "../../lib/taskExecutionStatus";
import { supabaseClient } from "../../utility";
import { InsightsHeader, IntroCard } from "./shared";

type RecentEvent = {
    id: string;
    when?: string | null;
    user: string;
    object: string;
    event: string;
    before?: string | null;
    after?: string | null;
};

export const InsightsPanelPage = () => {
    const [, setExecutionStatusRevision] = useState(0);
    const [historyItems, setHistoryItems] = useState<InsightStatusHistoryRecord[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(true);
    const navigate = useNavigate();

    useEffect(() => {
        return subscribeTaskExecutionStatusUpdates(() => {
            setExecutionStatusRevision((previous) => previous + 1);
        });
    }, []);

    const loadHistory = useCallback(async () => {
        setIsLoadingHistory(true);

        try {
            const { data, error } = await supabaseClient
                .from("cliente_status_history")
                .select("id,cliente_id,de_status,para_status,movido_em,movido_por")
                .order("movido_em", { ascending: false });

            if (error) {
                throw error;
            }

            setHistoryItems((data || []) as InsightStatusHistoryRecord[]);
        } catch {
            setHistoryItems([]);
        } finally {
            setIsLoadingHistory(false);
        }
    }, []);

    useEffect(() => {
        loadHistory();
    }, [loadHistory]);

    const clientesResult = useList<InsightClienteRecord>({
        resource: "clientes",
        pagination: { mode: "off" },
    }) as any;
    const tarefasResult = useList<InsightTaskRecord>({
        resource: "tarefas",
        pagination: { mode: "off" },
        sorters: [{ field: "data_vencimento", order: "asc" }],
    }) as any;

    const clientesQuery = clientesResult.query || clientesResult;
    const tarefasQuery = tarefasResult.query || tarefasResult;

    const clientes = (clientesQuery?.data?.data || []) as InsightClienteRecord[];
    const tarefas = (tarefasQuery?.data?.data || []) as InsightTaskRecord[];

    const isLoading = Boolean(
        isLoadingHistory || clientesQuery?.isLoading || tarefasQuery?.isLoading,
    );

    const clienteNamesById = useMemo(() => {
        const map = new Map<string, string>();
        clientes.forEach((cliente) => {
            map.set(String(cliente.id), cliente.nome?.trim() || `Cliente #${cliente.id}`);
        });
        return map;
    }, [clientes]);

    const metrics = useMemo(() => {
        const nowDate = new Date();
        const currentMonthRef = toSafeDayjs(nowDate.toISOString());
        const pipelineValue = clientes
            .filter((cliente) => isOpenStatus(cliente.status))
            .reduce((acc, cliente) => acc + getInsightValue(cliente.conta_energia_media), 0);
        const closedThisMonth = clientes.filter(
            (cliente) =>
                isWonStatus(cliente.status) &&
                currentMonthRef &&
                isDateInMonth(cliente.created_at, currentMonthRef),
        );
        const closedThisMonthValue = closedThisMonth.reduce(
            (acc, cliente) => acc + getInsightValue(cliente.conta_energia_media),
            0,
        );
        const closed = clientes.filter((cliente) => isWonStatus(cliente.status)).length;
        const cycleBase = clientes.length || 1;
        const conversion = Number(((closed / cycleBase) * 100).toFixed(1));
        const nowRef = dayjs();
        const lateTasks = tarefas.filter(
            (task) =>
                getTaskSituation(
                    task.data_vencimento,
                    nowRef,
                    resolveTaskExecutionStatus(task as Record<string, any>),
                ) === "atrasada",
        ).length;
        const todayTasks = tarefas.filter((task) => {
            const due = toSafeDayjs(task.data_vencimento);
            return due ? due.isSame(nowDate, "day") : false;
        }).length;

        return {
            pipelineValue,
            closedThisMonthValue,
            conversion,
            lateTasks,
            todayTasks,
            totalClientes: clientes.length,
        };
    }, [clientes, tarefas]);

    const ownerPerformance = useMemo(() => buildOwnerPerformance(clientes).slice(0, 8), [clientes]);

    const upcomingTasks = useMemo(() => {
        const now = new Date();
        return tarefas
            .filter((task) => {
                const due = toSafeDayjs(task.data_vencimento);
                return due ? due.isAfter(now) : false;
            })
            .slice(0, 8);
    }, [tarefas]);

    const recentEvents = useMemo(() => {
        const statusEvents: RecentEvent[] = historyItems.map((item) => ({
            id: `status-${item.id}`,
            when: item.movido_em,
            user: item.movido_por || "Sistema",
            object: "Lead",
            event: "Etapa alterada",
            before: item.de_status || "-",
            after: item.para_status || "-",
        }));

        const taskEvents: RecentEvent[] = tarefas.map((task) => ({
            id: `task-${task.id}`,
            when: task.created_at || task.data_vencimento,
            user: task.responsavel || "Time comercial",
            object: "Atividade",
            event: task.titulo ? `Atividade: ${task.titulo}` : "Atividade registrada",
            before: "-",
            after: task.tipo || "-",
        }));

        return sortByDateDesc([...statusEvents, ...taskEvents], (event) => event.when).slice(0, 12);
    }, [historyItems, tarefas]);

    if (isLoading) {
        return <Skeleton active />;
    }

    return (
        <div style={{ padding: 20 }}>
            <InsightsHeader
                title="Painel de Insights"
                subtitle="Visao executiva de desempenho comercial, atividades e previsibilidade."
                extra={
                    <Space wrap>
                        <Button onClick={() => navigate("/insights/roi")}>ROI</Button>
                        <Button onClick={() => navigate("/insights/logs")}>Registros</Button>
                        <Button type="primary" onClick={() => navigate("/insights/goals")}>
                            Definir metas
                        </Button>
                    </Space>
                }
            />

            <IntroCard
                title="Diagnostico comercial em tempo real"
                description="Acompanhe ROI, ritmo de atividades, ganhos/perdas e evolucao do time sem sair do CRM."
            />

            <Row gutter={[12, 12]}>
                <Col xs={24} md={12} xl={6}>
                    <StatCard
                        title="Pipeline aberto"
                        value={metrics.pipelineValue}
                        prefix={<RiseOutlined style={{ color: "#4c8bf5" }} />}
                        accentColor="#4c8bf5"
                        valueStyle={{ color: "#1d4ed8" }}
                        subtitle={formatCurrencyBRL(metrics.pipelineValue, "R$ 0,00")}
                    />
                </Col>
                <Col xs={24} md={12} xl={6}>
                    <StatCard
                        title="Fechado no mes"
                        value={metrics.closedThisMonthValue}
                        prefix={<FlagOutlined style={{ color: "#16a34a" }} />}
                        accentColor="#16a34a"
                        valueStyle={{ color: "#166534" }}
                        subtitle="Volume de ganhos do mes atual"
                    />
                </Col>
                <Col xs={24} md={12} xl={6}>
                    <StatCard
                        title="Conversao geral"
                        value={metrics.conversion}
                        suffix="%"
                        prefix={<TeamOutlined style={{ color: "#e67e22" }} />}
                        accentColor="#e67e22"
                        valueStyle={{ color: "#b45309" }}
                        subtitle={`${metrics.totalClientes} oportunidades no CRM`}
                    />
                </Col>
                <Col xs={24} md={12} xl={6}>
                    <StatCard
                        title="Atividades do dia"
                        value={metrics.todayTasks}
                        prefix={<CalendarOutlined style={{ color: "#0f766e" }} />}
                        accentColor="#0f766e"
                        valueStyle={{ color: "#115e59" }}
                        subtitle={`${metrics.lateTasks} atrasadas para tratar agora`}
                    />
                </Col>
            </Row>

            <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
                <Col xs={24} xl={16}>
                    <Card title="Desempenho por consultor" bodyStyle={{ padding: 0 }}>
                        <Table
                            size="small"
                            rowKey={(record) => record.owner}
                            pagination={false}
                            dataSource={ownerPerformance}
                            columns={[
                                {
                                    title: "Consultor",
                                    dataIndex: "owner",
                                    render: (value: string) => (
                                        <Typography.Text strong>{value}</Typography.Text>
                                    ),
                                },
                                { title: "Total", dataIndex: "total", width: 72 },
                                { title: "Ativos", dataIndex: "ativos", width: 72 },
                                { title: "Ganhos", dataIndex: "ganhos", width: 82 },
                                {
                                    title: "Conversao",
                                    width: 170,
                                    render: (_, record: { ganhos: number; perdas: number }) => {
                                        const base = record.ganhos + record.perdas;
                                        const percent = base > 0 ? (record.ganhos / base) * 100 : 0;
                                        return (
                                            <Progress
                                                percent={Number(percent.toFixed(1))}
                                                size="small"
                                                strokeColor="#16a34a"
                                            />
                                        );
                                    },
                                },
                                {
                                    title: "Valor",
                                    dataIndex: "valor",
                                    width: 130,
                                    render: (value: number) => formatCurrencyBRL(value, "R$ 0,00"),
                                },
                            ]}
                        />
                    </Card>
                </Col>

                <Col xs={24} xl={8}>
                    <Card title="Proximas atividades">
                        {upcomingTasks.length === 0 ? (
                            <EmptyState
                                title="Sem atividades futuras"
                                description="Cadastre tarefas na agenda para distribuir a carga do time."
                            />
                        ) : (
                            <List
                                itemLayout="horizontal"
                                size="small"
                                dataSource={upcomingTasks}
                                renderItem={(task) => {
                                    const clienteLabel = task.cliente_id
                                        ? clienteNamesById.get(String(task.cliente_id)) ||
                                          `Cliente #${task.cliente_id}`
                                        : "Sem cliente";
                                    return (
                                        <List.Item>
                                            <List.Item.Meta
                                                title={
                                                    <Space size={8}>
                                                        <Typography.Text strong>
                                                            {task.titulo || "Atividade"}
                                                        </Typography.Text>
                                                        <Tag color="blue">{task.tipo || "tipo"}</Tag>
                                                    </Space>
                                                }
                                                description={
                                                    <Space
                                                        style={{
                                                            display: "flex",
                                                            justifyContent: "space-between",
                                                            width: "100%",
                                                        }}
                                                    >
                                                        <Typography.Text type="secondary">
                                                            {clienteLabel}
                                                        </Typography.Text>
                                                        <Typography.Text type="secondary">
                                                            {toSafeDayjs(task.data_vencimento)?.format(
                                                                "DD/MM HH:mm",
                                                            ) || "-"}
                                                        </Typography.Text>
                                                    </Space>
                                                }
                                            />
                                        </List.Item>
                                    );
                                }}
                            />
                        )}
                    </Card>
                </Col>
            </Row>

            <Card title="Eventos recentes" style={{ marginTop: 12 }}>
                <Table
                    size="small"
                    rowKey={(record) => record.id}
                    pagination={{ pageSize: 8, hideOnSinglePage: true }}
                    dataSource={recentEvents}
                    columns={[
                        {
                            title: "Data",
                            dataIndex: "when",
                            width: 140,
                            render: (value?: string | null) =>
                                toSafeDayjs(value)?.format("DD/MM/YYYY HH:mm") || "-",
                        },
                        { title: "Usuario", dataIndex: "user", width: 180 },
                        { title: "Objeto", dataIndex: "object", width: 100 },
                        { title: "Evento", dataIndex: "event" },
                        { title: "Antes", dataIndex: "before", width: 160 },
                        { title: "Depois", dataIndex: "after", width: 160 },
                    ]}
                />
            </Card>
        </div>
    );
};
