import React, { useEffect, useMemo, useRef, useState } from "react";
import { useList, useUpdate } from "@refinedev/core";
import { CreateButton, EditButton } from "@refinedev/antd";
import { Drawer, Input, Modal, Select, Space, Spin, Table, Tooltip, Typography, message } from "antd";
import {
    AppstoreOutlined,
    ArrowUpOutlined,
    BarsOutlined,
    CheckCircleOutlined,
    DeleteOutlined,
    DollarCircleOutlined,
    EyeOutlined,
    PlusOutlined,
    SearchOutlined,
    SettingOutlined,
} from "@ant-design/icons";
import {
    Badge,
    Button,
    Card,
    EmptyState,
    StatCard,
    TemperatureBadge,
} from "../../components/ui";
import { TaskFormModal, type TaskContextData } from "../../components/modal/agenda";
import { matchesLeadOwner, useCrmAccess } from "../../hooks/useCrmAccess";
import { formatCurrencyBRL, formatDateBR, normalizeText } from "../../lib/formatters";
import { isSupabaseMissingRelation } from "../../lib/supabaseErrors";
import { addLeadActivity } from "../../lib/leadTimeline";
import {
    type LeadTemperatureTag,
    LEAD_AUTOMATIC_TEMPERATURE_OPTIONS,
    LEAD_TEMPERATURE_OPTIONS,
    resolveLeadTemperature,
} from "../../lib/leadTemperature";
import { isLeadRecentlyCreated } from "../../lib/leadVisibility";
import { LeadDetails } from "./lead-details";
import { supabaseClient } from "../../utility";

const { Text, Title } = Typography;

type Stage = {
    id?: string | number;
    nome: string;
    cor?: string;
    ordem?: number;
    persisted?: boolean;
};

const DEFAULT_STAGES: Stage[] = [
    { id: "novo", nome: "Novo Lead", cor: "#5d9cec", ordem: 1 },
    { id: "negociacao", nome: "Em Negociação", cor: "#3182ce", ordem: 2 },
    { id: "visita", nome: "Visita Agendada", cor: "#ed8936", ordem: 3 },
    { id: "fechado", nome: "Fechado", cor: "#82cf6e", ordem: 4 },
    { id: "perdido", nome: "Perdido", cor: "#f56565", ordem: 5 },
];

