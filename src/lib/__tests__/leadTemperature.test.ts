import { describe, expect, it, vi } from "vitest";

vi.mock("../../utility", () => ({ supabaseClient: {} }));

import {
    isAutomaticLeadTemperature,
    isLeadTemperature,
    resolveAutomaticLeadTemperature,
    resolveEditableLeadTemperature,
    resolveLeadTemperature,
} from "../leadTemperature";

describe("resolveAutomaticLeadTemperature", () => {
    it("status fechado/ganho vira temperatura automática 'fechado'", () => {
        expect(resolveAutomaticLeadTemperature("Fechado")).toBe("fechado");
        expect(resolveAutomaticLeadTemperature("Negócio GANHO")).toBe("fechado");
    });

    it("status perdido vira 'perdido'", () => {
        expect(resolveAutomaticLeadTemperature("Perdido")).toBe("perdido");
    });

    it("status intermediário não gera temperatura automática", () => {
        expect(resolveAutomaticLeadTemperature("Em Negociação")).toBeUndefined();
        expect(resolveAutomaticLeadTemperature(null)).toBeUndefined();
        expect(resolveAutomaticLeadTemperature("")).toBeUndefined();
    });
});

describe("resolveLeadTemperature", () => {
    it("prioriza a temperatura automática do status", () => {
        expect(resolveLeadTemperature({ status: "Fechado", temperatura: "quente" })).toBe("fechado");
    });

    it("usa a temperatura do registro quando status não é terminal", () => {
        expect(resolveLeadTemperature({ status: "Novo Lead", temperatura: "quente" })).toBe("quente");
    });

    it("retorna undefined sem dados", () => {
        expect(resolveLeadTemperature(null)).toBeUndefined();
        expect(resolveLeadTemperature({})).toBeUndefined();
    });
});

describe("resolveEditableLeadTemperature", () => {
    it("só retorna temperaturas editáveis (frio/morno/quente)", () => {
        expect(resolveEditableLeadTemperature({ status: "Novo", temperatura: "morno" })).toBe("morno");
        expect(resolveEditableLeadTemperature({ status: "Fechado", temperatura: "morno" })).toBeUndefined();
    });
});

describe("type guards", () => {
    it("isLeadTemperature aceita apenas frio/morno/quente", () => {
        expect(isLeadTemperature("quente")).toBe(true);
        expect(isLeadTemperature("fechado")).toBe(false);
        expect(isLeadTemperature(null)).toBe(false);
    });

    it("isAutomaticLeadTemperature aceita apenas fechado/perdido", () => {
        expect(isAutomaticLeadTemperature("fechado")).toBe(true);
        expect(isAutomaticLeadTemperature("quente")).toBe(false);
    });
});
