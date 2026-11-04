import dayjs from "dayjs";
import { describe, expect, it } from "vitest";
import { extrairDadosExtras } from "../../hooks/useCustomFields";
import type { CustomFieldRecord } from "../../types/db";

const campo = (chave: string, tipo: CustomFieldRecord["tipo"] = "texto"): CustomFieldRecord => ({
    id: chave,
    entidade: "negocio",
    chave,
    label: chave,
    tipo,
});

const campos = [campo("origem"), campo("potencia", "numero"), campo("visita", "data")];

describe("extrairDadosExtras", () => {
    it("no cadastro omite campos vazios", () => {
        const saida = extrairDadosExtras({ dados_extras: { origem: "Site", potencia: "" } }, campos);
        expect(saida).toEqual({ origem: "Site" });
    });

    it("REGRESSÃO: na edição, campo esvaziado vai como null para ser apagado", () => {
        const saida = extrairDadosExtras({ dados_extras: { origem: "", potencia: 12 } }, campos, "editar");
        expect(saida).toEqual({ origem: null, potencia: 12, visita: null });
    });

    it("grava datas em ISO", () => {
        const saida = extrairDadosExtras({ dados_extras: { visita: dayjs("2026-11-02T13:00:00Z") } }, campos);
        expect(saida.visita).toBe("2026-11-02T13:00:00.000Z");
    });

    it("ignora chaves que não são campos do tenant", () => {
        const saida = extrairDadosExtras({ dados_extras: { intruso: "x" } }, campos);
        expect(saida).toEqual({});
    });
});
