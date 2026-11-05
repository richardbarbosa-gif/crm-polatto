import React from "react";
import type { CrudFilter } from "@refinedev/core";
import { EmptyState } from "../ui";
import { getStatusAccent } from "./types";
import type { KanbanLead, LeadNextTask, Stage } from "./types";
import { KanbanColumn, type FonteKanban } from "./KanbanColumn";

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
    onDragStartLead: (e: React.DragEvent<HTMLDivElement>, lead: KanbanLead) => void;
    onDragEndLead: (e: React.DragEvent<HTMLDivElement>) => void;
    onLeadPointerDown: (e: React.PointerEvent<HTMLDivElement>, leadId: string) => void;
    onLeadPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
    onLeadPointerUp: (e: React.PointerEvent<HTMLDivElement>, lead: KanbanLead) => void;
    onLeadPointerCancel: () => void;
    openLeadDrawer: (lead: KanbanLead) => void;
    openLeadEdit: (leadId: string | number) => void;
    stopActionPropagation: (e: React.SyntheticEvent<HTMLElement>) => void;
    kpiError: unknown;
    hasKpiPolicyRecursion: boolean;
    kpiErrorMessage: string | null;
    /** Total e valor por etapa vindos da view agregada (undefined com busca ativa). */
    valoresPorEtapa?: Map<string, { total: number; valor: number }>;
    tasksByLead?: Map<string, LeadNextTask>;
    stageMoveOptions?: { value: string; label: string }[];
    onMoveLeadToStage?: (lead: KanbanLead, stageId: string) => void;
    fonte?: FonteKanban;
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
    valoresPorEtapa,
    tasksByLead,
    stageMoveOptions,
    onMoveLeadToStage,
    fonte,
    hasKpiPolicyRecursion,
    kpiErrorMessage,
}) => {
    if (kpiError) {
        return (
            <div style={{ padding: 20 }}>
                <EmptyState
                    title={
                        hasKpiPolicyRecursion
                            ? "Falha de permissão no banco de dados"
                            : "Não foi possível carregar os leads"
                    }
                    description={
                        hasKpiPolicyRecursion
                            ? "Uma regra de acesso (RLS) do banco entrou em recursão. Avise o administrador."
                            : kpiErrorMessage || "Tente recarregar a página."
                    }
                />
            </div>
        );
    }

    // As colunas aparecem mesmo sem nenhum negócio: antes o board inteiro
    // era trocado por "Nenhum lead para os filtros aplicados", e uma empresa
    // recém-criada não via nem as etapas do próprio funil.
    return (
        <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }}>
            {/* A classe 'is-dragging-board' é aplicada enquanto um card é arrastado */}
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
                    const isOthers = estagio.id === "outros";
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
                            valorDaEtapa={valoresPorEtapa?.get(isOthers ? "outros" : stageColumnId)?.valor}
                            usarValorAgregado={Boolean(valoresPorEtapa)}
                            tasksByLead={tasksByLead}
                            stageMoveOptions={stageMoveOptions}
                            onMoveLeadToStage={onMoveLeadToStage}
                            fonte={fonte}
                        />
                    );
                })}
            </div>
        </div>
    );
};
