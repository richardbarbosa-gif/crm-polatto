import { describe, expect, it } from "vitest";
import { safeReportUrl } from "../safeReportUrl";

describe("safeReportUrl — URL enviada ao monitoramento de erros", () => {
    it("remove tokens do hash do link de recuperação de senha", () => {
        const url = safeReportUrl(
            "https://crm.polatto.com.br/update-password#access_token=eyJhbGciOi.x.y&refresh_token=abc&type=recovery",
        );
        expect(url).toBe("https://crm.polatto.com.br/update-password");
    });

    it("remove query string (busca, e-mail em filtro, code do OAuth)", () => {
        expect(safeReportUrl("https://crm.polatto.com.br/clientes?q=maria%40x.com&code=123")).toBe(
            "https://crm.polatto.com.br/clientes",
        );
    });

    it("mantém origem e caminho, que é o que importa para o diagnóstico", () => {
        expect(safeReportUrl("https://crm.polatto.com.br/clientes/show/42")).toBe(
            "https://crm.polatto.com.br/clientes/show/42",
        );
    });

    it("lida com valor vazio ou relativo", () => {
        expect(safeReportUrl(undefined)).toBeNull();
        expect(safeReportUrl("")).toBeNull();
        expect(safeReportUrl("/agenda?x=1#y")).toBe("/agenda");
    });
});
