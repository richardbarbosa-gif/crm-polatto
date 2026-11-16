import { describe, expect, it } from "vitest";
import { limparTermoDeBusca } from "../useBuscaNoServidor";

describe("limparTermoDeBusca", () => {
    it("remove o que quebraria o filtro or do PostgREST e apara espaços", () => {
        expect(limparTermoDeBusca("  Silva, João (ME)  ")).toBe("Silva  João  ME");
    });

    it("mantém e-mail, telefone e acentos", () => {
        expect(limparTermoDeBusca("joão@empresa.com.br")).toBe("joão@empresa.com.br");
        expect(limparTermoDeBusca("+55 11 98888-7777")).toBe("+55 11 98888-7777");
    });

    it("só pontuação vira busca vazia (sem filtro)", () => {
        expect(limparTermoDeBusca("(,)")).toBe("");
    });
});
