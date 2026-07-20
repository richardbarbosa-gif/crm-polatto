import {
    DollarCircleOutlined,
    DownloadOutlined,
    ExperimentOutlined,
    RiseOutlined,
    WalletOutlined,
} from "@ant-design/icons";
import { useList } from "@refinedev/core";
import { Col, InputNumber, Row, Select, Skeleton, Space, Table, Typography } from "antd";
import { useMemo, useState } from "react";
import { Button, Card, StatCard } from "../../components/ui";
import { exportRowsToCsv } from "../../lib/exportCsv";
import { formatCurrencyBRL } from "../../lib/formatters";
import {
    buildOwnerPerformance,
    getInsightValue,
    isDateInLastDays,
    isWonStatus,
    type InsightClienteRecord,
    type InsightTaskRecord,
} from "../../lib/insights";
import { InsightsHeader, IntroCard } from "./shared";

const PERIOD_OPTIONS = [
    { label: "30 dias", value: 30 },
    { label: "90 dias", value: 90 },
    { label: "180 dias", value: 180 },
];

export const InsightsROIPage = () => {
    const [periodDays, setPeriodDays] = useState<number>(90);
    const [costPerLead, setCostPerLead] = useState<number>(85);
    const [costPerActivity, setCostPerActivity] = useState<number>(18);

    const clientesResult = useList<InsightClienteRecord>({
        resource: "clientes",
        pagination: { mode: "off" },
    }) as any;
    const tarefasResult = useList<InsightTaskRecord>({
        resource: "tarefas",
        pagination: { mode: "off" },
    }) as any;

    const clientesQuery = clientesResult.query || clientesResult;
    const tarefasQuery = tarefasResult.query || tarefasResult;
    const clientes = (clientesQuery?.data?.data || []) as InsightClienteRecord[];
    const tarefas = (tarefasQuery?.data?.data || []) as InsightTaskRecord[];

    const isLoading = Boolean(clientesQuery?.isLoading || tarefasQuery?.isLoading);

    const roi = useMemo(() => {
        const clientesPeriodo = clientes.filter((cliente) =>
            isDateInLastDays(cliente.created_at, periodDays),
        );
        const tarefasPeriodo = tarefas.filter((task) =>
            isDateInLastDays(task.data_vencimento || task.created_at, periodDays),
        );

        const ganhos = clientesPeriodo.filter((cliente) => isWonStatus(cliente.status));
        const ganhosValor = ganhos.reduce(
            (acc, cliente) => acc + getInsightValue(cliente.conta_energia_media),
            0,
        );
        const investimento = clientesPeriodo.length * costPerLead + tarefasPeriodo.length * costPerActivity;
        const lucro = ganhosValor - investimento;
        const roiPercent = investimento > 0 ? (lucro / investimento) * 100 : 0;
        const cobertura = investimento > 0 ? (ganhosValor / investimento) * 100 : 0;
        const retornoMedio = ganhos.length > 0 ? ganhosValor / ganhos.length : 0;

        return {
            clientesPeriodo,
            tarefasPeriodo,
            ganhosValor,
            investimento,
            lucro,
            roiPercent,
            cobertura,
            retornoMedio,
        };
    }, [clientes, tarefas, periodDays, costPerLead, costPerActivity]);

    const ownerBreakdown = useMemo(() => {
        const clientesPeriodo = clientes.filter((cliente) =>
            isDateInLastDays(cliente.created_at, periodDays),
        );

        return buildOwnerPerformance(clientesPeriodo).map((owner) => {
            const investimentoOwner = owner.total * costPerLead;
            const retornoOwner = owner.valor;
            const lucroOwner = retornoOwner - investimentoOwner;
            const roiOwner = investimentoOwner > 0 ? (lucroOwner / investimentoOwner) * 100 : 0;

            return {
                owner: owner.owner,
                investimento: investimentoOwner,
                retorno: retornoOwner,
                lucro: lucroOwner,
                roi: roiOwner,
            };
        });
    }, [clientes, periodDays, costPerLead]);

    if (isLoading) {
        return <Skeleton active />;
    }

    return (
        <div style={{ padding: 20 }}>
            <InsightsHeader
                title="ROI Comercial"
                subtitle="Modelo de retorno baseado no volume de leads e esforco operacional."
                extra={
                    <Space wrap>
                        <Select
                            value={periodDays}
                            options={PERIOD_OPTIONS}
                            onChange={(value) => setPeriodDays(value)}
                            style={{ width: 130 }}
                        />
                        <InputNumber
                            value={costPerLead}
                            min={0}
                            step={5}
                            prefix="R$"
                            onChange={(value) => setCostPerLead(Number(value || 0))}
                            style={{ width: 140 }}
                            placeholder="Custo/lead"
                        />
                        <InputNumber
                            value={costPerActivity}
                            min={0}
                            step={1}
                            prefix="R$"
                            onChange={(value) => setCostPerActivity(Number(value || 0))}
                            style={{ width: 150 }}
                            placeholder="Custo/atividade"
                        />
                        <Button
                            icon={<DownloadOutlined />}
                            disabled={ownerBreakdown.length === 0}
                            onClick={() =>
                                exportRowsToCsv(
                                    "roi-comercial",
                                    ownerBreakdown.map((linha) => ({
                                        responsavel: linha.owner,
                                        investimento: linha.investimento,
                                        retorno: linha.retorno,
                                        lucro: linha.lucro,
                                        roi_pct: linha.roi,
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
                title="ROI orientado por dados do CRM"
                description="Ajuste o custo por lead e por atividade para simular diferentes cenarios de operacao."
            />

            <Row gutter={[12, 12]}>
                <Col xs={24} md={12} xl={6}>
                    <StatCard
                        title="Investimento estimado"
                        value={roi.investimento}
                        prefix={<WalletOutlined style={{ color: "#334155" }} />}
                        accentColor="#64748b"
                        valueStyle={{ color: "#334155" }}
                        subtitle={`${roi.clientesPeriodo.length} leads e ${roi.tarefasPeriodo.length} atividades`}
                    />
                </Col>
                <Col xs={24} md={12} xl={6}>
                    <StatCard
                        title="Retorno bruto"
                        value={roi.ganhosValor}
                        prefix={<DollarCircleOutlined style={{ color: "#16a34a" }} />}
                        accentColor="#16a34a"
                        valueStyle={{ color: "#166534" }}
                        subtitle="Valor fechado no periodo"
                    />
                </Col>
                <Col xs={24} md={12} xl={6}>
                    <StatCard
                        title="ROI"
                        value={Number(roi.roiPercent.toFixed(1))}
                        suffix="%"
                        prefix={<RiseOutlined style={{ color: "#2563eb" }} />}
                        accentColor="#2563eb"
                        valueStyle={{ color: roi.roiPercent >= 0 ? "#1d4ed8" : "#b91c1c" }}
                        subtitle={roi.roiPercent >= 0 ? "Operacao positiva" : "Ajustar custo de aquisicao"}
                    />
                </Col>
                <Col xs={24} md={12} xl={6}>
                    <StatCard
                        title="Retorno medio por ganho"
                        value={roi.retornoMedio}
                        prefix={<ExperimentOutlined style={{ color: "#f97316" }} />}
                        accentColor="#f97316"
                        valueStyle={{ color: "#c2410c" }}
                        subtitle={`Cobertura ${roi.cobertura.toFixed(1)}%`}
                    />
                </Col>
            </Row>

            <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
                <Col xs={24} xl={10}>
                    <Card title="Formula aplicada">
                        <Typography.Paragraph>
                            <Typography.Text strong>Investimento:</Typography.Text> Leads no periodo
                            x custo por lead + atividades x custo por atividade.
                        </Typography.Paragraph>
                        <Typography.Paragraph>
                            <Typography.Text strong>ROI:</Typography.Text> (Retorno bruto -
                            investimento) / investimento.
                        </Typography.Paragraph>
                        <Typography.Paragraph style={{ marginBottom: 0 }}>
                            <Typography.Text strong>Lucro estimado:</Typography.Text>{" "}
                            {formatCurrencyBRL(roi.lucro, "R$ 0,00")}
                        </Typography.Paragraph>
                    </Card>
                </Col>
                <Col xs={24} xl={14}>
                    <Card title="ROI por consultor">
                        <Table
                            size="small"
                            rowKey={(record) => record.owner}
                            pagination={{ pageSize: 6, hideOnSinglePage: true }}
                            dataSource={ownerBreakdown}
                            columns={[
                                {
                                    title: "Consultor",
                                    dataIndex: "owner",
                                    render: (value: string) => (
                                        <Typography.Text strong>{value}</Typography.Text>
                                    ),
                                },
                                {
                                    title: "Investimento",
                                    dataIndex: "investimento",
                                    render: (value: number) => formatCurrencyBRL(value, "R$ 0,00"),
                                },
                                {
                                    title: "Retorno",
                                    dataIndex: "retorno",
                                    render: (value: number) => formatCurrencyBRL(value, "R$ 0,00"),
                                },
                                {
                                    title: "ROI",
                                    dataIndex: "roi",
                                    render: (value: number) => (
                                        <Typography.Text
                                            style={{
                                                color: value >= 0 ? "#166534" : "#b91c1c",
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
                </Col>
            </Row>
        </div>
    );
};
