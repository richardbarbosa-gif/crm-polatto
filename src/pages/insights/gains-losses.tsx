import {
    CheckCircleOutlined,
    CloseCircleOutlined,
    DownloadOutlined,
    FundProjectionScreenOutlined,
    RiseOutlined,
    WarningOutlined,
} from "@ant-design/icons";
import { useList } from "@refinedev/core";
import { Col, Progress, Row, Select, Skeleton, Space, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { Button, Card, EmptyState, StatCard } from "../../components/ui";
import { exportRowsToCsv } from "../../lib/exportCsv";
import { formatCurrencyBRL, normalizeText, formatoProgresso, formatPercentBR } from "../../lib/formatters";
import {
    COLUNAS_INSIGHT_CLIENTE,
    buildOwnerPerformance,
    dataDeDecisao,
    getMonthKey,
    isDateInLastDays,
    type InsightClienteRecord,
} from "../../lib/insights";
import { classificarDesfecho, indexarEtapas, percentual, valorDoLead, type EtapaFunil } from "../../lib/pipelineMetrics";
import { InsightsHeader, IntroCard } from "./shared";

const PERIOD_OPTIONS = [
    { label: "30 dias", value: 30 },
    { label: "90 dias", value: 90 },
    { label: "180 dias", value: 180 },
    { label: "365 dias", value: 365 },
];

export const InsightsGainsLossesPage = () => {
    const [periodDays, setPeriodDays] = useState<number>(180);

    const { query: clientesQuery } = useList<InsightClienteRecord>({
        resource: "clientes",
        pagination: { mode: "off" },
        meta: { select: COLUNAS_INSIGHT_CLIENTE },
    });
    const { query: stagesQuery } = useList<EtapaFunil & { id: string | number }>({
        resource: "pipeline_stages",
        pagination: { mode: "off" },
        queryOptions: { retry: false },
    });
    const clientes = useMemo(() => clientesQuery?.data?.data ?? [], [clientesQuery?.data?.data]);
    const etapasPorId = useMemo(() => indexarEtapas(stagesQuery?.data?.data), [stagesQuery?.data?.data]);
    const isLoading = Boolean(clientesQuery?.isLoading);

    // Ganho/perda pelos flags da etapa e pela DATA DA DECISÃO (fechamento).
    // Antes valia o nome da etapa e a data de criação do lead: um negócio
    // criado há 8 meses e ganho ontem não entrava no período de 180 dias.
    const decididos = useMemo(
        () =>
            clientes
                .map((cliente) => ({ cliente, desfecho: classificarDesfecho(cliente, etapasPorId) }))
                .filter((item) => item.desfecho !== "aberto"),
        [clientes, etapasPorId],
    );

    const report = useMemo(() => {
        const base = decididos.filter((item) => isDateInLastDays(dataDeDecisao(item.cliente), periodDays));
        const ganhos = base.filter((item) => item.desfecho === "ganho").map((item) => item.cliente);
        const perdas = base.filter((item) => item.desfecho === "perdido").map((item) => item.cliente);

        const ganhoValor = ganhos.reduce((acc, cliente) => acc + valorDoLead(cliente), 0);
        const perdaValor = perdas.reduce((acc, cliente) => acc + valorDoLead(cliente), 0);

        const totalDecisoes = ganhos.length + perdas.length;
        const taxaGanhos = percentual(ganhos.length, totalDecisoes);
        const taxaPerdas = percentual(perdas.length, totalDecisoes);

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
    }, [decididos, periodDays]);

    const ownerSummary = useMemo(() => {
        const base = decididos
            .filter((item) => isDateInLastDays(dataDeDecisao(item.cliente), periodDays))
            .map((item) => item.cliente);
        return buildOwnerPerformance(base, etapasPorId).map((owner) => {
            const decided = owner.ganhos + owner.perdas;
            const winRate = percentual(owner.ganhos, decided);
            return { ...owner, decided, winRate };
        });
    }, [decididos, etapasPorId, periodDays]);

    const trend = useMemo(() => {
        const current = dayjs();
        const months = Array.from({ length: 6 }, (_, index) =>
            current.subtract(5 - index, "month").format("YYYY-MM"),
        );
        return months.map((monthKey) => {
            const monthItems = decididos.filter(
                (item) => getMonthKey(dataDeDecisao(item.cliente)) === monthKey,
            );
            const wins = monthItems.filter((item) => item.desfecho === "ganho").length;
            const losses = monthItems.filter((item) => item.desfecho === "perdido").length;
            const total = wins + losses;
            const winRate = percentual(wins, total);
            return {
                key: monthKey,
                month: dayjs(`${monthKey}-01`).format("MMM/YYYY"),
                wins,
                losses,
                winRate,
            };
        });
    }, [decididos]);

    const topLossReasons = useMemo(() => {
        // Agrupa sem diferenciar maiúsculas, mas exibe o texto como o vendedor
        // escreveu (só a primeira letra em maiúscula). O antigo
        // text-transform: capitalize gerava "Preço Acima Do Orçamento".
        const map = new Map<string, { reason: string; count: number }>();

        report.perdas.forEach((cliente) => {
            const original = (cliente.motivo_perda ?? "").trim().replace(/\s+/g, " ");
            const chave = normalizeText(original) || "sem motivo informado";
            const atual = map.get(chave);
            if (atual) {
                atual.count += 1;
                return;
            }
            const texto = original || "Sem motivo informado";
            map.set(chave, { reason: texto.charAt(0).toUpperCase() + texto.slice(1), count: 1 });
        });

        return Array.from(map.values())
            .sort((first, second) => second.count - first.count)
            .slice(0, 6);
    }, [report.perdas]);

    if (isLoading) {
        return <Skeleton active />;
    }

    return (
        <div style={{ padding: 20 }}>
            <InsightsHeader
                icon={<RiseOutlined />}
                title="Ganhos e perdas"
                subtitle="Leia a saúde de fechamento por volume, valor e ritmo de conversão."
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
                title="Entenda onde o faturamento está escapando"
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
                                    title: "Taxa de ganho",
                                    className: "crm-nowrap",
                                    width: 160,
                                    render: (_, record: { winRate: number }) => (
                                        <Progress format={formatoProgresso}
                                            percent={Number(record.winRate.toFixed(1))}
                                            size="small"
                                            strokeColor="#16a34a"
                                        />
                                    ),
                                },
                                {
                                    title: "Valor",
                                    className: "crm-nowrap",
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
                                title="Sem perdas no período"
                                description="Ótimo sinal. Continue registrando os motivos para manter a inteligência do funil."
                            />
                        ) : (
                            <Space direction="vertical" size={10} style={{ width: "100%" }}>
                                {topLossReasons.map((item) => (
                                    <div key={item.reason} className="crm-motivo-perda">
                                        <Typography.Text>{item.reason}</Typography.Text>
                                        <Tag color="red">{item.count}</Tag>
                                    </div>
                                ))}
                            </Space>
                        )}
                    </Card>
                </Col>
            </Row>

            <Card title="Tendência mensal de decisões" style={{ marginTop: 12 }}>
                <Table
                    size="small"
                    rowKey={(record) => record.key}
                    pagination={false}
                    dataSource={trend}
                    columns={[
                        { title: "Mês", dataIndex: "month", width: 120 },
                        { title: "Ganhos", dataIndex: "wins", width: 90 },
                        { title: "Perdas", dataIndex: "losses", width: 90 },
                        {
                            title: "Taxa de ganho",
                            className: "crm-nowrap",
                            dataIndex: "winRate",
                            render: (value: number) => (
                                <Typography.Text
                                    style={{
                                        color: value >= 50 ? "#166534" : "#b45309",
                                        fontWeight: 700,
                                    }}
                                >
                                    {formatPercentBR(value)}%
                                </Typography.Text>
                            ),
                        },
                    ]}
                />
            </Card>
        </div>
    );
};
