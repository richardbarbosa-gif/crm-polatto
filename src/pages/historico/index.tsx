import { HistoryOutlined, RollbackOutlined } from "@ant-design/icons";
import { useList, useUpdate, type CrudFilter } from "@refinedev/core";
import { Alert, Col, Modal, Row, Segmented, Skeleton, Table, Tag, Typography, message } from "antd";
import { useMemo, useState } from "react";
import { Button, Card, EmptyState, StatCard } from "../../components/ui";
import { useCrmAccess } from "../../hooks/useCrmAccess";
import {
    formatCurrencyBRL,
    formatDateBR,
    normalizeText,
} from "../../lib/formatters";
import { getSupabaseErrorMessage, isSupabaseMissingRelation } from "../../lib/supabaseErrors";
import { textoIndicaGanho, textoIndicaPerda, valorDoLead } from "../../lib/pipelineMetrics";
import type { ClienteRecord, PipelineStageRecord } from "../../types/db";

const { Title, Text } = Typography;

type SegmentoHistorico = "todos" | "ganhos" | "perdidos";

const PAGE_SIZE = 15;

const GANHO_FILTER: CrudFilter = {
    operator: "or",
    value: [
        { field: "status", operator: "contains", value: "fechado" },
        { field: "status", operator: "contains", value: "ganho" },
    ],
};

const HISTORICO_FILTER: CrudFilter = {
    operator: "or",
    value: [
        { field: "status", operator: "contains", value: "fechado" },
        { field: "status", operator: "contains", value: "ganho" },
        { field: "status", operator: "contains", value: "perdido" },
    ],
};

const isPerdido = (registro: ClienteRecord): boolean =>
    normalizeText(registro.status).includes("perdido");

