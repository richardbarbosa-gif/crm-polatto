import { describe, expect, it } from "vitest";
import { montarFiltroDuplicata, valorPostgrest } from "../duplicatas";

describe("valorPostgrest", () => {
    it("coloca entre aspas e escapa aspas e barras", () => {
        expect(valorPostgrest('a"b\\c')).toBe('"a\\"b\\\\c"');
        expect(valorPostgrest("(11) 9999-9999")).toBe('"(11) 9999-9999"');
    });
});

describe("montarFiltroDuplicata", () => {
    it("sem dados não monta filtro", () => {
        expect(montarFiltroDuplicata({})).toBeNull();
        expect(montarFiltroDuplicata({ telefone: " ", email: "" })).toBeNull();
    });

    it("REGRESSÃO: compara telefone cru com o formatado", () => {
        const filtro = montarFiltroDuplicata({ telefone: "11999998888" }) ?? "";
        expect(filtro).toContain('"(11) 99999-8888"');
        expect(filtro).toContain('"11999998888"');
        expect(filtro.startsWith("telefone.in.(")).toBe(true);
    });

    it("compara CPF com e sem máscara e e-mail sem diferenciar maiúsculas", () => {
        const filtro = montarFiltroDuplicata({ documento: "529.982.247-25", email: "Ana@X.com" }) ?? "";
        expect(filtro).toContain('cpf_cnpj.in.("52998224725","529.982.247-25")');
        expect(filtro).toContain('email.ilike."Ana@X.com"');
    });

    it("aceita nomes de coluna de outras tabelas", () => {
        const filtro = montarFiltroDuplicata({ documento: "11222333000181" }, { documento: "cnpj" }) ?? "";
        expect(filtro.startsWith("cnpj.in.(")).toBe(true);
    });
});
