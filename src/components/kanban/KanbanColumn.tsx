import React, { useEffect, useMemo, useRef } from "react";
import { useInfiniteList, type CrudFilter, type CrudSort } from "@refinedev/core";
import { Spin, Typography } from "antd";
import { KANBAN_PAGE_SIZE } from "./types";
import type { KanbanLead, LeadNextTask, Stage } from "./types";
import { LeadCard } from "./LeadCard";
import { formatCurrencyBRL } from "../../lib/formatters";
import { textoIndicaGanho, textoIndicaPerda, valorDoLead } from "../../lib/pipelineMetrics";
import { ordenarPorTemperatura, proximaTarefaDaSaude, semProximoPasso } from "../../lib/saudeNegocio";

const { Text } = Typography;

/**
 * De onde a coluna lê os cards: a view de saúde (vw_negocios_saude, com
 * parado/próximo passo/ordem de temperatura calculados no banco) ou, em
 * ambiente sem a migration 15, a view clientes de sempre.
 */
export type FonteKanban = {
    resource: string;
    sorters?: CrudSort[];
    filtrosExtras?: CrudFilter[];
    /**
     * Sem a view, o servidor não sabe ordenar por temperatura: os cards
     * carregados são reordenados aqui (quente > morno > frio), mantendo a
     * ordem que veio do banco como desempate.
     */
    ordenarNoCliente?: boolean;
};

const FONTE_PADRAO: FonteKanban = { resource: "clientes", ordenarNoCliente: true };

export interface KanbanColumnProps {
    stage: Stage;
    stageColumnId: string;
    isOthersColumn?: boolean;
    serverFilters: CrudFilter[];
    accentColor: string;
    isDragging: boolean;
    activeDropColumn: string | null;
    onDragOverColumn: (e: React.DragEvent<HTMLDivElement>, stageId: string) => void;
    onDropColumn: (e: React.DragEvent<HTMLDivElement>, stageId: string) => void;
    onDragStartLead: (e: React.DragEvent<HTMLDivElement>, lead: KanbanLead) => void;
    onDragEndLead: (e: React.DragEvent<HTMLDivElement>) => void;
    onLeadPointerDown: (e: React.PointerEvent<HTMLDivElement>, leadId: string) => void;
    onLeadPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
    onLeadPointerUp: (e: React.PointerEvent<HTMLDivElement>, lead: KanbanLead) => void;
    onLeadPointerCancel: () => void;
    openLeadDrawer: (lead: KanbanLead) => void;
    openLeadEdit: (leadId: string | number) => void;
    stopActionPropagation: (e: React.SyntheticEvent<HTMLElement>) => void;
    /** Valor total da etapa calculado no banco (vw_kanban_kpis). */
    valorDaEtapa?: number;
    /** Usar o valor agregado (falso com busca por texto ativa). */
    usarValorAgregado?: boolean;
    tasksByLead?: Map<string, LeadNextTask>;
    stageMoveOptions?: { value: string; label: string }[];
    onMoveLeadToStage?: (lead: KanbanLead, stageId: string) => void;
    fonte?: FonteKanban;
    onAgendarLead?: (lead: KanbanLead) => void;
}

