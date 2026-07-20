import { describe, expect, it } from "vitest";
import {
    getSupabaseErrorMessage,
    isSupabaseMissingColumn,
    isSupabaseMissingRelation,
    isSupabasePolicyRecursion,
} from "../supabaseErrors";

describe("isSupabaseMissingRelation", () => {
    it("detecta código 42P01 (tabela inexistente)", () => {
        expect(isSupabaseMissingRelation({ code: "42P01" })).toBe(true);
    });

    it("detecta pela mensagem", () => {
        expect(isSupabaseMissingRelation({ message: 'relation "x" does not exist' })).toBe(true);
        expect(isSupabaseMissingRelation({ message: "Could not find the table in schema cache" })).toBe(true);
    });

    it("detecta statusCode 404", () => {
        expect(isSupabaseMissingRelation({ statusCode: 404 })).toBe(true);
    });

    it("não acusa falso positivo", () => {
        expect(isSupabaseMissingRelation(null)).toBe(false);
        expect(isSupabaseMissingRelation({ code: "23505", message: "duplicate key" })).toBe(false);
    });
});

describe("isSupabaseMissingColumn", () => {
    it("detecta código 42703 (coluna inexistente)", () => {
        expect(isSupabaseMissingColumn({ code: "42703" })).toBe(true);
    });

    it("detecta pela mensagem", () => {
        expect(isSupabaseMissingColumn({ message: 'column "foo" does not exist' })).toBe(true);
    });

    it("não acusa falso positivo", () => {
        expect(isSupabaseMissingColumn(null)).toBe(false);
        expect(isSupabaseMissingColumn({ message: "row does not exist" })).toBe(false);
    });
});

describe("isSupabasePolicyRecursion", () => {
    it("detecta código 42P17 e mensagem de recursão", () => {
        expect(isSupabasePolicyRecursion({ code: "42P17" })).toBe(true);
        expect(
            isSupabasePolicyRecursion({ message: "infinite recursion detected in policy for relation x" }),
        ).toBe(true);
    });

    it("não acusa falso positivo", () => {
        expect(isSupabasePolicyRecursion({ code: "42P01" })).toBe(false);
    });
});

describe("getSupabaseErrorMessage", () => {
    it("combina message e details quando diferentes", () => {
        expect(getSupabaseErrorMessage({ message: "Erro A", details: "Detalhe B" })).toBe("Erro A Detalhe B");
    });

    it("não duplica quando message contém details", () => {
        expect(getSupabaseErrorMessage({ message: "Erro A com Detalhe", details: "Detalhe" })).toBe(
            "Erro A com Detalhe",
        );
    });

    it("retorna vazio sem erro", () => {
        expect(getSupabaseErrorMessage(null)).toBe("");
    });
});
