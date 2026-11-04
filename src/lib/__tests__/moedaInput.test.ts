import { describe, expect, it } from "vitest";
import { formatarMoedaInput, lerMoedaInput } from "../moedaInput";

/** O par antigo dos formulários de lead, reproduzido para provar o defeito. */
const formatterAntigo = (value: number | string) => `R$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const parserAntigo = (value: string) => Number(String(value).replace(/R\$\s?|\./g, "").replace(",", "."));

describe("moeda no InputNumber", () => {
    it("o par antigo corrompia centavos (1500,5 virava 15005)", () => {
        expect(parserAntigo(formatterAntigo(1500.5))).toBe(15005);
    });

    it("REGRESSÃO: o novo par é estável — formatar e ler devolve o mesmo valor", () => {
        for (const valor of [0, 0.5, 1500.5, 1234567.89, 15000]) {
            expect(Number(lerMoedaInput(formatarMoedaInput(valor)))).toBe(valor);
        }
    });

    it("formata no padrão brasileiro ao sair do campo", () => {
        expect(formatarMoedaInput(1500.5)).toBe("1.500,50");
        expect(formatarMoedaInput(undefined)).toBe("");
    });

    it("enquanto digita, mantém o texto do usuário", () => {
        expect(formatarMoedaInput(1500, { userTyping: true, input: "1500," })).toBe("1500,");
    });

    it("lê os formatos que o usuário costuma digitar", () => {
        expect(lerMoedaInput("1.234,56")).toBe("1234.56");
        expect(lerMoedaInput("R$ 1.234")).toBe("1234");
        expect(lerMoedaInput("1500,5")).toBe("1500.5");
        expect(lerMoedaInput("1500.50")).toBe("1500.50");
        expect(lerMoedaInput("")).toBe("");
    });
});
