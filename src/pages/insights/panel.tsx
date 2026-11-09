import {
    CalendarOutlined,
    DashboardOutlined,
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
import { formatCurrencyBRL, formatoProgresso } from "../../lib/formatters";
import {
    COLUNAS_INSIGHT_CLIENTE,
    buildOwnerPerformance,
    dataDeDecisao,
    getTaskSituation,
    isDateInMonth,
    sortByDateDesc,
    toSafeDayjs,
    type InsightClienteRecord,
    type InsightStatusHistoryRecord,
    type InsightTaskRecord,
} from "../../lib/insights";
import {
    classificarDesfecho,
    indexarEtapas,
    taxaDeConversao,
    valorDoLead,
    type EtapaFunil,
} from "../../lib/pipelineMetrics";
import {
    resolveTaskExecutionStatus,
    subscribeTaskExecutionStatusUpdates,
} from "../../lib/taskExecutionStatus";
import { supabaseClient } from "../../utility";
import { InsightsHeader, IntroCard } from "./shared";
import { rotuloTipoAtividade } from "../../lib/tiposAtividade";

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
                .order("movido_em", { ascending: false })
                // O painel mostra os 12 eventos mais recentes: não há por que
                // baixar o histórico inteiro.
                .limit(50);

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

    const { query: clientesQuery } = useList<InsightClienteRecord>({
        resource: "clientes",
        pagination: { mode: "off" },
        meta: { select: COLUNAS_INSIGHT_CLIENTE },
    });
    const { query: tarefasQuery } = useList<InsightTaskRecord>({
        resource: "tarefas",
        pagination: { mode: "off" },
        filters: [{ field: "deleted_at", operator: "null", value: true }],
        sorters: [{ field: "data_vencimento", order: "asc" }],
        meta: { select: "id,cliente_id,titulo,tipo,data_vencimento,created_at,responsavel,concluido,execucao_status" },
    });
    const { query: stagesQuery } = useList<EtapaFunil & { id: string | number }>({
        resource: "pipeline_stages",
        pagination: { mode: "off" },
        queryOptions: { retry: false },
    });

    const clientes = useMemo(() => clientesQuery?.data?.data ?? [], [clientesQuery?.data?.data]);
    const tarefas = useMemo(() => tarefasQuery?.data?.data ?? [], [tarefasQuery?.data?.data]);
    const etapasPorId = useMemo(() => indexarEtapas(stagesQuery?.data?.data), [stagesQuery?.data?.data]);

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
        const nowRef = dayjs();
        const desfechos = clientes.map((cliente) => classificarDesfecho(cliente, etapasPorId));
        // Pipeline aberto = nem ganho nem perdido, pelos flags da etapa. Antes
        // só contavam etapas cujo nome tinha "novo", "visita", "proposta"...
        const pipelineValue = clientes.reduce(
            (acc, cliente, i) => (desfechos[i] === "aberto" ? acc + valorDoLead(cliente) : acc),
            0,
        );
        // "Fechado no mês" pela DATA DE FECHAMENTO. Antes filtrava pela data
        // de criação: um negócio criado em março e ganho hoje não aparecia.
        const closedThisMonthValue = clientes.reduce(
            (acc, cliente, i) =>
                desfechos[i] === "ganho" && isDateInMonth(dataDeDecisao(cliente), nowRef)
                    ? acc + valorDoLead(cliente)
                    : acc,
            0,
        );
        const closed = desfechos.filter((d) => d === "ganho").length;
        const lost = desfechos.filter((d) => d === "perdido").length;
        const conversion = Number(taxaDeConversao(closed, lost).toFixed(1));
        const lateTasks = tarefas.filter(
            (task) =>
                getTaskSituation(task.data_vencimento, nowRef, resolveTaskExecutionStatus(task)) === "atrasada",
        ).length;
        const todayTasks = tarefas.filter((task) => {
            if (task.concluido) return false;
            const due = toSafeDayjs(task.data_vencimento);
            return due ? due.isSame(nowRef, "day") : false;
        }).length;

        return {
            pipelineValue,
            closedThisMonthValue,
            conversion,
            ganhos: closed,
            encerrados: closed + lost,
            lateTasks,
            todayTasks,
            totalClientes: clientes.length,
        };
    }, [clientes, etapasPorId, tarefas]);

    const ownerPerformance = useMemo(
        () => buildOwnerPerformance(clientes, etapasPorId).slice(0, 8),
        [clientes, etapasPorId],
    );

    const upcomingTasks = useMemo(() => {
        const now = new Date();
        return tarefas
            .filter((task) => {
                if (task.concluido) return false;
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
            after: rotuloTipoAtividade(task.tipo),
        }));

        return sortByDateDesc([...statusEvents, ...taskEvents], (event) => event.when).slice(0, 12);
    }, [historyItems, tarefas]);

    if (isLoading) {
        return <Skeleton active />;
    }

    return (
        <div style={{ padding: 20 }}>
            <InsightsHeader
                icon={<DashboardOutlined />}
                title="Painel comercial"
                subtitle="Visão executiva de desempenho comercial, atividades e previsibilidade."
                extra={
                    <Space wrap>
                        <Button onClick={() => navigate("/insights/roi")}>ROI</Button>
                        <Button onClick={() => navigate("/insights/logs")}>Registros</Button>
                        <Button type="primary" onClick={() => navigate("/metas")}>
                            Definir metas
                        </Button>
                    </Space>
                }
            />

            <IntroCard
                title="Diagnóstico comercial em tempo real"
                description="Acompanhe ROI, ritmo de atividades, ganhos/perdas e evolução do time sem sair do CRM."
            />

            <Row gutter={[12, 12]}>
                <Col xs={24} md={12} xl={6}>
                    <StatCard
                        title="Pipeline aberto"
                        value={formatCurrencyBRL(metrics.pipelineValue, "R$ 0,00")}
                        prefix={<RiseOutlined style={{ color: "#4c8bf5" }} />}
                        accentColor="#4c8bf5"
                        valueStyle={{ color: "#1d4ed8" }}
                        subtitle="Negócios em aberto (nem ganhos nem perdidos)"
                    />
                </Col>
                <Col xs={24} md={12} xl={6}>
                    <StatCard
                        title="Ganho no mês"
                        value={formatCurrencyBRL(metrics.closedThisMonthValue, "R$ 0,00")}
                        prefix={<FlagOutlined style={{ color: "#16a34a" }} />}
                        accentColor="#16a34a"
                        valueStyle={{ color: "#166534" }}
                        subtitle="Negócios ganhos com fechamento neste mês"
                    />
                </Col>
                <Col xs={24} md={12} xl={6}>
                    <StatCard
                        title="Conversão"
                        value={metrics.conversion}
                        suffix="%"
                        prefix={<TeamOutlined style={{ color: "#e67e22" }} />}
                        accentColor="#e67e22"
                        valueStyle={{ color: "#b45309" }}
                        subtitle={`${metrics.ganhos} ganho(s) de ${metrics.encerrados} encerrado(s)`}
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
                                    title: "Conversão",
                                    width: 170,
                                    render: (_, record: { ganhos: number; perdas: number }) => {
                                        const base = record.ganhos + record.perdas;
                                        const percent = base > 0 ? (record.ganhos / base) * 100 : 0;
                                        return (
                                            <Progress format={formatoProgresso}
                                                percent={Number(percent.toFixed(1))}
                                                size="small"
                                                strokeColor="#16a34a"
                                            />
                                        );
                                    },
                                },
                                {
                                    title: "Valor",
                                    className: "crm-nowrap",
                                    dataIndex: "valor",
                                    width: 130,
                                    render: (value: number) => formatCurrencyBRL(value, "R$ 0,00"),
                                },
                            ]}
                        />
                    </Card>
                </Col>

                <Col xs={24} xl={8}>
                    <Card title="Próximas atividades">
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
                                                        <Tag color="blue">{rotuloTipoAtividade(task.tipo)}</Tag>
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
                            className: "crm-nowrap",
                            dataIndex: "when",
                            width: 140,
                            render: (value?: string | null) =>
                                toSafeDayjs(value)?.format("DD/MM/YYYY HH:mm") || "-",
                        },
                        { title: "Usuário", dataIndex: "user", width: 180 },
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