export const KanbanColumn: React.FC<KanbanColumnProps> = ({
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
    valorDaEtapa,
    usarValorAgregado = false,
    tasksByLead,
    stageMoveOptions,
    onMoveLeadToStage,
    fonte = FONTE_PADRAO,
    onAgendarLead,
}) => {
    const sentinelRef = useRef<HTMLDivElement | null>(null);

    const columnFilters = useMemo<CrudFilter[]>(() => {
        const base = [...serverFilters, ...(fonte.filtrosExtras ?? [])];
        if (isOthersColumn) {
            base.push({ field: "stage_id", operator: "null" as const, value: true });
        } else {
            base.push({ field: "stage_id", operator: "eq" as const, value: stageColumnId });
        }
        return base;
    }, [serverFilters, fonte.filtrosExtras, stageColumnId, isOthersColumn]);

    // Etapas de exemplo (ainda não gravadas, ids como "novo") não têm o que
    // consultar: stage_id é bigint e a requisição só devolveria erro.
    const consultaHabilitada = Boolean(isOthersColumn || stage.persisted);

    const { query: colQuery, result: colResult } = useInfiniteList<KanbanLead>({
        resource: fonte.resource,
        pagination: { currentPage: 1, pageSize: KANBAN_PAGE_SIZE },
        filters: columnFilters,
        sorters: fonte.sorters,
        liveMode: "auto",
        queryOptions: { enabled: consultaHabilitada },
    });

    const leads = useMemo(() => {
        const carregados = colResult.data?.pages.flatMap((p) => p.data) ?? [];
        return fonte.ordenarNoCliente ? ordenarPorTemperatura(carregados) : carregados;
    }, [colResult.data, fonte.ordenarNoCliente]);
    const total = colResult.data?.pages[0]?.total ?? 0;
    const isColLoading = consultaHabilitada && colQuery.isLoading;
    const isFetchingMore = colQuery.isFetchingNextPage;
    const temMais = Boolean(colResult.hasNextPage);
    const { fetchNextPage } = colQuery;

    // IntersectionObserver para rolagem infinita
    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting && temMais && !isFetchingMore) {
                    void fetchNextPage();
                }
            },
            { rootMargin: "200px" },
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [temMais, isFetchingMore, fetchNextPage]);

    // Valor da coluna: o agregado do banco quando disponível; senão a soma
    // dos cards carregados, marcada com "+" se ainda houver cards a carregar.
    const somaCarregados = useMemo(
        () => leads.reduce((acc, lead) => acc + valorDoLead(lead), 0),
        [leads],
    );
    const valorColuna = usarValorAgregado ? valorDaEtapa ?? 0 : somaCarregados;
    const valorParcial = !usarValorAgregado && temMais;

    const isDroppable = !isOthersColumn;
    const isDropActive = isDroppable && isDragging && activeDropColumn === stageColumnId;

    return (
        <div
            onDragOver={isDroppable ? (e) => onDragOverColumn(e, stageColumnId) : undefined}
            onDrop={isDroppable ? (e) => onDropColumn(e, stageColumnId) : undefined}
            className={`crm-kanban-column ${isDropActive ? "crm-kanban-column-drop-active" : ""}`}
            style={{ backgroundColor: isDropActive ? "rgba(37, 99, 235, 0.08)" : undefined }}
            aria-label={`Etapa ${stage.nome}`}
        >
            <div className="crm-kanban-column-head">
                <Text strong className="crm-kanban-column-title">{stage.nome}</Text>
                <div className="crm-kanban-column-stats">
                    <Text style={{ fontSize: 11, color: "var(--crm-ink-500)", fontWeight: 500 }}>
                        {total} {total === 1 ? "lead" : "leads"}
                    </Text>
                    <span style={{ color: "var(--crm-ink-300)" }}>·</span>
                    <Text style={{ fontSize: 11, color: "var(--crm-ink-500)", fontWeight: 500 }}>
                        {formatCurrencyBRL(valorColuna, "R$ 0,00")}
                        {valorParcial ? "+" : ""}
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
                ) : colQuery.isError ? (
                    <div className="crm-kanban-empty" role="alert">
                        Não foi possível carregar esta etapa.
                    </div>
                ) : leads.length === 0 ? (
                    <div className="crm-kanban-empty">
                        {isDropActive ? "Solte o lead aqui" : "Sem leads nesta etapa"}
                    </div>
                ) : (
                    <>
                        {leads.map((cliente) => {
                            // Próxima atividade: da view de saúde (mesma linha do card) ou,
                            // sem ela, da consulta de tarefas que o board já fazia.
                            const proxima = tasksByLead?.get(String(cliente.id)) ?? proximaTarefaDaSaude(cliente);
                            const etapaFinal =
                                Boolean(stage.ganho || stage.perdido) ||
                                textoIndicaGanho(cliente.status) ||
                                textoIndicaPerda(cliente.status);
                            return (
                                <LeadCard
                                    key={String(cliente.id)}
                                    lead={cliente}
                                    accentColor={accentColor}
                                    onPointerDown={onLeadPointerDown}
                                    onPointerMove={onLeadPointerMove}
                                    onPointerUp={onLeadPointerUp}
                                    onPointerCancel={onLeadPointerCancel}
                                    onDragStart={onDragStartLead}
                                    onDragEnd={onDragEndLead}
                                    onEdit={openLeadEdit}
                                    onView={openLeadDrawer}
                                    stopActionPropagation={stopActionPropagation}
                                    nextTask={proxima}
                                    stageMoveOptions={stageMoveOptions}
                                    onMoveToStage={onMoveLeadToStage}
                                    semProximoPasso={semProximoPasso(cliente, proxima, etapaFinal)}
                                    onAgendar={onAgendarLead}
                                />
                            );
                        })}
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
