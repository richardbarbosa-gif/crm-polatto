import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CAMPO_BUSCA_SEM_ACENTO, MAPA_DE_ACENTOS, filtroBuscaSemAcento, semAcento } from "../buscaSemAcento";

describe("semAcento", () => {
    it("troca só a letra acentuada e mantém maiúscula/minúscula", () => {
        expect(semAcento("João Conceição ÁVILA, Ñandú ÿ")).toBe("Joao Conceicao AVILA, Nandu y");
    });

    it("não mexe em número, e-mail, telefone nem pontuação", () => {
        expect(semAcento("+55 (11) 98888-7777 joão@empresa.com.br")).toBe("+55 (11) 98888-7777 joao@empresa.com.br");
        expect(semAcento("")).toBe("");
    });
});

describe("filtroBuscaSemAcento", () => {
    it("vira um ILIKE na coluna calculada com o termo sem acento", () => {
        expect(filtroBuscaSemAcento("José")).toEqual({
            field: CAMPO_BUSCA_SEM_ACENTO,
            operator: "contains",
            value: "Jose",
        });
    });
});

describe("paridade com o banco", () => {
    it("o mapa de letras é o mesmo de public.sem_acento (migration 23)", () => {
        const sql = readFileSync(
            resolve(__dirname, "../../../database/migrations/2026-11-17_23_busca_sem_acento.sql"),
            "utf8",
        );
        const translate = /translate\(\s*p_texto,\s*'([^']+)',\s*'([^']+)'\s*\)/.exec(sql);
        expect(translate).not.toBeNull();
        expect(translate?.[1]).toBe(MAPA_DE_ACENTOS.COM_ACENTO);
        expect(translate?.[2]).toBe(MAPA_DE_ACENTOS.SEM_ACENTO);
        expect(MAPA_DE_ACENTOS.COM_ACENTO.length).toBe(MAPA_DE_ACENTOS.SEM_ACENTO.length);
    });
});
