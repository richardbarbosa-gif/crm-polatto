import React, { useEffect, useMemo, useRef } from "react";
import { useInfiniteList, type CrudFilter } from "@refinedev/core";
import { Spin, Typography } from "antd";
import { KANBAN_PAGE_SIZE } from "./types";
import type { LeadNextTask, Stage } from "./types";
import { LeadCard } from "./LeadCard";
import { formatCurrencyBRL } from "../../lib/formatters";

const { Text } = Typography;

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
    onDragStartLead: (e: React.DragEvent<HTMLDivElement>, lead: any) => void;
    onDragEndLead: (e: React.DragEvent<HTMLDivElement>) => void;
    onLeadPointerDown: (e: React.PointerEvent<HTMLDivElement>, leadId: string) => void;
    onLeadPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
    onLeadPointerUp: (e: React.PointerEvent<HTMLDivElement>, lead: any) => void;
    onLeadPointerCancel: () => void;
    openLeadDrawer: (lead: any) => void;
    openLeadEdit: (leadId: string | number) => void;
    stopActionPropagation: (e: React.SyntheticEvent<HTMLElement>) => void;
    tasksByLead?: Map<string, LeadNextTask>;
    stageMoveOptions?: { value: string; label: string }[];
    onMoveLeadToStage?: (lead: any, stageId: string) => void;
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
    tasksByLead,
    stageMoveOptions,
    onMoveLeadToStage,
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

    // IntersectionObserver para infinite scroll automatico
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
                            <LeadCard
                                key={cliente.id}
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
                                nextTask={tasksByLead?.get(String(cliente.id))}
                                stageMoveOptions={stageMoveOptions}
                                onMoveToStage={onMoveLeadToStage}
                            />
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
