import { describe, expect, it } from "vitest";
import { buildKpiFilters, buildLeadFilters } from "../leadFilters";

/** Procura um filtro simples (campo/operador/valor) na lista. */
const temFiltro = (
    filtros: ReturnType<typeof buildLeadFilters>,
    field: string,
    value?: unknown,
): boolean =>
    filtros.some(
        (f) =>
            "field" in f &&
            f.field === field &&
            (value === undefined || f.value === value),
    );

describe("buildLeadFilters", () => {
    it("sem nenhum critério não aplica filtro", () => {
        expect(buildLeadFilters({})).toEqual([]);
    });

    it("busca procura em nome e telefone", () => {
        const filtros = buildLeadFilters({ busca: "maria" });
        expect(filtros).toHaveLength(1);
        expect(filtros[0]).toMatchObject({
            operator: "or",
            value: [
                { field: "nome", operator: "contains", value: "maria" },
                { field: "telefone", operator: "contains", value: "maria" },
            ],
        });
    });

    it("filtra por responsável", () => {
        expect(temFiltro(buildLeadFilters({ responsavel: "Ana" }), "responsavel", "Ana")).toBe(true);
    });

    it("temperatura comum filtra a coluna temperatura", () => {
        expect(temFiltro(buildLeadFilters({ temperatura: "quente" }), "temperatura", "quente")).toBe(true);
    });

    it("fechado cobre também os status de ganho", () => {
        const filtros = buildLeadFilters({ temperatura: "fechado" });
        expect(filtros[0]).toMatchObject({
            operator: "or",
            value: [
                { field: "status", operator: "contains", value: "fechado" },
                { field: "status", operator: "contains", value: "ganho" },
            ],
        });
    });

    it("visão restrita limita aos leads do próprio usuário", () => {
        const filtros = buildLeadFilters({
            canViewAllLeads: false,
            ownerCandidates: ["Ana", "ana@x.com"],
        });
        expect(filtros.some((f) => "field" in f && f.field === "responsavel" && f.operator === "in")).toBe(true);
    });

    // ---- Correção do PR #1, problema 3 ----
    it("REGRESSÃO: funil ativo restringe os leads ao funil selecionado", () => {
        const filtros = buildLeadFilters({ pipelineId: "funil-vendas" });
        expect(temFiltro(filtros, "pipeline_id", "funil-vendas")).toBe(true);
    });

    it("sem funil ativo não restringe por funil", () => {
        expect(temFiltro(buildLeadFilters({ busca: "x" }), "pipeline_id")).toBe(false);
    });

    it("funil convive com os demais filtros", () => {
        const filtros = buildLeadFilters({
            busca: "maria",
            responsavel: "Ana",
            temperatura: "quente",
            pipelineId: "funil-a",
            canViewAllLeads: false,
            ownerCandidates: ["Ana"],
        });
        expect(temFiltro(filtros, "pipeline_id", "funil-a")).toBe(true);
        expect(temFiltro(filtros, "responsavel", "Ana")).toBe(true);
        expect(temFiltro(filtros, "temperatura", "quente")).toBe(true);
    });
});

describe("buildKpiFilters", () => {
    it("sem critério não aplica filtro", () => {
        expect(buildKpiFilters({})).toEqual([]);
    });

    // ---- Correção do PR #1, problema 3 ----
    it("REGRESSÃO: funil ativo restringe os KPIs ao funil selecionado", () => {
        const filtros = buildKpiFilters({ pipelineId: "funil-vendas" });
        expect(temFiltro(filtros, "pipeline_id", "funil-vendas")).toBe(true);
    });

    it("KPI e lista concordam no mesmo funil", () => {
        const entrada = { temperatura: "todas" as const, pipelineId: "funil-a" };
        expect(temFiltro(buildKpiFilters(entrada), "pipeline_id", "funil-a")).toBe(true);
        expect(temFiltro(buildLeadFilters(entrada), "pipeline_id", "funil-a")).toBe(true);
    });

    it("KPI respeita visão restrita por responsável", () => {
        const filtros = buildKpiFilters({ canViewAllLeads: false, ownerCandidates: ["Ana"] });
        expect(filtros.some((f) => "field" in f && f.field === "responsavel" && f.operator === "in")).toBe(true);
    });

    it("perdido filtra pelo status", () => {
        expect(temFiltro(buildKpiFilters({ temperatura: "perdido" }), "status")).toBe(true);
    });
});
