import {
    CheckCircleOutlined,
    DollarCircleOutlined,
    FireOutlined,
    RiseOutlined,
} from "@ant-design/icons";
import { useList, type CrudFilter } from "@refinedev/core";
import { Alert, Col, Progress, Row, Skeleton, Space, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { Button, Card, EmptyState, StatCard } from "../../components/ui";
import { ListaNegociosSaude } from "../../components/saude/lista-negocios-saude";
import { PrimeiroAcesso } from "../../components/primeiro-acesso";
import { useCrmAccess } from "../../hooks/useCrmAccess";
import { useRealtimeNegocios } from "../../hooks/useRealtimeNegocios";
import { formatCurrencyBRL, formatDateBR, formatPercentBR, parseCurrencyLikeValue } from "../../lib/formatters";
import {
    classificarDesfecho,
    indexarEtapas,
    percentual,
    resumirFunil,
    taxaDeConversao,
    valorDoLead,
    type EtapaFunil,
    type LinhaKpi,
} from "../../lib/pipelineMetrics";
import {
    DIAS_QUENTE_SEM_CONTATO,
    filtrosQuentesSemContato,
    RECURSO_SAUDE,
    rotuloSemContato,
} from "../../lib/saudeNegocio";

const { Title, Text } = Typography;

type LeadRecente = {
    id: string | number;
    nome?: string | null;
    status?: string | null;
    stage_id?: string | number | null;
    responsavel?: string | null;
    created_at?: string | null;
    valor?: number | string | null;
    conta_energia_media?: number | string | null;
};

type MetaDoMes = { funcionario_id?: string | null; valor_meta?: number | string | null; target_wins?: number | null };
type RealizadoDoMes = { funcionario_id?: string | null; vendas_qtd?: number | string | null; vendas_valor?: number | string | null };

const CORES_DESFECHO = { ganho: "#10b981", perdido: "#ef4444", aberto: "#3b82f6" } as const;

const temperatureColors: Record<"quente" | "morno" | "frio", { bg: string; text: string; label: string }> = {
    quente: { bg: "rgba(239, 68, 68, 0.08)", text: "#dc2626", label: "Quente" },
    morno: { bg: "rgba(245, 158, 11, 0.08)", text: "#d97706", label: "Morno" },
    frio: { bg: "rgba(100, 116, 139, 0.08)", text: "#64748b", label: "Frio" },
};

/**
 * Dashboard calculado sobre a view agregada vw_kanban_kpis.
 *
 * Antes a tela baixava TODOS os leads (select * sem limite) e contava no
 * navegador: acima de 1000 leads o Supabase cortava a resposta e todos os
 * números ficavam errados sem aviso; o funil só reconhecia cinco etapas de
 * nome fixo ("novo", "visita"...); o "pipeline" somava negócios já
 * ganhos; e a "Meta do mês" era um 10 fixo comparado com as vendas de
 * todos os tempos.
 */
export const DashboardPage = () => {
    const navigate = useNavigate();
    const { canViewAllLeads, ownerCandidates, employee, isLoadingAccess, isGerente, tenantId } = useCrmAccess();

    // Mantém o dashboard vivo depois que "clientes" vira view (ver hook)
    useRealtimeNegocios(["clientes", "vw_kanban_kpis", RECURSO_SAUDE]);

    // Mesma visão do Kanban: vendedor sem acesso total vê os próprios negócios.
    const filtrosDeVisao = useMemo<CrudFilter[]>(
        () =>
            !canViewAllLeads && ownerCandidates.length > 0
                ? [{ field: "responsavel", operator: "in", value: ownerCandidates }]
                : [],
        [canViewAllLeads, ownerCandidates],
    );

    const { query: kpiQuery } = useList<LinhaKpi>({
        resource: "vw_kanban_kpis",
        pagination: { mode: "off" },
        filters: filtrosDeVisao,
        queryOptions: { enabled: !isLoadingAccess },
    });

    const { query: stagesQuery } = useList<EtapaFunil & { id: string | number }>({
        resource: "pipeline_stages",
        pagination: { mode: "off" },
        sorters: [{ field: "ordem", order: "asc" }],
        queryOptions: { retry: false },
    });

    const { query: recentesQuery } = useList<LeadRecente>({
        resource: "clientes",
        pagination: { currentPage: 1, pageSize: 5 },
        sorters: [{ field: "created_at", order: "desc" }],
        filters: filtrosDeVisao,
        meta: { select: "id,nome,status,stage_id,responsavel,created_at,valor,conta_energia_media" },
        queryOptions: { enabled: !isLoadingAccess },
    });

    const inicioDoMes = dayjs().startOf("month").format("YYYY-MM-DD");
    const filtrosDoMes = useMemo<CrudFilter[]>(() => {
        const filtros: CrudFilter[] = [{ field: "mes_referencia", operator: "eq", value: inicioDoMes }];
        // Vendedor acompanha a própria meta; gestor, a do time.
        if (!canViewAllLeads && employee?.id) {
            filtros.push({ field: "funcionario_id", operator: "eq", value: employee.id });
        }
        return filtros;
    }, [canViewAllLeads, employee?.id, inicioDoMes]);

    const { query: metasQuery } = useList<MetaDoMes>({
        resource: "metas",
        pagination: { mode: "off" },
        filters: filtrosDoMes,
        queryOptions: { retry: false, enabled: !isLoadingAccess },
    });
    const { query: realizadoQuery } = useList<RealizadoDoMes>({
        resource: "vw_performance_vendedores",
        pagination: { mode: "off" },
        filters: filtrosDoMes,
        queryOptions: { retry: false, enabled: !isLoadingAccess },
    });

    const etapas = stagesQuery?.data?.data;
    const resumo = useMemo(() => resumirFunil(kpiQuery?.data?.data, etapas), [kpiQuery?.data?.data, etapas]);
    const etapasPorId = useMemo(() => indexarEtapas(etapas), [etapas]);

    const metaDoMes = useMemo(() => {
        const metas = metasQuery?.data?.data ?? [];
        const realizado = realizadoQuery?.data?.data ?? [];
        const alvoQtd = metas.reduce((acc, m) => acc + (Number(m.target_wins) || 0), 0);
        const alvoValor = metas.reduce((acc, m) => acc + (parseCurrencyLikeValue(m.valor_meta) ?? 0), 0);
        const feitoQtd = realizado.reduce((acc, r) => acc + (Number(r.vendas_qtd) || 0), 0);
        const feitoValor = realizado.reduce((acc, r) => acc + (parseCurrencyLikeValue(r.vendas_valor) ?? 0), 0);
        return { alvoQtd, alvoValor, feitoQtd, feitoValor, definida: alvoQtd > 0 || alvoValor > 0 };
    }, [metasQuery?.data?.data, realizadoQuery?.data?.data]);

    const ticketMedio = resumo.ganhos > 0 ? resumo.valorGanho / resumo.ganhos : 0;
    const maxFunil = Math.max(...resumo.porEtapa.map((e) => e.total), 1);
    const topResponsaveis = resumo.porResponsavel.slice(0, 5);
    const recentes = recentesQuery?.data?.data ?? [];

    if (isLoadingAccess || kpiQuery?.isLoading) {
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

    // Progresso da meta: pela quantidade quando definida; senão pelo valor.
    const usarQuantidade = metaDoMes.alvoQtd > 0;
    const progressoMeta = usarQuantidade
        ? percentual(metaDoMes.feitoQtd, metaDoMes.alvoQtd)
        : percentual(metaDoMes.feitoValor, metaDoMes.alvoValor);

    return (
        <div className="crm-page-shell">
            <div className="crm-page-header">
                <div>
                    <Title level={3} className="crm-page-header-title">Dashboard</Title>
                    <Text className="crm-page-header-subtitle">
                        Visão executiva do funil — {dayjs().format("DD [de] MMMM [de] YYYY")}
                    </Text>
                </div>
                <Space wrap>
                    <Button onClick={() => navigate("/clientes")}>Ver oportunidades</Button>
                    <Button type="primary" onClick={() => navigate("/metas")}>Metas do mês</Button>
                </Space>
            </div>

            <PrimeiroAcesso isGerente={isGerente} tenantId={tenantId} />

            {kpiQuery?.isError ? (
                <Alert
                    type="error"
                    showIcon
                    style={{ marginBottom: 14 }}
                    message="Não foi possível carregar os indicadores"
                    description={kpiQuery.error?.message || "Tente recarregar a página."}
                />
            ) : null}

            <Row gutter={[14, 14]}>
                <Col xs={24} sm={12} lg={6}>
                    <div className="crm-dashboard-hero" style={{ borderRadius: 14, padding: "20px 22px 18px", position: "relative", overflow: "hidden" }}>
                        <div style={{ position: "absolute", top: -30, right: -20, width: 120, height: 120, borderRadius: "50%", background: "radial-gradient(circle, rgba(96,165,250,0.15) 0%, transparent 70%)" }} />
                        <Text style={{ color: "rgba(148,163,184,0.85)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 550, display: "block", marginBottom: 8 }}>
                            Pipeline em aberto
                        </Text>
                        <div style={{ fontSize: 28, fontWeight: 700, color: "#fff", fontFamily: "'Sora','Inter',sans-serif", letterSpacing: "-0.03em", lineHeight: 1.1 }}>
                            {formatCurrencyBRL(resumo.valorAberto, "R$ 0")}
                        </div>
                        <Text style={{ color: "rgba(148,163,184,0.75)", fontSize: 12, marginTop: 6, display: "block" }}>
                            {resumo.abertos} {resumo.abertos === 1 ? "oportunidade ativa" : "oportunidades ativas"}
                        </Text>
                    </div>
                </Col>

                <Col xs={24} sm={12} lg={6}>
                    <StatCard
                        title="Receita ganha (acumulada)"
                        value={formatCurrencyBRL(resumo.valorGanho, "R$ 0")}
                        prefix={<CheckCircleOutlined style={{ color: "#10b981" }} />}
                        valueStyle={{ color: "#059669" }}
                        accentColor="#10b981"
                        subtitle={`${resumo.ganhos} ${resumo.ganhos === 1 ? "venda realizada" : "vendas realizadas"}`}
                        style={{ height: "100%" }}
                    />
                </Col>

                <Col xs={24} sm={12} lg={6}>
                    <StatCard
                        title="Conversão"
                        value={formatPercentBR(resumo.conversao)}
                        suffix="%"
                        prefix={<RiseOutlined style={{ color: "#3b82f6" }} />}
                        accentColor="#3b82f6"
                        subtitle={`${resumo.ganhos} ganho${resumo.ganhos === 1 ? "" : "s"} de ${resumo.encerrados} encerrado${resumo.encerrados === 1 ? "" : "s"}`}
                        style={{ height: "100%" }}
                    />
                </Col>

                <Col xs={24} sm={12} lg={6}>
                    <StatCard
                        title="Ticket médio"
                        value={formatCurrencyBRL(ticketMedio, "R$ 0")}
                        prefix={<DollarCircleOutlined style={{ color: "#3b82f6" }} />}
                        accentColor="#3b82f6"
                        subtitle="Por venda ganha"
                        style={{ height: "100%" }}
                    />
                </Col>

                {resumo.temProbabilidade ? (
                    <Col xs={24} sm={12} lg={6}>
                        <StatCard
                            title="Previsão ponderada"
                            value={formatCurrencyBRL(resumo.valorPonderado, "R$ 0")}
                            subtitle="Valor em aberto × probabilidade da etapa"
                            accentColor="#8b5cf6"
                            style={{ height: "100%" }}
                        />
                    </Col>
                ) : null}
            </Row>

            <Row gutter={[14, 14]}>
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
                        {resumo.porEtapa.length === 0 ? (
                            <EmptyState
                                title="Nenhuma oportunidade ainda"
                                description="Cadastre o primeiro lead para acompanhar o funil."
                            />
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                                {resumo.porEtapa.map((etapa) => {
                                    const cor = etapa.cor || CORES_DESFECHO[etapa.desfecho];
                                    const pct = (etapa.total / maxFunil) * 100;
                                    return (
                                        <div key={etapa.chave}>
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8 }}>
                                                <Text style={{ fontSize: 13.5, fontWeight: 500, color: "var(--crm-ink-700)" }}>{etapa.nome}</Text>
                                                <Space size={12}>
                                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                                        {formatCurrencyBRL(etapa.valor, "R$ 0")}
                                                    </Text>
                                                    <Text style={{ fontSize: 20, fontWeight: 700, color: cor, fontFamily: "'Sora','Inter',sans-serif", letterSpacing: "-0.02em" }}>
                                                        {etapa.total}
                                                    </Text>
                                                </Space>
                                            </div>
                                            <div
                                                style={{ background: "var(--crm-surface-2)", borderRadius: 6, height: 8, overflow: "hidden" }}
                                                role="progressbar"
                                                aria-label={`${etapa.nome}: ${etapa.total}`}
                                                aria-valuenow={etapa.total}
                                                aria-valuemax={maxFunil}
                                            >
                                                <div
                                                    style={{
                                                        width: `${Math.max(pct, 2)}%`,
                                                        height: "100%",
                                                        background: `linear-gradient(90deg, ${cor}, ${cor}cc)`,
                                                        borderRadius: 6,
                                                        transition: "width 0.8s cubic-bezier(0.22, 1, 0.36, 1)",
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </Card>
                </Col>

                <Col xs={24} lg={8}>
                    <Space direction="vertical" size={14} style={{ width: "100%" }}>
                        <Card
                            title={<Text strong style={{ fontSize: 15 }}>Temperatura dos leads</Text>}
                            style={{ borderRadius: 14 }}
                            bodyStyle={{ padding: "16px 22px 20px" }}
                        >
                            <div style={{ display: "flex", gap: 10 }}>
                                {(["quente", "morno", "frio"] as const).map((temp) => {
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
                                                {resumo.porTemperatura[temp]}
                                            </div>
                                            <Text style={{ fontSize: 11, color: config.text, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                                {config.label}
                                            </Text>
                                        </div>
                                    );
                                })}
                            </div>
                        </Card>

                        <ListaNegociosSaude
                            titulo={`Quentes sem contato há ${DIAS_QUENTE_SEM_CONTATO}+ dias`}
                            filtros={[...filtrosQuentesSemContato(), ...filtrosDeVisao]}
                            sorters={[{ field: "dias_sem_contato", order: "desc" }, { field: "id", order: "asc" }]}
                            detalhe={(linha) => rotuloSemContato(linha.dias_sem_contato)}
                            vazio="Nenhum lead quente esperando contato."
                            habilitado={!isLoadingAccess}
                            corDetalhe="#dc2626"
                        />

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
                            {!metaDoMes.definida ? (
                                <div style={{ textAlign: "center", padding: "8px 0" }}>
                                    <Text type="secondary">
                                        Nenhuma meta definida para {dayjs().format("MMMM")}.
                                    </Text>
                                    <div style={{ marginTop: 8 }}>
                                        <Text>
                                            {metaDoMes.feitoQtd} {metaDoMes.feitoQtd === 1 ? "venda" : "vendas"} no mês ·{" "}
                                            {formatCurrencyBRL(metaDoMes.feitoValor, "R$ 0")}
                                        </Text>
                                    </div>
                                </div>
                            ) : (
                                <div style={{ textAlign: "center", padding: "8px 0" }}>
                                    <Progress
                                        type="dashboard"
                                        percent={Math.min(Number(progressoMeta.toFixed(0)), 100)}
                                        format={() => (
                                            <div>
                                                <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Sora','Inter',sans-serif", color: "var(--crm-ink-950)" }}>
                                                    {usarQuantidade
                                                        ? `${metaDoMes.feitoQtd}/${metaDoMes.alvoQtd}`
                                                        : `${progressoMeta.toFixed(0)}%`}
                                                </div>
                                                <div style={{ fontSize: 11, color: "var(--crm-ink-400)", marginTop: 2 }}>
                                                    {usarQuantidade ? "vendas" : "do valor"}
                                                </div>
                                            </div>
                                        )}
                                        strokeColor={{ "0%": "#3b82f6", "100%": "#10b981" }}
                                        strokeWidth={8}
                                        size={140}
                                    />
                                    <Text type="secondary" style={{ display: "block", fontSize: 13, marginTop: 8 }}>
                                        {progressoMeta >= 100 ? (
                                            <Tag color="success" style={{ borderRadius: 6 }}><FireOutlined /> Meta batida!</Tag>
                                        ) : usarQuantidade ? (
                                            <>Faltam <b>{Math.max(metaDoMes.alvoQtd - metaDoMes.feitoQtd, 0)}</b> vendas para a meta</>
                                        ) : (
                                            <>Faltam <b>{formatCurrencyBRL(Math.max(metaDoMes.alvoValor - metaDoMes.feitoValor, 0), "R$ 0")}</b></>
                                        )}
                                    </Text>
                                </div>
                            )}
                        </Card>
                    </Space>
                </Col>
            </Row>

            <Row gutter={[14, 14]}>
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
                            rowKey={(r) => r.nome}
                            pagination={false}
                            dataSource={topResponsaveis}
                            scroll={{ x: 480 }}
                            locale={{ emptyText: "Sem negócios atribuídos ainda." }}
                            columns={[
                                {
                                    title: "#",
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
                                    dataIndex: "nome",
                                    render: (v: string) => <Text strong style={{ fontSize: 13.5 }}>{v}</Text>,
                                },
                                { title: "Leads", dataIndex: "total", width: 65 },
                                { title: "Ganhos", dataIndex: "ganhos", width: 70, render: (v: number) => <Text style={{ color: "#059669", fontWeight: 600 }}>{v}</Text> },
                                {
                                    title: "Conversão",
                                    width: 140,
                                    render: (_, r) => (
                                        <Progress percent={Number(taxaDeConversao(r.ganhos, r.perdidos).toFixed(0))} size="small" strokeColor="#10b981" />
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
                        {recentes.length === 0 ? (
                            <div style={{ padding: 24, textAlign: "center" }}>
                                <Text type="secondary">Nenhum lead cadastrado ainda.</Text>
                            </div>
                        ) : (
                            <div>
                                {recentes.map((lead, index) => {
                                    const desfecho = classificarDesfecho(lead, etapasPorId);
                                    return (
                                        <button
                                            type="button"
                                            key={String(lead.id)}
                                            className="crm-dashboard-recent-lead"
                                            style={{
                                                display: "flex",
                                                width: "100%",
                                                alignItems: "center",
                                                justifyContent: "space-between",
                                                padding: "10px 22px",
                                                border: "none",
                                                background: "transparent",
                                                textAlign: "left",
                                                borderBottom: index < recentes.length - 1 ? "1px solid var(--crm-border-subtle)" : "none",
                                                cursor: "pointer",
                                            }}
                                            onClick={() => navigate(`/clientes/show/${lead.id}`)}
                                        >
                                            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                                                <span
                                                    aria-hidden
                                                    style={{ width: 8, height: 8, borderRadius: "50%", background: CORES_DESFECHO[desfecho], flexShrink: 0 }}
                                                />
                                                <div style={{ minWidth: 0 }}>
                                                    <Text strong style={{ fontSize: 13.5, display: "block" }} ellipsis>{lead.nome || "Sem nome"}</Text>
                                                    <Text type="secondary" style={{ fontSize: 11.5 }}>
                                                        {lead.responsavel || "Sem responsável"} · {formatDateBR(lead.created_at, "-")}
                                                    </Text>
                                                </div>
                                            </div>
                                            <Text style={{ fontSize: 13, fontWeight: 600, color: "var(--crm-ink-700)", whiteSpace: "nowrap" }}>
                                                {formatCurrencyBRL(valorDoLead(lead), "-")}
                                            </Text>
                                        </button>
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
