import { describe, expect, it } from "vitest";
import { lerRespostaPerfil, validarNome, validarNovaSenha, validarTelefonePerfil } from "../perfil";

describe("validarNome", () => {
    it("exige 2 a 120 caracteres", () => {
        expect(validarNome("Ana")).toBeNull();
        expect(validarNome(" A ")).not.toBeNull();
        expect(validarNome("x".repeat(121))).not.toBeNull();
    });
});

describe("validarTelefonePerfil", () => {
    it("opcional; aceita formatos comuns", () => {
        expect(validarTelefonePerfil("")).toBeNull();
        expect(validarTelefonePerfil("(11) 98888-7777")).toBeNull();
        expect(validarTelefonePerfil("+55 11 98888.7777")).toBeNull();
    });

    it("recusa letras, script e tamanho fora de 8..15 dígitos", () => {
        expect(validarTelefonePerfil("11 9999<script>")).not.toBeNull();
        expect(validarTelefonePerfil("ramal 12")).not.toBeNull();
        expect(validarTelefonePerfil("1234567")).not.toBeNull();
        expect(validarTelefonePerfil("1".repeat(16))).not.toBeNull();
    });
});

describe("validarNovaSenha", () => {
    it("mínimo de 8 e confirmação igual", () => {
        expect(validarNovaSenha("1234567", "1234567")).toMatch(/pelo menos 8/);
        expect(validarNovaSenha("segura123", "segura124")).toMatch(/confirmação/);
        expect(validarNovaSenha("segura123", "segura123")).toBeNull();
    });

    it("recusa só espaços e acima de 72 bytes", () => {
        expect(validarNovaSenha("        ", "        ")).toMatch(/espaços/);
        expect(validarNovaSenha("é".repeat(40), "é".repeat(40))).toMatch(/72/);
    });
});

describe("lerRespostaPerfil", () => {
    it("interpreta sucesso e erro da RPC", () => {
        expect(lerRespostaPerfil({ success: true, message: "Perfil atualizado." })).toEqual({ ok: true, mensagem: "Perfil atualizado." });
        expect(lerRespostaPerfil({ success: false, error: "Telefone inválido" })).toEqual({ ok: false, mensagem: "Telefone inválido" });
        expect(lerRespostaPerfil(null).ok).toBe(false);
    });
});
