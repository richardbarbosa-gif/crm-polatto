import { afterEach, describe, expect, it, vi } from "vitest";
import { buscarEnderecoPorCep, enderecoDaRespostaViaCep, formatarCep } from "../cep";

describe("cep", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("formata CEP enquanto digita", () => {
        expect(formatarCep("01310")).toBe("01310");
        expect(formatarCep("013101")).toBe("01310-1");
        expect(formatarCep("01310-100")).toBe("01310-100");
        expect(formatarCep("0131010099")).toBe("01310-100");
    });

    it("monta o endereço da resposta do ViaCEP", () => {
        expect(
            enderecoDaRespostaViaCep({ logradouro: "Avenida Paulista", bairro: "Bela Vista", localidade: "São Paulo", uf: "SP" }),
        ).toBe("Avenida Paulista, Bela Vista, São Paulo - SP");
        expect(enderecoDaRespostaViaCep({ localidade: "Ribeirão Preto", uf: "SP" })).toBe("Ribeirão Preto - SP");
    });

    it("não chama a rede com CEP incompleto", async () => {
        const fetchFalso = vi.fn();
        vi.stubGlobal("fetch", fetchFalso);
        await expect(buscarEnderecoPorCep("0131")).resolves.toEqual({ status: "nao_encontrado" });
        expect(fetchFalso).not.toHaveBeenCalled();
    });

    it("distingue encontrado, não encontrado e falha de rede", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({ ok: true, json: async () => ({ logradouro: "Rua A", localidade: "Franca", uf: "SP" }) }),
        );
        await expect(buscarEnderecoPorCep("14400-000")).resolves.toEqual({ status: "ok", endereco: "Rua A, Franca - SP" });

        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ erro: true }) }));
        await expect(buscarEnderecoPorCep("99999999")).resolves.toEqual({ status: "nao_encontrado" });

        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
        await expect(buscarEnderecoPorCep("14400000")).resolves.toEqual({ status: "falha" });
    });
});
