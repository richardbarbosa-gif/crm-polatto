import { describe, expect, it } from "vitest";
import { formatarDocumento, regraCpfCnpj, tipoPessoaDoDocumento } from "../documentos";

describe("tipo de pessoa e máscara do documento", () => {
    it("infere o tipo pelo documento salvo", () => {
        expect(tipoPessoaDoDocumento("529.982.247-25")).toBe("pf");
        expect(tipoPessoaDoDocumento("11.222.333/0001-81")).toBe("pj");
        expect(tipoPessoaDoDocumento("")).toBe("pf");
        expect(tipoPessoaDoDocumento(null)).toBe("pf");
    });

    it("mascara CPF e corta em 11 dígitos", () => {
        expect(formatarDocumento("52998224725", "pf")).toBe("529.982.247-25");
        expect(formatarDocumento("5299822472599", "pf")).toBe("529.982.247-25");
        expect(formatarDocumento("5299", "pf")).toBe("529.9");
    });

    it("mascara CNPJ", () => {
        expect(formatarDocumento("11222333000181", "pj")).toBe("11.222.333/0001-81");
        expect(formatarDocumento("11222", "pj")).toBe("11.222");
    });

    it("pessoa física exige CPF válido; empresa exige CNPJ válido", async () => {
        await expect(regraCpfCnpj("cpf").validator(null, "529.982.247-25")).resolves.toBeUndefined();
        await expect(regraCpfCnpj("cpf").validator(null, "11.222.333/0001-81")).rejects.toThrow("CPF inválido");
        await expect(regraCpfCnpj("cnpj").validator(null, "11.222.333/0001-81")).resolves.toBeUndefined();
        await expect(regraCpfCnpj("cnpj").validator(null, "529.982.247-25")).rejects.toThrow("CNPJ inválido");
    });
});

describe("CNPJ alfanumérico (Receita Federal, jul/2026)", () => {
    it("valida o exemplo oficial e recusa dígito trocado (mesma conta do banco)", async () => {
        const { validarCnpj, validarCpfOuCnpj } = await import("../documentos");
        expect(validarCnpj("12.ABC.345/01DE-35")).toBe(true);
        expect(validarCnpj("12abc34501de35")).toBe(true);
        expect(validarCnpj("12.ABC.345/01DE-36")).toBe(false);
        expect(validarCnpj("AAAAAAAAAAAAAA")).toBe(false);
        expect(validarCnpj("11.222.333/0001-81")).toBe(true);
        expect(validarCpfOuCnpj("12.ABC.345/01DE-35")).toBe(true);
        expect(validarCpfOuCnpj("529.982.247-25")).toBe(true);
    });

    it("máscara e tipo aceitam letras no CNPJ", () => {
        expect(formatarDocumento("12abc34501de35", "pj")).toBe("12.ABC.345/01DE-35");
        expect(tipoPessoaDoDocumento("12.ABC.345/01DE-35")).toBe("pj");
    });
});
