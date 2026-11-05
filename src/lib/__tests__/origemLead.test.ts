import { describe, expect, it } from "vitest";
import { indexarEtapas, taxaDeConversao } from "../pipelineMetrics";
import {
    inicioDoPeriodo,
    origemDoLead,
    origemParaDadosExtras,
    resumirPorOrigem,
    SEM_ORIGEM,
    type CanalOrigem,
} from "../origemLead";

const canais: CanalOrigem[] = [
    { id: "c-insta", nome: "Instagram" },
    { id: "c-ind", nome: "Indicação" },
];

describe("origemParaDadosExtras", () => {
    it("grava id e nome do canal escolhido", () => {
        expect(origemParaDadosExtras("c-ind", canais)).toEqual({ origem_id: "c-ind", origem: "Indicação" });
    });

    it("criar sem origem não manda nada; editar limpando manda null", () => {
        expect(origemParaDadosExtras(undefined, canais)).toEqual({});
        expect(origemParaDadosExtras(null, canais, "editar")).toEqual({ origem_id: null, origem: null });
    });

    it("id que não é um canal da empresa é descartado (não grava id forjado)", () => {
        expect(origemParaDadosExtras("canal-de-outro-tenant", canais)).toEqual({});
        expect(origemParaDadosExtras("canal-de-outro-tenant", canais, "editar")).toEqual({ origem_id: null, origem: null });
    });
});

describe("origemDoLead", () => {
    it("lê id e nome; ignora tipos errados", () => {
        expect(origemDoLead({ origem_id: "c-insta", origem: " Instagram " })).toEqual({ id: "c-insta", nome: "Instagram" });
        expect(origemDoLead({ origem_id: 12, origem: "" })).toEqual({ id: undefined, nome: undefined });
        expect(origemDoLead(null)).toEqual({ id: undefined, nome: undefined });
    });
});

describe("resumirPorOrigem", () => {
    const etapas = indexarEtapas([
        { id: 1, nome: "Novo" },
        { id: 2, nome: "Contrato assinado", ganho: true },
        { id: 3, nome: "Desistiu", perdido: true },
    ]);

    it("soma leads, ganhos, perdidos, valor ganho e usa a taxa oficial", () => {
        const resumo = resumirPorOrigem(
            [
                { origem: "Instagram", stage_id: 1, total_leads: 5, valor_total: 50000 },
                { origem: "Instagram", stage_id: 2, total_leads: 2, valor_total: 40000 },
                { origem: "Instagram", stage_id: 3, total_leads: 2, valor_total: 9000 },
                { origem: "Indicação", stage_id: 2, total_leads: 3, valor_total: "90000" },
                { origem: null, stage_id: 1, total_leads: 4, valor_total: 1000 },
            ],
            etapas,
        );
        expect(resumo.map((r) => r.origem)).toEqual(["Indicação", "Instagram", SEM_ORIGEM]);
        const insta = resumo.find((r) => r.origem === "Instagram");
        expect(insta).toMatchObject({ leads: 9, ganhos: 2, perdidos: 2, abertos: 5, valorGanho: 40000 });
        expect(insta?.conversao).toBe(taxaDeConversao(2, 2));
        expect(insta?.conversao).toBe(50);
        expect(resumo.find((r) => r.origem === "Indicação")?.conversao).toBe(100);
        expect(resumo.find((r) => r.origem === SEM_ORIGEM)).toMatchObject({ leads: 4, conversao: 0 });
    });

    it("sem etapa conhecida, o texto do status decide (Fechado/Perdido)", () => {
        const resumo = resumirPorOrigem(
            [
                { origem: "Site", status: "Fechado", total_leads: 1, valor_total: 100 },
                { origem: "Site", status: "Perdido", total_leads: 1, valor_total: 50 },
            ],
            new Map(),
        );
        expect(resumo[0]).toMatchObject({ ganhos: 1, perdidos: 1, valorGanho: 100, conversao: 50 });
    });

    it("lista vazia ou linhas zeradas não quebram", () => {
        expect(resumirPorOrigem(null, etapas)).toEqual([]);
        expect(resumirPorOrigem([{ origem: "X", total_leads: 0 }], etapas)).toEqual([]);
    });
});

describe("inicioDoPeriodo", () => {
    it("primeiro dia do mês, contando o mês atual", () => {
        const agora = new Date("2026-11-05T12:00:00Z");
        expect(inicioDoPeriodo(1, agora)).toBe("2026-11-01");
        expect(inicioDoPeriodo(3, agora)).toBe("2026-09-01");
        expect(inicioDoPeriodo(12, agora)).toBe("2025-12-01");
    });
});
