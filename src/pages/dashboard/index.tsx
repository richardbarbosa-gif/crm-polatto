import {
    ArrowDownOutlined,
    ArrowUpOutlined,
    CalendarOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    CloseCircleOutlined,
    DollarCircleOutlined,
    FireOutlined,
    RiseOutlined,
    ThunderboltOutlined,
    UsergroupAddOutlined,
} from "@ant-design/icons";
import { useList } from "@refinedev/core";
import { Col, Progress, Row, Skeleton, Space, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { Button, Card, StatCard } from "../../components/ui";
import { matchesLeadOwner, useCrmAccess } from "../../hooks/useCrmAccess";
import { useRealtimeNegocios } from "../../hooks/useRealtimeNegocios";
import { formatCurrencyBRL, formatDateBR, normalizeText, parseCurrencyLikeValue } from "../../lib/formatters";

const { Title, Text } = Typography;

interface ICliente {
    id: number;
    nome: string;
    status: string;
    conta_energia_media: number | string;
    valor?: number | string;
    responsavel?: string;
    created_at?: string;
    temperatura?: string;
    stage_id?: string | number | null;
}

interface IPipelineStage {
    id: string | number;
    nome?: string | null;
    probabilidade?: number | string | null;
}

const funnelSteps = [
    { key: "novo", label: "Novos leads", color: "#3b82f6", icon: <UsergroupAddOutlined /> },
    { key: "visita", label: "Visita agendada", color: "#f59e0b", icon: <CalendarOutlined /> },
    { key: "negociacao", label: "Em negociação", color: "#8b5cf6", icon: <ThunderboltOutlined /> },
    { key: "fechado", label: "Fechados", color: "#10b981", icon: <CheckCircleOutlined /> },
    { key: "perdido", label: "Perdidos", color: "#ef4444", icon: <CloseCircleOutlined /> },
] as const;

const temperatureColors: Record<string, { bg: string; text: string; label: string }> = {
    quente: { bg: "rgba(239, 68, 68, 0.08)", text: "#dc2626", label: "Quente" },
    morno: { bg: "rgba(245, 158, 11, 0.08)", text: "#d97706", label: "Morno" },
    frio: { bg: "rgba(100, 116, 139, 0.08)", text: "#64748b", label: "Frio" },
};

export const DashboardPage = () => {
    const navigate = useNavigate();
    const { canViewAllLeads, ownerCandidatesNormalized, ownerDisplayName } = useCrmAccess();

    // Mantém o dashboard vivo depois que "clientes" vira view (ver hook)
    useRealtimeNegocios(["clientes"]);

    const listResult = useList<ICliente>({
        resource: "clientes",
        pagination: { mode: "off" },
        liveMode: "auto",
    }) as any;

    const { data, isLoading } = listResult.query || listResult;
    const clientes = (data?.data || []) as ICliente[];

    const { query: stagesQuery } = useList<IPipelineStage>({
        resource: "pipeline_stages",
        pagination: { mode: "off" },
        queryOptions: { retry: false },
    });

    const stages = useMemo(
        () => ((stagesQuery?.data?.data as IPipelineStage[]) || []).filter(Boolean),
        [stagesQuery?.data?.data],
    );

    const clientesVisiveis = useMemo(() => {
        if (canViewAllLeads) return clientes;
        return clientes.filter((c) => matchesLeadOwner(c.responsavel, ownerCandidatesNormalized));
    }, [canViewAllLeads, clientes, ownerCandidatesNormalized]);

    const metrics = useMemo(() => {
        const total = clientesVisiveis.length;
        const fechados = clientesVisiveis.filter((c) => normalizeText(c.status).includes("fechado"));
        const perdidos = clientesVisiveis.filter((c) => normalizeText(c.status).includes("perdido"));
        const ativos = clientesVisiveis.filter((c) => !normalizeText(c.status).includes("perdido"));
        
        const receitaPipeline = ativos.reduce((acc, c) => acc + (parseCurrencyLikeValue(c.valor || c.conta_energia_media) || 0), 0);
        const receitaFechada = fechados.reduce((acc, c) => acc + (parseCurrencyLikeValue(c.valor || c.conta_energia_media) || 0), 0);
        const ticketMedio = fechados.length > 0 ? receitaFechada / fechados.length : 0;
        const conversao = total > 0 ? ((fechados.length / total) * 100).toFixed(1) : "0.0";

        const porStatus = {
            novo: clientesVisiveis.filter((c) => normalizeText(c.status).includes("novo")).length,
            visita: clientesVisiveis.filter((c) => normalizeText(c.status).includes("visita")).length,
            negociacao: clientesVisiveis.filter((c) => normalizeText(c.status).includes("negocia")).length,
            fechado: fechados.length,
            perdido: perdidos.length,
        };

        // Temperatura
        const quentes = clientesVisiveis.filter((c) => c.temperatura === "quente").length;
        const mornos = clientesVisiveis.filter((c) => c.temperatura === "morno").length;
        const frios = clientesVisiveis.filter((c) => c.temperatura === "frio").length;

        // Últimos leads
        const recentLeads = [...clientesVisiveis]
            .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
            .slice(0, 5);

        // Por responsável (top 5)
        const byOwner = new Map<string, { total: number; fechados: number; valor: number }>();
        clientesVisiveis.forEach((c) => {
            const owner = c.responsavel || "Sem responsável";
            const current = byOwner.get(owner) || { total: 0, fechados: 0, valor: 0 };
            current.total += 1;
            current.valor += parseCurrencyLikeValue(c.valor || c.conta_energia_media) || 0;
            if (normalizeText(c.status).includes("fechado")) current.fechados += 1;
            byOwner.set(owner, current);
        });
        const topOwners = Array.from(byOwner.entries())
            .map(([name, data]) => ({ name, ...data, winRate: data.total > 0 ? (data.fechados / data.total) * 100 : 0 }))
            .sort((a, b) => b.valor - a.valor)
            .slice(0, 5);

        return {
            total, ativos: ativos.length, receitaPipeline, receitaFechada, ticketMedio,
            conversao, porStatus, quentes, mornos, frios, recentLeads, topOwners,
            fechadosCount: fechados.length, perdidosCount: perdidos.length,
        };
    }, [clientesVisiveis]);

    const forecast = useMemo(() => {
        const probPorStageId = new Map<string, number>();
        const probPorNome = new Map<string, number>();
        let temProbabilidade = false;

        stages.forEach((stage) => {
            const prob = parseCurrencyLikeValue(stage.probabilidade) ?? 0;
            if (prob > 0) temProbabilidade = true;
            if (stage.id !== undefined && stage.id !== null) {
                probPorStageId.set(String(stage.id), prob);
            }
            const nomeNormalizado = normalizeText(stage.nome);
            if (nomeNormalizado) probPorNome.set(nomeNormalizado, prob);
        });

        if (!temProbabilidade) return { disponivel: false, valorPonderado: 0 };

        const valorPonderado = clientesVisiveis.reduce((acc, c) => {
            const statusNorm = normalizeText(c.status);
            if (
                statusNorm.includes("fechado") ||
                statusNorm.includes("ganho") ||
                statusNorm.includes("perdido")
            ) {
                return acc;
            }
            const valor = parseCurrencyLikeValue(c.valor || c.conta_energia_media) || 0;
            if (valor <= 0) return acc;
            const probabilidade =
                (c.stage_id != null ? probPorStageId.get(String(c.stage_id)) : undefined) ??
                probPorNome.get(statusNorm) ??
                0;
            return acc + (valor * probabilidade) / 100;
        }, 0);

        return { disponivel: true, valorPonderado };
    }, [clientesVisiveis, stages]);

    const maxFunnel = Math.max(...Object.values(metrics.porStatus), 1);

    if (isLoading) {
        return (
            <div className="crm-page-shell">
                <Skeleton active paragraph={{ rows: 1 }} />
                <Row gutter={[14, 14]}>
                    {[1, 2, 3, 4].map((i) => (
                        <Col key={i} xs={24} sm={12} lg={6}>
                            <Card style={{ borderRadius: 14, height: 140 }}>
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
            {/* Header */}
            <div className="crm-page-header">
                <div>
                    <Title level={3} className="crm-page-header-title">Dashboard</Title>
                    <Text className="crm-page-header-subtitle">
                        Visão executiva do funil — {dayjs().format("DD [de] MMMM, YYYY")}
                    </Text>
                </div>
                <Space>
                    <Button onClick={() => navigate("/clientes")}>Ver oportunidades</Button>
                    <Button type="primary" onClick={() => navigate("/metas")}>Metas do mês</Button>
                </Space>
            </div>

            {/* KPI Cards - Row 1 */}
            <Row gutter={[14, 14]}>
                {/* Hero Card - Pipeline */}
                <Col xs={24} sm={12} lg={6}>
                    <div className="crm-dashboard-hero" style={{ borderRadius: 14, padding: "20px 22px 18px", position: "relative", overflow: "hidden" }}>
                        <div style={{ position: "absolute", top: -30, right: -20, width: 120, height: 120, borderRadius: "50%", background: "radial-gradient(circle, rgba(96,165,250,0.15) 0%, transparent 70%)" }} />
                        <Text style={{ color: "rgba(148,163,184,0.7)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 550, display: "block", marginBottom: 8 }}>
                            Pipeline total
                        </Text>
                        <div style={{ fontSize: 28, fontWeight: 700, color: "#fff", fontFamily: "'Sora','Inter',sans-serif", letterSpacing: "-0.03em", lineHeight: 1.1 }}>
                            {formatCurrencyBRL(metrics.receitaPipeline, "R$ 0")}
                        </div>
                        <Text style={{ color: "rgba(148,163,184,0.5)", fontSize: 12, marginTop: 6, display: "block" }}>
                            {metrics.ativos} oportunidades ativas
                        </Text>
                    </div>
                </Col>

                {/* Vendas Fechadas */}
                <Col xs={24} sm={12} lg={6}>
                    <Card style={{ borderRadius: 14, height: "100%" }} bodyStyle={{ padding: "20px 22px 18px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                            <div>
                                <Text type="secondary" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 550 }}>Receita fechada</Text>
                                <div style={{ fontSize: 26, fontWeight: 700, fontFamily: "'Sora','Inter',sans-serif", letterSpacing: "-0.03em", color: "#059669", marginTop: 4 }}>
                                    {formatCurrencyBRL(metrics.receitaFechada, "R$ 0")}
                                </div>
                                <Text type="secondary" style={{ fontSize: 12 }}>{metrics.fechadosCount} vendas realizadas</Text>
                            </div>
                            <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(16,185,129,0.08)", display: "grid", placeItems: "center" }}>
                                <CheckCircleOutlined style={{ fontSize: 18, color: "#10b981" }} />
                            </div>
                        </div>
                    </Card>
                </Col>

                {/* Conversão */}
                <Col xs={24} sm={12} lg={6}>
                    <Card style={{ borderRadius: 14, height: "100%" }} bodyStyle={{ padding: "20px 22px 18px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                            <div>
                                <Text type="secondary" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 550 }}>Conversão</Text>
                                <div style={{ fontSize: 26, fontWeight: 700, fontFamily: "'Sora','Inter',sans-serif", letterSpacing: "-0.03em", color: Number(metrics.conversao) > 15 ? "#059669" : "#dc2626", marginTop: 4 }}>
                                    {metrics.conversao}%
                                </div>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                    {Number(metrics.conversao) > 15 ? "Acima da média" : "Precisa melhorar"}
                                </Text>
                            </div>
                            <div style={{ width: 40, height: 40, borderRadius: 10, background: Number(metrics.conversao) > 15 ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)", display: "grid", placeItems: "center" }}>
                                <RiseOutlined style={{ fontSize: 18, color: Number(metrics.conversao) > 15 ? "#10b981" : "#ef4444" }} />
                            </div>
                        </div>
                    </Card>
                </Col>

                {/* Ticket Médio */}
                <Col xs={24} sm={12} lg={6}>
                    <Card style={{ borderRadius: 14, height: "100%" }} bodyStyle={{ padding: "20px 22px 18px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                            <div>
                                <Text type="secondary" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 550 }}>Ticket médio</Text>
                                <div style={{ fontSize: 26, fontWeight: 700, fontFamily: "'Sora','Inter',sans-serif", letterSpacing: "-0.03em", marginTop: 4 }}>
                                    {formatCurrencyBRL(metrics.ticketMedio, "R$ 0")}
                                </div>
                                <Text type="secondary" style={{ fontSize: 12 }}>Por venda fechada</Text>
                            </div>
                            <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(59,130,246,0.08)", display: "grid", placeItems: "center" }}>
                                <DollarCircleOutlined style={{ fontSize: 18, color: "#3b82f6" }} />
                            </div>
                        </div>
                    </Card>
                </Col>

                {/* Previsão ponderada */}
                {forecast.disponivel ? (
                    <Col xs={24} sm={12} lg={6}>
                        <StatCard
                            title="Previsão ponderada"
                            value={formatCurrencyBRL(forecast.valorPonderado, "R$ 0")}
                            subtitle="valor × probabilidade da etapa"
                            accentColor="#8b5cf6"
                            style={{ height: "100%" }}
                        />
                    </Col>
                ) : null}
            </Row>

            {/* Funnel + Temperature Row */}
            <Row gutter={[14, 14]}>
                {/* Funil Visual */}
                <Col xs={24} lg={16}>
                    <Card
                        title={<Text strong style={{ fontSize: 15 }}>Funil de vendas</Text>}
                        style={{ borderRadius: 14 }}
                        bodyStyle={{ padding: "16px 22px 20px" }}
                        extra={
                            <Button size="small" onClick={() => navigate("/clientes")}>
                                Ver pipeline
                            </Button>
                        }
                    >
                        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                            {funnelSteps.map((step) => {
                                const count = metrics.porStatus[step.key];
                                const pct = (count / maxFunnel) * 100;
                                return (
                                    <div key={step.key}>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                                            <Space size={8}>
                                                <span style={{ color: step.color, fontSize: 14 }}>{step.icon}</span>
                                                <Text style={{ fontSize: 13.5, fontWeight: 500, color: "var(--crm-ink-700)" }}>{step.label}</Text>
                                            </Space>
                                            <Space size={12}>
                                                <Text style={{ fontSize: 20, fontWeight: 700, color: step.color, fontFamily: "'Sora','Inter',sans-serif", letterSpacing: "-0.02em" }}>
                                                    {count}
                                                </Text>
                                            </Space>
                                        </div>
                                        <div style={{ background: "var(--crm-surface-2)", borderRadius: 6, height: 8, overflow: "hidden" }}>
                                            <div
                                                style={{
                                                    width: `${Math.max(pct, 2)}%`,
                                                    height: "100%",
                                                    background: `linear-gradient(90deg, ${step.color}, ${step.color}cc)`,
                                                    borderRadius: 6,
                                                    transition: "width 0.8s cubic-bezier(0.22, 1, 0.36, 1)",
                                                }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </Card>
                </Col>

                {/* Temperatura + Meta */}
                <Col xs={24} lg={8}>
                    <Space direction="vertical" size={14} style={{ width: "100%" }}>
                        {/* Temperatura dos leads */}
                        <Card
                            title={<Text strong style={{ fontSize: 15 }}>Temperatura dos leads</Text>}
                            style={{ borderRadius: 14 }}
                            bodyStyle={{ padding: "16px 22px 20px" }}
                        >
                            <div style={{ display: "flex", gap: 10 }}>
                                {(["quente", "morno", "frio"] as const).map((temp) => {
                                    const count = metrics[temp === "quente" ? "quentes" : temp === "morno" ? "mornos" : "frios"];
                                    const config = temperatureColors[temp];
                                    return (
                                        <div
                                            key={temp}
                                            style={{
                                                flex: 1,
                                                textAlign: "center",
                                                padding: "14px 8px",
                                                borderRadius: 10,
                                                background: config.bg,
                                                border: `1px solid ${config.text}15`,
                                            }}
                                        >
                                            <div style={{ fontSize: 22, fontWeight: 700, color: config.text, fontFamily: "'Sora','Inter',sans-serif" }}>
                                                {count}
                                            </div>
                                            <Text style={{ fontSize: 11, color: config.text, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                                {config.label}
                                            </Text>
                                        </div>
                                    );
                                })}
                            </div>
                        </Card>

                        {/* Meta do mês */}
                        <Card
                            title={<Text strong style={{ fontSize: 15 }}>Meta do mês</Text>}
                            style={{ borderRadius: 14 }}
                            bodyStyle={{ padding: "16px 22px 20px" }}
                            extra={
                                <Button size="small" onClick={() => navigate("/metas")}>
                                    Definir
                                </Button>
                            }
                        >
                            <div style={{ textAlign: "center", padding: "8px 0" }}>
                                <Progress
                                    type="dashboard"
                                    percent={Math.min((metrics.fechadosCount / 10) * 100, 100)}
                                    format={() => (
                                        <div>
                                            <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "'Sora','Inter',sans-serif", color: "var(--crm-ink-950)" }}>
                                                {metrics.fechadosCount}/10
                                            </div>
                                            <div style={{ fontSize: 11, color: "var(--crm-ink-400)", marginTop: 2 }}>vendas</div>
                                        </div>
                                    )}
                                    strokeColor={{
                                        "0%": "#3b82f6",
                                        "100%": "#10b981",
                                    }}
                                    strokeWidth={8}
                                    size={140}
                                />
                                <Text type="secondary" style={{ display: "block", fontSize: 13, marginTop: 8 }}>
                                    {metrics.fechadosCount >= 10 ? (
                                        <Tag color="success" style={{ borderRadius: 6 }}><FireOutlined /> Meta batida!</Tag>
                                    ) : (
                                        <>Faltam <b>{Math.max(10 - metrics.fechadosCount, 0)}</b> vendas para a meta</>
                                    )}
                                </Text>
                            </div>
                        </Card>
                    </Space>
                </Col>
            </Row>

            {/* Bottom Row: Top Vendedores + Últimos Leads */}
            <Row gutter={[14, 14]}>
                {/* Top Vendedores */}
                <Col xs={24} lg={14}>
                    <Card
                        title={<Text strong style={{ fontSize: 15 }}>Ranking de vendedores</Text>}
                        style={{ borderRadius: 14 }}
                        bodyStyle={{ padding: 0 }}
                        extra={
                            <Button size="small" onClick={() => navigate("/equipe")}>
                                Ver equipe
                            </Button>
                        }
                    >
                        <Table
                            size="small"
                            rowKey={(r) => r.name}
                            pagination={false}
                            dataSource={metrics.topOwners}
                            columns={[
                                {
                                    title: "",
                                    width: 40,
                                    render: (_, __, index) => (
                                        <div style={{
                                            width: 24, height: 24, borderRadius: 6,
                                            background: index === 0 ? "rgba(245,158,11,0.12)" : index === 1 ? "rgba(148,163,184,0.1)" : "transparent",
                                            display: "grid", placeItems: "center",
                                            fontSize: 12, fontWeight: 700,
                                            color: index === 0 ? "#f59e0b" : index === 1 ? "#94a3b8" : "var(--crm-ink-400)",
                                        }}>
                                            {index + 1}
                                        </div>
                                    ),
                                },
                                {
                                    title: "Consultor",
                                    dataIndex: "name",
                                    render: (v: string) => <Text strong style={{ fontSize: 13.5 }}>{v}</Text>,
                                },
                                { title: "Leads", dataIndex: "total", width: 65, render: (v: number) => <Text>{v}</Text> },
                                { title: "Ganhos", dataIndex: "fechados", width: 70, render: (v: number) => <Text style={{ color: "#059669", fontWeight: 600 }}>{v}</Text> },
                                {
                                    title: "Conversão",
                                    width: 140,
                                    render: (_, r: any) => (
                                        <Progress percent={Number(r.winRate.toFixed(0))} size="small" strokeColor="#10b981" />
                                    ),
                                },
                                {
                                    title: "Valor",
                                    dataIndex: "valor",
                                    width: 120,
                                    render: (v: number) => <Text strong>{formatCurrencyBRL(v, "R$ 0")}</Text>,
                                },
                            ]}
                        />
                    </Card>
                </Col>

                {/* Últimos Leads */}
                <Col xs={24} lg={10}>
                    <Card
                        title={<Text strong style={{ fontSize: 15 }}>Últimos leads</Text>}
                        style={{ borderRadius: 14 }}
                        bodyStyle={{ padding: "8px 0" }}
                        extra={
                            <Button size="small" onClick={() => navigate("/clientes")}>
                                Ver todos
                            </Button>
                        }
                    >
                        {metrics.recentLeads.length === 0 ? (
                            <div style={{ padding: 24, textAlign: "center" }}>
                                <Text type="secondary">Nenhum lead cadastrado ainda.</Text>
                            </div>
                        ) : (
                            <div>
                                {metrics.recentLeads.map((lead, index) => {
                                    const statusNorm = normalizeText(lead.status);
                                    const statusColor = statusNorm.includes("fechado") ? "#10b981"
                                        : statusNorm.includes("perdido") ? "#ef4444"
                                        : statusNorm.includes("visita") ? "#f59e0b"
                                        : statusNorm.includes("negocia") ? "#8b5cf6"
                                        : "#3b82f6";

                                    return (
                                        <div
                                            key={lead.id}
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "space-between",
                                                padding: "10px 22px",
                                                borderBottom: index < metrics.recentLeads.length - 1 ? "1px solid var(--crm-border-subtle)" : "none",
                                                cursor: "pointer",
                                                transition: "background 0.15s",
                                            }}
                                            onMouseEnter={(e) => e.currentTarget.style.background = "var(--crm-surface-2)"}
                                            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                                            onClick={() => navigate(`/clientes/show/${lead.id}`)}
                                        >
                                            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                                <div style={{
                                                    width: 8, height: 8, borderRadius: "50%",
                                                    background: statusColor, flexShrink: 0,
                                                }} />
                                                <div>
                                                    <Text strong style={{ fontSize: 13.5, display: "block" }}>{lead.nome}</Text>
                                                    <Text type="secondary" style={{ fontSize: 11.5 }}>
                                                        {lead.responsavel || "Sem resp."} · {formatDateBR(lead.created_at, "-")}
                                                    </Text>
                                                </div>
                                            </div>
                                            <Text style={{ fontSize: 13, fontWeight: 600, color: "var(--crm-ink-700)" }}>
                                                {formatCurrencyBRL(lead.valor || lead.conta_energia_media, "-")}
                                            </Text>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </Card>
                </Col>
            </Row>
        </div>
    );
};
