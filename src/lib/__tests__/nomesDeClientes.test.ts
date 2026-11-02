import { describe, expect, it, vi } from "vitest";

const UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const consultasFeitas: Array<Array<string>> = [];

vi.mock("../../utility", () => ({
    supabaseClient: {
        from: () => ({
            select: () => ({
                in: async (_coluna: string, ids: string[]) => {
                    consultasFeitas.push(ids);
                    // Coluna uuid: lote com id numérico falha como no Postgres
                    if (ids.some((id) => /^\d+$/.test(id))) {
                        return { data: null, error: { code: "22P02", message: "invalid input syntax for type uuid" } };
                    }
                    return { data: ids.map((id) => ({ id, nome: `Cliente ${id.slice(0, 4)}` })), error: null };
                },
            }),
        }),
    },
}));

import { agruparIdsPorTipo, buscarNomesDeClientes, emLotes } from "../nomesDeClientes";

describe("agruparIdsPorTipo", () => {
    it("separa bigint de UUID e descarta lixo e repetidos", () => {
        expect(agruparIdsPorTipo([1, "2", UUID, UUID, null, "abc"])).toEqual({
            numericos: ["1", "2"],
            uuids: [UUID],
        });
    });
});

describe("emLotes", () => {
    it("quebra em lotes do tamanho pedido", () => {
        expect(emLotes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    });
});

describe("buscarNomesDeClientes", () => {
    it("REGRESSÃO: ids antigos misturados com UUID não derrubam a consulta", async () => {
        const nomes = await buscarNomesDeClientes(["42", UUID]);
        expect(nomes.get(UUID)).toBe("Cliente 3f25");
        // O lote numérico foi consultado à parte e falhou sozinho
        expect(consultasFeitas).toEqual(expect.arrayContaining([["42"], [UUID]]));
    });

    it("sem ids não consulta nada", async () => {
        consultasFeitas.length = 0;
        expect((await buscarNomesDeClientes([])).size).toBe(0);
        expect(consultasFeitas).toHaveLength(0);
    });
});
