import {
    CheckCircleOutlined,
    CloseCircleOutlined,
    DownloadOutlined,
    FundProjectionScreenOutlined,
    WarningOutlined,
} from "@ant-design/icons";
import { useList } from "@refinedev/core";
import { Col, Progress, Row, Select, Skeleton, Space, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { Button, Card, EmptyState, StatCard } from "../../components/ui";
import { exportRowsToCsv } from "../../lib/exportCsv";
import { formatCurrencyBRL, normalizeText } from "../../lib/formatters";
import {
    buildOwnerPerformance,
    getInsightValue,
    getMonthKey,
    isDateInLastDays,
    isLostStatus,
    isWonStatus,
    type InsightClienteRecord,
} from "../../lib/insights";
import { InsightsHeader, IntroCard } from "./shared";

const PERIOD_OPTIONS = [
    { label: "30 dias", value: 30 },
    { label: "90 dias", value: 90 },
    { label: "180 dias", value: 180 },
    { label: "365 dias", value: 365 },
];

export const InsightsGainsLossesPage = () => {
    const [periodDays, setPeriodDays] = useState<number>(180);

    const clientesResult = useList<InsightClienteRecord>({
        resource: "clientes",
        pagination: { mode: "off" },
    }) as any;
    const clientesQuery = clientesResult.query || clientesResult;
    const clientes = (clientesQuery?.data?.data || []) as InsightClienteRecord[];
    const isLoading = Boolean(clientesQuery?.isLoading);

    const report = useMemo(() => {
        const base = clientes.filter((cliente) => isDateInLastDays(cliente.created_at, periodDays));
        const ganhos = base.filter((cliente) => isWonStatus(cliente.status));
        const perdas = base.filter((cliente) => isLostStatus(cliente.status));

        const ganhoValor = ganhos.reduce(
            (acc, cliente) => acc + getInsightValue(cliente.conta_energia_media),
            0,
        );
        const perdaValor = perdas.reduce(
            (acc, cliente) => acc + getInsightValue(cliente.conta_energia_media),
            0,
        );

        const totalDecisoes = ganhos.length + perdas.length;
        const taxaGanhos = totalDecisoes > 0 ? (ganhos.length / totalDecisoes) * 100 : 0;
        const taxaPerdas = totalDecisoes > 0 ? (perdas.length / totalDecisoes) * 100 : 0;

        return {
            base,
            ganhos,
            perdas,
            ganhoValor,
            perdaValor,
            taxaGanhos,
            taxaPerdas,
            totalDecisoes,
        };
    }, [clientes, periodDays]);

    const ownerSummary = useMemo(() => {
        const base = clientes.filter((cliente) => isDateInLastDays(cliente.created_at, periodDays));
        return buildOwnerPerformance(base).map((owner) => {
            const decided = owner.ganhos + owner.perdas;
            const winRate = decided > 0 ? (owner.ganhos / decided) * 100 : 0;
            return { ...owner, decided, winRate };
        });
    }, [clientes, periodDays]);

    const trend = useMemo(() => {
        const current = dayjs();
        const months = Array.from({ length: 6 }, (_, index) =>
            current.subtract(5 - index, "month").format("YYYY-MM"),
        );
        return months.map((monthKey) => {
            const monthItems = clientes.filter(
                (cliente) => getMonthKey(cliente.created_at) === monthKey,
            );
            const wins = monthItems.filter((cliente) => isWonStatus(cliente.status)).length;
            const losses = monthItems.filter((cliente) => isLostStatus(cliente.status)).length;
            const total = wins + losses;
            const winRate = total > 0 ? (wins / total) * 100 : 0;
            return {
                key: monthKey,
                month: dayjs(`${monthKey}-01`).format("MMM/YYYY"),
                wins,
                losses,
                winRate,
            };
        });
    }, [clientes]);

    const topLossReasons = useMemo(() => {
        const map = new Map<string, number>();

        report.perdas.forEach((cliente) => {
            const reason = normalizeText(cliente.motivo_perda) || "sem motivo informado";
            map.set(reason, (map.get(reason) || 0) + 1);
        });

        return Array.from(map.entries())
            .map(([reason, count]) => ({ reason, count }))
            .sort((first, second) => second.count - first.count)
            .slice(0, 6);
    }, [report.perdas]);

    if (isLoading) {
        return <Skeleton active />;
    }

    return (
        <div style={{ padding: 20 }}>
            <InsightsHeader
                title="Ganhos e perdas"
                subtitle="Leia a saude de fechamento por volume, valor e ritmo de conversao."
                extra={
                    <Space wrap>
                        <Select
                            value={periodDays}
                            options={PERIOD_OPTIONS}
                            onChange={(value) => setPeriodDays(value)}
                            style={{ width: 140 }}
                        />
                        <Button
                            icon={<DownloadOutlined />}
                            disabled={trend.length === 0}
                            onClick={() =>
                                exportRowsToCsv(
                                    "ganhos-e-perdas",
                                    trend.map((linha) => ({
                                        mes: linha.month,
                                        ganhos: linha.wins,
                                        perdas: linha.losses,
                                        taxa_ganho_pct: linha.winRate,
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
                title="Entenda onde o faturamento esta escapando"
                description="Combine taxa de ganho, motivos de perda e desempenho por consultor para ajustar o funil."
            />

            <Row gutter={[12, 12]}>
                <Col xs={24} md={12} xl={6}>
                    <StatCard
                        title="Ganhos"
                        value={report.ganhos.length}
                        prefix={<CheckCircleOutlined style={{ color: "#16a34a" }} />}
                        accentColor="#16a34a"
                        valueStyle={{ color: "#166534" }}
                        subtitle={formatCurrencyBRL(report.ganhoValor, "R$ 0,00")}
                    />
                </Col>
                <Col xs={24} md={12} xl={6}>
                    <StatCard
                        title="Perdas"
                        value={report.perdas.length}
                        prefix={<CloseCircleOutlined style={{ color: "#ef4444" }} />}
                        accentColor="#ef4444"
                        valueStyle={{ color: "#b91c1c" }}
                        subtitle={formatCurrencyBRL(report.perdaValor, "R$ 0,00")}
                    />
                </Col>
                <Col xs={24} md={12} xl={6}>
                    <StatCard
                        title="Taxa de ganho"
                        value={Number(report.taxaGanhos.toFixed(1))}
                        suffix="%"
                        prefix={<FundProjectionScreenOutlined style={{ color: "#2563eb" }} />}
                        accentColor="#2563eb"
                        valueStyle={{ color: "#1d4ed8" }}
                        subtitle={`${report.totalDecisoes} oportunidades decididas`}
                    />
                </Col>
                <Col xs={24} md={12} xl={6}>
                    <StatCard
                        title="Taxa de perda"
                        value={Number(report.taxaPerdas.toFixed(1))}
                        suffix="%"
                        prefix={<WarningOutlined style={{ color: "#f97316" }} />}
                        accentColor="#f97316"
                        valueStyle={{ color: "#c2410c" }}
                        subtitle="Sinal para revisar abordagem comercial"
                    />
                </Col>
            </Row>

            <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
                <Col xs={24} xl={14}>
                    <Card title="Desempenho por consultor">
                        <Table
                            size="small"
                            rowKey={(record) => record.owner}
                            pagination={{ pageSize: 7, hideOnSinglePage: true }}
                            dataSource={ownerSummary}
                            columns={[
                                {
                                    title: "Consultor",
                                    dataIndex: "owner",
                                    render: (value: string) => (
                                        <Typography.Text strong>{value}</Typography.Text>
                                    ),
                                },
                                { title: "Ganhos", dataIndex: "ganhos", width: 80 },
                                { title: "Perdas", dataIndex: "perdas", width: 80 },
                                {
                                    title: "Win rate",
                                    width: 160,
                                    render: (_, record: { winRate: number }) => (
                                        <Progress
                                            percent={Number(record.winRate.toFixed(1))}
                                            size="small"
                                            strokeColor="#16a34a"
                                        />
                                    ),
                                },
                                {
                                    title: "Valor",
                                    dataIndex: "valor",
                                    width: 140,
                                    render: (value: number) => formatCurrencyBRL(value, "R$ 0,00"),
                                },
                            ]}
                        />
                    </Card>
                </Col>

                <Col xs={24} xl={10}>
                    <Card title="Motivos de perda">
                        {topLossReasons.length === 0 ? (
                            <EmptyState
                                title="Sem perdas no periodo"
                                description="Otimo sinal. Continue registrando os motivos para manter inteligencia de funil."
                            />
                        ) : (
                            <Space direction="vertical" size={10} style={{ width: "100%" }}>
                                {topLossReasons.map((item) => (
                                    <div
                                        key={item.reason}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            border: "1px solid #e7edf5",
                                            borderRadius: 10,
                                            padding: "8px 10px",
                                        }}
                                    >
                                        <Typography.Text style={{ textTransform: "capitalize" }}>
                                            {item.reason}
                                        </Typography.Text>
                                        <Tag color="red">{item.count}</Tag>
                                    </div>
                                ))}
                            </Space>
                        )}
                    </Card>
                </Col>
            </Row>

            <Card title="Tendencia mensal de decisoes" style={{ marginTop: 12 }}>
                <Table
                    size="small"
                    rowKey={(record) => record.key}
                    pagination={false}
                    dataSource={trend}
                    columns={[
                        { title: "Mes", dataIndex: "month", width: 120 },
                        { title: "Ganhos", dataIndex: "wins", width: 90 },
                        { title: "Perdas", dataIndex: "losses", width: 90 },
                        {
                            title: "Win rate",
                            dataIndex: "winRate",
                            render: (value: number) => (
                                <Typography.Text
                                    style={{
                                        color: value >= 50 ? "#166534" : "#b45309",
                                        fontWeight: 700,
                                    }}
                                >
                                    {value.toFixed(1)}%
                                </Typography.Text>
                            ),
                        },
                    ]}
                />
            </Card>
        </div>
    );
};
