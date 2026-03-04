import React, { useEffect, useMemo, useRef, useState } from "react";
import { useGo, useList, useUpdate, useCreate } from "@refinedev/core";
import { CreateButton } from "@refinedev/antd";
import { Drawer, Input, Modal, Select, Space, Spin, Table, Tooltip, Typography, message } from "antd";
import {
    AppstoreOutlined,
    ArrowUpOutlined,
    BarsOutlined,
    CheckCircleOutlined,
    DeleteOutlined,
    DollarCircleOutlined,
    EditOutlined,
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
import {
    getSupabaseErrorMessage,
    isSupabaseMissingRelation,
    isSupabasePolicyRecursion,
} from "../../lib/supabaseErrors";
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

const DRAG_ACTIVATION_DISTANCE = 5;
const DRAG_ACTIVATION_DELAY_MS = 250;

type LeadPointerSession = {
    leadId: string;
    startX: number;
    startY: number;
    draggableElement: HTMLDivElement;
    isInteractiveTarget: boolean;
    hasDragged: boolean;
    timerId: number | null;
};

export const ClienteList = () => {
    const go = useGo();
    const {
        canViewAllLeads,
        canDeleteRecords,
        isLoadingAccess,
        tenantId,
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
    const [deleteDestinationStage, setDeleteDestinationStage] = useState<string | undefined>(undefined);
    const [isDeletingStage, setIsDeletingStage] = useState(false);
    const [isBoardPanning, setIsBoardPanning] = useState(false);
    const boardRef = useRef<HTMLDivElement | null>(null);
    const boardPanStartRef = useRef<{
        x: number;
        y: number;
        scrollLeft: number;
        scrollTop: number;
    } | null>(null);
    const leadPointerSessionRef = useRef<LeadPointerSession | null>(null);

    const { mutateAsync: updateLead } = useUpdate();
    const { mutateAsync: createStage } = useCreate(); // <-- NOVO: Força o cache do Refine a atualizar

    const { query: clientesQuery } = useList({
        resource: "clientes",
        pagination: { mode: "off" },
        liveMode: "auto",
    });

    const { query: stagesQuery } = useList({
        resource: "pipeline_stages",
        pagination: { mode: "off" },
        sorters: [{ field: "ordem", order: "asc" }],
        liveMode: "auto", // <-- NOVO: Atualiza colunas em tempo real automaticamente
    });

    const isLoading = clientesQuery?.isLoading || isLoadingAccess;
    const rawData = clientesQuery?.data?.data || [];
    const clientesQueryError = (clientesQuery?.error || null) as any;
    const hasClientesPolicyRecursion = isSupabasePolicyRecursion(clientesQueryError);
    const clientesQueryErrorMessage = getSupabaseErrorMessage(clientesQueryError);

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

    const stageIdSet = useMemo(() => new Set(stages.map((stage) => String(stage.id ?? ""))), [stages]);
    const stageIdByName = useMemo(
        () =>
            new Map(stages.map((stage) => [normalizeText(stage.nome), String(stage.id ?? stage.nome)])),
        [stages],
    );
    const stageById = useMemo(
        () => new Map(stages.map((stage) => [String(stage.id ?? stage.nome), stage])),
        [stages],
    );

    const resolveLeadStageId = (cliente: any): string => {
        const rawStageId = cliente?.stage_id ?? cliente?.stageId;
        if (rawStageId !== undefined && rawStageId !== null && String(rawStageId).trim()) {
            return String(rawStageId);
        }

        const normalizedStatus = normalizeText(cliente?.status);
        if (!normalizedStatus) {
            return "";
        }

        return stageIdByName.get(normalizedStatus) || "";
    };

    const resolveLeadStageName = (cliente: any): string => {
        const stageId = resolveLeadStageId(cliente);
        if (stageId && stageById.has(stageId)) {
            return stageById.get(stageId)?.nome || cliente?.status || "Sem etapa";
        }

        if (typeof cliente?.status === "string" && cliente.status.trim()) {
            return cliente.status.trim();
        }

        return "Sem etapa";
    };

    const manageableStages = useMemo(
        () => stages.filter((stage) => stage.nome !== "Outros"),
        [stages],
    );
    const canDeleteAnyStage = manageableStages.length > 1;

    const stagesVisiveis = useMemo(() => {
        const possuiDesconhecidos = visibleData.some(
            (cliente: any) => {
                const stageId = resolveLeadStageId(cliente);
                return !stageId || !stageIdSet.has(stageId);
            },
        );

        if (!possuiDesconhecidos) return stages;
        return [...stages, { id: "outros", nome: "Outros", cor: "#94a3b8" }];
    }, [resolveLeadStageId, stageIdSet, stages, visibleData]);

    const leadCountByStageId = useMemo(() => {
        return rawData.reduce<Record<string, number>>((acc, cliente: any) => {
            const stageId = resolveLeadStageId(cliente);
            if (!stageId) {
                return acc;
            }
            acc[stageId] = (acc[stageId] || 0) + 1;
            return acc;
        }, {});
    }, [rawData, resolveLeadStageId]);

    const leadsInPendingDeleteStage = useMemo(() => {
        if (!stagePendingDelete) {
            return 0;
        }
        return leadCountByStageId[String(stagePendingDelete.id ?? "")] || 0;
    }, [leadCountByStageId, stagePendingDelete]);

    const deleteStageDestinationOptions = useMemo(() => {
        if (!stagePendingDelete) {
            return [];
        }
        return manageableStages
            .filter((stage) => stage.nome !== stagePendingDelete.nome)
            .map((stage) => ({
                value: String(stage.id ?? stage.nome),
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
            tenant_id: tenantId || undefined,
            nome: stage.nome,
            cor: stage.cor || getStatusAccent(stage.nome),
            ordem: index + 1,
        }));

        const { error } = await supabaseClient.from("pipeline_stages").insert(payload);

        if (error) {
            message.error("Não foi possível preparar as colunas do funil.");
            return false;
        }

        await stagesQuery?.refetch?.();
        return true;
    };

    const openStageManager = async () => {
        if (!canDeleteRecords) {
            message.warning("Somente admin pode gerenciar colunas.");
            return;
        }
        const ready = await persistDefaultStagesIfNeeded();
        if (!ready) {
            return;
        }
        setIsStageManagerOpen(true);
    };

   const handleCreateStage = async () => {
        if (!canDeleteRecords) {
            message.warning("Somente admin pode criar colunas.");
            return;
        }

        const nome = newStageName.trim();
        if (!nome) {
            message.warning("Informe o nome da coluna.");
            return;
        }

        const duplicated = manageableStages.some(
            (stage) => normalizeText(stage.nome) === normalizeText(nome),
        );
        if (duplicated) {
            message.warning("Já existe uma coluna com esse nome.");
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

            // <-- NOVO: Usamos o mutateAsync do Refine para criar e atualizar a tela NA HORA
            await createStage({
                resource: "pipeline_stages",
                values: {
                    tenant_id: tenantId || undefined,
                    nome: nome,
                    title: nome, // <--- OLHA O AJUSTE AQUI SALVANDO O DIA!
                    cor: newStageColor,
                    ordem: maxOrder + 1,
                },
                successNotification: false,
            });

            message.success(`Coluna "${nome}" criada com sucesso.`);
            setNewStageName("");
            setNewStageColor("#5d9cec");
            
            await stagesQuery?.refetch?.();
            
            // Joga o scroll para a direita após um pequeno tempo
            setTimeout(() => {
                if (boardRef.current) {
                    boardRef.current.scrollTo({ left: boardRef.current.scrollWidth + 1500, behavior: 'smooth' });
                }
            }, 600);

        } catch (error: any) {
            message.error("Erro: " + (error?.message || "Não foi possível criar a coluna."));
        } finally {
            setIsCreatingStage(false);
        }
    };

    const requestDeleteStage = (stage: Stage) => {
        if (!canDeleteRecords) {
            message.warning("Somente admin pode excluir colunas.");
            return;
        }

        if (!canDeleteAnyStage) {
            message.warning("Mantenha ao menos uma coluna no funil.");
            return;
        }

        setStagePendingDelete(stage);
        const defaultDestinationRaw = manageableStages.find(
            (item) => item.nome !== stage.nome,
        )?.id;
        const defaultDestination =
            defaultDestinationRaw === undefined || defaultDestinationRaw === null
                ? undefined
                : String(defaultDestinationRaw);
        setDeleteDestinationStage(defaultDestination);
    };

    const cancelDeleteStage = () => {
        setStagePendingDelete(null);
        setDeleteDestinationStage(undefined);
    };

    const confirmDeleteStage = async () => {
        if (!canDeleteRecords) {
            message.warning("Somente admin pode excluir colunas.");
            return;
        }

        if (!stagePendingDelete) {
            return;
        }

        if (
            leadsInPendingDeleteStage > 0 &&
            (!deleteDestinationStage ||
                deleteDestinationStage === String(stagePendingDelete.id ?? ""))
        ) {
            message.warning("Selecione uma coluna destino para mover os leads.");
            return;
        }

        if (stagePendingDelete.id === undefined || stagePendingDelete.id === null) {
            message.error("Não foi possível identificar a coluna para exclusão.");
            return;
        }

        setIsDeletingStage(true);
        try {
            if (leadsInPendingDeleteStage > 0 && deleteDestinationStage) {
                const destinationStage = stageById.get(deleteDestinationStage);
                const { error: moveError } = await supabaseClient
                    .from("clientes")
                    .update({
                        tenant_id: tenantId || undefined,
                        stage_id: deleteDestinationStage,
                        status: destinationStage?.nome || undefined,
                    })
                    .eq("stage_id", String(stagePendingDelete.id));

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

            message.success(`Coluna "${stagePendingDelete.nome}" excluída.`);
            cancelDeleteStage();
            await stagesQuery?.refetch?.();
            await clientesQuery?.refetch?.();
        } catch {
            message.error("Não foi possível excluir a coluna.");
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
                normalizeText(resolveLeadStageName(cliente)).includes(texto)
            );
        });
    }, [
        visibleData,
        responsavelFiltro,
        searchText,
        temperaturaFiltro,
        temperatureRevision,
        resolveLeadStageName,
    ]);

    const kpis = useMemo(() => {
        const totalLeads = clientesFiltrados.length;
        const totalValor = clientesFiltrados.reduce((acc: number, curr: any) => {
            return acc + Number(curr.conta_energia_media || 0);
        }, 0);
        const fechados = clientesFiltrados.filter((cliente: any) =>
            normalizeText(resolveLeadStageName(cliente)).includes("fechado"),
        ).length;
        const taxaConversao = totalLeads > 0 ? ((fechados / totalLeads) * 100).toFixed(1) : "0";

        return { totalLeads, totalValor, taxaConversao };
    }, [clientesFiltrados, resolveLeadStageName]);

    const isInteractiveLeadTarget = (target: EventTarget | null) => {
        if (!(target instanceof HTMLElement)) {
            return false;
        }

        return Boolean(
            target.closest(
                "button, a, input, textarea, select, [role='button'], [data-no-card-open='true']",
            ),
        );
    };

    const clearLeadPointerSession = () => {
        const session = leadPointerSessionRef.current;
        if (!session) {
            return;
        }

        if (session.timerId !== null) {
            window.clearTimeout(session.timerId);
        }

        session.draggableElement.draggable = true;
        leadPointerSessionRef.current = null;
    };

   const handleLeadPointerDown = (
        event: React.PointerEvent<HTMLDivElement>,
        leadId: string,
    ) => {
        if (!event.isPrimary || event.button !== 0 || isDragging) {
            return;
        }

        clearLeadPointerSession();

        const interactiveTarget = isInteractiveLeadTarget(event.target);
        const draggableElement = event.currentTarget;
        
        // A linha que travava o drag (draggableElement.draggable = false) foi removida daqui!

        const timerId = window.setTimeout(() => {
            const activeSession = leadPointerSessionRef.current;
            if (!activeSession || activeSession.leadId !== leadId) {
                return;
            }

            activeSession.draggableElement.draggable = true;
            activeSession.timerId = null;
        }, DRAG_ACTIVATION_DELAY_MS);

        leadPointerSessionRef.current = {
            leadId,
            startX: event.clientX,
            startY: event.clientY,
            draggableElement,
            isInteractiveTarget: interactiveTarget,
            hasDragged: false,
            timerId,
        };
    };

    const handleLeadPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const session = leadPointerSessionRef.current;
        if (!session) {
            return;
        }

        const deltaX = event.clientX - session.startX;
        const deltaY = event.clientY - session.startY;
        const pointerDistance = Math.hypot(deltaX, deltaY);

        if (pointerDistance < DRAG_ACTIVATION_DISTANCE) {
            return;
        }

        if (session.timerId !== null) {
            window.clearTimeout(session.timerId);
            session.timerId = null;
        }

        session.draggableElement.draggable = true;
    };

    const handleLeadPointerUp = (event: React.PointerEvent<HTMLDivElement>, lead: any) => {
        const session = leadPointerSessionRef.current;
        if (!session || session.leadId !== String(lead.id)) {
            return;
        }

        const deltaX = event.clientX - session.startX;
        const deltaY = event.clientY - session.startY;
        const pointerDistance = Math.hypot(deltaX, deltaY);
        const shouldOpenLead =
            !session.hasDragged &&
            !session.isInteractiveTarget &&
            pointerDistance < DRAG_ACTIVATION_DISTANCE;

        clearLeadPointerSession();

        if (shouldOpenLead) {
            openLeadDrawer(lead);
        }
    };

    const handleDragStart = (event: React.DragEvent<HTMLDivElement>, id: string) => {
        const activeSession = leadPointerSessionRef.current;
        if (activeSession && activeSession.leadId === id) {
            activeSession.hasDragged = true;
            if (activeSession.timerId !== null) {
                window.clearTimeout(activeSession.timerId);
                activeSession.timerId = null;
            }
        }

        setDraggedItemId(id);
        setIsDragging(true);
        setActiveDropColumn(null);
        setIsBoardPanning(false);
        boardPanStartRef.current = null;
        event.dataTransfer.setData("leadId", id);
        event.dataTransfer.effectAllowed = "move";
        event.currentTarget.style.opacity = "0.5";
        event.currentTarget.style.cursor = "grabbing";
    };

    const handleDragEnd = (event: React.DragEvent<HTMLDivElement>) => {
        event.currentTarget.style.opacity = "1";
        event.currentTarget.style.cursor = "grab";
        clearLeadPointerSession();
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

    const handleDragOver = (event: React.DragEvent<HTMLDivElement>, stageId: string) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (activeDropColumn !== stageId) {
            setActiveDropColumn(stageId);
        }
    };

    const handleDrop = async (
        event: React.DragEvent<HTMLDivElement>,
        novoStageId: string,
    ) => {
        event.preventDefault();
        setActiveDropColumn(null);
        setIsDragging(false);

        const leadId = draggedItemId || event.dataTransfer.getData("leadId");
        if (!leadId) return;

        const leadArrastado = visibleData.find((item: any) => item.id.toString() === leadId);

        if (!leadArrastado) {
            message.warning("Lead não encontrado.");
            return;
        }

        const currentStageId = resolveLeadStageId(leadArrastado);
        if (currentStageId === novoStageId) return;

        const nextStage = stageById.get(novoStageId);
        const nextStageName = nextStage?.nome || "Sem etapa";
        const fromStageName = resolveLeadStageName(leadArrastado);

        try {
            await updateLead({
                resource: "clientes",
                id: leadId,
                values: {
                    tenant_id: tenantId || undefined,
                    stage_id: novoStageId,
                    status: nextStage?.nome || undefined,
                },
                successNotification: () => ({
                    message: `Movido para ${nextStageName}`,
                    description: "Etapa atualizada com sucesso.",
                    type: "success",
                }),
                errorNotification: () => ({
                    message: "Não foi possível atualizar a etapa",
                    description: "Tente novamente.",
                    type: "error",
                }),
            });

            const { error: historyError } = await supabaseClient
                .from("cliente_status_history")
                .insert({
                    tenant_id: tenantId || undefined,
                    cliente_id: leadArrastado.id,
                    de_status: fromStageName,
                    para_status: nextStageName,
                    movido_em: new Date().toISOString(),
                    movido_por: ownerDisplayName || null,
                });

            if (historyError && !isSupabaseMissingRelation(historyError)) {
                message.warning(
                    "Status atualizado, mas não foi possível registrar no histórico.",
                );
            }

            if (leadArrastado.id !== undefined && leadArrastado.id !== null) {
                await addLeadActivity({
                    leadId: String(leadArrastado.id),
                    tenantId,
                    activityType: "status",
                    title: "Mudança de etapa",
                    description: `${fromStageName} -> ${nextStageName}`,
                    fromStatus: fromStageName,
                    toStatus: nextStageName,
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

    const openLeadEdit = (leadId: string | number) => {
        go({
            to: `/clientes/edit/${leadId}`,
            type: "push",
        });
    };

    const stopLeadCardActionPropagation = (event: React.SyntheticEvent<HTMLElement>) => {
        event.stopPropagation();
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

    useEffect(() => {
        return () => {
            clearLeadPointerSession();
        };
    }, []);

    useEffect(() => {
        const previousHtmlOverscrollX = document.documentElement.style.overscrollBehaviorX;
        const previousBodyOverscrollX = document.body.style.overscrollBehaviorX;

        document.documentElement.style.overscrollBehaviorX = "none";
        document.body.style.overscrollBehaviorX = "none";

        return () => {
            document.documentElement.style.overscrollBehaviorX = previousHtmlOverscrollX;
            document.body.style.overscrollBehaviorX = previousBodyOverscrollX;
        };
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
                        placeholder="Responsável"
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
                <Button icon={<SettingOutlined />} onClick={openStageManager} disabled={!canDeleteRecords}>
                    Colunas
                </Button>
            </div>

            {!canViewAllLeads ? (
                <div style={{ padding: "0 20px 8px 20px" }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                        Visão restrita: exibindo apenas leads vinculados a {ownerDisplayName}.
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
                        title="Previsão de Receita"
                        value={kpis.totalValor}
                        prefix={<DollarCircleOutlined style={{ color: "#4c8bf5" }} />}
                        accentColor="#4c8bf5"
                    />
                    <StatCard
                        title="Conversão"
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
                    Dica: clique e arraste no fundo do kanban para navegar horizontalmente.
                </Text>
            </div>
        </div>
    );

    const renderKanbanView = () => {
        if (clientesQueryError) {
            return (
                <div style={{ padding: 20 }}>
                    <EmptyState
                        title={
                            hasClientesPolicyRecursion
                                ? "Falha de policy RLS no Supabase"
                                : "Não foi possível carregar os leads"
                        }
                        description={
                            hasClientesPolicyRecursion
                                ? "O erro indica recursão infinita em policy. O acesso foi bloqueado."
                                : clientesQueryErrorMessage || "Revise as policies RLS."
                        }
                    />
                </div>
            );
        }

        if (clientesFiltrados.length === 0) {
            return (
                <div style={{ padding: 20 }}>
                    <EmptyState
                        title="Nenhum lead para os filtros aplicados"
                        description="Ajuste busca, responsável ou temperatura."
                    />
                </div>
            );
        }

        return (
            // <-- SOLUÇÃO DO SCROLL: Este contêiner é rigidamente preso à tela com position: absolute
            <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }}>
                <div
                    ref={boardRef}
                    className="crm-kanban-scroll"
                    onMouseDown={handleBoardMouseDown}
                    onMouseMove={handleBoardMouseMove}
                    onMouseUp={stopBoardPan}
                    onMouseLeave={stopBoardPan}
                    style={{
                        display: "flex",
                        overflowX: "auto",
                        overflowY: "hidden", 
                        height: "100%", 
                        backgroundColor: "#f7fafc", 
                        padding: "20px",
                        gap: "10px",
                        cursor: isDragging ? "default" : isBoardPanning ? "grabbing" : "grab",
                        userSelect: isBoardPanning ? "none" : "auto",
                        scrollbarWidth: "none",
                        msOverflowStyle: "none",
                        touchAction: "pan-x",
                    }}
                >
                    {stagesVisiveis.map((estagio) => {
                        const stageColumnId = String(estagio.id ?? estagio.nome);
                        const clientesDaColuna = clientesFiltrados.filter((cliente: any) =>
                            estagio.nome === "Outros"
                                ? !resolveLeadStageId(cliente) || !stageIdSet.has(resolveLeadStageId(cliente))
                                : resolveLeadStageId(cliente) === stageColumnId,
                        );
                        const totalColuna = clientesDaColuna.reduce((acc: number, curr: any) => {
                            return acc + Number(curr.conta_energia_media || 0);
                        }, 0);

                        const isDroppable = estagio.nome !== "Outros";
                        const isDropActive = isDroppable && isDragging && activeDropColumn === stageColumnId;
                        const accentColor = estagio.cor || getStatusAccent(estagio.nome);

                        return (
                            <div
                                key={stageColumnId}
                                onDragOver={
                                    isDroppable ? (event) => handleDragOver(event, stageColumnId) : undefined
                                }
                                onDrop={isDroppable ? (event) => handleDrop(event, stageColumnId) : undefined}
                                style={{
                                    minWidth: "320px", 
                                    maxWidth: "320px",
                                    height: "100%", 
                                    display: "flex",
                                    flexDirection: "column",
                                    padding: "0 10px",
                                    transition: "background 0.2s",
                                    backgroundColor: isDropActive ? "#f0f7ff" : "transparent",
                                    boxShadow: isDropActive ? "inset 0 0 0 1px #91caff" : "none",
                                    borderRadius: "8px",
                                }}
                            >
                                <div style={{ paddingBottom: "15px", paddingTop: "5px", textAlign: "center" }}>
                                    <Text
                                        strong
                                        style={{
                                            textTransform: "uppercase",
                                            fontSize: "12px",
                                            color: "#192a3e",
                                            display: "block",
                                            marginBottom: "4px",
                                        }}
                                    >
                                        {estagio.nome}
                                    </Text>
                                    <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', fontSize: "11px", color: "#667085" }}>
                                        <Text style={{ fontSize: "11px", color: "#667085" }}>{clientesDaColuna.length} leads</Text>
                                        <span>•</span>
                                        <Text style={{ fontSize: "11px", color: "#667085" }}>{formatCurrencyBRL(totalColuna, "R$ 0,00")}</Text>
                                    </div>
                                    <div
                                        style={{
                                            height: "4px",
                                            width: "100%",
                                            backgroundColor: accentColor,
                                            marginTop: "10px",
                                            borderRadius: "2px",
                                            opacity: 0.8
                                        }}
                                    />
                                </div>

                                <div 
                                    className="kanban-column-content"
                                    style={{ 
                                        flex: 1, 
                                        overflowY: "auto", 
                                        overflowX: "hidden",
                                        scrollbarWidth: "none",
                                        msOverflowStyle: "none",
                                        paddingRight: "5px", 
                                        paddingBottom: "20px",
                                        minHeight: 0 // <-- Junto com o absolute no pai, isso cria a barra interna definitiva.
                                    }}
                                >
                                    {clientesDaColuna.length === 0 ? (
                                        <div
                                            style={{
                                                border: "1px dashed #e2e8f0",
                                                borderRadius: "8px",
                                                padding: "20px 12px",
                                                textAlign: "center",
                                                color: "#98a2b3",
                                                fontSize: "13px",
                                                marginTop: "6px",
                                            }}
                                        >
                                            {isDropActive ? "Solte o lead aqui" : "Sem leads nesta etapa"}
                                        </div>
                                    ) : (
                                        clientesDaColuna.map((cliente: any) => (
                                            <div
                                                key={cliente.id}
                                                data-pan-ignore="true"
                                                draggable
                                                onPointerDown={(event) =>
                                                    handleLeadPointerDown(event, String(cliente.id))
                                                }
                                                onPointerMove={handleLeadPointerMove}
                                                onPointerUp={(event) => handleLeadPointerUp(event, cliente)}
                                                onPointerCancel={clearLeadPointerSession}
                                                onDragStart={(event) =>
                                                    handleDragStart(event, cliente.id.toString())
                                                }
                                                onDragEnd={handleDragEnd}
                                                style={{ cursor: "grab", touchAction: "pan-y" }}
                                            >
                                                <Card
                                                    size="small"
                                                    interactive
                                                    style={{
                                                        marginBottom: "12px",
                                                        borderLeft: `4px solid ${accentColor}`,
                                                        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                                                        cursor: "grab",
                                                        userSelect: "none",
                                                    }}
                                                    bodyStyle={{ padding: "12px" }}
                                                    actions={[
                                                        <Button
                                                            key={`edit-${cliente.id}`}
                                                            icon={<EditOutlined />}
                                                            size="small"
                                                            data-no-card-open="true"
                                                            onPointerDown={stopLeadCardActionPropagation}
                                                            onClick={(event) => {
                                                                stopLeadCardActionPropagation(event);
                                                                openLeadEdit(cliente.id);
                                                            }}
                                                        >
                                                            Editar
                                                        </Button>,
                                                        <Button
                                                            key={`show-${cliente.id}`}
                                                            icon={<EyeOutlined />}
                                                            size="small"
                                                            data-no-card-open="true"
                                                            onPointerDown={stopLeadCardActionPropagation}
                                                            onClick={(event) => {
                                                                stopLeadCardActionPropagation(event);
                                                                openLeadDrawer(cliente);
                                                            }}
                                                        >
                                                            Ver
                                                        </Button>,
                                                    ]}
                                                >
                                                    <div style={{ marginBottom: "8px" }}>
                                                        <Text
                                                            strong
                                                            style={{ color: "#192a3e", fontSize: "14px" }}
                                                        >
                                                            {cliente.nome}
                                                        </Text>
                                                    </div>
                                                    <div style={{ marginBottom: "8px" }}>
                                                        <TemperatureBadge
                                                            value={getClienteTemperature(cliente)}
                                                        />
                                                    </div>
                                                    <div
                                                        style={{
                                                            display: "flex",
                                                            flexDirection: "column",
                                                            gap: "4px",
                                                        }}
                                                    >
                                                        {cliente.conta_energia_media > 0 && (
                                                            <Text style={{ fontSize: "13px", color: "#4a5568", fontWeight: 500 }}>
                                                                {formatCurrencyBRL(
                                                                    cliente.conta_energia_media,
                                                                    "R$ 0,00",
                                                                )}
                                                            </Text>
                                                        )}
                                                        {cliente.responsavel && (
                                                            <Text style={{ fontSize: "11px", color: "#718096" }}>
                                                                Resp: {cliente.responsavel}
                                                            </Text>
                                                        )}
                                                        <Text style={{ fontSize: "11px", color: "#a0aec0" }}>
                                                            {formatDateBR(cliente.created_at, "-")}
                                                        </Text>
                                                    </div>
                                                </Card>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    const renderListView = () => (
        <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, padding: "20px", backgroundColor: "#fff", overflowY: "auto" }}>
            {clientesQueryError ? (
                <EmptyState
                    title="Erro ao carregar leads"
                    description={clientesQueryErrorMessage || "Revise as policies RLS."}
                />
            ) : (
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
                            title: "Etapa",
                            key: "stage_id",
                            render: (_, record: any) => {
                                const stageName = resolveLeadStageName(record);
                                return <Badge tone={getStatusTone(stageName)}>{stageName}</Badge>;
                            },
                        },
                        {
                            title: "Temperatura",
                            key: "temperature",
                            render: (_, record: any) => (
                                <TemperatureBadge value={getClienteTemperature(record)} />
                            ),
                        },
                        {
                            title: "Responsável",
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
                                    <Button
                                        size="small"
                                        icon={<EditOutlined />}
                                        onClick={() => openLeadEdit(record.id)}
                                    >
                                        Editar
                                    </Button>
                                </Space>
                            ),
                        },
                    ]}
                />
            )}
        </div>
    );

    return (
        <div
            style={{
                height: "100vh",
                display: "flex",
                flexDirection: "column",
                backgroundColor: "#fff",
                overflow: "hidden", 
            }}
        >
            <KommoHeader />
            <div
                style={{
                    flex: 1,
                    overflow: "hidden", 
                    position: "relative" // <-- Fundamental para o position absolute dos filhos funcionar
                }}
            >
                <style>{`
                    .crm-kanban-scroll::-webkit-scrollbar {
                        width: 0;
                        height: 0;
                    }

                    .kanban-column-content::-webkit-scrollbar {
                        width: 0;
                        height: 0;
                    }
                `}</style>
                
                {viewType === "kanban" ? renderKanbanView() : renderListView()}
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
                    Crie ou exclua colunas para adaptar o pipeline ao tipo de negócio.
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
                                        {leadCountByStageId[String(stage.id ?? "")] || 0} leads
                                    </Text>
                                </div>
                            </div>
                            <Button
                                type="text"
                                danger
                                icon={<DeleteOutlined />}
                                onClick={() => requestDeleteStage(stage)}
                                disabled={!canDeleteRecords || !canDeleteAnyStage || !stage.persisted}
                            >
                                Excluir
                            </Button>
                        </div>
                    ))}
                </div>
                {!canDeleteAnyStage ? (
                    <Text type="secondary">É necessário manter ao menos uma coluna no funil.</Text>
                ) : null}
            </Modal>

            <Modal
                title="Excluir coluna"
                open={Boolean(stagePendingDelete)}
                onCancel={cancelDeleteStage}
                onOk={confirmDeleteStage}
                okText="Excluir coluna"
                okButtonProps={{ danger: true, loading: isDeletingStage, disabled: !canDeleteRecords }}
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
