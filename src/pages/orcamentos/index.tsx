import { FileTextOutlined, SearchOutlined } from "@ant-design/icons";
import { useList } from "@refinedev/core";
import { Alert, Col, Input, Row, Select, Skeleton, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { EmptyState, StatCard } from "../../components/ui";
import { useTenant } from "../../contexts/tenant";
import { useEhAdminDoTenant } from "../../hooks/useEhAdminDoTenant";
import { formatCurrencyBRL, normalizeText } from "../../lib/formatters";
import { buscarClientesDosNegocios } from "../../lib/orcamentos/api";
import { ROTULO_STATUS, STATUS_ORCAMENTO, formatarDataIso, type StatusOrcamento } from "../../lib/orcamentos/formato";
import { paraOrcamento, type ClienteDoNegocio, type Orcamento } from "../../lib/orcamentos/tipos";
import { isSupabaseMissingRelation } from "../../lib/supabaseErrors";
import { AcoesOrcamento } from "./acoes-orcamento";
import { EditorOrcamento } from "./editor-orcamento";
import { StatusOrcamentoTag } from "./status-orcamento";
import "./orcamentos.css";

const { Title, Text } = Typography;

const SEM_RESPONSAVEL = "__sem_responsavel__";

/** Nome do cliente de cada negócio (view clientes), em lotes, com cancelamento. */
const useClientesDosNegocios = (ids: string[]) => {
    const chave = [...new Set(ids)].sort().join(",");
    const [estado, setEstado] = useState<{ chave: string; mapa: Map<string, ClienteDoNegocio> }>({ chave: "", mapa: new Map() });

    useEffect(() => {
        if (!chave) return;
        let ativo = true;
        buscarClientesDosNegocios(chave.split(","))
            .then((mapa) => {
                if (ativo) setEstado({ chave, mapa });
            })
            .catch(() => {
                if (ativo) setEstado({ chave, mapa: new Map() });
            });
        return () => {
            ativo = false;
        };
    }, [chave]);

    return { mapa: estado.mapa, carregando: Boolean(chave) && estado.chave !== chave };
};

export const OrcamentosPage = () => {
    const { identityUserId } = useTenant();
    const { ehAdmin, carregando: carregandoPapel } = useEhAdminDoTenant();
    const [busca, setBusca] = useState("");
    const [status, setStatus] = useState<StatusOrcamento[]>([]);
    const [responsavel, setResponsavel] = useState<string | undefined>(undefined);
    const [editando, setEditando] = useState<Orcamento | null>(null);

    const { query } = useList({
        resource: "orcamentos",
        filters: [{ field: "deleted_at", operator: "null", value: true }],
        sorters: [{ field: "created_at", order: "desc" }],
        pagination: { mode: "off" },
    });

    // Mesma regra da lista de leads: gerente/admin vê o time todo; o
    // vendedor vê os orçamentos que criou ou dos quais é o responsável.
    const visiveis = useMemo(() => {
        const todos = ((query.data?.data ?? []) as Record<string, unknown>[]).map(paraOrcamento);
        if (ehAdmin) return todos;
        return todos.filter((o) => o.created_by === identityUserId || o.responsavel_id === identityUserId);
    }, [ehAdmin, identityUserId, query.data?.data]);

    const { mapa: clientes, carregando: carregandoClientes } = useClientesDosNegocios(visiveis.map((o) => o.negocio_id));

    const responsaveis = useMemo(
        () =>
            [...new Set(visiveis.map((o) => o.responsavel_nome?.trim() || SEM_RESPONSAVEL))]
                .sort((a, b) => a.localeCompare(b, "pt-BR"))
                .map((nome) => ({ value: nome, label: nome === SEM_RESPONSAVEL ? "Sem responsável" : nome })),
        [visiveis],
    );

    const filtrados = useMemo(() => {
        const termo = normalizeText(busca);
        return visiveis.filter((o) => {
            if (status.length && !status.includes(o.status)) return false;
            if (responsavel && (o.responsavel_nome?.trim() || SEM_RESPONSAVEL) !== responsavel) return false;
            if (!termo) return true;
            const cliente = clientes.get(o.negocio_id)?.nome ?? "";
            return [o.numero, o.titulo ?? "", cliente].some((campo) => normalizeText(campo).includes(termo));
        });
    }, [busca, clientes, responsavel, status, visiveis]);

    const resumo = useMemo(() => {
        const abertos = visiveis.filter((o) => o.status === "rascunho" || o.status === "enviado");
        const aceitos = visiveis.filter((o) => o.status === "aceito");
        const decididos = visiveis.filter((o) => o.status === "aceito" || o.status === "recusado").length;
        return {
            abertos: abertos.length,
            valorAberto: abertos.reduce((s, o) => s + o.total, 0),
            aceitos: aceitos.length,
            valorAceito: aceitos.reduce((s, o) => s + o.total, 0),
            taxaAceite: decididos ? (aceitos.length / decididos) * 100 : null,
        };
    }, [visiveis]);

    const colunas: ColumnsType<Orcamento> = [
        {
            title: "Número",
            dataIndex: "numero",
            width: 110,
            render: (numero: string) => <Text strong style={{ fontVariantNumeric: "tabular-nums" }}>{numero}</Text>,
        },
        {
            title: "Cliente",
            key: "cliente",
            render: (_, o) => (
                <div style={{ minWidth: 160 }}>
                    <Link to={`/clientes/show/${o.negocio_id}`}>
                        {clientes.get(o.negocio_id)?.nome ?? (carregandoClientes ? "Carregando..." : "Negócio")}
                    </Link>
                    {o.titulo ? (
                        <Text type="secondary" style={{ display: "block", fontSize: 12 }}>
                            {o.titulo}
                        </Text>
                    ) : null}
                </div>
            ),
        },
        {
            title: "Status",
            key: "status",
            width: 150,
            render: (_, o) => <StatusOrcamentoTag status={o.status} validoAte={o.valido_ate} />,
        },
        {
            title: "Total",
            dataIndex: "total",
            align: "right",
            width: 140,
            sorter: (a, b) => a.total - b.total,
            render: (total: number) => <Text strong style={{ fontVariantNumeric: "tabular-nums" }}>{formatCurrencyBRL(total)}</Text>,
        },
        {
            title: "Validade",
            dataIndex: "valido_ate",
            width: 110,
            sorter: (a, b) => a.valido_ate.localeCompare(b.valido_ate),
            render: (data: string) => formatarDataIso(data),
            responsive: ["md"],
        },
        {
            title: "Responsável",
            dataIndex: "responsavel_nome",
            width: 160,
            render: (nome: string | null) => nome || <Text type="secondary">—</Text>,
            responsive: ["lg"],
        },
        {
            title: "Ações",
            key: "acoes",
            width: 120,
            render: (_, o) => (
                <AcoesOrcamento
                    orcamento={o}
                    cliente={clientes.get(o.negocio_id) ?? null}
                    podeExcluir={ehAdmin || o.created_by === identityUserId}
                    onEditar={() => setEditando(o)}
                    onAlterado={() => void query.refetch()}
                />
            ),
        },
    ];

    const tabelaAusente = isSupabaseMissingRelation(query.error);

    return (
        <div className="crm-page-shell">
            <div className="crm-page-header">
                <div>
                    <Title level={2} className="crm-page-header-title">
                        <FileTextOutlined style={{ marginRight: 10, color: "#64748b" }} />
                        Orçamentos
                    </Title>
                    <Text className="crm-page-header-subtitle">
                        Propostas com a identidade da empresa. Para criar uma nova, abra o negócio e use a seção Orçamentos.
                    </Text>
                </div>
            </div>

            {tabelaAusente ? (
                <Alert
                    type="warning"
                    showIcon
                    message="Módulo de orçamentos pendente"
                    description="Execute a migration 2026-11-03_13_orcamentos.sql no Supabase para habilitar os orçamentos."
                />
            ) : (
                <>
                    <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                        <Col xs={24} sm={12} lg={8}>
                            <StatCard
                                title="Em aberto (rascunho e enviados)"
                                value={formatCurrencyBRL(resumo.valorAberto)}
                                subtitle={`${resumo.abertos} proposta(s)`}
                                accentColor="#2563eb"
                            />
                        </Col>
                        <Col xs={24} sm={12} lg={8}>
                            <StatCard
                                title="Aceitos"
                                value={formatCurrencyBRL(resumo.valorAceito)}
                                subtitle={`${resumo.aceitos} proposta(s)`}
                                accentColor="#16a34a"
                            />
                        </Col>
                        <Col xs={24} sm={24} lg={8}>
                            <StatCard
                                title="Taxa de aceite"
                                value={
                                    resumo.taxaAceite === null
                                        ? "—"
                                        : `${resumo.taxaAceite.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
                                }
                                subtitle="Aceitos ÷ (aceitos + recusados)"
                                accentColor="#f59e0b"
                            />
                        </Col>
                    </Row>

                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                        <Input
                            allowClear
                            prefix={<SearchOutlined />}
                            placeholder="Buscar por número, cliente ou título"
                            value={busca}
                            onChange={(e) => setBusca(e.target.value)}
                            style={{ flex: "1 1 260px", maxWidth: 420 }}
                            aria-label="Buscar orçamentos"
                        />
                        <Select<StatusOrcamento[]>
                            mode="multiple"
                            allowClear
                            placeholder="Status"
                            value={status}
                            onChange={setStatus}
                            options={STATUS_ORCAMENTO.map((s) => ({ value: s, label: ROTULO_STATUS[s] }))}
                            style={{ flex: "1 1 200px", maxWidth: 320 }}
                            aria-label="Filtrar por status"
                        />
                        <Select<string>
                            allowClear
                            placeholder="Responsável"
                            value={responsavel}
                            onChange={setResponsavel}
                            options={responsaveis}
                            style={{ flex: "1 1 200px", maxWidth: 280 }}
                            aria-label="Filtrar por responsável"
                        />
                    </div>

                    {query.isLoading || carregandoPapel ? (
                        <Skeleton active paragraph={{ rows: 6 }} />
                    ) : query.error ? (
                        <Alert type="error" showIcon message="Não foi possível carregar os orçamentos." />
                    ) : visiveis.length === 0 ? (
                        <EmptyState
                            title="Nenhum orçamento por aqui"
                            description="Abra um negócio em Oportunidades e crie o orçamento na seção Orçamentos."
                        />
                    ) : (
                        <Table<Orcamento>
                            rowKey="id"
                            dataSource={filtrados}
                            columns={colunas}
                            size="middle"
                            pagination={{ pageSize: 20, showSizeChanger: false, hideOnSinglePage: true }}
                            scroll={{ x: 720 }}
                            locale={{ emptyText: "Nenhum orçamento com esses filtros." }}
                        />
                    )}
                </>
            )}

            {editando ? (
                <EditorOrcamento
                    negocioId={editando.negocio_id}
                    orcamentoId={editando.id}
                    clienteNome={clientes.get(editando.negocio_id)?.nome}
                    onFechar={() => setEditando(null)}
                    onSalvo={() => {
                        setEditando(null);
                        void query.refetch();
                    }}
                />
            ) : null}
        </div>
    );
};
