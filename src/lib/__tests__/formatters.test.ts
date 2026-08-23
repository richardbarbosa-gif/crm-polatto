import { describe, expect, it } from "vitest";
import {
    formatCpfCnpj,
    formatCurrencyBRL,
    formatDateBR,
    isClosedStatus,
    normalizeText,
    parseCurrencyLikeValue,
} from "../formatters";

describe("normalizeText", () => {
    it("normaliza para minúsculas e remove espaços das pontas", () => {
        expect(normalizeText("  Fechado  ")).toBe("fechado");
    });

    it("retorna string vazia para null/undefined", () => {
        expect(normalizeText(null)).toBe("");
        expect(normalizeText(undefined)).toBe("");
    });
});

describe("parseCurrencyLikeValue", () => {
    it("aceita número puro", () => {
        expect(parseCurrencyLikeValue(1500)).toBe(1500);
    });

    it("parseia formato brasileiro com R$", () => {
        expect(parseCurrencyLikeValue("R$ 1.234,56")).toBe(1234.56);
    });

    it("parseia decimal com vírgula", () => {
        expect(parseCurrencyLikeValue("350,90")).toBe(350.9);
    });

    it("parseia formato americano", () => {
        expect(parseCurrencyLikeValue("1234.56")).toBe(1234.56);
    });

    it("retorna null para lixo", () => {
        expect(parseCurrencyLikeValue("abc")).toBeNull();
        expect(parseCurrencyLikeValue("")).toBeNull();
        expect(parseCurrencyLikeValue(null)).toBeNull();
        expect(parseCurrencyLikeValue(undefined)).toBeNull();
        expect(parseCurrencyLikeValue(NaN)).toBeNull();
    });
});

describe("formatCurrencyBRL", () => {
    it("formata em reais", () => {
        const resultado = formatCurrencyBRL(1234.5);
        expect(resultado).toContain("1.234,50");
        expect(resultado).toContain("R$");
    });

    it("usa fallback quando não parseável", () => {
        expect(formatCurrencyBRL("xyz")).toBe("--");
        expect(formatCurrencyBRL(null, "R$ 0")).toBe("R$ 0");
    });
});

describe("formatDateBR", () => {
    it("formata data ISO no padrão brasileiro", () => {
        expect(formatDateBR("2026-07-19T12:00:00Z")).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    });

    it("usa fallback para valores inválidos", () => {
        expect(formatDateBR(null)).toBe("-");
        expect(formatDateBR("data-invalida")).toBe("-");
    });
});

describe("formatCpfCnpj", () => {
    it("formata CPF completo", () => {
        expect(formatCpfCnpj("12345678901")).toBe("123.456.789-01");
    });

    it("formata CNPJ completo", () => {
        expect(formatCpfCnpj("12345678000195")).toBe("12.345.678/0001-95");
    });

    it("formata CPF parcial durante digitação", () => {
        expect(formatCpfCnpj("123")).toBe("123");
        expect(formatCpfCnpj("123456")).toBe("123.456");
    });

    it("ignora caracteres não numéricos e limita a 14 dígitos", () => {
        expect(formatCpfCnpj("123.456.789-01")).toBe("123.456.789-01");
        expect(formatCpfCnpj("123456780001951111")).toBe("12.345.678/0001-95");
    });

    it("retorna vazio sem dígitos", () => {
        expect(formatCpfCnpj("")).toBe("");
        expect(formatCpfCnpj(null)).toBe("");
        expect(formatCpfCnpj("abc")).toBe("");
    });
});

describe("isClosedStatus", () => {
    it("reconhece fechado independente de caixa", () => {
        expect(isClosedStatus("Fechado")).toBe(true);
        expect(isClosedStatus(" FECHADO ")).toBe(true);
    });

    it("não confunde com outros status", () => {
        expect(isClosedStatus("perdido")).toBe(false);
        expect(isClosedStatus(null)).toBe(false);
    });
});
