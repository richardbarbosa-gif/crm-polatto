import { describe, expect, it } from "vitest";
import {
    aplicarModelo,
    emailValido,
    linkEmailModelo,
    linkWhatsAppModelo,
    montarDadosModelo,
    primeiroNome,
    telefoneWhatsApp,
    variaveisSemValor,
} from "../modelosMensagem";

const dados = montarDadosModelo({
    nomeCliente: "  Maria da Silva ",
    empresa: "Sol & Cia",
    vendedor: "Ana Vendas",
    valor: 28500.5,
    propostaNumero: "2026-0007",
    validade: "2026-11-20",
});

describe("montarDadosModelo", () => {
    it("formata nome, valor em reais e validade dd/mm/aaaa", () => {
        expect(dados.nome).toBe("Maria da Silva");
        expect(dados.primeiro_nome).toBe("Maria");
        expect(dados.valor?.replace(/\s/g, " ")).toBe("R$ 28.500,50");
        expect(dados.validade).toBe("20/11/2026");
        expect(dados.proposta_numero).toBe("2026-0007");
    });

    it("valor zero, ausente ou inválido não vira 'R$ 0,00'", () => {
        expect(montarDadosModelo({ valor: 0 }).valor).toBe("");
        expect(montarDadosModelo({ valor: null }).valor).toBe("");
        expect(montarDadosModelo({ valor: Number.NaN }).valor).toBe("");
        expect(montarDadosModelo({ validade: "lixo" }).validade).toBe("");
    });

    it("primeiro nome de nome vazio é vazio", () => {
        expect(primeiroNome("")).toBe("");
        expect(primeiroNome(null)).toBe("");
    });
});

describe("aplicarModelo", () => {
    it("substitui todas as variáveis", () => {
        const texto = "Olá, {primeiro_nome}! Aqui é {vendedor}, da {empresa}. Proposta {proposta_numero}: {valor} até {validade}. ({nome})";
        expect(aplicarModelo(texto, dados).replace(/\s/g, " ")).toBe(
            "Olá, Maria! Aqui é Ana Vendas, da Sol & Cia. Proposta 2026-0007: R$ 28.500,50 até 20/11/2026. (Maria da Silva)",
        );
    });

    it("variável repetida é trocada em todas as ocorrências", () => {
        expect(aplicarModelo("{primeiro_nome} {primeiro_nome}", dados)).toBe("Maria Maria");
    });

    it("valor com {variavel} não é reinterpretado (uma passada só)", () => {
        expect(aplicarModelo("Oi {nome}", { nome: "{vendedor}", vendedor: "X" })).toBe("Oi {vendedor}");
    });

    it("variável sem valor some sem deixar espaço duplo nem espaço antes da pontuação", () => {
        expect(aplicarModelo("Segue a proposta {proposta_numero} , no valor de {valor}.", {})).toBe(
            "Segue a proposta, no valor de.",
        );
        expect(aplicarModelo("Olá, {primeiro_nome} !", {})).toBe("Olá,!");
    });

    it("variável desconhecida fica visível para o vendedor corrigir", () => {
        expect(aplicarModelo("Oi {apelido}", dados)).toBe("Oi {apelido}");
    });

    it("preserva quebras de linha (e-mail)", () => {
        expect(aplicarModelo("Olá, {primeiro_nome},\n\nAbraço,\n{vendedor}", dados)).toBe(
            "Olá, Maria,\n\nAbraço,\nAna Vendas",
        );
    });

    it("lista as variáveis usadas que estão sem valor", () => {
        expect(variaveisSemValor("{nome} {proposta_numero} {validade} {x}", { nome: "A" })).toEqual([
            "proposta_numero",
            "validade",
        ]);
    });
});

describe("telefoneWhatsApp", () => {
    it("Brasil: DDD + número ganham o 55", () => {
        expect(telefoneWhatsApp("(11) 99999-8888")).toBe("5511999998888");
        expect(telefoneWhatsApp("1133334444", "+55")).toBe("551133334444");
        expect(telefoneWhatsApp("+55 11 99999-8888")).toBe("5511999998888");
    });

    it("número incompleto ou vazio não gera link", () => {
        expect(telefoneWhatsApp("9999-8888")).toBeNull();
        expect(telefoneWhatsApp("")).toBeNull();
        expect(telefoneWhatsApp(null)).toBeNull();
    });

    it("outro país usa o DDI do lead", () => {
        expect(telefoneWhatsApp("912345678", "+351")).toBe("351912345678");
    });
});

describe("linkWhatsAppModelo", () => {
    it("codifica o texto inteiro: & ? # e quebra de linha não viram parâmetros", () => {
        const link = linkWhatsAppModelo("11999998888", "Sol & Cia?\n#1 100% solar", "+55");
        expect(link).toBe("https://wa.me/5511999998888?text=Sol%20%26%20Cia%3F%0A%231%20100%25%20solar");
        const url = new URL(link as string);
        expect([...url.searchParams.keys()]).toEqual(["text"]);
        expect(url.searchParams.get("text")).toBe("Sol & Cia?\n#1 100% solar");
    });

    it("sem telefone válido devolve null; sem texto abre só a conversa", () => {
        expect(linkWhatsAppModelo("123", "oi")).toBeNull();
        expect(linkWhatsAppModelo("11999998888", "  ")).toBe("https://wa.me/5511999998888");
    });
});

describe("linkEmailModelo", () => {
    it("codifica assunto e corpo (espaço vira %20, não +)", () => {
        const link = linkEmailModelo("cliente@teste.com", "Proposta - Sol & Cia", "Olá,\n\nValor: R$ 10,00 & mais");
        expect(link).toBe(
            "mailto:cliente@teste.com?subject=Proposta%20-%20Sol%20%26%20Cia&body=Ol%C3%A1%2C%0A%0AValor%3A%20R%24%2010%2C00%20%26%20mais",
        );
    });

    it("recusa destino que injeta cc/bcc ou parâmetros", () => {
        expect(linkEmailModelo("a@b.com?bcc=x@y.com", "a", "b")).toBeNull();
        expect(linkEmailModelo("a@b.com&cc=x@y.com", "a", "b")).toBeNull();
        expect(linkEmailModelo("a@b.com,x@y.com", "a", "b")).toBeNull();
        expect(linkEmailModelo("sem-arroba", "a", "b")).toBeNull();
        expect(emailValido(" cliente@teste.com ")).toBe(true);
    });

    it("sem assunto nem corpo gera só o endereço", () => {
        expect(linkEmailModelo("cliente@teste.com", "", " ")).toBe("mailto:cliente@teste.com");
    });
});
