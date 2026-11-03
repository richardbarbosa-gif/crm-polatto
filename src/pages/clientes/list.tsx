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
import { formatPercentBR, normalizeText } from "../../lib/formatters";
import { buildKpiFilters, buildLeadFilters } from "../../lib/leadFilters";
import { buildLeadCountByStageId, buildStagesVisiveis, type KpiRow } from "../../lib/kanbanStages";
import {
    getSupabaseErrorMessage,
    isSupabaseMissingRelation,
    isSupabasePolicyRecursion,
} from "../../lib/supabaseErrors";
import { registrarMudancaDeEtapa } from "../../lib/leadTimeline";
import { type LeadTemperatureTag } from "../../lib/leadTemperature";
import {
    resumirFunil,
    textoIndicaGanho,
    textoIndicaPerda,
    totaisPorEtapa,
} from "../../lib/pipelineMetrics";
import { LeadDetails, type LeadDetalhe } from "./lead-details";
import type { MotivoPerdaRecord, PipelineRecord } from "../../types/db";
import { supabaseClient } from "../../utility";

import {
    KanbanHeader,
    KanbanBoard,
    ListView,
    type Stage,
    type KanbanLead,
    type LeadNextTask,
    type LeadPointerSession,
    DEFAULT_STAGE_BLUEPRINT,
    DRAG_ACTIVATION_DISTANCE,
    DRAG_ACTIVATION_DELAY_MS,
    SEARCH_DEBOUNCE_MS,
    getStatusAccent,
} from "../../components/kanban";

const { Text } = Typography;