export const HistoricoPage = () => {
    const { canViewAllLeads, canDeleteRecords, isLoadingAccess, tenantId, ownerCandidates } =
        useCrmAccess();

    const [segmento, setSegmento] = useState<SegmentoHistorico>("todos");
    const [pagina, setPagina] = useState(1);

    const { mutateAsync: updateCliente } = useUpdate();

    const visibilityFilters = useMemo<CrudFilter[]>(() => {
        if (!canViewAllLeads && ownerCandidates.length > 0) {
            return [{ field: "responsavel", operator: "in", value: ownerCandidates }];
        }
        return [];
    }, [canViewAllLeads, ownerCandidates]);

    const serverFilters = useMemo<CrudFilter[]>(() => {
        const filters: CrudFilter[] = [];
        if (segmento === "ganhos") {
            filters.push(GANHO_FILTER);
        } else if (segmento === "perdidos") {
            filters.push({ field: "status", operator: "contains", value: "perdido" });
        } else {
            filters.push(HISTORICO_FILTER);
        }
        return [...filters, ...visibilityFilters];
    }, [segmento, visibilityFilters]);

    const kpiFilters = useMemo<CrudFilter[]>(
        () => [HISTORICO_FILTER, ...visibilityFilters],
        [visibilityFilters],
    );

    const { query: listQuery } = useList<ClienteRecord>({
        resource: "clientes",
        pagination: { currentPage: pagina, pageSize: PAGE_SIZE },
        filters: serverFilters,
        sorters: [{ field: "created_at", order: "desc" }],
        queryOptions: { enabled: !isLoadingAccess, retry: false },
    });

    const { query: kpiQuery } = useList<ClienteRecord>({
        resource: "clientes",
        pagination: { mode: "off" },
        filters: kpiFilters,
        queryOptions: { enabled: !isLoadingAccess, retry: false },
    });

    const { query: stagesQuery } = useList<PipelineStageRecord & { ganho?: boolean | null; perdido?: boolean | null; pipeline_id?: string | null }>({
        resource: "pipeline_stages",
        pagination: { mode: "off" },
        sorters: [{ field: "ordem", order: "asc" }],
        queryOptions: { retry: false },
    });

    const registros = useMemo(
        () => ((listQuery?.data?.data as ClienteRecord[]) || []).filter(Boolean),
        [listQuery?.data?.data],
    );
    const total = listQuery?.data?.total ?? 0;

    const listError = listQuery?.error ?? null;
    const tabelaAusente = isSupabaseMissingRelation(listError);
    const listErrorMessage = listError && !tabelaAusente ? getSupabaseErrorMessage(listError) : "";

    const kpis = useMemo(() => {
        const rows = ((kpiQuery?.data?.data as ClienteRecord[]) || []).filter(Boolean);
        const ganhos = rows.filter((r) => !isPerdido(r));
        const perdidos = rows.filter(isPerdido);
        const valorGanho = ganhos.reduce(
            (acc, r) => acc + valorDoLead(r),
            0,
        );
        return { totalGanhos: ganhos.length, totalPerdidos: perdidos.length, valorGanho };
    }, [kpiQuery?.data?.data]);

    /**
     * Primeira etapa em aberto do funil do negócio. Reabrir gravava
     * stage_id = null e status "Novo Lead": o negócio caía na coluna
     * "Outros" (ou sumia, se o funil não a exibisse) em vez de voltar ao
     * começo do funil.
     */
    const etapaDeReabertura = (registro: ClienteRecord) => {
        const etapas = (stagesQuery?.data?.data ?? []).filter(
            (etapa) => !etapa.ganho && !etapa.perdido && !textoIndicaGanho(etapa.nome) && !textoIndicaPerda(etapa.nome),
        );
        const doFunil = etapas.filter(
            (etapa) => registro.pipeline_id && String(etapa.pipeline_id ?? "") === String(registro.pipeline_id),
        );
        const candidatas = doFunil.length ? doFunil : etapas;
        return [...candidatas].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))[0];
    };

    const reabrirNegocio = (registro: ClienteRecord) => {
        const destino = etapaDeReabertura(registro);
        Modal.confirm({
            title: "Reabrir negócio",
            content: (
                <Text>
                    O negócio <Text strong>{registro.nome || "Sem nome"}</Text> voltará ao funil
                    na etapa "{destino?.nome || "Novo Lead"}". Deseja continuar?
                </Text>
            ),
            okText: "Reabrir",
            cancelText: "Cancelar",
            onOk: async () => {
                try {
                    await updateCliente({
                        resource: "clientes",
                        id: registro.id,
                        values: {
                            tenant_id: tenantId || undefined,
                            status: destino?.nome || "Novo Lead",
                            stage_id: destino?.id ?? null,
                            ...(destino?.pipeline_id ? { pipeline_id: destino.pipeline_id } : {}),
                            data_fechamento: null,
                            motivo_perda: null,
                        },
                        successNotification: false,
                        errorNotification: false,
                    });
                    message.success("Negócio reaberto no funil.");
                    await Promise.all([listQuery?.refetch?.(), kpiQuery?.refetch?.()]);
                } catch {
                    message.error("Não foi possível reabrir o negócio.");
                }
            },
        });
    };

    if (isLoadingAccess || listQuery?.isLoading) {
        return (
            <div className="crm-page-shell">
                <Skeleton active />
            </div>
        );
    }

    return (
        <div className="crm-page-shell">
            <div className="crm-page-header">
                <div>
                    <Title level={2} className="crm-page-header-title">
                        <HistoryOutlined style={{ marginRight: 10, color: "#64748b" }} />
                        Histórico de negócios
                    </Title>
                    <Text className="crm-page-header-subtitle">
                        Negócios ganhos e perdidos que saíram do funil ativo.
                    </Text>
                </div>
                <Segmented
                    value={segmento}
                    onChange={(value) => {
                        setSegmento(value as SegmentoHistorico);
                        setPagina(1);
                    }}
                    options={[
                        { label: "Todos", value: "todos" },
                        { label: "Ganhos", value: "ganhos" },
                        { label: "Perdidos", value: "perdidos" },
                    ]}
                />
            </div>

            {tabelaAusente ? (
                <Alert
                    type="warning"
                    showIcon
                    message="Estrutura do banco pendente"
                    description="A tabela clientes ainda não existe neste ambiente. Execute as migrations em database/migrations/ no Supabase."
                    style={{ marginBottom: 16 }}
                />
            ) : null}

            {listErrorMessage ? (
                <Alert
                    type="error"
                    showIcon
                    message="Não foi possível carregar o histórico"
                    description={listErrorMessage}
                    style={{ marginBottom: 16 }}
                />
            ) : null}

            <Row gutter={[14, 14]} style={{ marginBottom: 16 }}>
                <Col xs={24} sm={8}>
                    <StatCard
                        title="Total ganhos"
                        value={kpis.totalGanhos}
                        accentColor="#10b981"
                        subtitle="negócios fechados"
                    />
                </Col>
                <Col xs={24} sm={8}>
                    <StatCard
                        title="Total perdidos"
                        value={kpis.totalPerdidos}
                        accentColor="#ef4444"
                        subtitle="negócios perdidos"
                    />
                </Col>
                <Col xs={24} sm={8}>
                    <StatCard
                        title="Valor ganho"
                        value={formatCurrencyBRL(kpis.valorGanho, "R$ 0")}
                        accentColor="#3b82f6"
                        subtitle="soma dos negócios ganhos"
                    />
                </Col>
            </Row>

            <Card bordered={false} className="crm-card">
                {registros.length === 0 && !tabelaAusente ? (
                    <EmptyState
                        title="Nenhum negócio no histórico"
                        description="Quando negócios forem ganhos ou perdidos no funil, eles aparecem aqui."
                        icon={<HistoryOutlined />}
                    />
                ) : (
                    <Table<ClienteRecord>
                        rowKey="id"
                        dataSource={registros}
                        pagination={{
                            current: pagina,
                            pageSize: PAGE_SIZE,
                            total,
                            showSizeChanger: false,
                            onChange: (page) => setPagina(page),
                        }}
                        columns={[
                            {
                                title: "Nome",
                                dataIndex: "nome",
                                render: (value: string | null) => (
                                    <Text strong>{value || "—"}</Text>
                                ),
                            },
                            {
                                title: "Valor",
                                key: "valor",
                                render: (_, registro) =>
                                    formatCurrencyBRL(
                                        registro.valor ?? registro.conta_energia_media,
                                        "—",
                                    ),
                            },
                            {
                                title: "Responsável",
                                dataIndex: "responsavel",
                                responsive: ["md"],
                                render: (value: string | null) => value || "—",
                            },
                            {
                                title: "Status",
                                dataIndex: "status",
                                render: (value: string | null, registro) => (
                                    <Tag color={isPerdido(registro) ? "red" : "green"}>
                                        {value || "—"}
                                    </Tag>
                                ),
                            },
                            {
                                title: "Motivo da perda",
                                dataIndex: "motivo_perda",
                                responsive: ["lg"],
                                render: (value: unknown) =>
                                    typeof value === "string" && value.trim() ? value : "—",
                            },
                            {
                                title: "Criado em",
                                dataIndex: "created_at",
                                responsive: ["md"],
                                render: (value: string | null) => formatDateBR(value),
                            },
                            ...(canDeleteRecords
                                ? [
                                      {
                                          title: "Ações",
                                          key: "acoes",
                                          width: 120,
                                          render: (_: unknown, registro: ClienteRecord) => (
                                              <Button
                                                  size="small"
                                                  icon={<RollbackOutlined />}
                                                  onClick={() => reabrirNegocio(registro)}
                                              >
                                                  Reabrir
                                              </Button>
                                          ),
                                      },
                                  ]
                                : []),
                        ]}
                    />
                )}
            </Card>
        </div>
    );
};
