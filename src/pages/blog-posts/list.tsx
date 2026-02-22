import React, { useEffect, useMemo, useState } from "react";
import { useGetIdentity, useList, useUpdate } from "@refinedev/core";
import { CreateButton, EditButton, ShowButton } from "@refinedev/antd";
import { Input, Select, Space, Spin, Table, Tooltip, Typography, message } from "antd";
import {
    AppstoreOutlined,
    ArrowUpOutlined,
    BarsOutlined,
    CheckCircleOutlined,
    DollarCircleOutlined,
    PlusOutlined,
    SearchOutlined,
} from "@ant-design/icons";
import {
    Badge,
    Button,
    Card,
    EmptyState,
    StatCard,
    TemperatureBadge,
} from "../../components/ui";
import { formatCurrencyBRL, formatDateBR, normalizeText } from "../../lib/formatters";
import { isSupabaseMissingRelation } from "../../lib/supabaseErrors";
import {
    type LeadTemperatureTag,
    LEAD_AUTOMATIC_TEMPERATURE_OPTIONS,
    LEAD_TEMPERATURE_OPTIONS,
    resolveLeadTemperature,
} from "../../lib/leadTemperature";
import { supabaseClient } from "../../utility";

const { Text, Title } = Typography;

type Stage = {
    id?: string | number;
    nome: string;
    cor?: string;
    ordem?: number;
};

const DEFAULT_STAGES: Stage[] = [
    { id: "novo", nome: "Novo Lead", cor: "#5d9cec", ordem: 1 },
    { id: "negociacao", nome: "Em Negociação", cor: "#3182ce", ordem: 2 },
    { id: "visita", nome: "Visita Agendada", cor: "#ed8936", ordem: 3 },
    { id: "fechado", nome: "Fechado", cor: "#82cf6e", ordem: 4 },
    { id: "perdido", nome: "Perdido", cor: "#f56565", ordem: 5 },
];

const getStatusAccent = (status?: string) => {
    const normalized = normalizeText(status);
    if (normalized.includes("fechado")) return "#82cf6e";
    if (normalized.includes("perdido")) return "#f56565";
    if (normalized.includes("visita")) return "#ed8936";
    if (normalized.includes("negocia")) return "#3182ce";
    return "#5d9cec";
};

const getStatusTone = (
    status?: string,
): "success" | "danger" | "warning" | "info" => {
    const normalized = normalizeText(status);
    if (normalized.includes("fechado")) return "success";
    if (normalized.includes("perdido")) return "danger";
    if (normalized.includes("visita")) return "warning";
    return "info";
};

