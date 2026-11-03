import { describe, expect, it } from "vitest";
import {
    campoDoCabecalho,
    chavesDeIdentidade,
    emLotesDe,
    mapearLinha,
    normalizarCabecalho,
    separarDuplicadasNaPlanilha,
    type LinhaImportada,
} from "../csvImport";

describe("cabeçalhos", () => {
    it("aceita variações de grafia, acento e maiúsculas", () => {
        expect(normalizarCabecalho(" E-mail ")).toBe("e_mail");
        expect(campoDoCabecalho("E-mail")).toBe("email");
        expect(campoDoCabecalho("Telefone/WhatsApp")).toBe("telefone");
        expect(campoDoCabecalho("Responsável")).toBe("responsavel");
        expect(campoDoCabecalho("Valor do negócio")).toBe("valor");
        expect(campoDoCabecalho("coluna estranha")).toBeUndefined();
    });
});

describe("mapearLinha", () => {
    it("REGRESSÃO: valor em formato brasileiro não vira zero", () => {
        const r = mapearLinha({ Nome: "Ana", Valor: "1.234,56", "Conta de luz": "R$ 350,00" }, 2);
        expect(r.ok && r.dados.valor).toBe(1234.56);
        expect(r.ok && r.dados.conta_energia_media).toBe(350);
    });

    it("rejeita linha sem identificação, com motivo e número da linha", () => {
        expect(mapearLinha({ Cidade: "Recife" }, 7)).toEqual({
            ok: false,
            erro: { linha: 7, motivo: "sem nome, telefone ou e-mail" },
        });
    });

    it("rejeita e-mail inválido e valor negativo", () => {
        const email = mapearLinha({ nome: "Bia", email: "bia@" }, 3);
        expect(email.ok).toBe(false);
        const negativo = mapearLinha({ nome: "Caio", valor: "-10" }, 4);
        expect(negativo.ok).toBe(false);
    });

    it("temperatura desconhecida vira nula em vez de gravar lixo", () => {
        const r = mapearLinha({ nome: "Davi", temperatura: "Fervendo" }, 5);
        expect(r.ok && r.dados.temperatura).toBeNull();
        const q = mapearLinha({ nome: "Davi", temperatura: "QUENTE" }, 5);
        expect(q.ok && q.dados.temperatura).toBe("quente");
    });
});

describe("duplicadas na planilha", () => {
    const linha = (n: number, extra: Partial<LinhaImportada>): LinhaImportada => ({
        linha: n,
        nome: `L${n}`,
        email: null,
        telefone: "",
        cpf_cnpj: null,
        responsavel: null,
        conta_energia_media: null,
        valor: null,
        status: null,
        temperatura: null,
        ...extra,
    });

    it("REGRESSÃO: mesmo telefone em formatos diferentes conta como repetido", () => {
        const { unicas, repetidas } = separarDuplicadasNaPlanilha([
            linha(2, { telefone: "(11) 99999-8888" }),
            linha(3, { telefone: "5511999998888" }),
            linha(4, { email: "X@Y.COM" }),
            linha(5, { email: "x@y.com" }),
            linha(6, { telefone: "11888887777" }),
        ]);
        expect(unicas.map((l) => l.linha)).toEqual([2, 4, 6]);
        expect(repetidas.map((l) => l.linha)).toEqual([3, 5]);
    });

    it("chaves usam só dígitos do documento", () => {
        expect(chavesDeIdentidade({ telefone: "", email: null, cpf_cnpj: "529.982.247-25" })).toEqual([
            "doc:52998224725",
        ]);
    });
});

describe("emLotesDe", () => {
    it("quebra em lotes", () => {
        expect(emLotesDe([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
    });
});
