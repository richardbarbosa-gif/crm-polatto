import { describe, expect, it } from "vitest";
import { calcularItem, calcularOrcamento } from "../orcamentos/calculo";
import {
    contraste,
    corDeTextoSobre,
    corLegivelEmBranco,
    ehCorHex,
    estaVencido,
    formatarDataIso,
    hexParaRgb,
    hojeEmBrasilia,
    linkEmail,
    linkWhatsApp,
    mensagemProposta,
    nomeArquivoProposta,
    somarDias,
    telefoneParaWhatsApp,
} from "../orcamentos/formato";
import { gerarPropostaPdf, textoPdf } from "../orcamentos/pdf";

describe("calcularItem / calcularOrcamento (mesma regra do trigger do banco)", () => {
    it("item com desconto percentual: 10 x 1.234,56 - 10% = 11.111,04", () => {
        expect(
            calcularItem({ quantidade: 10, valor_unitario: 1234.56, desconto_tipo: "percentual", desconto_valor: 10 }),
        ).toEqual({ bruto: 12345.6, desconto: 1234.56, total: 11111.04 });
    });

    it("bate com os cenários da suíte SQL 7 (O3)", () => {
        const itens = [
            { quantidade: 10, valor_unitario: 1234.56, desconto_tipo: "percentual" as const, desconto_valor: 10 },
            { quantidade: 1, valor_unitario: 2500, desconto_tipo: "valor" as const, desconto_valor: 100 },
        ];
        expect(calcularOrcamento(itens).total).toBe(13511.04);
        const comDesconto = calcularOrcamento(itens, { tipo: "percentual", valor: 5 });
        expect(comDesconto.desconto).toBe(675.55);
        expect(comDesconto.total).toBe(12835.49);
        expect(calcularOrcamento([itens[0], { ...itens[1], quantidade: 2.5 }]).total).toBe(17261.04);
    });

    it("usa aritmética decimal exata (sem erro de ponto flutuante)", () => {
        // 2,5 × 0,07 = 0,175 → 0,18 (em float daria 0,17499999… → 0,17)
        expect(calcularItem({ quantidade: 2.5, valor_unitario: 0.07 }).total).toBe(0.18);
        // 0,1 + 0,2 não vira 0,30000000000000004
        expect(calcularOrcamento([
            { quantidade: 1, valor_unitario: 0.1 },
            { quantidade: 1, valor_unitario: 0.2 },
        ]).subtotal).toBe(0.3);
        // meio centavo arredonda para cima, como round() do numeric
        expect(calcularItem({ quantidade: 1, valor_unitario: 0.05, desconto_tipo: "percentual", desconto_valor: 10 }).desconto).toBe(0.01);
        expect(calcularItem({ quantidade: 3, valor_unitario: 33.33 }).total).toBe(99.99);
        expect(calcularItem({ quantidade: 0.333, valor_unitario: 10 }).total).toBe(3.33);
    });

    it("desconto nunca deixa total negativo e percentual é limitado a 100%", () => {
        expect(calcularItem({ quantidade: 1, valor_unitario: 50, desconto_valor: 80 })).toEqual({ bruto: 50, desconto: 50, total: 0 });
        expect(calcularItem({ quantidade: 1, valor_unitario: 50, desconto_tipo: "percentual", desconto_valor: 150 }).total).toBe(0);
        expect(calcularOrcamento([{ quantidade: 1, valor_unitario: 100 }], { tipo: "valor", valor: 500 })).toMatchObject({
            subtotal: 100,
            desconto: 100,
            total: 0,
        });
    });

    it("aceita string com vírgula e trata vazio/negativo/inválido como zero", () => {
        expect(calcularItem({ quantidade: "2,5", valor_unitario: "10" }).total).toBe(25);
        expect(calcularItem({ quantidade: "", valor_unitario: 10 }).total).toBe(0);
        expect(calcularItem({ quantidade: -1, valor_unitario: 10 }).total).toBe(0);
        expect(calcularItem({ quantidade: "abc", valor_unitario: 10 }).total).toBe(0);
        expect(calcularOrcamento([]).total).toBe(0);
    });

    it("valores grandes continuam exatos", () => {
        // 1.234,567 × 98.765,43 = 121.932.540,61881 → 121.932.540,62 (cabe em numeric(14,2))
        expect(calcularItem({ quantidade: 1234.567, valor_unitario: 98765.43 }).total).toBe(121932540.62);
    });
});

