import { FileTextOutlined, SearchOutlined } from "@ant-design/icons";
import { useList, type CrudFilter } from "@refinedev/core";
import { Alert, Col, Input, Row, Select, Skeleton, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { EmptyState, RecursoIndisponivel, StatCard } from "../../components/ui";
import { useTenant } from "../../contexts/tenant";
import { useCrmAccess } from "../../hooks/useCrmAccess";
import { useBuscaNoServidor } from "../../hooks/useBuscaNoServidor";
import { contar, formatCurrencyBRL } from "../../lib/formatters";
import { buscarClientesDosNegocios } from "../../lib/orcamentos/api";
import { ROTULO_STATUS, STATUS_ORCAMENTO, formatarDataIso, type StatusOrcamento } from "../../lib/orcamentos/formato";
import { rotuloRevisao } from "../../lib/orcamentos/regras";
import { paraOrcamento, type ClienteDoNegocio, type Orcamento } from "../../lib/orcamentos/tipos";
import { isSupabaseMissingRelation } from "../../lib/supabaseErrors";
import type { Linha } from "../../types/database.generated";
import { AcoesOrcamento } from "./acoes-orcamento";
import { EditorOrcamento } from "./editor-orcamento";
import { StatusOrcamentoTag } from "./status-orcamento";
import "./orcamentos.css";

const { Title, Text } = Typography;

const SEM_RESPONSAVEL = "__sem_responsavel__";
const TAMANHO_DA_PAGINA = 20;

// Em view o banco não informa quais colunas aceitam nulo; o id do orçamento
// nunca é nulo (chave primária de orcamentos).
type LinhaDaLista = Omit<Linha<"vw_orcamentos_lista">, "id"> & { id: string };
type LinhaDoResumo = Linha<"vw_orcamentos_resumo">;

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
    const { isGerente: ehAdmin, isLoadingAccess: carregandoPapel } = useCrmAccess();
    const [busca, setBusca] = useState("");
    const [status, setStatus] = useState<StatusOrcamento[]>([]);
    const [responsavel, setResponsavel] = useState<string | undefined>(undefined);
    const [editando, setEditando] = useState<{ id: string; negocioId: string } | null>(null);

    // Paginação, busca e filtros no banco (vw_orcamentos_lista traz o nome do
    // cliente junto); os cartões do topo e o filtro de responsável vêm de
    // vw_orcamentos_resumo. Antes a tela baixava todos os orçamentos da
    // empresa para somar, filtrar e buscar no navegador.
    const [pagina, setPagina] = useState(1);
    const { termo, filtros: filtrosDaBusca } = useBuscaNoServidor(busca, ["numero", "titulo", "cliente_nome"]);
    const chaveDosFiltros = `${termo}|${status.join(",")}|${responsavel ?? ""}`;
    useEffect(() => setPagina(1), [chaveDosFiltros]);

    const filtros = useMemo<CrudFilter[]>(() => {
        const lista: CrudFilter[] = [...filtrosDaBusca];
        if (status.length) lista.push({ field: "status", operator: "in", value: status });
        if (responsavel === SEM_RESPONSAVEL) {
            lista.push({
                operator: "or",
                value: [
                    { field: "responsavel_nome", operator: "null", value: true },
                    { field: "responsavel_nome", operator: "eq", value: "" },
                ],
            });
        } else if (responsavel) {
            lista.push({ field: "responsavel_nome", operator: "eq", value: responsavel });
        }
        return lista;
    }, [filtrosDaBusca, responsavel, status]);

    const { query } = useList<LinhaDaLista>({
        resource: "vw_orcamentos_lista",
        filters: filtros,
        sorters: [{ field: "created_at", order: "desc" }],
        pagination: { currentPage: pagina, pageSize: TAMANHO_DA_PAGINA },
    });
    const { query: resumoQuery } = useList<LinhaDoResumo>({
        resource: "vw_orcamentos_resumo",
        pagination: { mode: "off" },
    });

    const recarregar = () => {
        void query.refetch();
        void resumoQuery.refetch();
    };

    // Mesma regra dos leads (Richard, 2026-11-03): todo vendedor vê os
    // orçamentos da empresa; excluir é só de quem criou ou do gerente.
    const linhas = useMemo(() => query.data?.data ?? [], [query.data?.data]);
    const visiveis = useMemo(() => linhas.map((linha) => paraOrcamento(linha as Record<string, unknown>)), [linhas]);
    const total = query.data?.total ?? visiveis.length;
    const nomeDoCliente = useMemo(
        () => new Map(linhas.map((linha) => [String(linha.negocio_id), linha.cliente_nome ?? ""])),
        [linhas],
    );

    // Dados completos do cliente (documento, endereço) para gerar o PDF: só os
    // dos orçamentos da página exibida.
    const { mapa: clientes } = useClientesDosNegocios(visiveis.map((o) => o.negocio_id));

    // Normalmente uma linha (a empresa do usuário); o administrador da
    // plataforma enxerga uma por empresa, e a tela soma.
    const resumo = useMemo(() => {
        const linhasDoResumo = resumoQuery.data?.data ?? [];
        const soma = (campo: "abertos" | "valor_aberto" | "aceitos" | "valor_aceito" | "decididos") =>
            linhasDoResumo.reduce((acc, linha) => acc + Number(linha[campo] ?? 0), 0);
        const aceitos = soma("aceitos");
        const decididos = soma("decididos");
        return {
            abertos: soma("abertos"),
            valorAberto: soma("valor_aberto"),
            aceitos,
            valorAceito: soma("valor_aceito"),
            taxaAceite: decididos ? (aceitos / decididos) * 100 : null,
            semNenhum: linhasDoResumo.length === 0,
        };
    }, [resumoQuery.data?.data]);

    const responsaveis = useMemo(() => {
        const linhasDoResumo = resumoQuery.data?.data ?? [];
        const nomes = [...new Set(linhasDoResumo.flatMap((linha) => linha.responsaveis ?? []))].sort((a, b) =>
            a.localeCompare(b, "pt-BR"),
        );
        const opcoes = nomes.map((nome) => ({ value: nome, label: nome }));
        if (linhasDoResumo.some((linha) => linha.tem_sem_responsavel)) {
            opcoes.push({ value: SEM_RESPONSAVEL, label: "Sem responsável" });
        }
        return opcoes;
    }, [resumoQuery.data?.data]);

    const colunas: ColumnsType<Orcamento> = [
        {
            title: "Número",
            className: "crm-nowrap",
            dataIndex: "numero",
            width: 130,
            render: (numero: string, o) => {
                const revisao = rotuloRevisao(o.revisao, o.numero_original);
                return (
                    <div>
                        <Text strong style={{ fontVariantNumeric: "tabular-nums" }}>
                            {numero}
                        </Text>
                        {revisao ? (
                            <Text type="secondary" style={{ display: "block", fontSize: 12 }}>
                                {revisao}
                            </Text>
                        ) : null}
                    </div>
                );
            },
        },
        {
            title: "Cliente",
            key: "cliente",
            render: (_, o) => (
                <div style={{ minWidth: 160 }}>
                    <Link to={`/clientes/show/${o.negocio_id}`}>
                        {nomeDoCliente.get(o.negocio_id) || "Negócio"}
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
            className: "crm-nowrap",
            dataIndex: "total",
            align: "right",
            width: 140,
            sorter: (a, b) => a.total - b.total,
            render: (total: number) => <Text strong style={{ fontVariantNumeric: "tabular-nums" }}>{formatCurrencyBRL(total)}</Text>,
        },
        {
            title: "Validade",
            className: "crm-nowrap",
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
                    onAbrir={() => setEditando({ id: o.id, negocioId: o.negocio_id })}
                    onNovaVersao={(id) => setEditando({ id, negocioId: o.negocio_id })}
                    onAlterado={recarregar}
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
                <RecursoIndisponivel recurso="Orçamentos" />
            ) : (
                <>
                    <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                        <Col xs={24} sm={12} lg={8}>
                            <StatCard
                                title="Em aberto (rascunho e enviados)"
                                value={formatCurrencyBRL(resumo.valorAberto)}
                                subtitle={contar(resumo.abertos, "proposta", "propostas")}
                                accentColor="#2563eb"
                            />
                        </Col>
                        <Col xs={24} sm={12} lg={8}>
                            <StatCard
                                title="Aceitos"
                                value={formatCurrencyBRL(resumo.valorAceito)}
                                subtitle={contar(resumo.aceitos, "proposta", "propostas")}
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
                    ) : resumo.semNenhum && !resumoQuery.isLoading ? (
                        <EmptyState
                            title="Nenhum orçamento por aqui"
                            description="Abra um negócio em Oportunidades e crie o orçamento na seção Orçamentos."
                        />
                    ) : (
                        <Table<Orcamento>
                            rowKey="id"
                            dataSource={visiveis}
                            columns={colunas}
                            size="middle"
                            loading={query.isFetching}
                            pagination={{
                                current: pagina,
                                pageSize: TAMANHO_DA_PAGINA,
                                total,
                                showSizeChanger: false,
                                hideOnSinglePage: true,
                                onChange: setPagina,
                            }}
                            scroll={{ x: 720 }}
                            locale={{ emptyText: "Nenhum orçamento com esses filtros." }}
                        />
                    )}
                </>
            )}

            {editando ? (
                <EditorOrcamento
                    key={editando.id}
                    negocioId={editando.negocioId}
                    orcamentoId={editando.id}
                    clienteNome={nomeDoCliente.get(editando.negocioId) || undefined}
                    onFechar={() => setEditando(null)}
                    onSalvo={() => {
                        setEditando(null);
                        recarregar();
                    }}
                    onNovaVersao={(id) => {
                        setEditando({ id, negocioId: editando.negocioId });
                        recarregar();
                    }}
                />
            ) : null}
        </div>
    );
};
