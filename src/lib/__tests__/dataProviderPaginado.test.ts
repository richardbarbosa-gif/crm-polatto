import type { DataProvider, GetListParams } from "@refinedev/core";
import { describe, expect, it, vi } from "vitest";
import {
    buscarTodasAsLinhas,
    comPaginacaoCompleta,
    ordenacaoComDesempate,
} from "../dataProviderPaginado";

/**
 * Simula o PostgREST: devolve no máximo `maxRows` linhas por requisição e
 * informa o total em `count`, exatamente como o data provider do Refine
 * para Supabase faz.
 */
const criarBase = (totalLinhas: number, maxRows = 1000) => {
    const linhas = Array.from({ length: totalLinhas }, (_, i) => ({ id: i + 1 }));
    const getList = vi.fn(async (params: GetListParams) => {
        const { mode = "server", currentPage = 1, pageSize = 10 } = params.pagination ?? {};
        if (mode === "off") {
            return { data: linhas.slice(0, maxRows), total: totalLinhas };
        }
        const inicio = (currentPage - 1) * pageSize;
        const fim = inicio + Math.min(pageSize, maxRows);
        return { data: linhas.slice(inicio, fim), total: totalLinhas };
    });
    return { base: { getList } as unknown as DataProvider, getList };
};

describe("comPaginacaoCompleta", () => {
    it("REGRESSÃO: modo off traz todas as linhas, não só as 1000 primeiras", async () => {
        const { base } = criarBase(2500);
        const provider = comPaginacaoCompleta(base);
        const resposta = await provider.getList({ resource: "clientes", pagination: { mode: "off" } });
        expect(resposta.data).toHaveLength(2500);
        expect(resposta.total).toBe(2500);
        expect(resposta.data.at(-1)).toEqual({ id: 2500 });
    });

    it("com até uma página faz uma única requisição", async () => {
        const { base, getList } = criarBase(40);
        const provider = comPaginacaoCompleta(base);
        const resposta = await provider.getList({ resource: "clientes", pagination: { mode: "off" } });
        expect(resposta.data).toHaveLength(40);
        expect(getList).toHaveBeenCalledTimes(1);
    });

    it("não mexe na paginação de servidor", async () => {
        const { base, getList } = criarBase(100);
        const provider = comPaginacaoCompleta(base);
        const params: GetListParams = {
            resource: "clientes",
            pagination: { mode: "server", currentPage: 2, pageSize: 12 },
        };
        const resposta = await provider.getList(params);
        expect(resposta.data).toHaveLength(12);
        expect(getList).toHaveBeenCalledWith(params);
    });

    it("respeita max-rows menor que a página pedida", async () => {
        const { base } = criarBase(1200, 500);
        const provider = comPaginacaoCompleta(base);
        const resposta = await provider.getList({ resource: "tarefas", pagination: { mode: "off" } });
        expect(resposta.data).toHaveLength(1200);
        expect(new Set(resposta.data.map((r) => r.id)).size).toBe(1200);
    });

    it("acrescenta desempate por id quando precisa de várias páginas", async () => {
        const { base, getList } = criarBase(1500);
        const provider = comPaginacaoCompleta(base);
        await provider.getList({
            resource: "clientes",
            pagination: { mode: "off" },
            sorters: [{ field: "nome", order: "asc" }],
        });
        const ultimaChamada = getList.mock.calls.at(-1)?.[0];
        expect(ultimaChamada?.sorters).toEqual([
            { field: "nome", order: "asc" },
            { field: "id", order: "asc" },
        ]);
    });
});

describe("ordenacaoComDesempate", () => {
    it("views agregadas não ganham ordenação por id", () => {
        expect(ordenacaoComDesempate("vw_kanban_kpis", undefined)).toBeUndefined();
    });

    it("não duplica o id quando já está na ordenação", () => {
        const sorters = [{ field: "id", order: "desc" as const }];
        expect(ordenacaoComDesempate("clientes", sorters)).toEqual(sorters);
    });
});

describe("buscarTodasAsLinhas", () => {
    it("pagina com range até a última página incompleta", async () => {
        const todas = Array.from({ length: 2300 }, (_, i) => i);
        const montar = vi.fn(async (inicio: number, fim: number) => ({
            data: todas.slice(inicio, fim + 1),
            error: null,
        }));
        const linhas = await buscarTodasAsLinhas(montar);
        expect(linhas).toHaveLength(2300);
        expect(montar).toHaveBeenCalledTimes(3);
    });

    it("propaga o erro do Supabase", async () => {
        const erro = { message: "permission denied" };
        await expect(
            buscarTodasAsLinhas(async () => ({ data: null, error: erro })),
        ).rejects.toBe(erro);
    });
});
