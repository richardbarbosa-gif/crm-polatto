import { describe, expect, it } from "vitest";
import { lerStatusPrimeiroAcesso, montarChecklist, PASSOS_PRIMEIRO_ACESSO } from "../primeiroAcesso";

const status = (parcial: Partial<Record<string, boolean>> = {}) => ({
    identidade: false,
    produtos: false,
    equipe: false,
    funil: false,
    primeiro_lead: false,
    dispensado: false,
    ...parcial,
});

describe("lerStatusPrimeiroAcesso", () => {
    it("aceita a resposta completa da RPC", () => {
        expect(lerStatusPrimeiroAcesso(status({ produtos: true }))).toMatchObject({ produtos: true, equipe: false });
    });

    it("resposta nula, incompleta ou com tipo errado vira null", () => {
        expect(lerStatusPrimeiroAcesso(null)).toBeNull();
        expect(lerStatusPrimeiroAcesso([])).toBeNull();
        expect(lerStatusPrimeiroAcesso({ identidade: true })).toBeNull();
        expect(lerStatusPrimeiroAcesso({ ...status(), funil: "sim" })).toBeNull();
    });

    it("ignora chaves extras", () => {
        expect(lerStatusPrimeiroAcesso({ ...status(), extra: 1 })).not.toHaveProperty("extra");
    });
});

describe("montarChecklist", () => {
    it("os 5 passos na ordem pedida", () => {
        expect(PASSOS_PRIMEIRO_ACESSO.map((p) => p.chave)).toEqual([
            "identidade",
            "produtos",
            "equipe",
            "funil",
            "primeiro_lead",
        ]);
    });

    it("marca o que o banco disse que está feito e calcula o progresso", () => {
        const c = montarChecklist(lerStatusPrimeiroAcesso(status({ identidade: true, primeiro_lead: true })), true);
        expect(c.itens.filter((i) => i.feito).map((i) => i.chave)).toEqual(["identidade", "primeiro_lead"]);
        expect([c.feitos, c.total, c.percentual, c.completo, c.visivel]).toEqual([2, 5, 40, false, true]);
    });

    it("some para vendedor, quando dispensado, quando completo ou sem resposta", () => {
        expect(montarChecklist(lerStatusPrimeiroAcesso(status()), false).visivel).toBe(false);
        expect(montarChecklist(lerStatusPrimeiroAcesso(status({ dispensado: true })), true).visivel).toBe(false);
        const tudo = status({ identidade: true, produtos: true, equipe: true, funil: true, primeiro_lead: true });
        const completo = montarChecklist(lerStatusPrimeiroAcesso(tudo), true);
        expect([completo.completo, completo.visivel, completo.percentual]).toEqual([true, false, 100]);
        expect(montarChecklist(null, true).visivel).toBe(false);
    });
});