export const BlogPostList = () => {
    const [viewType, setViewType] = useState<"kanban" | "list">("kanban");
    const [searchText, setSearchText] = useState("");
    const [responsavelFiltro, setResponsavelFiltro] = useState<string | undefined>(
        undefined,
    );
    const [temperaturaFiltro, setTemperaturaFiltro] = useState<
        "todas" | LeadTemperatureTag
    >("todas");
    const [temperatureRevision, setTemperatureRevision] = useState(0);

    const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
    const [activeDropColumn, setActiveDropColumn] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    const { query: clientesQuery } = useList({
        resource: "clientes",
        pagination: { mode: "off" },
    });

    const { query: stagesQuery } = useList({
        resource: "pipeline_stages",
        pagination: { mode: "off" },
        sorters: [{ field: "ordem", order: "asc" }],
    });

    const { mutateAsync: updateLead } = useUpdate();
    const { data: user } = useGetIdentity();

    const isLoading = clientesQuery?.isLoading;
    const rawData = clientesQuery?.data?.data || [];

    useEffect(() => {
        const handleFocus = () => setTemperatureRevision((prev) => prev + 1);
        window.addEventListener("focus", handleFocus);
        return () => window.removeEventListener("focus", handleFocus);
    }, []);

    const stages = useMemo(() => {
        const data = (stagesQuery?.data?.data as any[]) || [];
        const normalized = data
            .map((stage) => ({
                id: stage.id,
                nome: stage.nome ?? stage.name ?? "",
                cor: stage.cor ?? stage.color,
                ordem: stage.ordem ?? stage.order ?? stage.sort_order,
            }))
            .filter((stage) => stage.nome)
            .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
        return normalized.length > 0 ? normalized : DEFAULT_STAGES;
    }, [stagesQuery?.data?.data]);

    const stageNames = useMemo(() => stages.map((stage) => stage.nome), [stages]);

    const stagesVisiveis = useMemo(() => {
        const possuiDesconhecidos = rawData.some(
            (cliente: any) => cliente.status && !stageNames.includes(cliente.status),
        );

        if (!possuiDesconhecidos) return stages;
        return [...stages, { id: "outros", nome: "Outros", cor: "#94a3b8" }];
    }, [rawData, stageNames, stages]);

    const responsaveisDisponiveis = useMemo(() => {
        const valores = new Set<string>();
        rawData.forEach((cliente: any) => {
            if (cliente.responsavel) {
                valores.add(cliente.responsavel);
            }
        });
        return Array.from(valores).sort((a, b) => a.localeCompare(b));
    }, [rawData]);

    const getClienteTemperature = (cliente: any) => {
        return resolveLeadTemperature(cliente);
    };

    const clientesFiltrados = useMemo(() => {
        const texto = normalizeText(searchText);

        return rawData.filter((cliente: any) => {
            if (responsavelFiltro && cliente.responsavel !== responsavelFiltro) {
                return false;
            }

            if (temperaturaFiltro !== "todas") {
                const temperatura = getClienteTemperature(cliente);
                if (temperatura !== temperaturaFiltro) {
                    return false;
                }
            }

            if (!texto) {
                return true;
            }

            return (
                normalizeText(cliente.nome).includes(texto) ||
                normalizeText(cliente.telefone).includes(texto) ||
                normalizeText(cliente.status).includes(texto)
            );
        });
    }, [
        rawData,
        responsavelFiltro,
        searchText,
        temperaturaFiltro,
        temperatureRevision,
    ]);

    const kpis = useMemo(() => {
        const totalLeads = clientesFiltrados.length;
        const totalValor = clientesFiltrados.reduce((acc: number, curr: any) => {
            return acc + Number(curr.conta_energia_media || 0);
        }, 0);
        const fechados = clientesFiltrados.filter((cliente: any) =>
            normalizeText(cliente.status).includes("fechado"),
        ).length;
        const taxaConversao = totalLeads > 0 ? ((fechados / totalLeads) * 100).toFixed(1) : "0";

        return { totalLeads, totalValor, taxaConversao };
    }, [clientesFiltrados]);

    const handleDragStart = (event: React.DragEvent<HTMLDivElement>, id: string) => {
        setDraggedItemId(id);
        setIsDragging(true);
        setActiveDropColumn(null);
        event.dataTransfer.effectAllowed = "move";
        event.currentTarget.style.opacity = "0.5";
        event.currentTarget.style.cursor = "grabbing";
    };

    const handleDragEnd = (event: React.DragEvent<HTMLDivElement>) => {
        event.currentTarget.style.opacity = "1";
        event.currentTarget.style.cursor = "grab";
        setDraggedItemId(null);
        setIsDragging(false);
        setActiveDropColumn(null);
    };

    const handleDragOver = (event: React.DragEvent<HTMLDivElement>, status: string) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (activeDropColumn !== status) {
            setActiveDropColumn(status);
        }
    };

    const handleDrop = async (
        event: React.DragEvent<HTMLDivElement>,
        novoStatus: string,
    ) => {
        event.preventDefault();
        setActiveDropColumn(null);
        setIsDragging(false);

        if (!draggedItemId) return;

        const leadArrastado = rawData.find((item: any) => item.id.toString() === draggedItemId);

        if (!leadArrastado) {
            message.warning("Lead nao encontrado.");
            return;
        }

        if (leadArrastado?.status === novoStatus) return;

        try {
            await updateLead({
                resource: "clientes",
                id: draggedItemId,
                values: { status: novoStatus },
                successNotification: () => ({
                    message: `Movido para ${novoStatus}`,
                    description: "Status atualizado com sucesso.",
                    type: "success",
                }),
                errorNotification: () => ({
                    message: "Nao foi possivel atualizar o status",
                    description: "Tente novamente.",
                    type: "error",
                }),
            });

            const { error: historyError } = await supabaseClient
                .from("cliente_status_history")
                .insert({
                    cliente_id: leadArrastado.id,
                    de_status: leadArrastado.status,
                    para_status: novoStatus,
                    movido_em: new Date().toISOString(),
                    movido_por: user?.name || user?.email || null,
                });

            if (historyError && !isSupabaseMissingRelation(historyError)) {
                message.warning(
                    "Status atualizado, mas nao foi possivel registrar no historico.",
                );
            }
        } catch {
            // Error notification is handled by refine.
        }
    };

    if (isLoading) {
        return (
            <div style={{ display: "flex", justifyContent: "center", paddingTop: 50 }}>
                <Spin size="large" tip="Carregando CRM..." />
            </div>
        );
    }

    const KommoHeader = () => (
        <div
            style={{
                backgroundColor: "#fff",
                borderBottom: "1px solid #e0e0e0",
                paddingBottom: "10px",
            }}
        >
            <div
                style={{
                    padding: "10px 20px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    minHeight: "60px",
                    gap: 10,
                    flexWrap: "wrap",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
                    <Title
                        level={4}
                        style={{ margin: 0, color: "#153046", letterSpacing: "-0.5px" }}
                    >
                        LTD
                    </Title>
                    <div
                        style={{
                            display: "flex",
                            gap: "5px",
                            borderLeft: "1px solid #eee",
                            paddingLeft: "15px",
                        }}
                    >
                        <Tooltip title="Kanban">
                            <Button
                                type="text"
                                icon={<AppstoreOutlined />}
                                style={{
                                    color: viewType === "kanban" ? "#3182ce" : "#a0aec0",
                                    background:
                                        viewType === "kanban" ? "#ebf8ff" : "transparent",
                                }}
                                onClick={() => setViewType("kanban")}
                            />
                        </Tooltip>
                        <Tooltip title="Lista">
                            <Button
                                type="text"
                                icon={<BarsOutlined />}
                                style={{
                                    color: viewType === "list" ? "#3182ce" : "#a0aec0",
                                    background: viewType === "list" ? "#ebf8ff" : "transparent",
                                }}
                                onClick={() => setViewType("list")}
                            />
                        </Tooltip>
                    </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Input
                        placeholder="Busca e filtro"
                        prefix={<SearchOutlined style={{ color: "#a0aec0" }} />}
                        value={searchText}
                        onChange={(event) => setSearchText(event.target.value)}
                        style={{
                            width: "230px",
                            backgroundColor: "#f0f2f5",
                            border: "none",
                            borderRadius: "6px",
                            height: "34px",
                            fontSize: "13px",
                        }}
                    />
                    <Select
                        placeholder="Responsavel"
                        allowClear
                        value={responsavelFiltro}
                        onChange={(value) => setResponsavelFiltro(value)}
                        options={responsaveisDisponiveis.map((responsavel) => ({
                            value: responsavel,
                            label: responsavel,
                        }))}
                        style={{ width: "180px" }}
                        disabled={responsaveisDisponiveis.length === 0}
                    />
                    <Select
                        value={temperaturaFiltro}
                        onChange={(value) => setTemperaturaFiltro(value)}
                        style={{ width: "170px" }}
                        options={[
                            { value: "todas", label: "Temperatura: Todas" },
                            ...LEAD_TEMPERATURE_OPTIONS.map((option) => ({
                                value: option.value,
                                label: `Temperatura: ${option.label}`,
                            })),
                            ...LEAD_AUTOMATIC_TEMPERATURE_OPTIONS.map((option) => ({
                                value: option.value,
                                label: `Temperatura: ${option.label}`,
                            })),
                        ]}
                    />
                </div>

                <CreateButton
                    type="primary"
                    icon={<PlusOutlined />}
                    style={{
                        backgroundColor: "#4c8bf5",
                        fontWeight: 600,
                        borderRadius: "8px",
                        fontSize: "12px",
                        textTransform: "uppercase",
                    }}
                >
                    Novo Lead
                </CreateButton>
            </div>

            <div style={{ padding: "0 20px", marginTop: "5px" }}>
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                        gap: 12,
                    }}
                >
                    <StatCard
                        title="Previsao de Receita"
                        value={kpis.totalValor}
                        prefix={<DollarCircleOutlined style={{ color: "#4c8bf5" }} />}
                        accentColor="#4c8bf5"
                    />
                    <StatCard
                        title="Conversao"
                        value={kpis.taxaConversao}
                        suffix="%"
                        prefix={<CheckCircleOutlined style={{ color: "#38a169" }} />}
                        accentColor="#38a169"
                        valueStyle={{ color: "#38a169" }}
                    />
                    <StatCard
                        title="Leads Ativos"
                        value={kpis.totalLeads}
                        prefix={<ArrowUpOutlined style={{ color: "#ed8936" }} />}
                        accentColor="#ed8936"
                    />
                </div>
            </div>
        </div>
    );

    const KanbanView = () => {
        if (clientesFiltrados.length === 0) {
            return (
                <div style={{ padding: 20 }}>
                    <EmptyState
                        title="Nenhum lead para os filtros aplicados"
                        description="Ajuste busca, responsavel ou temperatura."
                    />
                </div>
            );
        }

        return (
            <div
                style={{
                    display: "flex",
                    overflowX: "auto",
                    height: "calc(100vh - 210px)",
                    backgroundColor: "#fff",
                    padding: "20px",
                    gap: "10px",
                }}
            >
                {stagesVisiveis.map((estagio) => {
                    const clientesDaColuna = clientesFiltrados.filter((cliente: any) =>
                        estagio.nome === "Outros"
                            ? cliente.status && !stageNames.includes(cliente.status)
                            : cliente.status === estagio.nome,
                    );
                    const totalColuna = clientesDaColuna.reduce((acc: number, curr: any) => {
                        return acc + Number(curr.conta_energia_media || 0);
                    }, 0);

                    const isDroppable = estagio.nome !== "Outros";
                    const isDropActive = isDroppable && isDragging && activeDropColumn === estagio.nome;
                    const accentColor = estagio.cor || getStatusAccent(estagio.nome);

                    return (
                        <div
                            key={estagio.nome}
                            onDragOver={isDroppable ? (event) => handleDragOver(event, estagio.nome) : undefined}
                            onDrop={isDroppable ? (event) => handleDrop(event, estagio.nome) : undefined}
                            style={{
                                minWidth: "300px",
                                maxWidth: "300px",
                                display: "flex",
                                flexDirection: "column",
                                borderRight: "1px solid #f0f0f0",
                                padding: "0 10px",
                                transition: "background 0.2s",
                                backgroundColor: isDropActive ? "#f0f7ff" : "transparent",
                                boxShadow: isDropActive ? "inset 0 0 0 1px #91caff" : "none",
                                borderRadius: "6px",
                            }}
                        >
                            <div style={{ paddingBottom: "15px", paddingTop: "5px", textAlign: "center" }}>
                                <Text
                                    strong
                                    style={{
                                        textTransform: "uppercase",
                                        fontSize: "11px",
                                        color: "#6e7c87",
                                        display: "block",
                                        marginBottom: "4px",
                                    }}
                                >
                                    {estagio.nome}
                                </Text>
                                <Text style={{ fontSize: "10px", color: "#98a2b3" }}>
                                    {clientesDaColuna.length} leads
                                </Text>
                                <Text style={{ fontSize: "10px", color: "#667085" }}>
                                    {formatCurrencyBRL(totalColuna, "R$ 0,00")}
                                </Text>
                                <div
                                    style={{
                                        height: "3px",
                                        width: "100%",
                                        backgroundColor: accentColor,
                                        marginTop: "6px",
                                        borderRadius: "2px",
                                    }}
                                />
                            </div>

                            <div style={{ flex: 1, overflowY: "auto", minHeight: "200px" }}>
                                {clientesDaColuna.length === 0 ? (
                                    <div
                                        style={{
                                            border: "1px dashed #e2e8f0",
                                            borderRadius: "6px",
                                            padding: "12px",
                                            textAlign: "center",
                                            color: "#98a2b3",
                                            fontSize: "12px",
                                            marginTop: "6px",
                                        }}
                                    >
                                        {isDropActive ? "Solte aqui" : "Sem leads"}
                                    </div>
                                ) : (
                                    clientesDaColuna.map((cliente: any) => (
                                        <div
                                            key={cliente.id}
                                            draggable
                                            onDragStart={(event) =>
                                                handleDragStart(event, cliente.id.toString())
                                            }
                                            onDragEnd={handleDragEnd}
                                            style={{ cursor: "grab" }}
                                        >
                                            <Card
                                                size="small"
                                                interactive
                                                style={{
                                                    marginBottom: "10px",
                                                    borderLeft: `3px solid ${accentColor}`,
                                                    cursor: "grab",
                                                    userSelect: "none",
                                                }}
                                                bodyStyle={{ padding: "10px" }}
                                                actions={[
                                                    <EditButton
                                                        key={`edit-${cliente.id}`}
                                                        hideText
                                                        size="small"
                                                        recordItemId={cliente.id}
                                                    />,
                                                    <ShowButton
                                                        key={`show-${cliente.id}`}
                                                        hideText
                                                        size="small"
                                                        recordItemId={cliente.id}
                                                    />,
                                                ]}
                                            >
                                                <div style={{ marginBottom: "6px" }}>
                                                    <Text
                                                        strong
                                                        style={{ color: "#192a3e", fontSize: "13px" }}
                                                    >
                                                        {cliente.nome}
                                                    </Text>
                                                </div>
                                                <div style={{ marginBottom: "6px" }}>
                                                    <TemperatureBadge
                                                        value={getClienteTemperature(cliente)}
                                                    />
                                                </div>
                                                <div
                                                    style={{
                                                        display: "flex",
                                                        flexDirection: "column",
                                                        gap: "2px",
                                                    }}
                                                >
                                                    {cliente.conta_energia_media > 0 && (
                                                        <Text style={{ fontSize: "12px", color: "#555" }}>
                                                            {formatCurrencyBRL(
                                                                cliente.conta_energia_media,
                                                                "R$ 0,00",
                                                            )}
                                                        </Text>
                                                    )}
                                                    {cliente.responsavel && (
                                                        <Text style={{ fontSize: "10px", color: "#667085" }}>
                                                            Resp: {cliente.responsavel}
                                                        </Text>
                                                    )}
                                                    <Text style={{ fontSize: "10px", color: "#a0aec0" }}>
                                                        {formatDateBR(cliente.created_at, "-")}
                                                    </Text>
                                                </div>
                                            </Card>
                                        </div>
                                    ))
                                )}
                                <div style={{ height: "50px" }} />
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    const ListView = () => (
        <div style={{ padding: "20px", backgroundColor: "#fff", height: "calc(100vh - 210px)" }}>
            <Table
                dataSource={clientesFiltrados}
                rowKey="id"
                size="middle"
                pagination={{ pageSize: 12, position: ["bottomCenter"] }}
                columns={[
                    {
                        title: "Nome do Lead",
                        dataIndex: "nome",
                        render: (text) => <b style={{ color: "#153046" }}>{text}</b>,
                    },
                    {
                        title: "Status",
                        dataIndex: "status",
                        render: (status) => (
                            <Badge tone={getStatusTone(status)}>{status || "Sem status"}</Badge>
                        ),
                    },
                    {
                        title: "Temperatura",
                        key: "temperature",
                        render: (_, record: any) => (
                            <TemperatureBadge value={getClienteTemperature(record)} />
                        ),
                    },
                    {
                        title: "Responsavel",
                        dataIndex: "responsavel",
                        render: (value) => value || "-",
                    },
                    {
                        title: "Valor",
                        dataIndex: "conta_energia_media",
                        render: (value) => formatCurrencyBRL(value, "R$ 0,00"),
                    },
                    { title: "Telefone", dataIndex: "telefone" },
                    {
                        title: "",
                        render: (_, record: any) => (
                            <Space>
                                <EditButton hideText size="small" recordItemId={record.id} />
                            </Space>
                        ),
                    },
                ]}
            />
        </div>
    );

    return (
        <div
            style={{
                height: "100vh",
                display: "flex",
                flexDirection: "column",
                backgroundColor: "#fff",
            }}
        >
            <KommoHeader />
            <div style={{ flex: 1, backgroundColor: "#fff" }}>
                {viewType === "kanban" ? <KanbanView /> : <ListView />}
            </div>
        </div>
    );
};