const DEFAULT_STAGE_BLUEPRINT: Stage[] = [
    { id: "novo", nome: "Novo Lead", cor: "#5d9cec", ordem: 1 },
    { id: "visita", nome: "Visita Agendada", cor: "#ed8936", ordem: 2 },
    { id: "negociacao", nome: "Em Negociacao", cor: "#3182ce", ordem: 3 },
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

export const ClienteList = () => {
    const {
        canViewAllLeads,
        isLoadingAccess,
        ownerCandidatesNormalized,
        ownerDisplayName,
    } = useCrmAccess();
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
    const [isLeadDrawerOpen, setIsLeadDrawerOpen] = useState(false);
    const [selectedLeadId, setSelectedLeadId] = useState<string | number | null>(null);
    const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
    const [taskContextData, setTaskContextData] = useState<TaskContextData | null>(null);
    const [isStageManagerOpen, setIsStageManagerOpen] = useState(false);
    const [newStageName, setNewStageName] = useState("");
    const [newStageColor, setNewStageColor] = useState("#5d9cec");
    const [isCreatingStage, setIsCreatingStage] = useState(false);
    const [stagePendingDelete, setStagePendingDelete] = useState<Stage | null>(null);
    const [deleteDestinationStage, setDeleteDestinationStage] = useState<string | undefined>(
        undefined,
    );
    const [isDeletingStage, setIsDeletingStage] = useState(false);
    const [isBoardPanning, setIsBoardPanning] = useState(false);
    const boardRef = useRef<HTMLDivElement | null>(null);
    const boardPanStartRef = useRef<{
        x: number;
        y: number;
        scrollLeft: number;
        scrollTop: number;
    } | null>(null);

    const { query: clientesQuery } = useList({
        resource: "clientes",
        pagination: { mode: "off" },
        liveMode: "auto",
    });

    const { query: stagesQuery } = useList({
        resource: "pipeline_stages",
        pagination: { mode: "off" },
        sorters: [{ field: "ordem", order: "asc" }],
    });

    const { mutateAsync: updateLead } = useUpdate();
    const isLoading = clientesQuery?.isLoading || isLoadingAccess;
    const rawData = clientesQuery?.data?.data || [];

    const persistedStagesRaw = useMemo(() => {
        return ((stagesQuery?.data?.data as any[]) || []).filter((stage) => stage !== null);
    }, [stagesQuery?.data?.data]);

    const visibleData = useMemo(() => {
        if (canViewAllLeads) {
            return rawData;
        }

        return rawData.filter((cliente: any) => {
            if (matchesLeadOwner(cliente.responsavel, ownerCandidatesNormalized)) {
                return true;
            }

            // Evita "salvou e sumiu" para quem acabou de cadastrar um lead.
            return isLeadRecentlyCreated(cliente.id);
        });
    }, [canViewAllLeads, ownerCandidatesNormalized, rawData]);

    const selectedLead = useMemo<Record<string, any> | null>(() => {
        if (selectedLeadId === null || selectedLeadId === undefined) {
            return null;
        }

        const lead =
            rawData.find((cliente: any) => String(cliente.id) === String(selectedLeadId)) || null;

        if (!lead || lead.id === null || lead.id === undefined) {
            return null;
        }

        return lead as Record<string, any>;
    }, [rawData, selectedLeadId]);

    useEffect(() => {
        const handleFocus = () => setTemperatureRevision((prev) => prev + 1);
        window.addEventListener("focus", handleFocus);
        return () => window.removeEventListener("focus", handleFocus);
    }, []);

    const refetchClientes = clientesQuery?.refetch;

    useEffect(() => {
        const channel = supabaseClient
            .channel("crm-leads-realtime-notifications")
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: "clientes" },
                (payload) => {
                    const leadName = (payload.new as Record<string, unknown>)?.nome;
                    message.info(
                        `Novo lead recebido: ${typeof leadName === "string" ? leadName : "Sem nome"}`,
                    );
                    refetchClientes?.();
                },
            )
            .subscribe();

        return () => {
            supabaseClient.removeChannel(channel);
        };
    }, [refetchClientes]);

    const stages = useMemo(() => {
        const normalized = persistedStagesRaw
            .map((stage) => ({
                id: stage.id,
                nome: stage.nome ?? stage.name ?? "",
                cor: stage.cor ?? stage.color,
                ordem: stage.ordem ?? stage.order ?? stage.sort_order,
                persisted: stage.id !== undefined && stage.id !== null,
            }))
            .filter((stage) => stage.nome)
            .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
        if (normalized.length > 0) {
            return normalized;
        }
        return DEFAULT_STAGE_BLUEPRINT.map((stage) => ({ ...stage, persisted: false }));
    }, [persistedStagesRaw]);

    const stageNames = useMemo(() => stages.map((stage) => stage.nome), [stages]);
    const manageableStages = useMemo(
        () => stages.filter((stage) => stage.nome !== "Outros"),
        [stages],
    );
    const canDeleteAnyStage = manageableStages.length > 1;

    const stagesVisiveis = useMemo(() => {
        const possuiDesconhecidos = visibleData.some(
            (cliente: any) => cliente.status && !stageNames.includes(cliente.status),
        );

        if (!possuiDesconhecidos) return stages;
        return [...stages, { id: "outros", nome: "Outros", cor: "#94a3b8" }];
    }, [stageNames, stages, visibleData]);

    const leadCountByStatus = useMemo(() => {
        return rawData.reduce<Record<string, number>>((acc, cliente: any) => {
            if (!cliente?.status) {
                return acc;
            }
            acc[cliente.status] = (acc[cliente.status] || 0) + 1;
            return acc;
        }, {});
    }, [rawData]);

    const leadsInPendingDeleteStage = useMemo(() => {
        if (!stagePendingDelete) {
            return 0;
        }
        return leadCountByStatus[stagePendingDelete.nome] || 0;
    }, [leadCountByStatus, stagePendingDelete]);

    const deleteStageDestinationOptions = useMemo(() => {
        if (!stagePendingDelete) {
            return [];
        }
        return manageableStages
            .filter((stage) => stage.nome !== stagePendingDelete.nome)
            .map((stage) => ({
                value: stage.nome,
                label: stage.nome,
            }));
    }, [manageableStages, stagePendingDelete]);

    const responsaveisDisponiveis = useMemo(() => {
        const valores = new Set<string>();
        visibleData.forEach((cliente: any) => {
            if (cliente.responsavel) {
                valores.add(cliente.responsavel);
            }
        });
        return Array.from(valores).sort((a, b) => a.localeCompare(b));
    }, [visibleData]);

    const getClienteTemperature = (cliente: any) => {
        return resolveLeadTemperature(cliente);
    };

    const persistDefaultStagesIfNeeded = async () => {
        const refreshed = await stagesQuery?.refetch?.();
        const existingRows = ((refreshed?.data?.data as any[]) || persistedStagesRaw).filter(
            (stage: any) => stage !== null && stage !== undefined,
        );
        if (existingRows.length > 0) {
            return true;
        }

        const payload = DEFAULT_STAGE_BLUEPRINT.map((stage, index) => ({
            nome: stage.nome,
            cor: stage.cor || getStatusAccent(stage.nome),
            ordem: index + 1,
        }));

        const { error } = await supabaseClient.from("pipeline_stages").insert(payload);

        if (error) {
            message.error("Nao foi possivel preparar as colunas do funil.");
            return false;
        }

        await stagesQuery?.refetch?.();
        return true;
    };

    const openStageManager = async () => {
        const ready = await persistDefaultStagesIfNeeded();
        if (!ready) {
            return;
        }
        setIsStageManagerOpen(true);
    };

    const handleCreateStage = async () => {
        const nome = newStageName.trim();
        if (!nome) {
            message.warning("Informe o nome da coluna.");
            return;
        }

        const duplicated = manageableStages.some(
            (stage) => normalizeText(stage.nome) === normalizeText(nome),
        );
        if (duplicated) {
            message.warning("Ja existe uma coluna com esse nome.");
            return;
        }

        setIsCreatingStage(true);
        try {
            const ready = await persistDefaultStagesIfNeeded();
            if (!ready) {
                return;
            }

            const maxOrder = manageableStages.reduce((acc, stage) => {
                return Math.max(acc, Number(stage.ordem || 0));
            }, 0);

            const { error } = await supabaseClient.from("pipeline_stages").insert({
                nome,
                cor: newStageColor,
                ordem: maxOrder + 1,
            });

            if (error) {
                throw error;
            }

            message.success(`Coluna "${nome}" criada com sucesso.`);
            setNewStageName("");
            setNewStageColor("#5d9cec");
            await stagesQuery?.refetch?.();
        } catch {
            message.error("Nao foi possivel criar a coluna.");
        } finally {
            setIsCreatingStage(false);
        }
    };

    const requestDeleteStage = (stage: Stage) => {
        if (!canDeleteAnyStage) {
            message.warning("Mantenha ao menos uma coluna no funil.");
            return;
        }

        setStagePendingDelete(stage);
        const defaultDestination = manageableStages.find(
            (item) => item.nome !== stage.nome,
        )?.nome;
        setDeleteDestinationStage(defaultDestination);
    };

    const cancelDeleteStage = () => {
        setStagePendingDelete(null);
        setDeleteDestinationStage(undefined);
    };

    const confirmDeleteStage = async () => {
        if (!stagePendingDelete) {
            return;
        }

        if (
            leadsInPendingDeleteStage > 0 &&
            (!deleteDestinationStage || deleteDestinationStage === stagePendingDelete.nome)
        ) {
            message.warning("Selecione uma coluna destino para mover os leads.");
            return;
        }

        if (stagePendingDelete.id === undefined || stagePendingDelete.id === null) {
            message.error("Nao foi possivel identificar a coluna para exclusao.");
            return;
        }

        setIsDeletingStage(true);
        try {
            if (leadsInPendingDeleteStage > 0 && deleteDestinationStage) {
                const { error: moveError } = await supabaseClient
                    .from("clientes")
                    .update({ status: deleteDestinationStage })
                    .eq("status", stagePendingDelete.nome);

                if (moveError) {
                    throw moveError;
                }
            }

            const { error: deleteError } = await supabaseClient
                .from("pipeline_stages")
                .delete()
                .eq("id", stagePendingDelete.id);

            if (deleteError) {
                throw deleteError;
            }

            message.success(`Coluna "${stagePendingDelete.nome}" excluida.`);
            cancelDeleteStage();
            await stagesQuery?.refetch?.();
            await clientesQuery?.refetch?.();
        } catch {
            message.error("Nao foi possivel excluir a coluna.");
        } finally {
            setIsDeletingStage(false);
        }
    };

    const clientesFiltrados = useMemo(() => {
        const texto = normalizeText(searchText);

        return visibleData.filter((cliente: any) => {
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
        visibleData,
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
        setIsBoardPanning(false);
        boardPanStartRef.current = null;
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

    const shouldIgnoreBoardPan = (target: EventTarget | null) => {
        if (!(target instanceof HTMLElement)) {
            return false;
        }
        return Boolean(target.closest("[data-pan-ignore='true']"));
    };

    const handleBoardMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
        if (event.button !== 0 || isDragging || shouldIgnoreBoardPan(event.target)) {
            return;
        }

        const board = boardRef.current;
        if (!board) {
            return;
        }

        boardPanStartRef.current = {
            x: event.clientX,
            y: event.clientY,
            scrollLeft: board.scrollLeft,
            scrollTop: board.scrollTop,
        };
        setIsBoardPanning(true);
    };

    const handleBoardMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
        if (!isBoardPanning || !boardPanStartRef.current) {
            return;
        }

        const board = boardRef.current;
        if (!board) {
            return;
        }

        const deltaX = event.clientX - boardPanStartRef.current.x;
        const deltaY = event.clientY - boardPanStartRef.current.y;
        board.scrollLeft = boardPanStartRef.current.scrollLeft - deltaX;
        board.scrollTop = boardPanStartRef.current.scrollTop - deltaY;
        event.preventDefault();
    };

    const stopBoardPan = () => {
        if (!isBoardPanning) {
            return;
        }
        boardPanStartRef.current = null;
        setIsBoardPanning(false);
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

        const leadArrastado = visibleData.find((item: any) => item.id.toString() === draggedItemId);

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
                    movido_por: ownerDisplayName || null,
                });

            if (historyError && !isSupabaseMissingRelation(historyError)) {
                message.warning(
                    "Status atualizado, mas nao foi possivel registrar no historico.",
                );
            }

            if (leadArrastado.id !== undefined && leadArrastado.id !== null) {
                await addLeadActivity({
                    leadId: String(leadArrastado.id),
                    activityType: "status",
                    title: "Mudanca de status",
                    description: `${leadArrastado.status || "-"} -> ${novoStatus}`,
                    fromStatus: leadArrastado.status || undefined,
                    toStatus: novoStatus,
                    author: ownerDisplayName,
                });
            }
        } catch {
            // Error notification is handled by refine.
        }
    };

    const openLeadDrawer = (lead: any) => {
        setSelectedLeadId(lead.id);
        setIsLeadDrawerOpen(true);
    };

    const closeLeadDrawer = () => {
        setIsLeadDrawerOpen(false);
        setSelectedLeadId(null);
    };

    const openTaskModal = (contextData: TaskContextData) => {
        setTaskContextData(contextData);
        setIsTaskModalOpen(true);
    };

    const closeTaskModal = () => {
        setIsTaskModalOpen(false);
        setTaskContextData(null);
    };

    useEffect(() => {
        const handleMouseUp = () => {
            boardPanStartRef.current = null;
            setIsBoardPanning(false);
        };

        window.addEventListener("mouseup", handleMouseUp);
        return () => window.removeEventListener("mouseup", handleMouseUp);
    }, []);

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
                <Button icon={<SettingOutlined />} onClick={openStageManager}>
                    Colunas
                </Button>
            </div>

            {!canViewAllLeads ? (
                <div style={{ padding: "0 20px 8px 20px" }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                        Visao restrita: exibindo apenas leads vinculados a {ownerDisplayName}.
                    </Text>
                </div>
            ) : null}

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
                <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 10 }}>
                    Dica: clique e arraste no fundo do kanban para navegar como "maozinha".
                </Text>
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
                ref={boardRef}
                className="crm-kanban-scroll"
                onMouseDown={handleBoardMouseDown}
                onMouseMove={handleBoardMouseMove}
                onMouseUp={stopBoardPan}
                onMouseLeave={stopBoardPan}
                style={{
                    display: "flex",
                    overflow: "auto",
                    height: "calc(100vh - 210px)",
                    backgroundColor: "#fff",
                    padding: "20px",
                    gap: "10px",
                    cursor: isDragging ? "default" : isBoardPanning ? "grabbing" : "grab",
                    userSelect: isBoardPanning ? "none" : "auto",
                    scrollbarWidth: "none",
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
                                alignSelf: "flex-start",
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

                            <div style={{ minHeight: "200px" }}>
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
                                            data-pan-ignore="true"
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
                                                    <Button
                                                        key={`show-${cliente.id}`}
                                                        icon={<EyeOutlined />}
                                                        size="small"
                                                        onClick={() => openLeadDrawer(cliente)}
                                                    >
                                                        Ver
                                                    </Button>,
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
                                <div style={{ height: "24px" }} />
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
                                <Button
                                    size="small"
                                    icon={<EyeOutlined />}
                                    onClick={() => openLeadDrawer(record)}
                                >
                                    Ver
                                </Button>
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
                <style>{`
                    .crm-kanban-scroll::-webkit-scrollbar {
                        width: 0;
                        height: 0;
                        display: none;
                    }
                `}</style>
                {viewType === "kanban" ? <KanbanView /> : <ListView />}
            </div>

            <Modal
                title="Gerenciar colunas do funil"
                open={isStageManagerOpen}
                onCancel={() => setIsStageManagerOpen(false)}
                footer={null}
                width={680}
                destroyOnClose
            >
                <Text type="secondary">
                    Crie ou exclua colunas para adaptar o pipeline ao tipo de negocio.
                </Text>
                <div
                    style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "center",
                        marginTop: 16,
                        marginBottom: 18,
                        flexWrap: "wrap",
                    }}
                >
                    <Input
                        placeholder="Nome da nova coluna"
                        value={newStageName}
                        onChange={(event) => setNewStageName(event.target.value)}
                        onPressEnter={handleCreateStage}
                        style={{ flex: 1, minWidth: 240 }}
                    />
                    <input
                        type="color"
                        value={newStageColor}
                        onChange={(event) => setNewStageColor(event.target.value)}
                        aria-label="Cor da coluna"
                        style={{
                            width: 42,
                            height: 36,
                            border: "1px solid #d9d9d9",
                            borderRadius: 8,
                            backgroundColor: "#fff",
                            cursor: "pointer",
                        }}
                    />
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={handleCreateStage}
                        loading={isCreatingStage}
                    >
                        Adicionar
                    </Button>
                </div>
                <div style={{ maxHeight: 340, overflowY: "auto", paddingRight: 4 }}>
                    {manageableStages.map((stage) => (
                        <div
                            key={stage.id ?? stage.nome}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "10px 12px",
                                border: "1px solid #e5e7eb",
                                borderRadius: 10,
                                marginBottom: 8,
                                backgroundColor: "#fff",
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <span
                                    style={{
                                        width: 10,
                                        height: 10,
                                        borderRadius: "50%",
                                        backgroundColor: stage.cor || "#94a3b8",
                                    }}
                                />
                                <div>
                                    <Text strong>{stage.nome}</Text>
                                    <Text type="secondary" style={{ marginLeft: 8 }}>
                                        {leadCountByStatus[stage.nome] || 0} leads
                                    </Text>
                                </div>
                            </div>
                            <Button
                                type="text"
                                danger
                                icon={<DeleteOutlined />}
                                onClick={() => requestDeleteStage(stage)}
                                disabled={!canDeleteAnyStage || !stage.persisted}
                            >
                                Excluir
                            </Button>
                        </div>
                    ))}
                </div>
                {!canDeleteAnyStage ? (
                    <Text type="secondary">E necessario manter ao menos uma coluna no funil.</Text>
                ) : null}
            </Modal>

            <Modal
                title="Excluir coluna"
                open={Boolean(stagePendingDelete)}
                onCancel={cancelDeleteStage}
                onOk={confirmDeleteStage}
                okText="Excluir coluna"
                okButtonProps={{ danger: true, loading: isDeletingStage }}
                cancelButtonProps={{ disabled: isDeletingStage }}
                destroyOnClose
            >
                <Text>
                    Tem certeza que deseja excluir a coluna{" "}
                    <Text strong>{stagePendingDelete?.nome || "-"}</Text>?
                </Text>
                {leadsInPendingDeleteStage > 0 ? (
                    <div style={{ marginTop: 14 }}>
                        <Text type="warning" style={{ display: "block", marginBottom: 8 }}>
                            Essa coluna possui {leadsInPendingDeleteStage} leads. Selecione o destino
                            antes de excluir.
                        </Text>
                        <Select
                            value={deleteDestinationStage}
                            onChange={(value) => setDeleteDestinationStage(value)}
                            options={deleteStageDestinationOptions}
                            placeholder="Mover leads para"
                            style={{ width: "100%" }}
                        />
                    </div>
                ) : null}
            </Modal>

            <Drawer
                title={selectedLead?.nome ? `Lead: ${selectedLead.nome}` : "Detalhes do lead"}
                open={isLeadDrawerOpen}
                width={620}
                onClose={closeLeadDrawer}
                destroyOnClose
            >
                <LeadDetails
                    record={selectedLead}
                    currentUserLabel={ownerDisplayName}
                    onScheduleVisit={openTaskModal}
                />
            </Drawer>

            <TaskFormModal
                open={isTaskModalOpen}
                onClose={closeTaskModal}
                contextData={taskContextData}
            />
        </div>
    );
};
