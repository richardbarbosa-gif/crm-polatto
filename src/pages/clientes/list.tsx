import React, { useEffect, useMemo, useRef, useState } from "react";
import { useGo, useList, useUpdate, useCreate, type CrudFilter } from "@refinedev/core";

import { Drawer, Input, Modal, Select, Spin, Typography, message } from "antd";
import {
    DeleteOutlined,
    PlusOutlined,
} from "@ant-design/icons";
import { Button } from "../../components/ui";
import { TaskFormModal, type TaskContextData } from "../../components/modal/agenda";
import { useCrmAccess } from "../../hooks/useCrmAccess";
import { useRealtimeNegocios } from "../../hooks/useRealtimeNegocios";
import { normalizeText } from "../../lib/formatters";
import { buildKpiFilters, buildLeadFilters } from "../../lib/leadFilters";
import { buildLeadCountByStageId, buildStagesVisiveis, type KpiRow } from "../../lib/kanbanStages";
import {
    getSupabaseErrorMessage,
    isSupabaseMissingRelation,
    isSupabasePolicyRecursion,
} from "../../lib/supabaseErrors";
import { addLeadActivity } from "../../lib/leadTimeline";
import { type LeadTemperatureTag } from "../../lib/leadTemperature";
import { LeadDetails } from "./lead-details";
import { supabaseClient } from "../../utility";

import {
    KanbanHeader,
    KanbanBoard,
    ListView,
    type Stage,
    type LeadNextTask,
    type LeadPointerSession,
    DEFAULT_STAGE_BLUEPRINT,
    DRAG_ACTIVATION_DISTANCE,
    DRAG_ACTIVATION_DELAY_MS,
    SEARCH_DEBOUNCE_MS,
    getStatusAccent,
} from "../../components/kanban";

