import React from "react";
import type { CrudFilter } from "@refinedev/core";
import { EmptyState } from "../ui";
import { getStatusAccent } from "./types";
import type { LeadNextTask, Stage } from "./types";
import { KanbanColumn } from "./KanbanColumn";

export interface KanbanBoardProps {
    stagesVisiveis: Stage[];
    serverFilters: CrudFilter[];
    filterKey: string;
    isDragging: boolean;
    isBoardPanning: boolean;
    activeDropColumn: string | null;
    boardRef: React.RefObject<HTMLDivElement | null>;
    onBoardMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
    onBoardMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void;
    onBoardMouseUp: () => void;
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
    kpiError: any;
    hasKpiPolicyRecursion: boolean;
    kpiErrorMessage: string | null;
    totalLeads: number;
    isKpiLoading: boolean;
    tasksByLead?: Map<string, LeadNextTask>;
}

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
    stagesVisiveis,
    serverFilters,
    filterKey,
    isDragging,
    isBoardPanning,
    activeDropColumn,
    boardRef,
    onBoardMouseDown,
    onBoardMouseMove,
    onBoardMouseUp,
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
    kpiError,
    tasksByLead,
    hasKpiPolicyRecursion,
    kpiErrorMessage,
    totalLeads,
    isKpiLoading,
}) => {
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

    if (!isKpiLoading && totalLeads === 0) {
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
            {/* 🔥 MÁGICA 2: A classe 'is-dragging-board' é adicionada quando você segura num card */}
            <div
                ref={boardRef}
                className={`crm-kanban-scroll crm-kanban-board ${isDragging ? "is-dragging-board" : ""}`}
                onMouseDown={onBoardMouseDown}
                onMouseMove={onBoardMouseMove}
                onMouseUp={onBoardMouseUp}
                onMouseLeave={onBoardMouseUp}
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
                            onDragOverColumn={onDragOverColumn}
                            onDropColumn={onDropColumn}
                            onDragStartLead={onDragStartLead}
                            onDragEndLead={onDragEndLead}
                            onLeadPointerDown={onLeadPointerDown}
                            onLeadPointerMove={onLeadPointerMove}
                            onLeadPointerUp={onLeadPointerUp}
                            onLeadPointerCancel={onLeadPointerCancel}
                            openLeadDrawer={openLeadDrawer}
                            openLeadEdit={openLeadEdit}
                            stopActionPropagation={stopActionPropagation}
                            tasksByLead={tasksByLead}
                        />
                    );
                })}
            </div>
        </div>
    );
};