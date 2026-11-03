import { describe, expect, it } from "vitest";
import {
    DEFAULT_LEAD_STAGES,
    buildLeadStageOptions,
    buildLeadStages,
    coerceLeadStageIdValue,
    pipelineDaEtapa,
} from "../leadStatus";

const etapas = [
    { id: 1, nome: "Novo Lead", ordem: 1, pipeline_id: "vendas" },
    { id: 2, nome: "Proposta", ordem: 2, pipeline_id: "vendas" },
    { id: 10, nome: "Novo Lead", ordem: 1, pipeline_id: "pos" },
    { id: 11, nome: "Instalação", ordem: 2, pipeline_id: "pos" },
];
const funis = [
    { id: "vendas", nome: "Vendas" },
    { id: "pos", nome: "Pós-venda" },
];

describe("buildLeadStages", () => {
    it("REGRESSÃO: etapas homônimas de funis diferentes não somem", () => {
        const ids = buildLeadStages(etapas).map((e) => e.id);
        expect(ids).toEqual(expect.arrayContaining(["1", "10"]));
        expect(ids).toHaveLength(4);
    });

    it("deduplica por nome dentro do mesmo funil", () => {
        const comCopia = [...etapas, { id: 3, nome: "novo lead", ordem: 5, pipeline_id: "vendas" }];
        expect(buildLeadStages(comCopia)).toHaveLength(4);
    });

    it("sem etapas no banco usa o funil de exemplo", () => {
        expect(buildLeadStages([])).toBe(DEFAULT_LEAD_STAGES);
    });
});

describe("buildLeadStageOptions", () => {
    it("com vários funis o rótulo leva o nome do funil, agrupado na ordem dos funis", () => {
        const opcoes = buildLeadStageOptions(etapas, funis);
        expect(opcoes.map((o) => o.label)).toEqual([
            "Vendas · Novo Lead",
            "Vendas · Proposta",
            "Pós-venda · Novo Lead",
            "Pós-venda · Instalação",
        ]);
    });

    it("com um funil só mantém o nome da etapa", () => {
        const opcoes = buildLeadStageOptions(etapas.slice(0, 2), funis);
        expect(opcoes.map((o) => o.label)).toEqual(["Novo Lead", "Proposta"]);
    });
});

describe("pipelineDaEtapa e coerceLeadStageIdValue", () => {
    it("descobre o funil da etapa escolhida", () => {
        const stages = buildLeadStages(etapas);
        expect(pipelineDaEtapa(stages, "11")).toBe("pos");
        expect(pipelineDaEtapa(stages, "999")).toBeNull();
    });

    it("converte status antigo (texto) no id da etapa", () => {
        const stages = buildLeadStages(etapas);
        expect(coerceLeadStageIdValue("Proposta", stages)).toBe("2");
    });
});