const { Text } = Typography;

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
        ownerCandidates,
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

    // ---- Pipelines (múltiplos funis por tenant) ----
    const { query: pipelinesQuery } = useList({
        resource: "pipelines",
        pagination: { mode: "off" },
        filters: [{ field: "ativo", operator: "eq", value: true }],
        sorters: [{ field: "ordem", order: "asc" }],
        queryOptions: { retry: false },
    });

    const pipelines = useMemo(() => {
        if (isSupabaseMissingRelation(pipelinesQuery?.error)) return [];
        return ((pipelinesQuery?.data?.data as any[]) || []).filter((p) => p?.id && p?.nome);
    }, [pipelinesQuery?.data?.data, pipelinesQuery?.error]);

    const pipelineStorageKey = `crm_pipeline_${tenantId || "default"}`;
    const [pipelineSelecionado, setPipelineSelecionado] = useState<string | undefined>(undefined);

    // Restaura a escolha do funil assim que o tenant é resolvido (o estado
    // inicial não pode ler a chave certa porque tenantId ainda é null no mount)
    useEffect(() => {
        const persistido = window.localStorage.getItem(pipelineStorageKey);
        if (persistido) setPipelineSelecionado(persistido);
    }, [pipelineStorageKey]);

    const pipelineAtivo = useMemo(() => {
        if (pipelines.length === 0) return undefined;
        const persistido = pipelines.find((p) => String(p.id) === pipelineSelecionado);
        return persistido ? String(persistido.id) : String(pipelines[0].id);
    }, [pipelines, pipelineSelecionado]);

    const handlePipelineChange = (pipelineId: string) => {
        setPipelineSelecionado(pipelineId);
        window.localStorage.setItem(pipelineStorageKey, pipelineId);
    };

    const pipelineOptions = useMemo(
        () => pipelines.map((p) => ({ value: String(p.id), label: String(p.nome) })),
        [pipelines],
    );

    // ---- Motivos de perda (configuráveis por tenant) ----
    const { query: motivosPerdaQuery } = useList({
        resource: "motivos_perda",
        pagination: { mode: "off" },
        filters: [{ field: "ativo", operator: "eq", value: true }],
        sorters: [{ field: "ordem", order: "asc" }],
        queryOptions: { retry: false },
    });

    const motivosPerda = useMemo(() => {
        if (isSupabaseMissingRelation(motivosPerdaQuery?.error)) return [];
        return ((motivosPerdaQuery?.data?.data as any[]) || []).filter((m) => m?.nome);
    }, [motivosPerdaQuery?.data?.data, motivosPerdaQuery?.error]);

    // ---- Próxima atividade por lead (visível no card, estilo Pipedrive) ----
    const [tasksByLead, setTasksByLead] = useState<Map<string, LeadNextTask>>(new Map());

    useEffect(() => {
        let active = true;

        const fetchNextTasks = async () => {
            try {
                const { data, error } = await supabaseClient
                    .from("tarefas")
                    .select("cliente_id,titulo,tipo,data_vencimento")
                    .eq("concluido", false)
                    .not("cliente_id", "is", null)
                    .order("data_vencimento", { ascending: true })
                    .limit(1000);

                if (!active || error || !data) return;

                const mapa = new Map<string, LeadNextTask>();
                (data as Array<LeadNextTask & { cliente_id?: string | number | null }>).forEach(
                    (tarefa) => {
                        const chave = String(tarefa.cliente_id ?? "");
                        if (!chave || mapa.has(chave)) return;
                        mapa.set(chave, {
                            titulo: tarefa.titulo,
                            tipo: tarefa.tipo,
                            data_vencimento: tarefa.data_vencimento,
                        });
                    },
                );
                setTasksByLead(mapa);
            } catch {
                // sem próxima atividade não pode quebrar o board
            }
        };

        void fetchNextTasks();
        const timer = window.setInterval(() => void fetchNextTasks(), 2 * 60 * 1000);
        return () => {
            active = false;
            window.clearInterval(timer);
        };
    }, []);

    const [pendingLossDrop, setPendingLossDrop] = useState<{
        lead: any;
        novoStageId: string;
    } | null>(null);
    const [motivoPerdaSelecionado, setMotivoPerdaSelecionado] = useState<string | undefined>(undefined);
    const [motivoPerdaLivre, setMotivoPerdaLivre] = useState("");
    const [isSavingLossDrop, setIsSavingLossDrop] = useState(false);

    // ---- Stages query ----
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
                pipeline_id: s.pipeline_id ?? null,
                probabilidade: s.probabilidade ?? null,
                ganho: Boolean(s.ganho),
                perdido: Boolean(s.perdido),
            }))
            .filter((s) => s.nome)
            // Com funil ativo: mostra as etapas dele + legadas sem funil
            .filter((s) => {
                if (!pipelineAtivo) return true;
                return s.pipeline_id == null || String(s.pipeline_id) === pipelineAtivo;
            })
            .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
        if (normalized.length > 0) return normalized;
        return DEFAULT_STAGE_BLUEPRINT.map((s) => ({ ...s, persisted: false }));
    }, [persistedStagesRaw, pipelineAtivo]);

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
    // A lógica de filtros vive em src/lib/leadFilters.ts para ser testável
    // fora do componente (ver src/lib/__tests__/leadFilters.test.ts).
    const serverFilters = useMemo<CrudFilter[]>(
        () =>
            buildLeadFilters({
                busca: debouncedSearch,
                responsavel: responsavelFiltro,
                temperatura: temperaturaFiltro,
                pipelineId: pipelineAtivo,
                canViewAllLeads,
                ownerCandidates,
            }),
        [debouncedSearch, responsavelFiltro, temperaturaFiltro, pipelineAtivo, canViewAllLeads, ownerCandidates],
    );

    const filterKey = useMemo(() => JSON.stringify(serverFilters), [serverFilters]);

    useEffect(() => {
        setListPage(1);
    }, [serverFilters]);

    // ---- KPI filters (subset aplicável à View materializada) ----
    const kpiFilters = useMemo<CrudFilter[]>(
        () =>
            buildKpiFilters({
                temperatura: temperaturaFiltro,
                pipelineId: pipelineAtivo,
                canViewAllLeads,
                ownerCandidates,
            }),
        [temperaturaFiltro, pipelineAtivo, canViewAllLeads, ownerCandidates],
    );

    // ---- KPI query (View agregada – dados já somados no banco) ----
    const { query: kpiQuery } = useList<KpiRow>({
        resource: "vw_kanban_kpis",
        pagination: { mode: "off" },
        filters: kpiFilters,
        liveMode: "auto",
    });

    const kpiRows: KpiRow[] = kpiQuery?.data?.data ?? [];
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
    // Agregado por stage_id (a view expõe a coluna). A agregação por NOME
    // somava etapas homônimas de funis diferentes e zerava a contagem quando
    // o status divergia do nome — e contagem zero faz o fluxo de exclusão
    // apagar a etapa sem mover os leads, deixando-os órfãos.
    const leadCountByStageId = useMemo(() => buildLeadCountByStageId(kpiRows), [kpiRows]);

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
    // A coluna "Outros" consulta stage_id IS NULL; a detecção usa exatamente
    // a mesma condição. Ver src/lib/kanbanStages.ts para os defeitos que a
    // detecção anterior (por texto do status) causava.
    const stagesVisiveis = useMemo(
        () => buildStagesVisiveis(stages, kpiRows),
        [stages, kpiRows],
    );

    // ---- Responsáveis disponíveis (Lendo da tabela oficial de funcionários) ----
    useEffect(() => {
        if (isLoadingAccess) return;
        const fetchResponsaveis = async () => {
            let query = supabaseClient
                .from("funcionarios")
                .select("nome")
                .eq("ativo", true) // Pega apenas os vendedores ativos
                .not("nome", "is", null);

            // Se for um vendedor comum (Sem Modo Deus), ele só vê a si mesmo no filtro
            if (!canViewAllLeads && ownerCandidates.length > 0) {
                query = query.in("nome", ownerCandidates);
            }

            const { data } = await query.limit(1000);
            
            const unique = [
                ...new Set((data || []).map((d: any) => d.nome as string).filter(Boolean)),
            ].sort((a, b) => a.localeCompare(b));
            
            setResponsaveisDisponiveis(unique);
        };
        fetchResponsaveis();
    }, [canViewAllLeads, ownerCandidates, isLoadingAccess]);
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

    // ---- Realtime ----
    // Toast do lead novo pela tabela legada (enquanto "clientes" for tabela).
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

    // Depois da virada, "clientes" é uma view e o Supabase não emite evento
    // para views — o liveMode do Refine pararia de atualizar a tela sozinho.
    // Este hook escuta a tabela real e revalida os recursos da página.
    useRealtimeNegocios(["clientes", "vw_kanban_kpis"], (registro) => {
        const titulo = registro?.titulo ?? registro?.nome;
        message.info(`Novo lead recebido: ${typeof titulo === "string" ? titulo : "Sem nome"}`);
    });

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
                    ...(pipelineAtivo ? { pipeline_id: pipelineAtivo } : {}),
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

    const moverLeadParaStage = async (
        leadArrastado: any,
        novoStageId: string,
        motivoPerda?: string,
    ) => {
        const leadId = String(leadArrastado.id);
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
                    // Carimba o funil da etapa destino: sem isto o lead ficaria
                    // sem pipeline_id e sumiria do filtro por funil.
                    ...(nextStage?.pipeline_id || pipelineAtivo
                        ? { pipeline_id: nextStage?.pipeline_id || pipelineAtivo }
                        : {}),
                    ...(motivoPerda ? { motivo_perda: motivoPerda } : {}),
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
                    description: motivoPerda
                        ? `${fromStageName} -> ${nextStageName} (motivo: ${motivoPerda})`
                        : `${fromStageName} -> ${nextStageName}`,
                    fromStatus: fromStageName,
                    toStatus: nextStageName,
                    author: ownerDisplayName,
                });
            }
        } catch {
            // Error notification is handled by refine.
        }
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

        const currentStageId = resolveLeadStageId(leadArrastado);
        if (currentStageId === novoStageId) return;

        // Etapa de perda: pede o motivo antes de mover (configurável por tenant)
        const nextStage = stageById.get(novoStageId);
        const isPerdido =
            Boolean(nextStage?.perdido) ||
            normalizeText(nextStage?.nome).includes("perdido");

        if (isPerdido) {
            setMotivoPerdaSelecionado(undefined);
            setMotivoPerdaLivre("");
            setPendingLossDrop({ lead: leadArrastado, novoStageId });
            return;
        }

        await moverLeadParaStage(leadArrastado, novoStageId);
    };

    const cancelarMotivoPerda = () => {
        setPendingLossDrop(null);
        setMotivoPerdaSelecionado(undefined);
        setMotivoPerdaLivre("");
    };

    const confirmarMotivoPerda = async () => {
        if (!pendingLossDrop) return;
        const motivo =
            motivoPerdaSelecionado === "__outro__" || motivosPerda.length === 0
                ? motivoPerdaLivre.trim()
                : motivoPerdaSelecionado;

        if (!motivo) {
            message.warning("Informe o motivo da perda.");
            return;
        }

        setIsSavingLossDrop(true);
        try {
            await moverLeadParaStage(pendingLossDrop.lead, pendingLossDrop.novoStageId, motivo);
            cancelarMotivoPerda();
        } finally {
            setIsSavingLossDrop(false);
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

    // ---- Main render ----
    return (
        <div className="crm-opportunities-page">
            <KanbanHeader
                viewType={viewType}
                onViewTypeChange={setViewType}
                searchText={searchText}
                onSearchChange={setSearchText}
                responsavelFiltro={responsavelFiltro}
                onResponsavelChange={setResponsavelFiltro}
                responsaveisDisponiveis={responsaveisDisponiveis}
                temperaturaFiltro={temperaturaFiltro}
                onTemperaturaChange={setTemperaturaFiltro}
                canDeleteRecords={canDeleteRecords}
                canViewAllLeads={canViewAllLeads}
                ownerDisplayName={ownerDisplayName}
                onOpenStageManager={openStageManager}
                kpis={kpis}
                pipelineOptions={pipelineOptions}
                pipelineSelecionado={pipelineAtivo}
                onPipelineChange={handlePipelineChange}
            />
            <div
                style={{
                    flex: 1,
                    overflow: "hidden",
                    position: "relative",
                }}
            >
                {viewType === "kanban" ? (
                    <KanbanBoard
                        stagesVisiveis={stagesVisiveis}
                        serverFilters={serverFilters}
                        filterKey={filterKey}
                        isDragging={isDragging}
                        isBoardPanning={isBoardPanning}
                        activeDropColumn={activeDropColumn}
                        boardRef={boardRef}
                        onBoardMouseDown={handleBoardMouseDown}
                        onBoardMouseMove={handleBoardMouseMove}
                        onBoardMouseUp={stopBoardPan}
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
                        kpiError={kpiError}
                        hasKpiPolicyRecursion={hasKpiPolicyRecursion}
                        kpiErrorMessage={kpiErrorMessage}
                        totalLeads={kpis.totalLeads}
                        isKpiLoading={kpiQuery?.isLoading}
                        tasksByLead={tasksByLead}
                    />
                ) : (
                    <ListView
                        listData={listData}
                        listTotal={listTotal}
                        listPage={listPage}
                        isLoading={listQuery?.isLoading}
                        listError={listError}
                        listErrorMessage={listErrorMessage}
                        onPageChange={setListPage}
                        resolveLeadStageName={resolveLeadStageName}
                        onView={openLeadDrawer}
                        onEdit={openLeadEdit}
                        canDeleteRecords={canDeleteRecords}
                        stages={stages}
                        onRefresh={async () => {
                            await listQuery?.refetch?.();
                            await kpiQuery?.refetch?.();
                        }}
                    />
                )}
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

            <Modal
                title="Motivo da perda"
                open={Boolean(pendingLossDrop)}
                onCancel={cancelarMotivoPerda}
                onOk={confirmarMotivoPerda}
                okText="Confirmar perda"
                okButtonProps={{ danger: true, loading: isSavingLossDrop }}
                cancelButtonProps={{ disabled: isSavingLossDrop }}
                destroyOnClose
            >
                <Text style={{ display: "block", marginBottom: 12 }}>
                    Por que o negócio{" "}
                    <Text strong>{pendingLossDrop?.lead?.nome || pendingLossDrop?.lead?.titulo || ""}</Text>{" "}
                    foi perdido?
                </Text>
                {motivosPerda.length > 0 ? (
                    <Select
                        value={motivoPerdaSelecionado}
                        onChange={(value) => setMotivoPerdaSelecionado(value)}
                        placeholder="Selecione o motivo"
                        style={{ width: "100%", marginBottom: 10 }}
                        options={[
                            ...motivosPerda.map((m: any) => ({
                                value: String(m.nome),
                                label: String(m.nome),
                            })),
                            { value: "__outro__", label: "Outro motivo..." },
                        ]}
                    />
                ) : null}
                {motivoPerdaSelecionado === "__outro__" || motivosPerda.length === 0 ? (
                    <Input.TextArea
                        value={motivoPerdaLivre}
                        onChange={(e) => setMotivoPerdaLivre(e.target.value)}
                        placeholder="Descreva o motivo da perda"
                        rows={3}
                    />
                ) : null}
            </Modal>
        </div>
    );
};
