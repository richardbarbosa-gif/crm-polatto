import { describe, expect, it } from "vitest";
import { canDelete, normalizarPapel, podeExcluirRegistro, rotuloDoPapel, type ContextoDeDono } from "../permissions";

describe("canDelete (excluir qualquer registro / configurar = gerente)", () => {
    it("superadmin sempre pode, mesmo sem role", () => {
        expect(canDelete(null, true)).toBe(true);
        expect(canDelete("vendedor", true)).toBe(true);
    });

    it("papéis de gerência podem (mesmos termos de eh_admin_do_tenant no banco)", () => {
        for (const papel of ["admin", "Administrador", "superadmin", "owner", "gerente", "Gerente", "gestor", "manager"]) {
            expect(canDelete(papel)).toBe(true);
        }
    });

    it("vendedor e papel vazio não podem", () => {
        expect(canDelete("vendedor")).toBe(false);
        expect(canDelete(null)).toBe(false);
        expect(canDelete(undefined)).toBe(false);
        expect(canDelete("")).toBe(false);
        expect(canDelete("   ")).toBe(false);
    });
});

describe("papel normalizado e rótulo", () => {
    it("só existem gerente e vendedor", () => {
        expect(normalizarPapel("admin")).toBe("gerente");
        expect(normalizarPapel("gestor")).toBe("gerente");
        expect(normalizarPapel("vendedor")).toBe("vendedor");
        expect(normalizarPapel(null)).toBe("vendedor");
    });

    it("rótulo exibido na tela", () => {
        expect(rotuloDoPapel("admin")).toBe("Gerente");
        expect(rotuloDoPapel("vendedor")).toBe("Vendedor");
        expect(rotuloDoPapel("superadmin")).toBe("Superadmin");
    });
});

describe("podeExcluirRegistro (vendedor só o que é dele; gerente tudo)", () => {
    const ana: ContextoDeDono = {
        ehGerente: false,
        userId: "uid-ana",
        funcionarioId: "func-ana",
        nomesNormalizados: ["ana vendas", "ana@empresa.com"],
    };

    it("gerente exclui qualquer registro", () => {
        expect(podeExcluirRegistro({ created_by: "outro", responsavel: "Bruno" }, { ...ana, ehGerente: true })).toBe(true);
    });

    it("vendedor exclui o que cadastrou", () => {
        expect(podeExcluirRegistro({ created_by: "uid-ana", responsavel: "Bruno" }, ana)).toBe(true);
    });

    it("vendedor exclui o que está sob responsabilidade dele (id ou nome)", () => {
        expect(podeExcluirRegistro({ responsavel_id: "func-ana" }, ana)).toBe(true);
        expect(podeExcluirRegistro({ responsavel_id: "uid-ana" }, ana)).toBe(true);
        expect(podeExcluirRegistro({ responsavel: "  Ana Vendas " }, ana)).toBe(true);
    });

    it("vendedor NÃO exclui o de outro vendedor", () => {
        expect(podeExcluirRegistro({ created_by: "uid-bruno", responsavel: "Bruno Vendas" }, ana)).toBe(false);
        expect(podeExcluirRegistro({ responsavel_id: "func-bruno" }, ana)).toBe(false);
    });

    it("registro antigo sem autor nem responsável: só gerente", () => {
        expect(podeExcluirRegistro({}, ana)).toBe(false);
        expect(podeExcluirRegistro(null, ana)).toBe(false);
        expect(podeExcluirRegistro({}, { ...ana, ehGerente: true })).toBe(true);
    });

    it("parte do nome não basta (o banco compara nome inteiro)", () => {
        expect(podeExcluirRegistro({ responsavel: "Ana" }, ana)).toBe(false);
    });
});
