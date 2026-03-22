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

const funnelSteps = [
    { key: "novo", label: "Novos leads", color: "#3b82f6" },
    { key: "visita", label: "Visita agendada", color: "#f59e0b" },
    { key: "negociacao", label: "Em negociacao", color: "#8b5cf6" },
    { key: "fechado", label: "Fechados", color: "#10b981" },
] as const;

const cardBase = {
    border: "1px solid var(--crm-border)",
    boxShadow: "var(--crm-shadow-xs)",
};

const valueBase = {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: "-0.03em",
    fontFamily: "'Sora', 'Inter', sans-serif",
};

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
        return (
            <div className="crm-page-shell">
                <Skeleton active paragraph={{ rows: 1 }} />
                <Row gutter={[14, 14]}>
                    {[1, 2, 3, 4].map((i) => (
                        <Col key={i} xs={24} sm={12} lg={6}>
                            <Card bordered={false} style={{ borderRadius: 14, ...cardBase }}>
                                <Skeleton active paragraph={{ rows: 2 }} title={false} />
                            </Card>
                        </Col>
                    ))}
                </Row>
            </div>
        );
    }

    return (
        <div className="crm-page-shell">
            <div className="crm-page-header">
                <div>
                    <Title level={3} className="crm-page-header-title">
                        Dashboard
                    </Title>
                    <Text className="crm-page-header-subtitle">
                        Visao executiva do funil e performance do time.
                    </Text>
                </div>
            </div>

            <Row gutter={[14, 14]}>
                <Col xs={24} sm={12} lg={6}>
                    <Card bordered={false} className="crm-card crm-dashboard-hero">
                        <Statistic
                            title="Pipeline estimado"
                            value={receitaPipeline}
                            precision={2}
                            prefix={<DollarCircleOutlined style={{ fontSize: 14, opacity: 0.5 }} />}
                            valueStyle={{ ...valueBase, color: "#ffffff" }}
                        />
                        <Text style={{ color: "rgba(148, 163, 184, 0.6)", fontSize: 12, marginTop: 4, display: "block" }}>
                            Oportunidades ativas
                        </Text>
                    </Card>
                </Col>

                <Col xs={24} sm={12} lg={6}>
                    <Card bordered={false} className="crm-card" style={cardBase}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(59, 130, 246, 0.06)", display: "grid", placeItems: "center", marginBottom: 12 }}>
                            <UsergroupAddOutlined style={{ fontSize: 14, color: "#3b82f6" }} />
                        </div>
                        <Statistic title="Leads ativos" value={totalLeads} valueStyle={valueBase} />
                        <Text type="secondary" style={{ fontSize: 12 }}>Em aberto</Text>
                    </Card>
                </Col>

                <Col xs={24} sm={12} lg={6}>
                    <Card bordered={false} className="crm-card" style={cardBase}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: Number(conversao) > 20 ? "rgba(16, 185, 129, 0.06)" : "rgba(239, 68, 68, 0.06)", display: "grid", placeItems: "center", marginBottom: 12 }}>
                            <RiseOutlined style={{ fontSize: 14, color: Number(conversao) > 20 ? "#10b981" : "#ef4444" }} />
                        </div>
                        <Statistic
                            title="Conversao"
                            value={conversao}
                            precision={1}
                            valueStyle={{
                                ...valueBase,
                                color: Number(conversao) > 20 ? "#059669" : "#dc2626",
                            }}
                            suffix="%"
                        />
                        <Text type="secondary" style={{ fontSize: 12 }}>Eficiencia</Text>
                    </Card>
                </Col>

                <Col xs={24} sm={12} lg={6}>
                    <Card bordered={false} className="crm-card" style={cardBase}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(16, 185, 129, 0.06)", display: "grid", placeItems: "center", marginBottom: 12 }}>
                            <CheckCircleOutlined style={{ fontSize: 14, color: "#10b981" }} />
                        </div>
                        <Statistic title="Vendas" value={qtdVendas} valueStyle={valueBase} />
                        <Text type="secondary" style={{ fontSize: 12 }}>No mes</Text>
                    </Card>
                </Col>
            </Row>

            <Row gutter={[14, 14]}>
                <Col xs={24} lg={16}>
                    <Card
                        title="Saude do funil"
                        bordered={false}
                        className="crm-card"
                        style={cardBase}
                    >
                        <div className="crm-dashboard-funnel-row">
                            {funnelSteps.map((step) => {
                                const count = porStatus[step.key];
                                const pct = getPercent(count);
                                return (
                                    <div key={step.key}>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                                            <Text style={{ fontSize: 13, color: "var(--crm-ink-700)", fontWeight: 500 }}>
                                                {step.label}
                                            </Text>
                                            <Text style={{ fontSize: 13, fontWeight: 600, color: step.color, fontFamily: "'Sora', 'Inter', sans-serif" }}>
                                                {count}
                                            </Text>
                                        </div>
                                        <Progress
                                            percent={step.key === "fechado" ? 100 : pct}
                                            success={step.key === "fechado" ? { percent: pct } : undefined}
                                            showInfo={false}
                                            strokeColor={step.color}
                                            trailColor="var(--crm-border)"
                                            style={{ marginBottom: 0 }}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    </Card>
                </Col>

                <Col xs={24} lg={8}>
                    <Card
                        title="Destaques"
                        bordered={false}
                        className="crm-card"
                        style={cardBase}
                    >
                        <Space direction="vertical" size="large" style={{ width: "100%" }}>
                            <div className="crm-soft-block">
                                <Text strong style={{ fontSize: 13, display: "block", marginBottom: 4 }}>
                                    Meta do mes
                                </Text>
                                <Text style={{ display: "block", marginBottom: 8, fontSize: 13, color: "var(--crm-ink-500)" }}>
                                    Faltam {Math.max(10 - qtdVendas, 0)} para a meta.
                                </Text>
                                <Progress
                                    percent={Math.min((qtdVendas / 10) * 100, 100)}
                                    size="small"
                                    status="active"
                                    strokeColor="#3b82f6"
                                    trailColor="var(--crm-border)"
                                />
                            </div>
                            <div>
                                <Text style={{ fontSize: 11, fontWeight: 550, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--crm-ink-400)" }}>
                                    Resumo
                                </Text>
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
