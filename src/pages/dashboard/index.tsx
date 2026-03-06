import {
    CheckCircleOutlined,
    DollarCircleOutlined,
    RiseOutlined,
    UsergroupAddOutlined,
} from "@ant-design/icons";
import { useList } from "@refinedev/core";
import { Card, Col, Progress, Row, Skeleton, Space, Statistic, Typography } from "antd";
import { useMemo } from "react";
import { matchesLeadOwner, useCrmAccess } from "../../hooks/useCrmAccess";
import { normalizeText, parseCurrencyLikeValue } from "../../lib/formatters";

const { Title, Text } = Typography;

interface ICliente {
    id: number;
    nome: string;
    status: string;
    conta_energia_media: number | string;
    responsavel?: string;
}

export const DashboardPage = () => {
    const { canViewAllLeads, ownerCandidatesNormalized } = useCrmAccess();

    const listResult = useList<ICliente>({
        resource: "clientes",
        pagination: { mode: "off" },
        liveMode: "auto",
    }) as any;

    const { data, isLoading } = listResult.query || listResult;
    const clientes = (data?.data || []) as ICliente[];

    const clientesVisiveis = useMemo(() => {
        if (canViewAllLeads) {
            return clientes;
        }
        return clientes.filter((cliente) =>
            matchesLeadOwner(cliente.responsavel, ownerCandidatesNormalized),
        );
    }, [canViewAllLeads, clientes, ownerCandidatesNormalized]);

    const leadsAtivos = clientesVisiveis.filter(
        (cliente) => !normalizeText(cliente.status).includes("perdido"),
    );
    const totalLeads = leadsAtivos.length;
    const vendasFechadas = clientesVisiveis.filter((cliente) =>
        normalizeText(cliente.status).includes("fechado"),
    );
    const qtdVendas = vendasFechadas.length;

    const receitaPipeline = leadsAtivos.reduce((acc, curr) => {
        return acc + (parseCurrencyLikeValue(curr.conta_energia_media) || 0);
    }, 0);

    const conversao = totalLeads > 0 ? ((qtdVendas / totalLeads) * 100).toFixed(1) : "0.0";

    const porStatus = {
        novo: clientesVisiveis.filter((cliente) => normalizeText(cliente.status).includes("novo")).length,
        visita: clientesVisiveis.filter((cliente) => normalizeText(cliente.status).includes("visita")).length,
        negociacao: clientesVisiveis.filter((cliente) =>
            normalizeText(cliente.status).includes("negocia"),
        ).length,
        fechado: qtdVendas,
    };

    const getPercent = (value: number) => (totalLeads > 0 ? (value / totalLeads) * 100 : 0);

    if (isLoading) {
        return <Skeleton active />;
    }

    return (
        <div className="crm-page-shell">
            <div className="crm-page-header">
                <div>
                    <Title level={2} className="crm-page-header-title">
                        Dashboard comercial
                    </Title>
                    <Text className="crm-page-header-subtitle">
                        Visao executiva do funil e da performance do time no periodo atual.
                    </Text>
                </div>
            </div>

            <Row gutter={[16, 16]}>
                <Col xs={24} sm={12} lg={6}>
                    <Card bordered={false} className="crm-card crm-dashboard-hero">
                        <Statistic title="Pipeline estimado" value={receitaPipeline} precision={2} prefix={<DollarCircleOutlined />} />
                        <Text style={{ color: "rgba(219,234,254,0.86)", fontSize: "12px" }}>
                            Soma das oportunidades ativas
                        </Text>
                    </Card>
                </Col>

                <Col xs={24} sm={12} lg={6}>
                    <Card bordered={false} className="crm-card">
                        <Statistic
                            title="Leads ativos"
                            value={totalLeads}
                            prefix={<UsergroupAddOutlined />}
                        />
                        <Text type="secondary">Oportunidades em aberto</Text>
                    </Card>
                </Col>

                <Col xs={24} sm={12} lg={6}>
                    <Card bordered={false} className="crm-card">
                        <Statistic
                            title="Taxa de conversao"
                            value={conversao}
                            precision={1}
                            valueStyle={{ color: Number(conversao) > 20 ? "#3f8600" : "#cf1322" }}
                            prefix={<RiseOutlined />}
                            suffix="%"
                        />
                        <Text type="secondary">Eficiencia do time</Text>
                    </Card>
                </Col>

                <Col xs={24} sm={12} lg={6}>
                    <Card bordered={false} className="crm-card">
                        <Statistic
                            title="Vendas realizadas"
                            value={qtdVendas}
                            prefix={<CheckCircleOutlined />}
                        />
                        <Text type="secondary">Vendas no mes</Text>
                    </Card>
                </Col>
            </Row>

            <Row gutter={[16, 16]}>
                <Col xs={24} lg={16}>
                    <Card title="Saude do funil" bordered={false} className="crm-card">
                        <div className="crm-dashboard-funnel-row">
                            <div>
                                <Text strong>Novos leads ({porStatus.novo})</Text>
                                <Progress
                                    percent={getPercent(porStatus.novo)}
                                    showInfo={false}
                                    strokeColor="#1890ff"
                                />
                            </div>
                            <div>
                                <Text strong>Visita agendada ({porStatus.visita})</Text>
                                <Progress
                                    percent={getPercent(porStatus.visita)}
                                    showInfo={false}
                                    strokeColor="#faad14"
                                />
                            </div>
                            <div>
                                <Text strong>Em negociacao ({porStatus.negociacao})</Text>
                                <Progress
                                    percent={getPercent(porStatus.negociacao)}
                                    showInfo={false}
                                    strokeColor="#fa541c"
                                />
                            </div>
                            <div>
                                <Text strong>Fechados ({porStatus.fechado})</Text>
                                <Progress
                                    percent={100}
                                    success={{ percent: getPercent(porStatus.fechado) }}
                                    showInfo={false}
                                />
                            </div>
                        </div>
                    </Card>
                </Col>

                <Col xs={24} lg={8}>
                    <Card title="Destaques operacionais" bordered={false} className="crm-card">
                        <Space direction="vertical" size="large" style={{ width: "100%" }}>
                            <div className="crm-soft-block">
                                <Text strong>Meta do mes</Text>
                                <Text style={{ display: "block", marginBottom: 5 }}>
                                    Faltam {Math.max(10 - qtdVendas, 0)} para a meta.
                                </Text>
                                <Progress
                                    percent={Math.min((qtdVendas / 10) * 100, 100)}
                                    size="small"
                                    status="active"
                                />
                            </div>
                            <div>
                                <Text type="secondary">Resumo rapido:</Text>
                                <ul className="crm-dashboard-highlight-list">
                                    <li>
                                        Voce tem <b>{porStatus.visita}</b> visitas para fazer.
                                    </li>
                                    <li>
                                        Existem <b>{porStatus.negociacao}</b> propostas.
                                    </li>
                                </ul>
                            </div>
                        </Space>
                    </Card>
                </Col>
            </Row>
        </div>
    );
};