/** Linha de pipeline_stages como vem do banco (com aliases de bases antigas). */
type EtapaBruta = {
    id: string | number;
    nome?: string | null;
    name?: string | null;
    cor?: string | null;
    color?: string | null;
    ordem?: number | null;
    order?: number | null;
    sort_order?: number | null;
    pipeline_id?: string | null;
    probabilidade?: number | null;
    ganho?: boolean | null;
    perdido?: boolean | null;
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
        ownerCandidates,
        ownerDisplayName,
    } = useCrmAccess();

    // ---- UI state ----
    const [viewType, setViewType] = useState<"kanban" | "list">("kanban");
    const [searchText, setSearchText] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [responsavelFiltro, setResponsavelFiltro] = useState<string | undefined>(undefined);
    const [temperaturaFiltro, setTemperaturaFiltro] = useState<"todas" | LeadTemperatureTag>("todas");
    const [draggedLead, setDraggedLead] = useState<KanbanLead | null>(null);
    const [activeDropColumn, setActiveDropColumn] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isLeadDrawerOpen, setIsLeadDrawerOpen] = useState(false);
    const [selectedLeadId, setSelectedLeadId] = useState<string | number | null>(null);
    const [selectedLead, setSelectedLead] = useState<LeadDetalhe | null>(null);
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
    const { query: pipelinesQuery } = useList<PipelineRecord>({
        resource: "pipelines",
        pagination: { mode: "off" },
        filters: [{ field: "ativo", operator: "eq", value: true }],
        sorters: [{ field: "ordem", order: "asc" }],
        queryOptions: { retry: false },
    });

    const pipelines = useMemo(() => {
        if (isSupabaseMissingRelation(pipelinesQuery?.error)) return [];
        return (pipelinesQuery?.data?.data ?? []).filter((p) => p?.id && p?.nome);
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
    const { query: motivosPerdaQuery } = useList<MotivoPerdaRecord>({
        resource: "motivos_perda",
        pagination: { mode: "off" },
        filters: [{ field: "ativo", operator: "eq", value: true }],
        sorters: [{ field: "ordem", order: "asc" }],
        queryOptions: { retry: false },
    });

    const motivosPerda = useMemo(() => {
        if (isSupabaseMissingRelation(motivosPerdaQuery?.error)) return [];
        return (motivosPerdaQuery?.data?.data ?? []).filter((m) => m?.nome);
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
        lead: KanbanLead;
        novoStageId: string;
    } | null>(null);
    const [motivoPerdaSelecionado, setMotivoPerdaSelecionado] = useState<string | undefined>(undefined);
    const [motivoPerdaLivre, setMotivoPerdaLivre] = useState("");
    const [isSavingLossDrop, setIsSavingLossDrop] = useState(false);

    // ---- Stages query ----
    const { query: stagesQuery } = useList<EtapaBruta>({
        resource: "pipeline_stages",
        pagination: { mode: "off" },
        sorters: [{ field: "ordem", order: "asc" }],
        liveMode: "auto",
    });

    const persistedStagesRaw = useMemo(() => {
        return (stagesQuery?.data?.data ?? []).filter((s) => s !== null);
    }, [stagesQuery?.data?.data]);

    const stages = useMemo(() => {
        const normalized = persistedStagesRaw
            .map((s) => ({
                id: s.id,
                nome: s.nome ?? s.name ?? "",
                cor: s.cor ?? s.color ?? undefined,
                ordem: s.ordem ?? s.order ?? s.sort_order ?? undefined,
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

    // Etapas oferecidas na ação "Mover" do card — alternativa ao arraste,
    // que usa drag HTML5 e não dispara em tela de toque.
    const stageMoveOptions = useMemo(
        () => stages.map((s) => ({ value: String(s.id ?? s.nome), label: s.nome })),
        [stages],
    );

    // Etapas gravadas do funil ativo: um negócio pertence ao funil se tiver
    // pipeline_id = funil OU estiver numa destas etapas (ver filtroDeFunil).
    const etapasDoFunil = useMemo(
        () => stages.filter((s) => s.persisted && s.id != null).map((s) => String(s.id)),
        [stages],
    );

    const resolveLeadStageId = (cliente: KanbanLead): string => {
        const rawStageId = cliente?.stage_id ?? cliente?.stageId;
        if (rawStageId !== undefined && rawStageId !== null && String(rawStageId).trim()) {
            return String(rawStageId);
        }
        const normalizedStatus = normalizeText(cliente?.status);
        if (!normalizedStatus) return "";
        return stageIdByName.get(normalizedStatus) || "";
    };

    const resolveLeadStageName = (cliente: KanbanLead): string => {
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
        // A coluna sintética "Outros" (id "outros") só existe em stagesVisiveis;
        // uma etapa real chamada "Outros" precisa continuar gerenciável.
        () => stages.filter((s) => s.id !== "outros"),
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
                etapasDoFunil,
                canViewAllLeads,
                ownerCandidates,
            }),
        [debouncedSearch, responsavelFiltro, temperaturaFiltro, pipelineAtivo, etapasDoFunil, canViewAllLeads, ownerCandidates],
    );

    const filterKey = useMemo(() => JSON.stringify(serverFilters), [serverFilters]);

    useEffect(() => {
        setListPage(1);
    }, [serverFilters]);

    // ---- KPI filters (todos os filtros do board, exceto a busca por texto) ----
    const kpiFilters = useMemo<CrudFilter[]>(
        () =>
            buildKpiFilters({
                responsavel: responsavelFiltro,
                temperatura: temperaturaFiltro,
                pipelineId: pipelineAtivo,
                etapasDoFunil,
                canViewAllLeads,
                ownerCandidates,
            }),
        [responsavelFiltro, temperaturaFiltro, pipelineAtivo, etapasDoFunil, canViewAllLeads, ownerCandidates],
    );

    // ---- KPI query (View agregada – dados já somados no banco) ----
    const { query: kpiQuery } = useList<KpiRow>({
        resource: "vw_kanban_kpis",
        pagination: { mode: "off" },
        filters: kpiFilters,
        liveMode: "auto",
    });

    const kpiRows = useMemo<KpiRow[]>(() => kpiQuery?.data?.data ?? [], [kpiQuery?.data?.data]);
    const kpiError = kpiQuery?.error ?? null;
    const hasKpiPolicyRecursion = isSupabasePolicyRecursion(kpiError);
    const kpiErrorMessage = getSupabaseErrorMessage(kpiError);

    // ---- KPIs ----
    // Ganho/perdido pelos flags da etapa (resumirFunil), não pelo texto do
    // status: etapa "Contrato assinado" marcada como ganho não entrava na
    // conversão porque o nome não continha "fechado".
    const kpis = useMemo(() => {
        const resumo = resumirFunil(kpiRows, persistedStagesRaw);
        return {
            totalLeads: resumo.totalLeads,
            totalValor: resumo.valorTotal,
            taxaConversao: formatPercentBR(resumo.conversao),
        };
    }, [kpiRows, persistedStagesRaw]);

    // Total e valor de cada coluna vêm da view agregada. Somar os cards
    // carregados (20 por vez, rolagem infinita) dava um total errado assim
    // que a coluna passava de 20 negócios. A busca por texto não chega à
    // view; com busca ativa a coluna soma o que carregou.
    const valoresPorEtapa = useMemo(
        () => (debouncedSearch.trim() ? undefined : totaisPorEtapa(kpiRows)),
        [debouncedSearch, kpiRows],
    );

    // ---- leadCountByStageId (para o gerenciador de colunas) ----
    // Agregado por stage_id (a view expõe a coluna). A agregação por NOME
    // somava etapas homônimas de funis diferentes e zerava a contagem quando
    // o status divergia do nome — e contagem zero faz o fluxo de exclusão
    // apagar a etapa sem mover os leads, deixando-os órfãos.
    const leadCountByStageId = useMemo(() => buildLeadCountByStageId(kpiRows), [kpiRows]);

    // Contagem da etapa a excluir direto no banco, sem os filtros do board:
    // a contagem dos KPIs respeita responsável/temperatura/funil e podia dar
    // zero com negócios na etapa — a etapa era apagada sem mover ninguém.
    const [leadsNaEtapaPendente, setLeadsNaEtapaPendente] = useState<number | null>(null);
    const leadsInPendingDeleteStage = useMemo(() => {
        if (!stagePendingDelete) return 0;
        if (leadsNaEtapaPendente !== null) return leadsNaEtapaPendente;
        return leadCountByStageId[String(stagePendingDelete.id ?? "")] || 0;
    }, [leadCountByStageId, leadsNaEtapaPendente, stagePendingDelete]);

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
                .eq("ativo", true) // apenas vendedores ativos
                .is("deleted_at", null)
                .not("nome", "is", null);

            // Se for um vendedor comum (Sem Modo Deus), ele só vê a si mesmo no filtro
            if (!canViewAllLeads && ownerCandidates.length > 0) {
                query = query.in("nome", ownerCandidates);
            }

            const { data } = await query.limit(1000);
            
            const unique = [
                ...new Set(((data ?? []) as Array<{ nome?: string | null }>).map((d) => d.nome ?? "").filter(Boolean)),
            ].sort((a, b) => a.localeCompare(b));
            
            setResponsaveisDisponiveis(unique);
        };
        fetchResponsaveis();
    }, [canViewAllLeads, ownerCandidates, isLoadingAccess]);
    // ---- List view query (paginação server-side) ----
    const { query: listQuery } = useList<KanbanLead>({
        resource: "clientes",
        pagination: { currentPage: listPage, pageSize: 12 },
        filters: serverFilters,
        liveMode: "auto",
        queryOptions: { enabled: viewType === "list" },
    });

    const listData = listQuery?.data?.data ?? [];
    const listTotal = listQuery?.data?.total ?? 0;
    const listError = listQuery?.error ?? null;
    const listErrorMessage = getSupabaseErrorMessage(listError);

    // ---- Selected lead (fetch direto para o drawer) ----
    useEffect(() => {
        if (selectedLeadId == null) {
            setSelectedLead(null);
            return;
        }
        // Cliques rápidos em cards diferentes: a resposta antiga não pode
        // sobrescrever o lead aberto agora.
        let ativo = true;
        setSelectedLead(null);
        void supabaseClient
            .from("clientes")
            .select("*")
            .eq("id", selectedLeadId)
            .maybeSingle()
            .then(({ data, error }) => {
                if (!ativo) return;
                if (error) {
                    message.error("Não foi possível abrir o lead.");
                    return;
                }
                setSelectedLead((data as Record<string, unknown> | null) ?? null);
            });
        return () => {
            ativo = false;
        };
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
        const existingRows = (refreshed?.data?.data ?? persistedStagesRaw).filter(
            (s) => s !== null && s !== undefined,
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
        } catch (error: unknown) {
            message.error((error as { message?: string })?.message || "Não foi possível criar a coluna.");
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
        setLeadsNaEtapaPendente(null);
        const defaultDestinationRaw = manageableStages.find((item) => item.nome !== stage.nome)?.id;
        const defaultDestination =
            defaultDestinationRaw == null ? undefined : String(defaultDestinationRaw);
        setDeleteDestinationStage(defaultDestination);

        if (stage.id != null) {
            void supabaseClient
                .from("clientes")
                .select("id", { count: "exact", head: true })
                .eq("stage_id", String(stage.id))
                .then(({ count, error }) => {
                    if (!error && typeof count === "number") setLeadsNaEtapaPendente(count);
                });
        }
    };

    const cancelDeleteStage = () => {
        setStagePendingDelete(null);
        setDeleteDestinationStage(undefined);
        setLeadsNaEtapaPendente(null);
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
            // Move sempre que houver destino: não depende de a contagem estar
            // certa (mover zero negócios é inofensivo; apagar a etapa com
            // negócios dentro os deixaria sem etapa).
            if (deleteDestinationStage && deleteDestinationStage !== String(stagePendingDelete.id)) {
                const destinationStage = stageById.get(deleteDestinationStage);
                const { error: moveError } = await supabaseClient
                    .from("clientes")
                    .update({
                        tenant_id: tenantId || undefined,
                        stage_id: deleteDestinationStage,
                        status: destinationStage?.nome || undefined,
                        ...(destinationStage?.pipeline_id
                            ? { pipeline_id: destinationStage.pipeline_id }
                            : {}),
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

    const handleLeadPointerUp = (event: React.PointerEvent<HTMLDivElement>, lead: KanbanLead) => {
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

    const handleDragStart = (event: React.DragEvent<HTMLDivElement>, lead: KanbanLead) => {
        const id = String(lead.id);
        const activeSession = leadPointerSessionRef.current;
        if (activeSession && activeSession.leadId === id) {
            activeSession.hasDragged = true;
            if (activeSession.timerId !== null) {
                window.clearTimeout(activeSession.timerId);
                activeSession.timerId = null;
            }
        }
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
        leadArrastado: KanbanLead,
        novoStageId: string,
        motivoPerda?: string,
    ) => {
        const leadId = String(leadArrastado.id);
        const nextStage = stageById.get(novoStageId);
        const nextStageName = nextStage?.nome || "Sem etapa";
        const fromStageName = resolveLeadStageName(leadArrastado);
        // Flags da etapa primeiro; o nome é só o fallback (etapa "Contrato
        // assinado" marcada como ganho também fecha o negócio).
        const isGanho = Boolean(nextStage?.ganho) || textoIndicaGanho(nextStageName);
        const isPerda = Boolean(nextStage?.perdido) || textoIndicaPerda(nextStageName);
        const isTerminal = isGanho || isPerda;

        try {
            await updateLead({
                resource: "clientes",
                id: leadId,
                values: {
                    tenant_id: tenantId || undefined,
                    stage_id: novoStageId,
                    status: nextStage?.nome || undefined,
                    data_fechamento: isTerminal ? new Date().toISOString() : null,
                    // Carimba o funil da etapa destino: sem isto o lead ficaria
                    // sem pipeline_id e sumiria do filtro por funil.
                    ...(nextStage?.pipeline_id || pipelineAtivo
                        ? { pipeline_id: nextStage?.pipeline_id || pipelineAtivo }
                        : {}),
                    // Reaberto (saiu de "perdido"): o motivo antigo deixa de valer.
                    motivo_perda: isPerda ? motivoPerda ?? leadArrastado.motivo_perda ?? null : null,
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

            const historicoGravado = await registrarMudancaDeEtapa({
                leadId: leadArrastado.id,
                tenantId,
                de: fromStageName,
                para: nextStageName,
                motivoPerda,
                autor: ownerDisplayName,
            });
            if (!historicoGravado) {
                message.warning("Etapa atualizada, mas não foi possível registrar no histórico.");
            }
        } catch {
            // A notificação de erro da mudança de etapa é exibida pelo Refine.
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

        await solicitarMoverLead(leadArrastado, novoStageId);
    };

    /**
     * Ponto único de decisão para mover um lead de etapa — usado tanto pelo
     * arraste (desktop) quanto pela ação "Mover" do card (toque/celular).
     * Etapa de perda exige motivo antes de concluir.
     */
    const solicitarMoverLead = async (lead: KanbanLead, novoStageId: string) => {
        if (!lead) return;

        const currentStageId = resolveLeadStageId(lead);
        if (currentStageId === novoStageId) return;

        const nextStage = stageById.get(novoStageId);
        const isPerdido = Boolean(nextStage?.perdido) || textoIndicaPerda(nextStage?.nome);

        if (isPerdido) {
            setMotivoPerdaSelecionado(undefined);
            setMotivoPerdaLivre("");
            setPendingLossDrop({ lead, novoStageId });
            return;
        }

        await moverLeadParaStage(lead, novoStageId);
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
    const openLeadDrawer = (lead: KanbanLead) => {
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
                        valoresPorEtapa={valoresPorEtapa}
                        tasksByLead={tasksByLead}
                        stageMoveOptions={stageMoveOptions}
                        onMoveLeadToStage={solicitarMoverLead}
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
                            ...motivosPerda.map((m) => ({
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
