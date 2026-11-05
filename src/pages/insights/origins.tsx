import { DownloadOutlined } from "@ant-design/icons";
import { useList, type CrudFilter } from "@refinedev/core";
import { Alert, Col, Progress, Row, Select, Skeleton, Space, Table, Typography } from "antd";
import { useMemo, useState } from "react";
import { Button, Card, EmptyState, StatCard } from "../../components/ui";
import { exportRowsToCsv } from "../../lib/exportCsv";
import { formatCurrencyBRL, formatPercentBR } from "../../lib/formatters";
import {
    inicioDoPeriodo,
    RECURSO_VENDAS_POR_ORIGEM,
    resumirPorOrigem,
    type LinhaOrigem,
    type ResumoOrigem,
} from "../../lib/origemLead";
import { indexarEtapas, taxaDeConversao, type EtapaFunil } from "../../lib/pipelineMetrics";
import { InsightsHeader } from "./shared";

const { Text } = Typography;

const PERIODOS = [
    { label: "Este mês", value: 1 },
    { label: "Últimos 3 meses", value: 3 },
    { label: "Últimos 6 meses", value: 6 },
    { label: "Últimos 12 meses", value: 12 },
    { label: "Todo o período", value: 0 },
];

/**
 * Vendas por origem (migration 16). Agregado no banco (vw_vendas_por_origem),
 * por coorte de cadastro: dos leads que ENTRARAM no período, quantos foram
 * ganhos e perdidos e quanto renderam. Conversão pela regra oficial
 * (taxaDeConversao: ganhos ÷ encerrados).
 */
export const InsightsOriginsPage = () => {
    const [meses, setMeses] = useState<number>(6);

    const filtros = useMemo<CrudFilter[]>(
        () => (meses > 0 ? [{ field: "mes_cadastro", operator: "gte", value: inicioDoPeriodo(meses) }] : []),
        [meses],
    );

    const { query, result } = useList<LinhaOrigem>({
        resource: RECURSO_VENDAS_POR_ORIGEM,
        pagination: { mode: "off" },
        filters: filtros,
        queryOptions: { retry: false },
    });
    const { query: stagesQuery } = useList<EtapaFunil & { id: string | number }>({
        resource: "pipeline_stages",
        pagination: { mode: "off" },
        queryOptions: { retry: false },
    });

    const etapasPorId = useMemo(() => indexarEtapas(stagesQuery.data?.data), [stagesQuery.data?.data]);
    const resumo = useMemo(() => resumirPorOrigem(result.data, etapasPorId), [result.data, etapasPorId]);

    const totais = useMemo(() => {
        const leads = resumo.reduce((acc, r) => acc + r.leads, 0);
        const ganhos = resumo.reduce((acc, r) => acc + r.ganhos, 0);
        const perdidos = resumo.reduce((acc, r) => acc + r.perdidos, 0);
        const valor = resumo.reduce((acc, r) => acc + r.valorGanho, 0);
        return { leads, ganhos, perdidos, valor, conversao: taxaDeConversao(ganhos, perdidos) };
    }, [resumo]);
    const melhor = resumo.find((r) => r.valorGanho > 0);

    if (query.isLoading) return <Skeleton active />;

    return (
        <div style={{ padding: 20 }}>
            <InsightsHeader
                title="Vendas por origem"
                subtitle="Quais canais trazem leads que viram venda."
                extra={
                    <Space wrap>
                        <Select
                            value={meses}
                            onChange={setMeses}
                            options={PERIODOS}
                            style={{ width: 180 }}
                            aria-label="Período de cadastro"
                        />
                        <Button
                            icon={<DownloadOutlined />}
                            disabled={resumo.length === 0}
                            onClick={() =>
                                exportRowsToCsv(
                                    "vendas-por-origem",
                                    resumo.map((r) => ({
                                        origem: r.origem,
                                        leads: r.leads,
                                        ganhos: r.ganhos,
                                        perdidos: r.perdidos,
                                        em_aberto: r.abertos,
                                        conversao_pct: Number(r.conversao.toFixed(1)),
                                        valor_ganho: r.valorGanho,
                                    })),
                                )
                            }
                        >
                            Exportar CSV
                        </Button>
                    </Space>
                }
            />

            {query.isError ? (
                <Alert
                    type="warning"
                    showIcon
                    message="Relatório indisponível"
                    description="A estrutura de origens ainda não foi aplicada neste ambiente (migration 16)."
                />
            ) : (
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                    <Row gutter={[14, 14]}>
                        <Col xs={24} sm={12} lg={6}>
                            <StatCard title="Leads no período" value={totais.leads} accentColor="#3b82f6" />
                        </Col>
                        <Col xs={24} sm={12} lg={6}>
                            <StatCard
                                title="Conversão geral"
                                value={`${formatPercentBR(totais.conversao)}%`}
                                subtitle={`${totais.ganhos} ganhos de ${totais.ganhos + totais.perdidos} encerrados`}
                                accentColor="#10b981"
                            />
                        </Col>
                        <Col xs={24} sm={12} lg={6}>
                            <StatCard
                                title="Valor ganho"
                                value={formatCurrencyBRL(totais.valor, "R$ 0,00")}
                                accentColor="#059669"
                            />
                        </Col>
                        <Col xs={24} sm={12} lg={6}>
                            <StatCard
                                title="Melhor origem"
                                value={melhor?.origem ?? "—"}
                                subtitle={melhor ? formatCurrencyBRL(melhor.valorGanho, "-") : "Ainda sem vendas no período"}
                                accentColor="#f59e0b"
                            />
                        </Col>
                    </Row>

                    <Card title={<Text strong>Desempenho por origem</Text>} styles={{ body: { padding: 0 } }}>
                        {resumo.length === 0 ? (
                            <div style={{ padding: 20 }}>
                                <EmptyState
                                    title="Nenhum lead no período"
                                    description="Escolha a origem no cadastro do lead para acompanhar quais canais vendem mais."
                                />
                            </div>
                        ) : (
                            <Table<ResumoOrigem>
                                rowKey="origem"
                                dataSource={resumo}
                                pagination={false}
                                scroll={{ x: 640 }}
                                columns={[
                                    { title: "Origem", dataIndex: "origem", fixed: "left" },
                                    { title: "Leads", dataIndex: "leads", align: "right", width: 80 },
                                    { title: "Ganhos", dataIndex: "ganhos", align: "right", width: 90 },
                                    { title: "Perdidos", dataIndex: "perdidos", align: "right", width: 90 },
                                    { title: "Em aberto", dataIndex: "abertos", align: "right", width: 100 },
                                    {
                                        title: "Conversão",
                                        dataIndex: "conversao",
                                        width: 160,
                                        render: (valor: number, r) =>
                                            r.ganhos + r.perdidos === 0 ? (
                                                <Text type="secondary">Sem encerrados</Text>
                                            ) : (
                                                <Progress percent={Number(valor.toFixed(1))} size="small" />
                                            ),
                                    },
                                    {
                                        title: "Valor ganho",
                                        dataIndex: "valorGanho",
                                        align: "right",
                                        width: 140,
                                        render: (valor: number) => formatCurrencyBRL(valor, "R$ 0,00"),
                                    },
                                ]}
                            />
                        )}
                    </Card>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                        Conta os leads pelo mês de cadastro. Conversão = ganhos ÷ (ganhos + perdidos), a mesma
                        regra do Kanban e do Dashboard.
                    </Text>
                </Space>
            )}
        </div>
    );
};
