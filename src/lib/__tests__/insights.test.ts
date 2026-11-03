import { describe, expect, it } from "vitest";
import { buildOwnerPerformance, dataDeDecisao, isOpenStatus } from "../insights";
import { indexarEtapas } from "../pipelineMetrics";

const etapas = indexarEtapas([
    { id: 1, nome: "Contato inicial" },
    { id: 2, nome: "Contrato assinado", ganho: true },
    { id: 3, nome: "Desistiu", perdido: true },
]);

describe("buildOwnerPerformance", () => {
    const clientes = [
        { id: 1, responsavel: "Ana", stage_id: 2, status: "Contrato assinado", valor: 10000, conta_energia_media: 300 },
        { id: 2, responsavel: "Ana", stage_id: 1, status: "Contato inicial", valor: 5000 },
        { id: 3, responsavel: "Ana", stage_id: 3, status: "Desistiu", valor: 7000 },
    ];

    it("REGRESSÃO: receita do responsável conta só os ganhos (ROI por consultor)", () => {
        const [ana] = buildOwnerPerformance(clientes, etapas);
        expect(ana).toMatchObject({ total: 3, ganhos: 1, perdas: 1, ativos: 1, valorGanho: 10000, valor: 22000 });
    });

    it("usa o valor do negócio, não a conta de luz", () => {
        const [ana] = buildOwnerPerformance([clientes[0]], etapas);
        expect(ana.valor).toBe(10000);
    });

    it("sem etapas cai no texto do status", () => {
        const [semFlags] = buildOwnerPerformance([{ id: 9, responsavel: "Bia", status: "Fechado", valor: 1 }]);
        expect(semFlags.ganhos).toBe(1);
    });
});

describe("isOpenStatus", () => {
    it("REGRESSÃO: etapa personalizada conta como aberta", () => {
        expect(isOpenStatus("Contato inicial")).toBe(true);
        expect(isOpenStatus("Fechado")).toBe(false);
        expect(isOpenStatus("Perdido")).toBe(false);
    });
});

describe("dataDeDecisao", () => {
    it("prefere a data de fechamento à de criação", () => {
        expect(dataDeDecisao({ id: 1, created_at: "2026-01-01", data_fechamento: "2026-11-02" })).toBe("2026-11-02");
        expect(dataDeDecisao({ id: 1, created_at: "2026-01-01" })).toBe("2026-01-01");
    });
});
