import { describe, expect, it } from "vitest";
import {
    formatarTelefoneBR,
    regraCpfCnpj,
    validarCnpj,
    validarCpf,
    validarCpfOuCnpj,
    validarEmail,
    validarTelefone,
    variantesDocumento,
    variantesTelefone,
} from "../documentos";

describe("validarCpf", () => {
    it("aceita CPF válido com ou sem máscara", () => {
        expect(validarCpf("529.982.247-25")).toBe(true);
        expect(validarCpf("52998224725")).toBe(true);
    });

    it("rejeita dígito verificador errado e sequências repetidas", () => {
        expect(validarCpf("529.982.247-24")).toBe(false);
        expect(validarCpf("111.111.111-11")).toBe(false);
        expect(validarCpf("123")).toBe(false);
    });
});

describe("validarCnpj", () => {
    it("aceita CNPJ válido", () => {
        expect(validarCnpj("11.222.333/0001-81")).toBe(true);
    });

    it("rejeita CNPJ inválido", () => {
        expect(validarCnpj("11.222.333/0001-80")).toBe(false);
        expect(validarCnpj("00.000.000/0000-00")).toBe(false);
    });
});

describe("validarCpfOuCnpj e regra do formulário", () => {
    it("decide pelo tamanho", () => {
        expect(validarCpfOuCnpj("52998224725")).toBe(true);
        expect(validarCpfOuCnpj("11222333000181")).toBe(true);
        expect(validarCpfOuCnpj("1122233300018")).toBe(false);
    });

    it("regra deixa vazio passar e barra documento inválido", async () => {
        const regra = regraCpfCnpj();
        await expect(regra.validator(null, "")).resolves.toBeUndefined();
        await expect(regra.validator(null, "529.982.247-25")).resolves.toBeUndefined();
        await expect(regra.validator(null, "529.982.247-00")).rejects.toThrow("CPF ou CNPJ inválido");
    });
});

describe("telefone", () => {
    it("valida fixo e celular brasileiros", () => {
        expect(validarTelefone("(11) 99999-8888")).toBe(true);
        expect(validarTelefone("(11) 3333-4444")).toBe(true);
        expect(validarTelefone("9999-8888")).toBe(false);
    });

    it("número estrangeiro aceita de 7 a 15 dígitos", () => {
        expect(validarTelefone("+1 415 555 0101", "+1")).toBe(true);
    });

    it("formata DDD + número", () => {
        expect(formatarTelefoneBR("11999998888")).toBe("(11) 99999-8888");
        expect(formatarTelefoneBR("1133334444")).toBe("(11) 3333-4444");
    });

    it("variantes cobrem o número cru, formatado e com 55", () => {
        expect(variantesTelefone("5511999998888")).toEqual(
            expect.arrayContaining(["5511999998888", "11999998888", "(11) 99999-8888"]),
        );
        expect(variantesTelefone("(11) 99999-8888")).toEqual(
            expect.arrayContaining(["(11) 99999-8888", "11999998888"]),
        );
    });
});

describe("variantesDocumento", () => {
    it("gera a forma só com dígitos e a formatada", () => {
        expect(variantesDocumento("52998224725")).toEqual(
            expect.arrayContaining(["52998224725", "529.982.247-25"]),
        );
        expect(variantesDocumento("")).toEqual([]);
    });
});

describe("validarEmail", () => {
    it("aceita e-mail comum e rejeita sem domínio", () => {
        expect(validarEmail("ana@empresa.com.br")).toBe(true);
        expect(validarEmail("ana@empresa")).toBe(false);
        expect(validarEmail("")).toBe(false);
    });
});
