import type { Stage } from "../components/kanban/types";

/**
 * Linha da view agregada vw_kanban_kpis.
 * `stage_id` passou a ser exposto pela view — antes o Kanban precisava
 * adivinhar a etapa pelo TEXTO do status, o que gerava divergências.
 */
export type KpiRow = {
    status?: string | null;
    stage_id?: string | number | null;
    pipeline_id?: string | null;
    total_leads?: number | string | null;
};

const contagem = (row: KpiRow): number => Number(row.total_leads ?? 0) || 0;

const chaveEtapa = (valor: unknown): string =>
    valor === null || valor === undefined ? "" : String(valor);

/**
 * Existe lead sem etapa definida?
 *
 * Esta é EXATAMENTE a condição que a coluna "Outros" consulta no banco
 * (`stage_id IS NULL`, ver KanbanColumn). Manter as duas definições
 * idênticas é o que impede os dois defeitos que existiam quando a
 * detecção era feita pelo texto do status:
 *
 *  - lead com stage_id nulo cujo status casava com o nome de uma etapa
 *    não acionava a coluna "Outros" e também não aparecia em nenhuma
 *    coluna de etapa (que filtram por stage_id): sumia do board;
 *  - lead de outro funil acionava "Outros", mas a coluna consultava
 *    stage_id nulo e vinha vazia: coluna fantasma.
 */
export const temLeadsSemEtapa = (kpiRows: KpiRow[]): boolean =>
    kpiRows.some((row) => row.stage_id === null || row.stage_id === undefined
        ? contagem(row) > 0
        : false);

/**
 * Colunas exibidas no board: as etapas do funil ativo, mais a coluna
 * "Outros" apenas quando existir lead realmente sem etapa.
 */
export const buildStagesVisiveis = (stages: Stage[], kpiRows: KpiRow[]): Stage[] => {
    if (!temLeadsSemEtapa(kpiRows)) {
        return stages;
    }
    return [...stages, { id: "outros", nome: "Outros", cor: "#94a3b8" }];
};

/**
 * Total de leads por etapa, agregado por `stage_id`.
 *
 * A agregação por NOME somava etapas homônimas de funis diferentes e
 * retornava zero quando o texto do status divergia do nome da etapa. Esse
 * zero é perigoso: o fluxo de exclusão de coluna usa esta contagem para
 * decidir se precisa mover os leads antes de apagar a etapa — contagem
 * errada apagava a etapa deixando os leads órfãos.
 */
export const buildLeadCountByStageId = (kpiRows: KpiRow[]): Record<string, number> =>
    kpiRows.reduce<Record<string, number>>((acc, row) => {
        const sid = chaveEtapa(row.stage_id);
        if (!sid) return acc;
        acc[sid] = (acc[sid] || 0) + contagem(row);
        return acc;
    }, {});
