import React, { useEffect, useMemo, useRef, useState } from "react";
import { useGo, useList, useInfiniteList, useUpdate, useCreate, type CrudFilter } from "@refinedev/core";
import { CreateButton } from "@refinedev/antd";
import { ImportLeadsButton } from "../../components/import-leads";

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
import { useCrmAccess } from "../../hooks/useCrmAccess";
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
const KANBAN_PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 400;

type LeadPointerSession = {
    leadId: string;
    startX: number;
    startY: number;
    draggableElement: HTMLDivElement;
    isInteractiveTarget: boolean;
    hasDragged: boolean;
    timerId: number | null;
};

/* ------------------------------------------------------------------ */
/*  KanbanColumn – cada coluna carrega seus leads de forma independente */
/* ------------------------------------------------------------------ */
type KanbanColumnProps = {
    stage: Stage;
    stageColumnId: string;
    isOthersColumn?: boolean;
    serverFilters: CrudFilter[];
    accentColor: string;
    isDragging: boolean;
    activeDropColumn: string | null;
    onDragOverColumn: (e: React.DragEvent<HTMLDivElement>, stageId: string) => void;
    onDropColumn: (e: React.DragEvent<HTMLDivElement>, stageId: string) => void;
    onDragStartLead: (e: React.DragEvent<HTMLDivElement>, lead: any) => void;
    onDragEndLead: (e: React.DragEvent<HTMLDivElement>) => void;
    onLeadPointerDown: (e: React.PointerEvent<HTMLDivElement>, leadId: string) => void;
    onLeadPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
    onLeadPointerUp: (e: React.PointerEvent<HTMLDivElement>, lead: any) => void;
    onLeadPointerCancel: () => void;
    openLeadDrawer: (lead: any) => void;
    openLeadEdit: (leadId: string | number) => void;
    stopActionPropagation: (e: React.SyntheticEvent<HTMLElement>) => void;
};

