import { describe, expect, it } from "vitest";
import type { Stage } from "../../components/kanban/types";
import {
    buildLeadCountByStageId,
    buildStagesVisiveis,
    temLeadsSemEtapa,
    type KpiRow,
} from "../kanbanStages";

const etapas: Stage[] = [
    { id: 1, nome: "Novo Lead", cor: "#5d9cec", ordem: 1 },
    { id: 2, nome: "Em Negociação", cor: "#3182ce", ordem: 2 },
];

describe("temLeadsSemEtapa", () => {
    it("sem linhas não há órfão", () => {
        expect(temLeadsSemEtapa([])).toBe(false);
    });

    it("todas as linhas com etapa: não há órfão", () => {
        const rows: KpiRow[] = [
            { status: "Novo Lead", stage_id: 1, total_leads: 3 },
            { status: "Em Negociação", stage_id: 2, total_leads: 2 },
        ];
        expect(temLeadsSemEtapa(rows)).toBe(false);
    });

    /**
     * BUG A — o mais grave. A detecção antiga olhava o TEXTO do status:
     * como "Novo Lead" casava com uma etapa conhecida, ela concluía que
     * não havia órfão e a coluna "Outros" não aparecia. Mas as colunas de
     * etapa filtram por stage_id, então este lead não aparecia em lugar
     * nenhum — sumia do board.
     */
    it("REGRESSÃO: lead sem etapa cujo status casa com o nome de uma etapa é órfão", () => {
        const rows: KpiRow[] = [{ status: "Novo Lead", stage_id: null, total_leads: 4 }];
        expect(temLeadsSemEtapa(rows)).toBe(true);
    });

    /**
     * BUG B — coluna fantasma. Um lead de outro funil (stage_id existente,
     * mas fora das etapas visíveis) fazia a detecção por nome acionar
     * "Outros"; a coluna, porém, consulta stage_id IS NULL e vinha vazia.
     */
    it("REGRESSÃO: lead com etapa de outro funil NÃO cria a coluna Outros", () => {
        const rows: KpiRow[] = [
            { status: "Etapa de outro funil", stage_id: 99, pipeline_id: "outro", total_leads: 5 },
        ];
        expect(temLeadsSemEtapa(rows)).toBe(false);
    });

    it("linha sem etapa e sem lead não aciona a coluna", () => {
        expect(temLeadsSemEtapa([{ status: "x", stage_id: null, total_leads: 0 }])).toBe(false);
    });

    it("stage_id indefinido conta como sem etapa", () => {
        expect(temLeadsSemEtapa([{ status: "x", total_leads: 1 }])).toBe(true);
    });
});

describe("buildStagesVisiveis", () => {
    it("sem órfãos devolve exatamente as etapas do funil", () => {
        const rows: KpiRow[] = [{ status: "Novo Lead", stage_id: 1, total_leads: 1 }];
        expect(buildStagesVisiveis(etapas, rows)).toEqual(etapas);
    });

    it("com órfãos acrescenta a coluna Outros no fim", () => {
        const rows: KpiRow[] = [{ status: "Novo Lead", stage_id: null, total_leads: 1 }];
        const visiveis = buildStagesVisiveis(etapas, rows);
        expect(visiveis).toHaveLength(etapas.length + 1);
        expect(visiveis[visiveis.length - 1]).toMatchObject({ id: "outros", nome: "Outros" });
    });

    it("não duplica a coluna Outros nem altera as etapas originais", () => {
        const rows: KpiRow[] = [{ stage_id: null, total_leads: 1 }];
        buildStagesVisiveis(etapas, rows);
        expect(etapas).toHaveLength(2);
    });
});

describe("buildLeadCountByStageId", () => {
    it("agrega por stage_id", () => {
        const rows: KpiRow[] = [
            { status: "Novo Lead", stage_id: 1, total_leads: 3 },
            { status: "Novo Lead", stage_id: 1, total_leads: 2 },
            { status: "Em Negociação", stage_id: 2, total_leads: 4 },
        ];
        expect(buildLeadCountByStageId(rows)).toEqual({ "1": 5, "2": 4 });
    });

    /**
     * A agregação por nome somava etapas homônimas de funis diferentes.
     * Duas etapas "Novo Lead" (uma em cada funil) viravam um número só.
     */
    it("REGRESSÃO: etapas homônimas de funis diferentes não são somadas juntas", () => {
        const rows: KpiRow[] = [
            { status: "Novo Lead", stage_id: 1, pipeline_id: "funil-a", total_leads: 3 },
            { status: "Novo Lead", stage_id: 7, pipeline_id: "funil-b", total_leads: 10 },
        ];
        expect(buildLeadCountByStageId(rows)).toEqual({ "1": 3, "7": 10 });
    });

    /**
     * Contagem zero indevida é perigosa: o fluxo de exclusão de coluna usa
     * este número para decidir se precisa mover os leads antes de apagar a
     * etapa. Zero errado = etapa apagada e leads órfãos.
     */
    it("REGRESSÃO: status divergente do nome da etapa não zera a contagem", () => {
        const rows: KpiRow[] = [
            { status: "texto totalmente diferente", stage_id: 2, total_leads: 6 },
        ];
        expect(buildLeadCountByStageId(rows)["2"]).toBe(6);
    });

    it("ignora linhas sem etapa (elas pertencem à coluna Outros)", () => {
        const rows: KpiRow[] = [
            { status: "x", stage_id: null, total_leads: 9 },
            { status: "Novo Lead", stage_id: 1, total_leads: 1 },
        ];
        expect(buildLeadCountByStageId(rows)).toEqual({ "1": 1 });
    });

    it("tolera total_leads ausente ou em texto", () => {
        const rows: KpiRow[] = [
            { stage_id: 1, total_leads: "5" },
            { stage_id: 1 },
        ];
        expect(buildLeadCountByStageId(rows)).toEqual({ "1": 5 });
    });
});
