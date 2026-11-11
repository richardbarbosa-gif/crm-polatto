import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Supabase falso: registra inserts e responde selects por tabela. Uma
 * consulta em cliente_status_history com cliente_id não numérico falha
 * como no Postgres real (coluna bigint).
 */
const inserts: Array<{ tabela: string; payload: Record<string, unknown> }> = [];
const linhasPorTabela: Record<string, Record<string, unknown>[]> = {};

const consulta = (tabela: string) => {
    const filtros: Array<[string, unknown]> = [];
    const builder = {
        select: () => builder,
        eq: (coluna: string, valor: unknown) => {
            filtros.push([coluna, valor]);
            return builder;
        },
        then: (resolve: (r: unknown) => unknown) => {
            const bigintInvalido =
                tabela === "cliente_status_history" &&
                filtros.some(([c, v]) => c === "cliente_id" && !/^\d+$/.test(String(v)));
            if (bigintInvalido) {
                return Promise.resolve({
                    data: null,
                    error: { code: "22P02", message: 'invalid input syntax for type bigint' },
                }).then(resolve);
            }
            const linhas = (linhasPorTabela[tabela] ?? []).filter((linha) =>
                filtros.every(([c, v]) => String(linha[c]) === String(v)),
            );
            return Promise.resolve({ data: linhas, error: null }).then(resolve);
        },
    };
    return builder;
};

vi.mock("../../utility", () => ({
    supabaseClient: {
        from: (tabela: string) => ({
            ...consulta(tabela),
            insert: async (payload: Record<string, unknown>) => {
                inserts.push({ tabela, payload });
                return { error: null };
            },
        }),
    },
}));

import { ehIdDoModeloNovo, fetchLeadTimeline, toTimelineType } from "../leadTimeline";

const UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

beforeEach(() => {
    inserts.length = 0;
    Object.keys(linhasPorTabela).forEach((k) => delete linhasPorTabela[k]);
});

describe("toTimelineType", () => {
    it("registro de temperatura (trigger da migration 15) vira tipo próprio", () => {
        expect(toTimelineType("temperatura")).toBe("temperatura");
        expect(toTimelineType("Temperatura")).toBe("temperatura");
    });

    it("registro de automação (migration 17) vira tipo próprio", () => {
        expect(toTimelineType("automacao")).toBe("automacao");
    });

    it("tipos existentes continuam iguais", () => {
        expect(toTimelineType("ligacao")).toBe("ligacao");
        expect(toTimelineType("nota")).toBe("nota");
        expect(toTimelineType("status")).toBe("status");
        expect(toTimelineType(undefined, "Novo", "Proposta")).toBe("status");
        expect(toTimelineType("whatsapp")).toBe("outro");
    });
});

describe("ehIdDoModeloNovo", () => {
    it("distingue UUID (negocios) de bigint (tabela antiga)", () => {
        expect(ehIdDoModeloNovo(UUID)).toBe(true);
        expect(ehIdDoModeloNovo("42")).toBe(false);
        expect(ehIdDoModeloNovo(42)).toBe(false);
    });
});

describe("fetchLeadTimeline", () => {
    it("REGRESSÃO: lead com id UUID carrega a timeline em vez de falhar", async () => {
        linhasPorTabela.atividades_lead = [
            { id: 1, cliente_id: UUID, tipo: "nota", titulo: "Ligou", created_at: "2026-11-01T10:00:00Z" },
            { id: 2, cliente_id: UUID, tipo: "status", de_status: "A", para_status: "B", created_at: "2026-11-02T10:00:00Z" },
        ];
        const timeline = await fetchLeadTimeline(UUID);
        expect(timeline.map((e) => e.type)).toEqual(["status", "nota"]);
    });

    it("lead antigo junta atividades e histórico de etapas", async () => {
        linhasPorTabela.atividades_lead = [{ id: 1, cliente_id: "7", tipo: "nota", created_at: "2026-11-01T10:00:00Z" }];
        linhasPorTabela.cliente_status_history = [
            { id: 9, cliente_id: 7, de_status: "Novo", para_status: "Visita", movido_em: "2026-11-03T10:00:00Z" },
        ];
        const timeline = await fetchLeadTimeline(7);
        expect(timeline).toHaveLength(2);
        expect(timeline[0].toStatus).toBe("Visita");
    });
});
