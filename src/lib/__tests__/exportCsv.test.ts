import { describe, expect, it } from "vitest";
import { rowsToCsv } from "../exportCsv";

const linhas = (csv: string) => csv.split(/\r?\n/);

describe("rowsToCsv — injeção de fórmula no export", () => {
    it.each([
        ["=HYPERLINK(\"http://evil\",\"x\")"],
        ["+5511999999999"],
        ["-2+3"],
        ["@SUM(A1)"],
        ["\t=1+1"],
        ["\r=1+1"],
    ])("neutraliza célula que começa com fórmula: %j", (valor) => {
        const csv = rowsToCsv([{ nome: valor }]);
        const celula = linhas(csv).slice(1).join("\n");
        expect(celula.startsWith("\"'")).toBe(true);
    });

    it("neutraliza fórmula com quebra de linha (a regex padrão do Papa deixaria passar)", () => {
        const csv = rowsToCsv([{ obs: "=WEBSERVICE(\"http://evil\")\nlinha 2" }]);
        expect(csv).toContain("\"'=WEBSERVICE");
    });

    it("mantém texto comum, números e cabeçalho intactos", () => {
        const csv = rowsToCsv([{ nome: "Maria Souza", valor: -150, email: "maria@teste.com" }]);
        const [cabecalho, linha] = linhas(csv);
        expect(cabecalho).toBe("nome;valor;email");
        expect(linha).toBe("Maria Souza;-150;maria@teste.com");
    });
});
