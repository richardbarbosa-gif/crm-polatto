import {
    CopyOutlined,
    EnvironmentOutlined,
    ReloadOutlined,
    TeamOutlined,
} from "@ant-design/icons";
import { Alert, Input, Select, Space, Table, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
    Button,
    Card,
    EmptyState,
    SkeletonCard,
    SkeletonRow,
    StatCard,
} from "../../components/ui";
import {
    formatCurrencyBRL,
    formatDateBR,
    isClosedStatus,
    normalizeText,
    parseCurrencyLikeValue,
} from "../../lib/formatters";
import { supabaseClient } from "../../utility";

type ClienteBaseRecord = {
    id: number | string;
    nome?: string | null;
    telefone?: string | null;
    email?: string | null;
    endereco_instalacao?: string | null;
    numero?: string | null;
    cep?: string | null;
    conta_energia_media?: number | string | null;
    responsavel?: string | null;
    status?: string | null;
    created_at?: string | null;
};

const PERIOD_OPTIONS = [
    { label: "7 dias", value: 7 },
    { label: "30 dias", value: 30 },
    { label: "90 dias", value: 90 },
];

export const BaseClientesPage = () => {
    const navigate = useNavigate();
    const [clientesFechados, setClientesFechados] = useState<ClienteBaseRecord[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [searchText, setSearchText] = useState("");
    const [responsavelFiltro, setResponsavelFiltro] = useState<string | undefined>(
        undefined,
    );
    const [periodoDias, setPeriodoDias] = useState<number>(30);

    const fetchClientesFechados = useCallback(async () => {
        setIsLoading(true);
        setErrorMessage(null);

        try {
            const { data, error } = await supabaseClient
                .from("clientes")
                .select(
                    "id,nome,telefone,email,endereco_instalacao,numero,cep,conta_energia_media,responsavel,status,created_at",
                )
                .ilike("status", "fechado")
                .order("created_at", { ascending: false });

            if (error) {
                throw error;
            }

            const registros = (data ?? []) as ClienteBaseRecord[];
            setClientesFechados(registros.filter((record) => isClosedStatus(record.status)));
        } catch (error: any) {
            setClientesFechados([]);
            setErrorMessage(error?.message || "Falha ao carregar a base de clientes.");
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchClientesFechados();
    }, [fetchClientesFechados]);

    const responsaveisDisponiveis = useMemo(() => {
        const valores = new Set<string>();
        clientesFechados.forEach((cliente) => {
            if (cliente.responsavel) {
                valores.add(cliente.responsavel);
            }
        });
        return Array.from(valores).sort((a, b) => a.localeCompare(b));
    }, [clientesFechados]);

    const clientesFiltrados = useMemo(() => {
        const texto = normalizeText(searchText);
        const now = Date.now();
        const oneDayMs = 24 * 60 * 60 * 1000;

        return clientesFechados.filter((cliente) => {
            if (responsavelFiltro && cliente.responsavel !== responsavelFiltro) {
                return false;
            }

            if (periodoDias > 0 && cliente.created_at) {
                const createdAt = new Date(cliente.created_at).getTime();
                if (!Number.isNaN(createdAt)) {
                    const diffDays = (now - createdAt) / oneDayMs;
                    if (diffDays > periodoDias) {
                        return false;
                    }
                }
            }

            if (!texto) {
                return true;
            }

            return [cliente.nome, cliente.telefone, cliente.email].some((value) =>
                normalizeText(value).includes(texto),
            );
        });
    }, [clientesFechados, periodoDias, responsavelFiltro, searchText]);

    const hasValorField = useMemo(() => {
        return clientesFiltrados.some((item) =>
            Object.prototype.hasOwnProperty.call(item, "conta_energia_media"),
        );
    }, [clientesFiltrados]);

    const totalReceita = useMemo(() => {
        if (!hasValorField) {
            return null;
        }

        return clientesFiltrados.reduce((acc, curr) => {
            return acc + (parseCurrencyLikeValue(curr.conta_energia_media) ?? 0);
        }, 0);
    }, [clientesFiltrados, hasValorField]);

    const ticketMedio = useMemo(() => {
        if (!hasValorField || clientesFiltrados.length === 0 || totalReceita === null) {
            return null;
        }

        return totalReceita / clientesFiltrados.length;
    }, [clientesFiltrados.length, hasValorField, totalReceita]);

    const handleCopyContato = async (record: ClienteBaseRecord) => {
        const contato = [record.telefone, record.email].filter(Boolean).join(" | ");
        if (!contato) {
            message.warning("Cliente sem contato para copiar.");
            return;
        }

        if (!navigator?.clipboard) {
            message.error("Area de transferencia indisponivel neste navegador.");
            return;
        }

        try {
            await navigator.clipboard.writeText(contato);
            message.success("Contato copiado.");
        } catch {
            message.error("Nao foi possivel copiar o contato.");
        }
    };

    const abrirNoMapa = (record: ClienteBaseRecord) => {
        if (!record.endereco_instalacao) {
            return;
        }

        const endereco = [
            record.endereco_instalacao,
            record.numero ? `N ${record.numero}` : "",
            record.cep ? `CEP ${record.cep}` : "",
        ]
            .filter(Boolean)
            .join(", ");
        const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
            endereco,
        )}`;
        window.open(mapUrl, "_blank", "noopener,noreferrer");
    };

    const columns: ColumnsType<ClienteBaseRecord> = [
        {
            title: "Cliente",
            dataIndex: "nome",
            key: "nome",
            render: (_, record) => (
                <div>
                    <Typography.Text strong style={{ color: "#153046" }}>
                        {record.nome || "-"}
                    </Typography.Text>
                    <div style={{ marginTop: 2 }}>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {record.status || "Fechado"}
                        </Typography.Text>
                    </div>
                </div>
            ),
        },
        {
            title: "Contato",
            key: "contato",
            render: (_, record) => (
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <Typography.Text>{record.telefone || "-"}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {record.email || "-"}
                    </Typography.Text>
                </div>
            ),
        },
        {
            title: "Cidade / Endereco",
            dataIndex: "endereco_instalacao",
            key: "endereco_instalacao",
            render: (value) => value || "-",
        },
        {
            title: "Valor",
            dataIndex: "conta_energia_media",
            key: "conta_energia_media",
            render: (value) =>
                hasValorField ? formatCurrencyBRL(value, "--") : "--",
        },
        {
            title: "Responsavel",
            dataIndex: "responsavel",
            key: "responsavel",
            render: (value) => value || "-",
        },
        {
            title: "Data",
            dataIndex: "created_at",
            key: "created_at",
            render: (value) => formatDateBR(value, "-"),
        },
        {
            title: "Acoes",
            key: "acoes",
            render: (_, record) => (
                <Space wrap>
                    <Button size="small" onClick={() => navigate(`/clientes/show/${record.id}`)}>
                        Ver detalhes
                    </Button>
                    <Button
                        size="small"
                        icon={<EnvironmentOutlined />}
                        onClick={() => abrirNoMapa(record)}
                        disabled={!record.endereco_instalacao}
                    >
                        Abrir no mapa
                    </Button>
                    <Button
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={() => handleCopyContato(record)}
                    >
                        Copiar contato
                    </Button>
                </Space>
            ),
        },
    ];

    if (isLoading) {
        return (
            <div style={{ padding: 20 }}>
                <SkeletonCard cards={3} />
                <Card style={{ marginTop: 16 }}>
                    <SkeletonRow rows={8} />
                </Card>
            </div>
        );
    }

    return (
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 12,
                    flexWrap: "wrap",
                }}
            >
                <div>
                    <Typography.Title level={3} style={{ marginBottom: 4 }}>
                        Base de Clientes
                    </Typography.Title>
                    <Typography.Text type="secondary">
                        Clientes com oportunidades fechadas
                    </Typography.Text>
                </div>
                <Button type="primary" onClick={() => navigate("/clientes")}>
                    Ir para Oportunidades
                </Button>
            </div>

            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: 12,
                }}
            >
                <StatCard
                    title="Total de clientes"
                    value={clientesFiltrados.length}
                    accentColor="#3182ce"
                    subtitle="Base filtrada"
                />
                <StatCard
                    title="Receita total"
                    value={totalReceita === null ? "--" : formatCurrencyBRL(totalReceita, "--")}
                    accentColor="#38a169"
                    subtitle="Soma dos clientes listados"
                />
                <StatCard
                    title="Ticket medio"
                    value={ticketMedio === null ? "--" : formatCurrencyBRL(ticketMedio, "--")}
                    accentColor="#ed8936"
                    subtitle="Receita media por cliente"
                />
            </div>

            <Card>
                <div
                    style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 10,
                        alignItems: "center",
                        justifyContent: "space-between",
                    }}
                >
                    <Input.Search
                        placeholder="Buscar por nome, telefone ou email"
                        value={searchText}
                        onChange={(event) => setSearchText(event.target.value)}
                        allowClear
                        style={{ width: 360, maxWidth: "100%" }}
                    />
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                        <Select
                            placeholder="Responsavel"
                            allowClear
                            style={{ width: 200 }}
                            value={responsavelFiltro}
                            onChange={(value) => setResponsavelFiltro(value)}
                            options={responsaveisDisponiveis.map((responsavel) => ({
                                label: responsavel,
                                value: responsavel,
                            }))}
                            disabled={responsaveisDisponiveis.length === 0}
                        />
                        <Select
                            style={{ width: 130 }}
                            value={periodoDias}
                            onChange={(value) => setPeriodoDias(value)}
                            options={PERIOD_OPTIONS}
                        />
                    </div>
                </div>
            </Card>

            {errorMessage ? (
                <Alert
                    type="error"
                    showIcon
                    message="Nao foi possivel carregar a base de clientes."
                    description={errorMessage}
                    action={
                        <Button
                            size="small"
                            icon={<ReloadOutlined />}
                            onClick={() => fetchClientesFechados()}
                        >
                            Tentar novamente
                        </Button>
                    }
                />
            ) : null}

            {!errorMessage && clientesFiltrados.length === 0 ? (
                <EmptyState
                    title="Nenhum cliente fechado encontrado"
                    description="Ajuste os filtros ou avance oportunidades para Fechado."
                    actionLabel="Ir para Oportunidades"
                    onAction={() => navigate("/clientes")}
                    icon={<TeamOutlined />}
                />
            ) : null}

            {!errorMessage && clientesFiltrados.length > 0 ? (
                <Card>
                    <Table
                        rowKey="id"
                        dataSource={clientesFiltrados}
                        columns={columns}
                        pagination={{ pageSize: 10, showSizeChanger: false }}
                        scroll={{ x: 1100 }}
                    />
                </Card>
            ) : null}
        </div>
    );
};