describe("formato do orçamento", () => {
    it("nome do arquivo sanitizado: sem acento, barra, ponto ou espaço", () => {
        expect(nomeArquivoProposta("2026-0001", "João Conceição / Araújo")).toBe("Proposta-2026-0001-Joao-Conceicao-Araujo.pdf");
        expect(nomeArquivoProposta("2026-0001", "../../etc/passwd")).toBe("Proposta-2026-0001-etc-passwd.pdf");
        expect(nomeArquivoProposta("2026-0001", "   ")).toBe("Proposta-2026-0001-cliente.pdf");
        expect(nomeArquivoProposta("2026-0001", "<script>alert(1)</script>")).toBe("Proposta-2026-0001-script-alert-1-script.pdf");
        expect(nomeArquivoProposta("2026-0001", "A".repeat(200)).length).toBeLessThanOrEqual(100);
    });

    it("telefone para wa.me: acrescenta 55 e respeita DDI estrangeiro", () => {
        expect(telefoneParaWhatsApp("(16) 99999-0000")).toBe("5516999990000");
        expect(telefoneParaWhatsApp("1633334444")).toBe("551633334444");
        expect(telefoneParaWhatsApp("+55 (16) 99999-0000")).toBe("5516999990000");
        expect(telefoneParaWhatsApp("016 99999-0000")).toBe("5516999990000");
        expect(telefoneParaWhatsApp("99999-0000")).toBeNull();
        expect(telefoneParaWhatsApp("")).toBeNull();
        expect(telefoneParaWhatsApp("(212) 555-0100", "+1")).toBe("12125550100");
        expect(telefoneParaWhatsApp("912345678", "+351")).toBe("351912345678");
    });

    it("link do WhatsApp codifica a mensagem; sem telefone válido não gera link", () => {
        const link = linkWhatsApp("(16) 99999-0000", "Olá & até já? #1");
        expect(link).toBe("https://wa.me/5516999990000?text=Ol%C3%A1%20%26%20at%C3%A9%20j%C3%A1%3F%20%231");
        expect(linkWhatsApp("123", "x")).toBeNull();
    });

    it("mailto só com e-mail válido e sem injeção de parâmetros", () => {
        expect(linkEmail("cliente@exemplo.com", "Proposta 2026-0001", "Olá\nSegue")).toBe(
            "mailto:cliente@exemplo.com?subject=Proposta%202026-0001&body=Ol%C3%A1%0ASegue",
        );
        expect(linkEmail("x@y.com?bcc=espiao@mal.com", "a", "b")).toBeNull();
        expect(linkEmail("javascript:alert(1)", "a", "b")).toBeNull();
        expect(linkEmail("", "a", "b")).toBeNull();
    });

    it("mensagem da proposta orienta o cliente sobre o PDF em anexo", () => {
        const texto = mensagemProposta({
            cliente: "João Araújo",
            numero: "2026-0001",
            total: 28544.61,
            validoAte: "2026-11-18",
            empresa: "Polatto Energia Solar",
            vendedor: "Mariana",
        });
        expect(texto).toContain("Olá, João!");
        expect(texto).toContain("proposta 2026-0001 da Polatto Energia Solar");
        expect(texto).toMatch(/R\$\s28\.544,61/);
        expect(texto).toContain("válida até 18/11/2026");
        expect(texto).toContain("em anexo");
        expect(texto.endsWith("Mariana")).toBe(true);
    });

    it("datas sem armadilha de fuso", () => {
        expect(formatarDataIso("2026-11-03")).toBe("03/11/2026");
        expect(formatarDataIso(null)).toBe("");
        expect(somarDias("2026-12-25", 10)).toBe("2027-01-04");
        expect(somarDias("2028-02-28", 1)).toBe("2028-02-29");
        // 02:30 UTC de 4/nov ainda é 3/nov em Brasília
        expect(hojeEmBrasilia(new Date("2026-11-04T02:30:00Z"))).toBe("2026-11-03");
    });

    it("vencido só para proposta em aberto com validade passada", () => {
        expect(estaVencido("2026-11-02", "enviado", "2026-11-03")).toBe(true);
        expect(estaVencido("2026-11-03", "enviado", "2026-11-03")).toBe(false);
        expect(estaVencido("2026-11-02", "aceito", "2026-11-03")).toBe(false);
        expect(estaVencido(null, "rascunho", "2026-11-03")).toBe(false);
    });

    it("cores: hex validado e texto sempre legível sobre a cor da marca", () => {
        expect(ehCorHex("#0F4C81")).toBe(true);
        expect(ehCorHex("#0F4C8")).toBe(false);
        expect(ehCorHex("red")).toBe(false);
        expect(ehCorHex("#0F4C81;background:url(x)")).toBe(false);
        expect(hexParaRgb("#0F4C81")).toEqual([15, 76, 129]);
        expect(hexParaRgb("inválida")).toEqual([15, 76, 129]);
        expect(corDeTextoSobre([15, 76, 129])).toEqual([255, 255, 255]);
        expect(corDeTextoSobre([255, 224, 102])).toEqual([17, 24, 39]);
        const amareloEscurecido = corLegivelEmBranco([255, 224, 102]);
        expect(contraste(amareloEscurecido, [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
        expect(corLegivelEmBranco([15, 76, 129])).toEqual([15, 76, 129]);
    });
});

describe("textoPdf (fonte padrão WinAnsi)", () => {
    it("preserva todos os acentos do português e a pontuação tipográfica", () => {
        const texto = "Ação, coração, pão, põe, é, ê, à, ü, Ç, º, ª, “aspas”, ‘x’, — – … • €";
        expect(textoPdf(texto)).toBe(texto);
    });

    it("troca ou remove o que a fonte não desenha, sem quebrar a linha", () => {
        expect(textoPdf("Economia → 92% ✓")).toBe("Economia -> 92% v");
        expect(textoPdf("Oferta 😀 imperdível")).toBe("Oferta  imperdível");
        expect(textoPdf("Gőd")).toBe("God");
        expect(textoPdf("a\u0000b\u0007c")).toBe("abc");
        expect(textoPdf("linha 1  \nlinha 2")).toBe("linha 1\nlinha 2");
        expect(textoPdf(null)).toBe("");
    });
});

describe("gerarPropostaPdf", () => {
    const dados = {
        empresa: { nomeFantasia: "Polatto Energia Solar", corPrimaria: "#0F4C81", corSecundaria: "#F2A900", rodape: "Rodapé" },
        cliente: { nome: "João Araújo", documento: "123.456.789-09" },
        orcamento: { numero: "2026-0001", dataEmissao: "2026-11-03", validoAte: "2026-11-18", vendedorNome: "Mariana" },
        itens: [{ descricao: "Módulo 550 W", quantidade: 10, valorUnitario: 1234.56 }],
    };

    const paginas = async (blob: Blob) => {
        const bruto = Buffer.from(await blob.arrayBuffer()).toString("latin1");
        expect(bruto.startsWith("%PDF-")).toBe(true);
        return Number(/\/Type \/Pages\s*\/Kids \[[^\]]*\]\s*\/Count (\d+)/.exec(bruto)?.[1]);
    };

    it("gera um PDF de uma página para uma proposta simples", async () => {
        const blob = await gerarPropostaPdf(dados);
        expect(blob.type).toBe("application/pdf");
        expect(await paginas(blob)).toBe(1);
    });

    it("revisão sai com \"Rev. N\" ao lado do número (título do documento e corpo)", async () => {
        const blob = await gerarPropostaPdf({ ...dados, orcamento: { ...dados.orcamento, numero: "2026-0005", revisao: 2 } });
        expect(await paginas(blob)).toBe(1);
        const bruto = Buffer.from(await blob.arrayBuffer()).toString("latin1");
        // metadado /Title do PDF (parênteses escapados pela sintaxe do PDF)
        expect(bruto).toContain("/Title (Proposta 2026-0005 \\(Rev. 2\\)");
    });

    it("quebra em várias páginas sem perder itens e sem logo", async () => {
        const itens = Array.from({ length: 60 }, (_, i) => ({
            descricao: `Item ${i + 1} com descrição longa o bastante para quebrar em duas linhas na coluna`,
            detalhes: "Detalhe técnico do item",
            quantidade: 1,
            valorUnitario: 10,
        }));
        expect(await paginas(await gerarPropostaPdf({ ...dados, itens, logo: null }))).toBeGreaterThan(2);
    });

    it("não quebra com orçamento sem itens, cores inválidas e campos vazios", async () => {
        const blob = await gerarPropostaPdf({
            empresa: { corPrimaria: "azul", corSecundaria: null },
            cliente: {},
            orcamento: { numero: "", dataEmissao: "", validoAte: "" },
            itens: [],
        });
        expect(await paginas(blob)).toBe(1);
    });
});
