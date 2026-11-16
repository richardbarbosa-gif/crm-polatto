import { describe, expect, it } from "vitest";
import { traduzirErroDeAuth } from "../errosDeAutenticacao";

describe("traduzirErroDeAuth", () => {
    it("traduz pelo código do Supabase", () => {
        expect(traduzirErroDeAuth({ code: "invalid_credentials", message: "Invalid login credentials" }, "Não foi possível entrar")).toEqual({
            name: "Não foi possível entrar",
            message: "E-mail ou senha incorretos.",
        });
    });

    it("sem código, reconhece o texto em inglês", () => {
        expect(traduzirErroDeAuth(new Error("Email not confirmed"), "x").message).toMatch(/Confirme seu e-mail/);
        expect(traduzirErroDeAuth(new Error("Failed to fetch"), "x").message).toMatch(/Sem conexão/);
    });

    it("nunca devolve o texto cru do serviço", () => {
        const { message } = traduzirErroDeAuth({ message: "AuthApiError: something odd" }, "x");
        expect(message).toBe("Não foi possível concluir. Tente novamente em instantes.");
    });
});