const KanbanColumn: React.FC<KanbanColumnProps> = ({
    stage,
    stageColumnId,
    isOthersColumn,
    serverFilters,
    accentColor,
    isDragging,
    activeDropColumn,
    onDragOverColumn,
    onDropColumn,
    onDragStartLead,
    onDragEndLead,
    onLeadPointerDown,
    onLeadPointerMove,
    onLeadPointerUp,
    onLeadPointerCancel,
    openLeadDrawer,
    openLeadEdit,
    stopActionPropagation,
}) => {
    const sentinelRef = useRef<HTMLDivElement | null>(null);

    const columnFilters = useMemo<CrudFilter[]>(() => {
        const base = [...serverFilters];
        if (isOthersColumn) {
            base.push({ field: "stage_id", operator: "null" as const, value: true });
        } else {
            base.push({ field: "stage_id", operator: "eq" as const, value: stageColumnId });
        }
        return base;
    }, [serverFilters, stageColumnId, isOthersColumn]);

    const { query: colQuery, result: colResult } = useInfiniteList({
        resource: "clientes",
        pagination: { currentPage: 1, pageSize: KANBAN_PAGE_SIZE },
        filters: columnFilters,
        liveMode: "auto",
    });

    const leads = useMemo(
        () => colResult.data?.pages.flatMap((p) => p.data) ?? [],
        [colResult.data],
    );
    const total = colResult.data?.pages[0]?.total ?? 0;
    const isColLoading = colQuery.isLoading;
    const isFetchingMore = colQuery.isFetchingNextPage;

    // IntersectionObserver para infinite scroll automático
    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting && colResult.hasNextPage && !isFetchingMore) {
                    colQuery.fetchNextPage();
                }
            },
            { rootMargin: "200px" },
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [colResult.hasNextPage, isFetchingMore, colQuery.fetchNextPage]);

    const totalColuna = useMemo(
        () => leads.reduce((acc: number, c: any) => acc + Number(c.conta_energia_media || 0), 0),
        [leads],
    );

    const isDroppable = !isOthersColumn;
    const isDropActive = isDroppable && isDragging && activeDropColumn === stageColumnId;

    return (
        <div
            onDragOver={isDroppable ? (e) => onDragOverColumn(e, stageColumnId) : undefined}
            onDrop={isDroppable ? (e) => onDropColumn(e, stageColumnId) : undefined}
            className={`crm-kanban-column ${isDropActive ? "crm-kanban-column-drop-active" : ""}`}
            style={{ backgroundColor: isDropActive ? "rgba(37, 99, 235, 0.08)" : undefined }}
        >
            <div className="crm-kanban-column-head">
                <Text strong className="crm-kanban-column-title">{stage.nome}</Text>
                <div className="crm-kanban-column-stats">
                    <Text style={{ fontSize: 11, color: "var(--crm-ink-500)", fontWeight: 500 }}>{total} leads</Text>
                    <span style={{ color: "var(--crm-ink-300)" }}>·</span>
                    <Text style={{ fontSize: 11, color: "var(--crm-ink-500)", fontWeight: 500 }}>
                        {formatCurrencyBRL(totalColuna, "R$ 0,00")}
                    </Text>
                </div>
                <div
                    style={{
                        height: 3,
                        width: "100%",
                        background: `linear-gradient(90deg, ${accentColor}, ${accentColor}88)`,
                        marginTop: 10,
                        borderRadius: 999,
                        opacity: 0.7,
                    }}
                />
            </div>

            <div className="crm-kanban-column-content" style={{ minHeight: 0 }}>
                {isColLoading ? (
                    <div style={{ display: "flex", justifyContent: "center", padding: 20 }}>
                        <Spin size="small" />
                    </div>
                ) : leads.length === 0 ? (
                    <div className="crm-kanban-empty">
                        {isDropActive ? "Solte o lead aqui" : "Sem leads nesta etapa"}
                    </div>
                ) : (
                    <>
                        {leads.map((cliente: any) => (
                            <div
                                key={cliente.id}
                                data-pan-ignore="true"
                                draggable
                                onPointerDown={(e) => onLeadPointerDown(e, String(cliente.id))}
                                onPointerMove={onLeadPointerMove}
                                onPointerUp={(e) => onLeadPointerUp(e, cliente)}
                                onPointerCancel={onLeadPointerCancel}
                                onDragStart={(e) => onDragStartLead(e, cliente)}
                                onDragEnd={onDragEndLead}
                                style={{ cursor: "grab", touchAction: "pan-y" }}
                            >
                                <Card
                                    size="small"
                                    interactive
                                    className="crm-lead-card"
                                    style={{ borderLeft: `3px solid ${accentColor}` }}
                                    bodyStyle={{ padding: "14px 14px 10px" }}
                                    actions={[
                                        <Button
                                            key={`edit-${cliente.id}`}
                                            icon={<EditOutlined />}
                                            size="small"
                                            data-no-card-open="true"
                                            onPointerDown={stopActionPropagation}
                                            onClick={(e) => {
                                                stopActionPropagation(e);
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
                                            onPointerDown={stopActionPropagation}
                                            onClick={(e) => {
                                                stopActionPropagation(e);
                                                openLeadDrawer(cliente);
                                            }}
                                        >
                                            Ver
                                        </Button>,
                                    ]}
                                >
                                    <div style={{ marginBottom: "8px" }}>
                                        <Text strong className="crm-lead-card-title">{cliente.nome}</Text>
                                    </div>
                                    <div style={{ marginBottom: "8px" }}>
                                        <TemperatureBadge value={resolveLeadTemperature(cliente)} />
                                    </div>
                                    <div className="crm-lead-card-meta">
                                        {cliente.conta_energia_media > 0 && (
                                            <Text style={{ fontSize: 13, color: "var(--crm-ink-700)", fontWeight: 600, letterSpacing: "-0.01em" }}>
                                                {formatCurrencyBRL(cliente.conta_energia_media, "R$ 0,00")}
                                            </Text>
                                        )}
                                        {cliente.responsavel && (
                                            <Text style={{ fontSize: 11, color: "var(--crm-ink-500)" }}>
                                                Resp: {cliente.responsavel}
                                            </Text>
                                        )}
                                        <Text style={{ fontSize: 11, color: "var(--crm-ink-400)" }}>
                                            {formatDateBR(cliente.created_at, "-")}
                                        </Text>
                                    </div>
                                </Card>
                            </div>
                        ))}
                        <div ref={sentinelRef} style={{ height: 1 }} />
                        {isFetchingMore && (
                            <div style={{ display: "flex", justifyContent: "center", padding: 12 }}>
                                <Spin size="small" />
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

/* ------------------------------------------------------------------ */
/*  ClienteList – componente principal                                 */
/* ------------------------------------------------------------------ */
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

    // ---- UI state ----
    const [viewType, setViewType] = useState<"kanban" | "list">("kanban");
    const [searchText, setSearchText] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [responsavelFiltro, setResponsavelFiltro] = useState<string | undefined>(undefined);
    const [temperaturaFiltro, setTemperaturaFiltro] = useState<"todas" | LeadTemperatureTag>("todas");
    const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
    const [draggedLead, setDraggedLead] = useState<any>(null);
    const [activeDropColumn, setActiveDropColumn] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isLeadDrawerOpen, setIsLeadDrawerOpen] = useState(false);
    const [selectedLeadId, setSelectedLeadId] = useState<string | number | null>(null);
    const [selectedLead, setSelectedLead] = useState<Record<string, any> | null>(null);
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
    const [listPage, setListPage] = useState(1);
    const [responsaveisDisponiveis, setResponsaveisDisponiveis] = useState<string[]>([]);

    const boardRef = useRef<HTMLDivElement | null>(null);
    const boardPanStartRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);
    const leadPointerSessionRef = useRef<LeadPointerSession | null>(null);

    const { mutateAsync: updateLead } = useUpdate();
    const { mutateAsync: createStage } = useCreate();

    // ---- Debounce de busca ----
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(searchText), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [searchText]);

    // ---- Stages query (inalterada) ----
    const { query: stagesQuery } = useList({
        resource: "pipeline_stages",
        pagination: { mode: "off" },
        sorters: [{ field: "ordem", order: "asc" }],
        liveMode: "auto",
    });

    const persistedStagesRaw = useMemo(() => {
        return ((stagesQuery?.data?.data as any[]) || []).filter((s) => s !== null);
    }, [stagesQuery?.data?.data]);

    const stages = useMemo(() => {
        const normalized = persistedStagesRaw
            .map((s) => ({
                id: s.id,
                nome: s.nome ?? s.name ?? "",
                cor: s.cor ?? s.color,
                ordem: s.ordem ?? s.order ?? s.sort_order,
                persisted: s.id !== undefined && s.id !== null,
            }))
            .filter((s) => s.nome)
            .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
        if (normalized.length > 0) return normalized;
        return DEFAULT_STAGE_BLUEPRINT.map((s) => ({ ...s, persisted: false }));
    }, [persistedStagesRaw]);

    const stageIdSet = useMemo(() => new Set(stages.map((s) => String(s.id ?? ""))), [stages]);
    const stageIdByName = useMemo(
        () => new Map(stages.map((s) => [normalizeText(s.nome), String(s.id ?? s.nome)])),
        [stages],
    );
    const stageById = useMemo(
        () => new Map(stages.map((s) => [String(s.id ?? s.nome), s])),
        [stages],
    );

    const resolveLeadStageId = (cliente: any): string => {
        const rawStageId = cliente?.stage_id ?? cliente?.stageId;
        if (rawStageId !== undefined && rawStageId !== null && String(rawStageId).trim()) {
            return String(rawStageId);
        }
        const normalizedStatus = normalizeText(cliente?.status);
        if (!normalizedStatus) return "";
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
        () => stages.filter((s) => s.nome !== "Outros"),
        [stages],
    );
    const canDeleteAnyStage = manageableStages.length > 1;

    // ---- Server-side filters ----
    const serverFilters = useMemo<CrudFilter[]>(() => {
        const filters: CrudFilter[] = [];

        if (debouncedSearch) {
            filters.push({
                operator: "or",
                value: [
                    { field: "nome", operator: "contains", value: debouncedSearch },
                    { field: "telefone", operator: "contains", value: debouncedSearch },
                ],
            });
        }

        if (responsavelFiltro) {
            filters.push({ field: "responsavel", operator: "eq", value: responsavelFiltro });
        }

        if (temperaturaFiltro !== "todas") {
            if (temperaturaFiltro === "fechado") {
                filters.push({
                    operator: "or",
                    value: [
                        { field: "status", operator: "contains", value: "fechado" },
                        { field: "status", operator: "contains", value: "ganho" },
                    ],
                });
            } else if (temperaturaFiltro === "perdido") {
                filters.push({ field: "status", operator: "contains", value: "perdido" });
            } else {
                filters.push({ field: "temperatura", operator: "eq", value: temperaturaFiltro });
            }
        }

        if (!canViewAllLeads && ownerCandidatesNormalized.length > 0) {
            filters.push({ field: "responsavel", operator: "in", value: ownerCandidatesNormalized });
        }

        return filters;
    }, [debouncedSearch, responsavelFiltro, temperaturaFiltro, canViewAllLeads, ownerCandidatesNormalized]);

    // Chave para forçar remount das colunas kanban quando filtros mudam
    const filterKey = useMemo(() => JSON.stringify(serverFilters), [serverFilters]);

    // Reset da página da lista quando filtros mudam
    useEffect(() => {
        setListPage(1);
    }, [serverFilters]);

    // ---- KPI filters (subset aplicável à View materializada) ----
    const kpiFilters = useMemo<CrudFilter[]>(() => {
        const filters: CrudFilter[] = [];

        if (responsavelFiltro) {
            filters.push({ field: "responsavel_id", operator: "eq", value: responsavelFiltro });
        }

        if (temperaturaFiltro !== "todas") {
            if (temperaturaFiltro === "fechado") {
                filters.push({
                    operator: "or",
                    value: [
                        { field: "status", operator: "contains", value: "fechado" },
                        { field: "status", operator: "contains", value: "ganho" },
                    ],
                });
            } else if (temperaturaFiltro === "perdido") {
                filters.push({ field: "status", operator: "contains", value: "perdido" });
            }
        }

        if (!canViewAllLeads && ownerCandidatesNormalized.length > 0) {
            filters.push({ field: "responsavel_id", operator: "in", value: ownerCandidatesNormalized });
        }

        return filters;
    }, [responsavelFiltro, temperaturaFiltro, canViewAllLeads, ownerCandidatesNormalized]);

    // ---- KPI query (View materializada – dados já agregados) ----
    const { query: kpiQuery } = useList({
        resource: "vw_kanban_kpis",
        pagination: { mode: "off" },
        filters: kpiFilters,
        liveMode: "auto",
    });

    const kpiRows = kpiQuery?.data?.data ?? [];
    const kpiError = (kpiQuery?.error ?? null) as any;
    const hasKpiPolicyRecursion = isSupabasePolicyRecursion(kpiError);
    const kpiErrorMessage = getSupabaseErrorMessage(kpiError);

    // ---- KPIs ----
    const kpis = useMemo(() => {
        const totalLeads = kpiRows.reduce((acc: number, r: any) => acc + Number(r.total_leads || 0), 0);
        const totalValor = kpiRows.reduce((acc: number, r: any) => acc + Number(r.valor_total || 0), 0);
        const fechados = kpiRows
            .filter((r: any) => {
                const s = normalizeText(r.status);
                return s.includes("fechado") || s.includes("ganho");
            })
            .reduce((acc: number, r: any) => acc + Number(r.total_leads || 0), 0);
        const taxaConversao = totalLeads > 0 ? ((fechados / totalLeads) * 100).toFixed(1) : "0";
        return { totalLeads, totalValor, taxaConversao };
    }, [kpiRows]);

    // ---- leadCountByStageId (para o gerenciador de colunas) ----
    const leadCountByStageId = useMemo(() => {
        return kpiRows.reduce<Record<string, number>>((acc, r: any) => {
            const normalizedStatus = normalizeText(r.status);
            const sid = stageIdByName.get(normalizedStatus) || "";
            if (!sid) return acc;
            acc[sid] = (acc[sid] || 0) + Number(r.total_leads || 0);
            return acc;
        }, {});
    }, [kpiRows, stageIdByName]);

    const leadsInPendingDeleteStage = useMemo(() => {
        if (!stagePendingDelete) return 0;
        return leadCountByStageId[String(stagePendingDelete.id ?? "")] || 0;
    }, [leadCountByStageId, stagePendingDelete]);

    const deleteStageDestinationOptions = useMemo(() => {
        if (!stagePendingDelete) return [];
        return manageableStages
            .filter((s) => s.nome !== stagePendingDelete.nome)
            .map((s) => ({ value: String(s.id ?? s.nome), label: s.nome }));
    }, [manageableStages, stagePendingDelete]);

    // ---- stagesVisiveis (detecção de coluna "Outros") ----
    const stagesVisiveis = useMemo(() => {
        const hasOrphaned = kpiRows.some((r: any) => {
            const normalizedStatus = normalizeText(r.status);
            const sid = stageIdByName.get(normalizedStatus);
            return !sid || !stageIdSet.has(sid);
        });
        if (!hasOrphaned) return stages;
        return [...stages, { id: "outros", nome: "Outros", cor: "#94a3b8" }];
    }, [kpiRows, stageIdByName, stageIdSet, stages]);

    // ---- Responsáveis disponíveis (query direta leve) ----
    useEffect(() => {
        if (isLoadingAccess) return;
        const fetchResponsaveis = async () => {
            let query = supabaseClient
                .from("clientes")
                .select("responsavel")
                .not("responsavel", "is", null);
            if (!canViewAllLeads && ownerCandidatesNormalized.length > 0) {
                query = query.in("responsavel", ownerCandidatesNormalized);
            }
            const { data } = await query.limit(5000);
            const unique = [
                ...new Set((data || []).map((d: any) => d.responsavel as string).filter(Boolean)),
            ].sort((a, b) => a.localeCompare(b));
            setResponsaveisDisponiveis(unique);
        };
        fetchResponsaveis();
    }, [canViewAllLeads, ownerCandidatesNormalized, tenantId, isLoadingAccess]);

    // ---- List view query (paginação server-side) ----
    const { query: listQuery } = useList({
        resource: "clientes",
        pagination: { currentPage: listPage, pageSize: 12 },
        filters: serverFilters,
        liveMode: "auto",
        queryOptions: { enabled: viewType === "list" },
    });

    const listData = listQuery?.data?.data ?? [];
    const listTotal = listQuery?.data?.total ?? 0;
    const listError = (listQuery?.error ?? null) as any;
    const listErrorMessage = getSupabaseErrorMessage(listError);

    // ---- Selected lead (fetch direto para o drawer) ----
    useEffect(() => {
        if (selectedLeadId == null) {
            setSelectedLead(null);
            return;
        }
        const fetchLead = async () => {
            const { data } = await supabaseClient
                .from("clientes")
                .select("*")
                .eq("id", selectedLeadId)
                .single();
            setSelectedLead(data ?? null);
        };
        fetchLead();
    }, [selectedLeadId]);

    // ---- Realtime notification (apenas toast – dados atualizados via liveMode) ----
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
                },
            )
            .subscribe();

        return () => {
            supabaseClient.removeChannel(channel);
        };
    }, []);

    // ---- Stage management ----
    const persistDefaultStagesIfNeeded = async () => {
        const refreshed = await stagesQuery?.refetch?.();
        const existingRows = ((refreshed?.data?.data as any[]) || persistedStagesRaw).filter(
            (s: any) => s !== null && s !== undefined,
        );
        if (existingRows.length > 0) return true;

        const payload = DEFAULT_STAGE_BLUEPRINT.map((s, i) => ({
            tenant_id: tenantId || undefined,
            nome: s.nome,
            cor: s.cor || getStatusAccent(s.nome),
            ordem: i + 1,
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
        if (!ready) return;
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
            (s) => normalizeText(s.nome) === normalizeText(nome),
        );
        if (duplicated) {
            message.warning("Já existe uma coluna com esse nome.");
            return;
        }

        setIsCreatingStage(true);
        try {
            const ready = await persistDefaultStagesIfNeeded();
            if (!ready) return;

            const maxOrder = manageableStages.reduce(
                (acc, s) => Math.max(acc, Number(s.ordem || 0)),
                0,
            );

            await createStage({
                resource: "pipeline_stages",
                values: {
                    tenant_id: tenantId || undefined,
                    nome,
                    title: nome,
                    cor: newStageColor,
                    ordem: maxOrder + 1,
                },
                successNotification: false,
            });

            message.success(`Coluna "${nome}" criada com sucesso.`);
            setNewStageName("");
            setNewStageColor("#5d9cec");
            await stagesQuery?.refetch?.();

            setTimeout(() => {
                if (boardRef.current) {
                    boardRef.current.scrollTo({ left: boardRef.current.scrollWidth + 1500, behavior: "smooth" });
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
        const defaultDestinationRaw = manageableStages.find((item) => item.nome !== stage.nome)?.id;
        const defaultDestination =
            defaultDestinationRaw == null ? undefined : String(defaultDestinationRaw);
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
        if (!stagePendingDelete) return;

        if (
            leadsInPendingDeleteStage > 0 &&
            (!deleteDestinationStage || deleteDestinationStage === String(stagePendingDelete.id ?? ""))
        ) {
            message.warning("Selecione uma coluna destino para mover os leads.");
            return;
        }

        if (stagePendingDelete.id == null) {
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
                if (moveError) throw moveError;
            }

            const { error: deleteError } = await supabaseClient
                .from("pipeline_stages")
                .delete()
                .eq("id", stagePendingDelete.id);
            if (deleteError) throw deleteError;

            message.success(`Coluna "${stagePendingDelete.nome}" excluída.`);
            cancelDeleteStage();
            await stagesQuery?.refetch?.();
            kpiQuery?.refetch?.();
        } catch {
            message.error("Não foi possível excluir a coluna.");
        } finally {
            setIsDeletingStage(false);
        }
    };

    // ---- Pointer / Drag handlers ----
    const isInteractiveLeadTarget = (target: EventTarget | null) => {
        if (!(target instanceof HTMLElement)) return false;
        return Boolean(
            target.closest(
                "button, a, input, textarea, select, [role='button'], [data-no-card-open='true']",
            ),
        );
    };

    const clearLeadPointerSession = () => {
        const session = leadPointerSessionRef.current;
        if (!session) return;
        if (session.timerId !== null) window.clearTimeout(session.timerId);
        session.draggableElement.draggable = true;
        leadPointerSessionRef.current = null;
    };

    const handleLeadPointerDown = (
        event: React.PointerEvent<HTMLDivElement>,
        leadId: string,
    ) => {
        if (!event.isPrimary || event.button !== 0 || isDragging) return;
        clearLeadPointerSession();

        const interactiveTarget = isInteractiveLeadTarget(event.target);
        const draggableElement = event.currentTarget;

        const timerId = window.setTimeout(() => {
            const activeSession = leadPointerSessionRef.current;
            if (!activeSession || activeSession.leadId !== leadId) return;
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
        if (!session) return;
        const deltaX = event.clientX - session.startX;
        const deltaY = event.clientY - session.startY;
        if (Math.hypot(deltaX, deltaY) < DRAG_ACTIVATION_DISTANCE) return;
        if (session.timerId !== null) {
            window.clearTimeout(session.timerId);
            session.timerId = null;
        }
        session.draggableElement.draggable = true;
    };

    const handleLeadPointerUp = (event: React.PointerEvent<HTMLDivElement>, lead: any) => {
        const session = leadPointerSessionRef.current;
        if (!session || session.leadId !== String(lead.id)) return;
        const deltaX = event.clientX - session.startX;
        const deltaY = event.clientY - session.startY;
        const shouldOpenLead =
            !session.hasDragged &&
            !session.isInteractiveTarget &&
            Math.hypot(deltaX, deltaY) < DRAG_ACTIVATION_DISTANCE;
        clearLeadPointerSession();
        if (shouldOpenLead) openLeadDrawer(lead);
    };

    const handleDragStart = (event: React.DragEvent<HTMLDivElement>, lead: any) => {
        const id = String(lead.id);
        const activeSession = leadPointerSessionRef.current;
        if (activeSession && activeSession.leadId === id) {
            activeSession.hasDragged = true;
            if (activeSession.timerId !== null) {
                window.clearTimeout(activeSession.timerId);
                activeSession.timerId = null;
            }
        }
        setDraggedItemId(id);
        setDraggedLead(lead);
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
        setDraggedLead(null);
        setIsDragging(false);
        setActiveDropColumn(null);
    };

    // ---- Board pan ----
    const shouldIgnoreBoardPan = (target: EventTarget | null) => {
        if (!(target instanceof HTMLElement)) return false;
        return Boolean(target.closest("[data-pan-ignore='true']"));
    };

    const handleBoardMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
        if (event.button !== 0 || isDragging || shouldIgnoreBoardPan(event.target)) return;
        const board = boardRef.current;
        if (!board) return;
        boardPanStartRef.current = {
            x: event.clientX,
            y: event.clientY,
            scrollLeft: board.scrollLeft,
            scrollTop: board.scrollTop,
        };
        setIsBoardPanning(true);
    };

    const handleBoardMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
        if (!isBoardPanning || !boardPanStartRef.current) return;
        const board = boardRef.current;
        if (!board) return;
        board.scrollLeft = boardPanStartRef.current.scrollLeft - (event.clientX - boardPanStartRef.current.x);
        board.scrollTop = boardPanStartRef.current.scrollTop - (event.clientY - boardPanStartRef.current.y);
        event.preventDefault();
    };

    const stopBoardPan = () => {
        if (!isBoardPanning) return;
        boardPanStartRef.current = null;
        setIsBoardPanning(false);
    };

    const handleDragOver = (event: React.DragEvent<HTMLDivElement>, stageId: string) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (activeDropColumn !== stageId) setActiveDropColumn(stageId);
    };

    const handleDrop = async (
        event: React.DragEvent<HTMLDivElement>,
        novoStageId: string,
    ) => {
        event.preventDefault();
        setActiveDropColumn(null);
        setIsDragging(false);

        const leadArrastado = draggedLead;
        if (!leadArrastado) {
            message.warning("Lead não encontrado.");
            return;
        }

        const leadId = String(leadArrastado.id);
        const currentStageId = resolveLeadStageId(leadArrastado);
        if (currentStageId === novoStageId) return;

        const nextStage = stageById.get(novoStageId);
        const nextStageName = nextStage?.nome || "Sem etapa";
        const fromStageName = resolveLeadStageName(leadArrastado);
        const isFechado = nextStageName.toLowerCase().includes("fechado");

        try {
            await updateLead({
                resource: "clientes",
                id: leadId,
                values: {
                    tenant_id: tenantId || undefined,
                    stage_id: novoStageId,
                    status: nextStage?.nome || undefined,
                    data_fechamento: isFechado ? new Date().toISOString() : null,
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
                message.warning("Status atualizado, mas não foi possível registrar no histórico.");
            }

            if (leadArrastado.id != null) {
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

    // ---- Drawer / modal helpers ----
    const openLeadDrawer = (lead: any) => {
        setSelectedLeadId(lead.id);
        setIsLeadDrawerOpen(true);
    };

    const openLeadEdit = (leadId: string | number) => {
        go({ to: `/clientes/edit/${leadId}`, type: "push" });
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

    // ---- Global effects ----
    useEffect(() => {
        const handleMouseUp = () => {
            boardPanStartRef.current = null;
            setIsBoardPanning(false);
        };
        window.addEventListener("mouseup", handleMouseUp);
        return () => window.removeEventListener("mouseup", handleMouseUp);
    }, []);

    useEffect(() => {
        return () => { clearLeadPointerSession(); };
    }, []);

    useEffect(() => {
        const prevHtml = document.documentElement.style.overscrollBehaviorX;
        const prevBody = document.body.style.overscrollBehaviorX;
        document.documentElement.style.overscrollBehaviorX = "none";
        document.body.style.overscrollBehaviorX = "none";
        return () => {
            document.documentElement.style.overscrollBehaviorX = prevHtml;
            document.body.style.overscrollBehaviorX = prevBody;
        };
    }, []);

    // ---- Loading ----
    const isLoading = isLoadingAccess || stagesQuery?.isLoading;

    if (isLoading) {
        return (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", paddingTop: 80, flexDirection: "column", gap: 16 }}>
                <Spin size="large" />
                <Text style={{ color: "#94a3b8", fontSize: 13 }}>Carregando oportunidades...</Text>
            </div>
        );
    }

    // ---- Header ----
    const KommoHeader = () => (
        <div className="crm-opportunities-header">
            <div className="crm-opportunities-header-main">
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <Title level={4} className="crm-opportunities-title" style={{ fontSize: 18 }}>
                        Oportunidades
                    </Title>
                    <div className="crm-view-toggle">
                        <Tooltip title="Kanban">
                            <Button
                                type="text"
                                icon={<AppstoreOutlined />}
                                aria-label="Exibir em kanban"
                                style={{
                                    color: viewType === "kanban" ? "#3b82f6" : "#94a3b8",
                                    background: viewType === "kanban" ? "rgba(59, 130, 246, 0.08)" : "transparent",
                                    borderRadius: 8,
                                }}
                                onClick={() => setViewType("kanban")}
                            />
                        </Tooltip>
                        <Tooltip title="Lista">
                            <Button
                                type="text"
                                icon={<BarsOutlined />}
                                aria-label="Exibir em lista"
                                style={{
                                    color: viewType === "list" ? "#3b82f6" : "#94a3b8",
                                    background: viewType === "list" ? "rgba(59, 130, 246, 0.08)" : "transparent",
                                    borderRadius: 8,
                                }}
                                onClick={() => setViewType("list")}
                            />
                        </Tooltip>
                    </div>
                </div>

                <div className="crm-opportunities-filters">
                    <Input
                        placeholder="Buscar leads..."
                        prefix={<SearchOutlined style={{ color: "#94a3b8", fontSize: 13 }} />}
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        aria-label="Buscar lead"
                        style={{
                            width: 220,
                            backgroundColor: "rgba(241, 245, 249, 0.8)",
                            border: "1px solid rgba(148, 163, 184, 0.15)",
                            borderRadius: 10,
                            height: 36,
                            fontSize: 13,
                        }}
                    />
                    <Select
                        placeholder="Responsável"
                        allowClear
                        value={responsavelFiltro}
                        onChange={(v) => setResponsavelFiltro(v)}
                        aria-label="Filtrar por responsavel"
                        options={responsaveisDisponiveis.map((r) => ({ value: r, label: r }))}
                        style={{ width: "180px" }}
                        disabled={responsaveisDisponiveis.length === 0}
                    />
                    <Select
                        value={temperaturaFiltro}
                        onChange={(v) => setTemperaturaFiltro(v)}
                        aria-label="Filtrar por temperatura"
                        style={{ width: "170px" }}
                        options={[
                            { value: "todas", label: "Temperatura: Todas" },
                            ...LEAD_TEMPERATURE_OPTIONS.map((o) => ({
                                value: o.value,
                                label: `Temperatura: ${o.label}`,
                            })),
                            ...LEAD_AUTOMATIC_TEMPERATURE_OPTIONS.map((o) => ({
                                value: o.value,
                                label: `Temperatura: ${o.label}`,
                            })),
                        ]}
                    />
                </div>

                <CreateButton type="primary" icon={<PlusOutlined />} className="crm-focusable">
                    Novo Lead
                </CreateButton>
                <ImportLeadsButton />
                <Button
                    icon={<SettingOutlined />}
                    onClick={openStageManager}
                    disabled={!canDeleteRecords}
                    aria-label="Gerenciar colunas"
                >
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

            <div className="crm-opportunities-kpis">
                <div className="crm-kpi-grid">
                    <StatCard
                        title="Previsao de receita"
                        value={kpis.totalValor}
                        prefix={<DollarCircleOutlined style={{ color: "#3b82f6" }} />}
                        accentColor="#3b82f6"
                    />
                    <StatCard
                        title="Conversao"
                        value={kpis.taxaConversao}
                        suffix="%"
                        prefix={<CheckCircleOutlined style={{ color: "#10b981" }} />}
                        accentColor="#10b981"
                        valueStyle={{ color: "#059669" }}
                    />
                    <StatCard
                        title="Leads Ativos"
                        value={kpis.totalLeads}
                        prefix={<ArrowUpOutlined style={{ color: "#f59e0b" }} />}
                        accentColor="#f59e0b"
                    />
                </div>
                <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 10 }}>
                    Dica: clique e arraste no fundo do kanban para navegar horizontalmente.
                </Text>
            </div>
        </div>
    );

    // ---- Kanban view ----
    const renderKanbanView = () => {
        if (kpiError) {
            return (
                <div style={{ padding: 20 }}>
                    <EmptyState
                        title={
                            hasKpiPolicyRecursion
                                ? "Falha de policy RLS no Supabase"
                                : "Não foi possível carregar os leads"
                        }
                        description={
                            hasKpiPolicyRecursion
                                ? "O erro indica recursão infinita em policy. O acesso foi bloqueado."
                                : kpiErrorMessage || "Revise as policies RLS."
                        }
                    />
                </div>
            );
        }

        if (!kpiQuery?.isLoading && kpis.totalLeads === 0) {
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
            <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }}>
                <div
                    ref={boardRef}
                    className="crm-kanban-scroll crm-kanban-board"
                    onMouseDown={handleBoardMouseDown}
                    onMouseMove={handleBoardMouseMove}
                    onMouseUp={stopBoardPan}
                    onMouseLeave={stopBoardPan}
                    style={{
                        cursor: isDragging ? "default" : isBoardPanning ? "grabbing" : "grab",
                        userSelect: isBoardPanning ? "none" : "auto",
                    }}
                >
                    {stagesVisiveis.map((estagio) => {
                        const stageColumnId = String(estagio.id ?? estagio.nome);
                        const isOthers = estagio.nome === "Outros";
                        const accentColor = estagio.cor || getStatusAccent(estagio.nome);

                        return (
                            <KanbanColumn
                                key={`${stageColumnId}-${filterKey}`}
                                stage={estagio}
                                stageColumnId={stageColumnId}
                                isOthersColumn={isOthers}
                                serverFilters={serverFilters}
                                accentColor={accentColor}
                                isDragging={isDragging}
                                activeDropColumn={activeDropColumn}
                                onDragOverColumn={handleDragOver}
                                onDropColumn={handleDrop}
                                onDragStartLead={handleDragStart}
                                onDragEndLead={handleDragEnd}
                                onLeadPointerDown={handleLeadPointerDown}
                                onLeadPointerMove={handleLeadPointerMove}
                                onLeadPointerUp={handleLeadPointerUp}
                                onLeadPointerCancel={clearLeadPointerSession}
                                openLeadDrawer={openLeadDrawer}
                                openLeadEdit={openLeadEdit}
                                stopActionPropagation={stopLeadCardActionPropagation}
                            />
                        );
                    })}
                </div>
            </div>
        );
    };

    // ---- List view ----
    const renderListView = () => (
        <div className="crm-list-shell">
            {listError ? (
                <EmptyState
                    title="Erro ao carregar leads"
                    description={listErrorMessage || "Revise as policies RLS."}
                />
            ) : (
                <Table
                    dataSource={listData}
                    rowKey="id"
                    size="middle"
                    loading={listQuery?.isLoading}
                    pagination={{
                        current: listPage,
                        pageSize: 12,
                        total: listTotal,
                        position: ["bottomCenter"],
                        showSizeChanger: false,
                    }}
                    onChange={(pagination) => {
                        setListPage(pagination.current || 1);
                    }}
                    columns={[
                        {
                            title: "Nome do Lead",
                            dataIndex: "nome",
                            render: (text) => <b style={{ color: "var(--crm-ink-900)" }}>{text}</b>,
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
                                <TemperatureBadge value={resolveLeadTemperature(record)} />
                            ),
                        },
                        {
                            title: "Responsável",
                            dataIndex: "responsavel",
                            render: (v) => v || "-",
                        },
                        {
                            title: "Valor",
                            dataIndex: "conta_energia_media",
                            render: (v) => formatCurrencyBRL(v, "R$ 0,00"),
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

    // ---- Main render ----
    return (
        <div className="crm-opportunities-page">
            <KommoHeader />
            <div
                style={{
                    flex: 1,
                    overflow: "hidden",
                    position: "relative",
                }}
            >
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
                        onChange={(e) => setNewStageName(e.target.value)}
                        onPressEnter={handleCreateStage}
                        style={{ flex: 1, minWidth: 240 }}
                    />
                    <input
                        type="color"
                        value={newStageColor}
                        onChange={(e) => setNewStageColor(e.target.value)}
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
                            onChange={(v) => setDeleteDestinationStage(v)}
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
