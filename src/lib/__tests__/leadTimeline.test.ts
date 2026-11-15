import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Supabase falso: registra inserts, responde selects por tabela e assina
 * caminhos do Storage (o arquivo "apagado.pdf" não existe mais).
 */
type ErroFalso = { code: string; message: string } | null;

const inserts: Array<{ tabela: string; payload: Record<string, unknown> }> = [];
const linhasPorTabela: Record<string, Record<string, unknown>[]> = {};
const tabelasConsultadas: string[] = [];
let erroDaConsulta: ErroFalso = null;
let erroDoInsert: ErroFalso = null;

const consulta = (tabela: string) => {
    const filtros: Array<[string, unknown]> = [];
    const builder = {
        select: () => {
            tabelasConsultadas.push(tabela);
            return builder;
        },
        eq: (coluna: string, valor: unknown) => {
            filtros.push([coluna, valor]);
            return builder;
        },
        order: () => builder,
        then: (resolve: (r: unknown) => unknown) => {
            if (erroDaConsulta) return Promise.resolve({ data: null, error: erroDaConsulta }).then(resolve);
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
                if (erroDoInsert) return { error: erroDoInsert };
                inserts.push({ tabela, payload });
                return { error: null };
            },
        }),
        storage: {
            from: () => ({
                createSignedUrls: async (caminhos: string[]) => ({
                    data: caminhos.map((path) =>
                        path.endsWith("apagado.pdf")
                            ? { path, signedUrl: "", error: "Object not found" }
                            : { path, signedUrl: `https://assinada.example/${path}`, error: null },
                    ),
                    error: null,
                }),
            }),
        },
    },
}));

import { addLeadActivity, ehIdDoModeloNovo, fetchLeadTimeline, temAssinaturaPdf, toTimelineType } from "../leadTimeline";

const UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

beforeEach(() => {
    inserts.length = 0;
    tabelasConsultadas.length = 0;
    erroDaConsulta = null;
    erroDoInsert = null;
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
        // o banco devolve já ordenado (order created_at desc)
        linhasPorTabela.atividades_lead = [
            { id: 2, cliente_id: UUID, tipo: "status", de_status: "A", para_status: "B", created_at: "2026-11-02T10:00:00Z" },
            { id: 1, cliente_id: UUID, tipo: "nota", titulo: "Ligou", created_at: "2026-11-01T10:00:00Z" },
        ];
        const timeline = await fetchLeadTimeline(UUID);
        expect(timeline.map((e) => e.type)).toEqual(["status", "nota"]);
    });

    it("não consulta cliente_status_history: a etapa já vem pela atividades_lead (trigger do banco)", async () => {
        linhasPorTabela.atividades_lead = [{ id: 1, cliente_id: UUID, tipo: "nota", created_at: "2026-11-01T10:00:00Z" }];
        linhasPorTabela.cliente_status_history = [{ id: 9, cliente_id: UUID, de_status: "Novo", para_status: "Visita" }];
        const timeline = await fetchLeadTimeline(UUID);
        expect(timeline).toHaveLength(1);
        expect(tabelasConsultadas).toEqual(["atividades_lead"]);
    });

    it("assina o link do arquivo na hora de exibir e ignora a URL antiga gravada no banco", async () => {
        linhasPorTabela.atividades_lead = [
            {
                id: 3,
                cliente_id: UUID,
                tipo: "upload_proposta",
                arquivo_nome: "proposta.pdf",
                arquivo_path: "tenant/lead/proposta.pdf",
                arquivo_url: "https://vencida.example/assinada",
                created_at: "2026-11-01T10:00:00Z",
            },
            { id: 4, cliente_id: UUID, tipo: "upload_proposta", arquivo_path: "tenant/lead/apagado.pdf", created_at: "2026-10-01T10:00:00Z" },
        ];
        const timeline = await fetchLeadTimeline(UUID);
        expect(timeline[0].fileUrl).toBe("https://assinada.example/tenant/lead/proposta.pdf");
        expect(timeline[1].fileUrl).toBeUndefined();
        expect(timeline[1].filePath).toBe("tenant/lead/apagado.pdf");
    });

    it("propaga o erro do banco em vez de devolver timeline vazia", async () => {
        erroDaConsulta = { code: "42703", message: 'column "x" does not exist' };
        await expect(fetchLeadTimeline(UUID)).rejects.toMatchObject({ code: "42703" });
    });
});

describe("addLeadActivity", () => {
    it("grava um único formato, sem data, autor nem empresa (o banco carimba)", async () => {
        await addLeadActivity({ leadId: UUID, activityType: "nota", title: "Nota", description: "Ligou" });
        expect(inserts).toEqual([
            { tabela: "atividades_lead", payload: { cliente_id: UUID, tipo: "nota", titulo: "Nota", descricao: "Ligou" } },
        ]);
    });

    it("propaga o erro do banco (antes tentava outros formatos e engolia a falha)", async () => {
        erroDoInsert = { code: "42501", message: "permission denied" };
        await expect(addLeadActivity({ leadId: UUID, activityType: "nota" })).rejects.toMatchObject({ code: "42501" });
    });
});

describe("temAssinaturaPdf", () => {
    it("aceita um arquivo que começa com %PDF-", async () => {
        expect(await temAssinaturaPdf(new Blob(["%PDF-1.7\n..."]))).toBe(true);
    });

    it("recusa outro conteúdo com extensão/tipo de PDF", async () => {
        expect(await temAssinaturaPdf(new Blob(["MZ\u0090\u0000 executável"], { type: "application/pdf" }))).toBe(false);
        expect(await temAssinaturaPdf(new Blob([]))).toBe(false);
    });
});
