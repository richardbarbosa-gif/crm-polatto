/**
 * PDF da proposta com a identidade visual da empresa.
 *
 * jsPDF e jspdf-autotable são carregados sob demanda (import dinâmico):
 * ficam num chunk próprio e só baixam quando alguém gera um PDF.
 *
 * Fonte: Helvetica padrão do PDF (WinAnsi). Cobre todo o português
 * (ç, ã, õ, é, ê, à, º, ª, —, “ ”) sem embutir arquivo de fonte. O que
 * estiver fora do WinAnsi (emoji, setas, CJK) é trocado por equivalente
 * ou removido em textoPdf(), em vez de sair como lixo no documento.
 *
 * Funciona no navegador e no Node (os testes geram o PDF de verdade).
 */
import type { CellDef } from "jspdf-autotable";
import { calcularOrcamento, type TipoDesconto } from "./calculo";
import {
    clarear,
    corDeTextoSobre,
    corLegivelEmBranco,
    formatarDataIso,
    formatarQuantidade,
    hexParaRgb,
    type Rgb,
} from "./formato";

export interface EmpresaPdf {
    nomeFantasia?: string | null;
    razaoSocial?: string | null;
    cnpj?: string | null;
    endereco?: string | null;
    telefone?: string | null;
    email?: string | null;
    site?: string | null;
    corPrimaria?: string | null;
    corSecundaria?: string | null;
    rodape?: string | null;
}

export interface ClientePdf {
    nome?: string | null;
    documento?: string | null;
    telefone?: string | null;
    email?: string | null;
    endereco?: string | null;
}

export interface ItemPdf {
    descricao: string;
    detalhes?: string | null;
    unidade?: string | null;
    quantidade: number;
    valorUnitario: number;
    descontoTipo?: TipoDesconto | null;
    descontoValor?: number | null;
}

export interface OrcamentoPdf {
    numero: string;
    titulo?: string | null;
    dataEmissao: string;
    validoAte: string;
    descontoTipo?: TipoDesconto | null;
    descontoValor?: number | null;
    condicoesPagamento?: string | null;
    observacoes?: string | null;
    vendedorNome?: string | null;
    vendedorEmail?: string | null;
    vendedorTelefone?: string | null;
    /** Totais gravados pelo banco. Se vierem, o PDF mostra exatamente estes. */
    totaisDoBanco?: { subtotal: number; desconto: number; total: number } | null;
}

export interface LogoPdf {
    dataUrl: string;
    largura: number;
    altura: number;
}

export interface DadosPropostaPdf {
    empresa: EmpresaPdf;
    cliente: ClientePdf;
    orcamento: OrcamentoPdf;
    itens: ItemPdf[];
    logo?: LogoPdf | null;
}

// ---------------------------------------------------------------------
// Texto seguro para a fonte padrão (WinAnsi)
// ---------------------------------------------------------------------

const TROCAS: Record<string, string> = {
    "\u2192": "->", "\u2190": "<-", "\u2194": "<->", "\u21D2": "=>",
    "\u2713": "v", "\u2714": "v", "\u2715": "x", "\u2716": "x", "\u2717": "x",
    "\u2212": "-", "\u2010": "-", "\u2011": "-", "\u2012": "-", "\u2015": "\u2014",
    "\u00A0": " ", "\u2007": " ", "\u2009": " ", "\u202F": " ", "\u200B": "",
    "\u2264": "<=", "\u2265": ">=", "\u2260": "!=", "\u2248": "~",
    "\u2032": "'", "\u2033": "\"", "\u00B4": "'",
};

// Caracteres fora do Latin-1 que o WinAnsi (cp1252) tem.
const CP1252_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

/** Normaliza o texto para o que a fonte padrão do PDF consegue desenhar. */
export const textoPdf = (valor?: string | null): string => {
    if (!valor) return "";
    let saida = "";
    for (const caractere of valor.normalize("NFC")) {
        const troca = TROCAS[caractere];
        if (troca !== undefined) {
            saida += troca;
            continue;
        }
        const codigo = caractere.codePointAt(0) ?? 0;
        if (caractere === "\n") saida += "\n";
        else if (caractere === "\t") saida += "    ";
        else if (codigo < 0x20 || (codigo >= 0x7f && codigo < 0xa0)) continue;
        else if (codigo <= 0xff || CP1252_EXTRA.has(caractere)) saida += caractere;
        else {
            // Letra acentuada fora do Latin-1 (ex.: "ő"): tira o acento.
            const base = caractere.normalize("NFD").replace(/[̀-ͯ]/g, "");
            if (base && [...base].every((c) => (c.codePointAt(0) ?? 0x100) <= 0xff)) saida += base;
        }
    }
    return saida.replace(/[ \t]+\n/g, "\n").trim();
};

const reais = (valor: number): string =>
    valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00A0/g, " ");

const percentual = (valor: number): string =>
    `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

// ---------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------

const PAGINA = { largura: 210, altura: 297 };
const MARGEM = 16;
const LARGURA_UTIL = PAGINA.largura - 2 * MARGEM;
const TOPO_CONTINUACAO = 24;
const LIMITE_INFERIOR = PAGINA.altura - 23;

const TINTA: Rgb = [31, 41, 55];
const CINZA: Rgb = [107, 114, 128];
const LINHA: Rgb = [229, 231, 235];

export const gerarPropostaPdf = async (dados: DadosPropostaPdf): Promise<Blob> => {
    const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);

    const { empresa, cliente, orcamento, itens, logo } = dados;
    const primaria = hexParaRgb(empresa.corPrimaria ?? "", [15, 76, 129]);
    const secundaria = hexParaRgb(empresa.corSecundaria ?? "", [242, 169, 0]);
    const primariaTexto = corLegivelEmBranco(primaria);
    const sobrePrimaria = corDeTextoSobre(primaria);
    const fundoSuave = clarear(primaria, 0.92);
    const fundoZebra = clarear(primaria, 0.96);

    const nomeEmpresa = textoPdf(empresa.nomeFantasia) || textoPdf(empresa.razaoSocial) || "Proposta comercial";
    const numero = textoPdf(orcamento.numero);

    const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
    doc.setProperties({
        title: `Proposta ${numero} - ${nomeEmpresa}`,
        subject: textoPdf(orcamento.titulo) || "Proposta comercial",
        author: nomeEmpresa,
        creator: "CRM Polatto",
    });
    doc.setLanguage("pt-BR");

    const cor = (rgb: Rgb) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);
    const preencher = (rgb: Rgb) => doc.setFillColor(rgb[0], rgb[1], rgb[2]);
    const tracar = (rgb: Rgb) => doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
    const fonte = (tamanho: number, estilo: "normal" | "bold" | "italic" = "normal") => {
        doc.setFont("helvetica", estilo);
        doc.setFontSize(tamanho);
    };
    const rotulo = (texto: string, x: number, y: number) => {
        fonte(7, "bold");
        cor(CINZA);
        doc.text(texto.toUpperCase(), x, y, { charSpace: 0.45 });
    };

    // Faixa da marca no topo de toda página
    const faixaTopo = () => {
        preencher(primaria);
        doc.rect(0, 0, PAGINA.largura, 4, "F");
        preencher(secundaria);
        doc.rect(PAGINA.largura - 58, 0, 58, 4, "F");
    };

    const cabecalhoContinuacao = () => {
        faixaTopo();
        fonte(8, "bold");
        cor(primariaTexto);
        doc.text(`Proposta ${numero}`, MARGEM, 13);
        fonte(8);
        cor(CINZA);
        doc.text(nomeEmpresa, PAGINA.largura - MARGEM, 13, { align: "right" });
        tracar(LINHA);
        doc.setLineWidth(0.2);
        doc.line(MARGEM, 16.5, PAGINA.largura - MARGEM, 16.5);
    };

    // ---------------- Cabeçalho da primeira página ----------------
    faixaTopo();
    const topo = 12;
    let alturaLogo = 0;
    if (logo) {
        const caixa = { largura: 56, altura: 22 };
        const escala = Math.min(caixa.largura / logo.largura, caixa.altura / logo.altura);
        const w = logo.largura * escala;
        const h = logo.altura * escala;
        doc.addImage(logo.dataUrl, "PNG", MARGEM, topo, w, h, undefined, "FAST");
        alturaLogo = h;
    } else {
        fonte(17, "bold");
        cor(primariaTexto);
        const linhas = doc.splitTextToSize(nomeEmpresa, 95) as string[];
        doc.text(linhas.slice(0, 2), MARGEM, topo + 7);
        alturaLogo = 7 + (Math.min(linhas.length, 2) - 1) * 7;
    }

    // Dados da empresa, alinhados à direita
    const xDireita = PAGINA.largura - MARGEM;
    let yEmpresa = topo + 3.5;
    if (logo) {
        fonte(11, "bold");
        cor(TINTA);
        doc.text(nomeEmpresa, xDireita, yEmpresa, { align: "right" });
        yEmpresa += 5;
    }
    const linhasEmpresa = [
        [textoPdf(empresa.razaoSocial), empresa.cnpj ? `CNPJ ${textoPdf(empresa.cnpj)}` : ""].filter(Boolean).join("  ·  "),
        textoPdf(empresa.endereco),
        [textoPdf(empresa.telefone), textoPdf(empresa.email), textoPdf(empresa.site)].filter(Boolean).join("  ·  "),
    ].filter(Boolean);
    fonte(8);
    cor(CINZA);
    for (const linha of linhasEmpresa) {
        const partes = doc.splitTextToSize(linha, 100) as string[];
        doc.text(partes, xDireita, yEmpresa, { align: "right" });
        yEmpresa += partes.length * 3.8;
    }

    let y = Math.max(topo + alturaLogo, yEmpresa) + 5;
    tracar(LINHA);
    doc.setLineWidth(0.3);
    doc.line(MARGEM, y, xDireita, y);

    // ---------------- Título, número e datas ----------------
    y += 9;
    fonte(8, "bold");
    cor(primariaTexto);
    doc.text("PROPOSTA COMERCIAL", MARGEM, y, { charSpace: 0.8 });
    fonte(22, "bold");
    cor(TINTA);
    doc.text(`Nº ${numero}`, MARGEM, y + 9.5);
    let yTitulo = y + 9.5;
    const titulo = textoPdf(orcamento.titulo);
    if (titulo) {
        fonte(11);
        cor(CINZA);
        const linhasTitulo = (doc.splitTextToSize(titulo, 110) as string[]).slice(0, 2);
        doc.text(linhasTitulo, MARGEM, yTitulo + 6.5);
        yTitulo += 6.5 + (linhasTitulo.length - 1) * 4.8;
    }

    // Caixa de datas
    const caixaDatas = { largura: 62, altura: 21 };
    const xDatas = xDireita - caixaDatas.largura;
    preencher(fundoSuave);
    doc.roundedRect(xDatas, y - 4, caixaDatas.largura, caixaDatas.altura, 2, 2, "F");
    rotulo("Emissão", xDatas + 5, y + 1.5);
    rotulo("Válida até", xDatas + 33, y + 1.5);
    fonte(11, "bold");
    cor(TINTA);
    doc.text(formatarDataIso(orcamento.dataEmissao), xDatas + 5, y + 8.5);
    cor(primariaTexto);
    doc.text(formatarDataIso(orcamento.validoAte), xDatas + 33, y + 8.5);
    fonte(7);
    cor(CINZA);
    doc.text("Valores em reais (R$)", xDatas + 5, y + 14);

    y = Math.max(yTitulo, y - 4 + caixaDatas.altura) + 8;

    // ---------------- Cliente ----------------
    const nomeCliente = textoPdf(cliente.nome) || "Cliente";
    const camposCliente: Array<[string, string]> = [
        ["CPF/CNPJ", textoPdf(cliente.documento)],
        ["Telefone", textoPdf(cliente.telefone)],
        ["E-mail", textoPdf(cliente.email)],
    ];
    const visiveis = camposCliente.filter(([, valor]) => valor);
    fonte(8.5);
    const enderecoCliente = textoPdf(cliente.endereco);
    const linhasEndereco = enderecoCliente
        ? (doc.splitTextToSize(`Endereço: ${enderecoCliente}`, LARGURA_UTIL - 14) as string[])
        : [];
    const alturaCliente = 17 + (visiveis.length ? 5.5 : 0) + linhasEndereco.length * 4.2 + 2;

    preencher(fundoSuave);
    doc.roundedRect(MARGEM, y, LARGURA_UTIL, alturaCliente, 2, 2, "F");
    preencher(primaria);
    doc.rect(MARGEM, y, 1.6, alturaCliente, "F");
    rotulo("Preparado para", MARGEM + 7, y + 6);
    fonte(13, "bold");
    cor(TINTA);
    doc.text((doc.splitTextToSize(nomeCliente, LARGURA_UTIL - 14) as string[])[0], MARGEM + 7, y + 12.5);
    let yCliente = y + 18.5;
    if (visiveis.length) {
        const larguraColuna = (LARGURA_UTIL - 14) / 3;
        visiveis.forEach(([nomeCampo, valor], indice) => {
            const x = MARGEM + 7 + indice * larguraColuna;
            fonte(8.5, "bold");
            cor(CINZA);
            doc.text(`${nomeCampo}:`, x, yCliente);
            const larguraRotulo = doc.getTextWidth(`${nomeCampo}: `);
            fonte(8.5);
            cor(TINTA);
            const texto = (doc.splitTextToSize(valor, larguraColuna - larguraRotulo - 2) as string[])[0];
            doc.text(texto, x + larguraRotulo, yCliente);
        });
        yCliente += 5.5;
    }
    if (linhasEndereco.length) {
        fonte(8.5);
        cor(TINTA);
        doc.text(linhasEndereco, MARGEM + 7, yCliente);
    }
    y += alturaCliente + 7;

    // ---------------- Itens ----------------
    const totais = calcularOrcamento(
        itens.map((item) => ({
            quantidade: item.quantidade,
            valor_unitario: item.valorUnitario,
            desconto_tipo: item.descontoTipo,
            desconto_valor: item.descontoValor,
        })),
        { tipo: orcamento.descontoTipo, valor: orcamento.descontoValor },
    );

    // Larguras fixas; a descrição fica com o resto. A descrição é quebrada
    // aqui (título em negrito + detalhes menores em cinza) e desenhada no
    // didDrawCell: assim título e detalhes ficam na MESMA linha da tabela e
    // nunca são separados por uma quebra de página.
    const colunas = { numero: 8, quantidade: 22, unitario: 25, desconto: 20, total: 27 };
    const larguraDescricao =
        LARGURA_UTIL - colunas.numero - colunas.quantidade - colunas.unitario - colunas.desconto - colunas.total;
    const respiro = { vertical: 2.4, horizontal: 2.2 };
    const larguraTextoDescricao = larguraDescricao - 2 * respiro.horizontal;
    const TAMANHO_ITEM = 8.5;
    const TAMANHO_DETALHE = 7.5;
    const alturaLinha = (pontos: number) => pontos * 0.3528 * 1.15;

    const descricoes = itens.map((item) => {
        fonte(TAMANHO_ITEM, "bold");
        const tituloItem = doc.splitTextToSize(textoPdf(item.descricao) || "Item", larguraTextoDescricao) as string[];
        fonte(TAMANHO_DETALHE);
        const detalhes = textoPdf(item.detalhes);
        const linhasDetalhe = detalhes ? (doc.splitTextToSize(detalhes, larguraTextoDescricao) as string[]) : [];
        return { titulo: tituloItem, detalhes: linhasDetalhe };
    });

    const corpo: CellDef[][] = itens.map((item, indice) => {
        const fundo: Rgb = indice % 2 === 0 ? [255, 255, 255] : fundoZebra;
        const calculado = totais.itens[indice];
        const descontoTexto =
            calculado.desconto > 0
                ? item.descontoTipo === "percentual"
                    ? percentual(Number(item.descontoValor) || 0)
                    : `- ${reais(calculado.desconto)}`
                : "-";
        const { titulo: linhasTitulo, detalhes: linhasDetalhe } = descricoes[indice];
        // A tabela mede a altura pelo título; minCellHeight reserva o espaço
        // exato dos detalhes (fonte menor), sem sobra nem corte.
        const alturaDescricao =
            2 * respiro.vertical +
            linhasTitulo.length * alturaLinha(TAMANHO_ITEM) +
            (linhasDetalhe.length ? 0.8 + linhasDetalhe.length * alturaLinha(TAMANHO_DETALHE) : 0);
        const quantidade = `${formatarQuantidade(item.quantidade)} ${textoPdf(item.unidade) || "un"}`;
        return [
            { content: String(indice + 1), styles: { fillColor: fundo, textColor: CINZA } },
            { content: linhasTitulo.join("\n"), styles: { fillColor: fundo, minCellHeight: alturaDescricao } },
            { content: quantidade, styles: { fillColor: fundo } },
            { content: reais(item.valorUnitario), styles: { fillColor: fundo } },
            { content: descontoTexto, styles: { fillColor: fundo, textColor: CINZA } },
            { content: reais(calculado.total), styles: { fillColor: fundo, fontStyle: "bold" } },
        ];
    });

    let yFinalTabela = y;
    autoTable(doc, {
        startY: y,
        margin: { top: TOPO_CONTINUACAO, bottom: PAGINA.altura - LIMITE_INFERIOR + 2, left: MARGEM, right: MARGEM },
        head: [["#", "Descrição", "Qtd.", "Valor unit.", "Desconto", "Total"]],
        body: corpo,
        theme: "plain",
        showHead: "everyPage",
        rowPageBreak: "avoid",
        styles: {
            font: "helvetica",
            fontSize: TAMANHO_ITEM,
            textColor: TINTA,
            cellPadding: { top: respiro.vertical, right: respiro.horizontal, bottom: respiro.vertical, left: respiro.horizontal },
            lineWidth: 0,
            valign: "top",
            overflow: "linebreak",
        },
        headStyles: {
            fillColor: primaria,
            textColor: sobrePrimaria,
            fontStyle: "bold",
            fontSize: 8,
            valign: "middle",
        },
        columnStyles: {
            0: { cellWidth: colunas.numero },
            1: { cellWidth: larguraDescricao },
            2: { cellWidth: colunas.quantidade, halign: "right" },
            3: { cellWidth: colunas.unitario, halign: "right" },
            4: { cellWidth: colunas.desconto, halign: "right" },
            5: { cellWidth: colunas.total, halign: "right" },
        },
        didParseCell: (data) => {
            if (data.section === "head" && data.column.index >= 2) data.cell.styles.halign = "right";
        },
        willDrawCell: (data) => {
            if (data.section === "body" && data.column.index === 1) data.cell.text = [];
        },
        didDrawCell: (data) => {
            if (data.section !== "body" || data.column.index !== 1) return;
            const linhas = descricoes[data.row.index];
            if (!linhas) return;
            const x = data.cell.x + respiro.horizontal;
            let yTexto = data.cell.y + respiro.vertical;
            fonte(TAMANHO_ITEM, "bold");
            cor(TINTA);
            doc.text(linhas.titulo, x, yTexto, { baseline: "top", lineHeightFactor: 1.15 });
            yTexto += linhas.titulo.length * alturaLinha(TAMANHO_ITEM) + 0.8;
            if (linhas.detalhes.length) {
                fonte(TAMANHO_DETALHE);
                cor(CINZA);
                doc.text(linhas.detalhes, x, yTexto, { baseline: "top", lineHeightFactor: 1.15 });
            }
        },
        willDrawPage: (data) => {
            if (data.pageNumber > 1) cabecalhoContinuacao();
        },
        didDrawPage: (data) => {
            if (data.cursor) yFinalTabela = data.cursor.y;
        },
    });
    if (itens.length === 0) {
        fonte(9, "italic");
        cor(CINZA);
        doc.text("Nenhum item informado.", MARGEM + 2.5, yFinalTabela + 6);
        yFinalTabela += 9;
    }
    tracar(primaria);
    doc.setLineWidth(0.4);
    doc.line(MARGEM, yFinalTabela, xDireita, yFinalTabela);

    // ---------------- Totais ----------------
    const subtotal = orcamento.totaisDoBanco?.subtotal ?? totais.subtotal;
    const desconto = orcamento.totaisDoBanco?.desconto ?? totais.desconto;
    const total = orcamento.totaisDoBanco?.total ?? totais.total;

    const novaPaginaSePreciso = (altura: number) => {
        if (y + altura > LIMITE_INFERIOR) {
            doc.addPage();
            cabecalhoContinuacao();
            y = TOPO_CONTINUACAO + 4;
        }
    };

    y = yFinalTabela + 7;
    const alturaTotais = (desconto > 0 ? 12 : 6) + 15;
    novaPaginaSePreciso(alturaTotais);
    const larguraTotais = 82;
    const xTotais = xDireita - larguraTotais;

    fonte(9);
    cor(CINZA);
    doc.text("Subtotal", xTotais + 4, y);
    cor(TINTA);
    doc.text(reais(subtotal), xDireita - 4, y, { align: "right" });
    if (desconto > 0) {
        y += 6;
        cor(CINZA);
        const rotuloDesconto =
            orcamento.descontoTipo === "percentual"
                ? `Desconto (${percentual(Number(orcamento.descontoValor) || 0)})`
                : "Desconto";
        doc.text(rotuloDesconto, xTotais + 4, y);
        cor(TINTA);
        doc.text(`- ${reais(desconto)}`, xDireita - 4, y, { align: "right" });
    }
    y += 4;
    preencher(primaria);
    doc.roundedRect(xTotais, y, larguraTotais, 13, 2, 2, "F");
    preencher(secundaria);
    doc.rect(xTotais, y + 3, 1.4, 7, "F");
    cor(sobrePrimaria);
    fonte(8.5, "bold");
    doc.text("TOTAL", xTotais + 5.5, y + 8.2, { charSpace: 0.8 });
    fonte(15, "bold");
    doc.text(reais(total), xDireita - 4, y + 8.9, { align: "right" });

    // Lembrete de validade ao lado do total
    fonte(8);
    cor(CINZA);
    const lembrete = doc.splitTextToSize(
        `Proposta válida até ${formatarDataIso(orcamento.validoAte)}. Após essa data, valores e condições podem ser revistos.`,
        LARGURA_UTIL - larguraTotais - 10,
    ) as string[];
    doc.text(lembrete, MARGEM, y + 5);
    y += 13 + 8;

    // ---------------- Condições e observações ----------------
    const secao = (tituloSecao: string, texto: string) => {
        if (!texto) return;
        fonte(9);
        const linhas = doc.splitTextToSize(texto, LARGURA_UTIL) as string[];
        const alturaLinha = 4.3;
        novaPaginaSePreciso(9 + Math.min(linhas.length, 3) * alturaLinha);
        fonte(8, "bold");
        cor(primariaTexto);
        doc.text(tituloSecao.toUpperCase(), MARGEM, y, { charSpace: 0.6 });
        tracar(LINHA);
        doc.setLineWidth(0.2);
        doc.line(MARGEM, y + 2, xDireita, y + 2);
        y += 7;
        fonte(9);
        cor(TINTA);
        for (const linha of linhas) {
            novaPaginaSePreciso(alturaLinha);
            doc.text(linha, MARGEM, y);
            y += alturaLinha;
        }
        y += 3;
    };
    secao("Condições de pagamento", textoPdf(orcamento.condicoesPagamento));
    secao("Observações", textoPdf(orcamento.observacoes));

    // ---------------- Aceite ----------------
    novaPaginaSePreciso(22);
    fonte(8, "bold");
    cor(primariaTexto);
    doc.text("ACEITE DA PROPOSTA", MARGEM, y, { charSpace: 0.6 });
    tracar(LINHA);
    doc.setLineWidth(0.2);
    doc.line(MARGEM, y + 2, xDireita, y + 2);
    fonte(8);
    cor(CINZA);
    doc.text(`De acordo com os termos e valores da proposta nº ${numero}.`, MARGEM, y + 6.5);
    const yAssinatura = y + 17;
    tracar(CINZA);
    doc.setLineWidth(0.25);
    doc.line(MARGEM, yAssinatura, MARGEM + 95, yAssinatura);
    doc.line(xDireita - 55, yAssinatura, xDireita, yAssinatura);
    fonte(7.5);
    doc.text(nomeCliente, MARGEM, yAssinatura + 3.8);
    doc.text("Local e data", xDireita - 55, yAssinatura + 3.8);

    // ---------------- Rodapé de todas as páginas ----------------
    const vendedor = [
        textoPdf(orcamento.vendedorNome),
        textoPdf(orcamento.vendedorTelefone),
        textoPdf(orcamento.vendedorEmail),
    ].filter(Boolean);
    const rodape = textoPdf(empresa.rodape);
    const totalPaginas = doc.getNumberOfPages();
    for (let pagina = 1; pagina <= totalPaginas; pagina += 1) {
        doc.setPage(pagina);
        const yRodape = PAGINA.altura - 17;
        tracar(LINHA);
        doc.setLineWidth(0.3);
        doc.line(MARGEM, yRodape, xDireita, yRodape);
        if (vendedor.length) {
            fonte(7.5, "bold");
            cor(TINTA);
            const prefixo = "Seu consultor:";
            doc.text(prefixo, MARGEM, yRodape + 5);
            const larguraPrefixo = doc.getTextWidth(`${prefixo} `);
            fonte(7.5);
            doc.text(vendedor.join("  ·  "), MARGEM + larguraPrefixo, yRodape + 5);
        }
        cor(CINZA);
        doc.text(`Página ${pagina} de ${totalPaginas}`, xDireita, yRodape + 5, { align: "right" });
        if (rodape) {
            fonte(7);
            doc.text((doc.splitTextToSize(rodape, LARGURA_UTIL) as string[]).slice(0, 2), MARGEM, yRodape + 9.5);
        }
        preencher(primaria);
        doc.rect(0, PAGINA.altura - 2.5, PAGINA.largura, 2.5, "F");
    }

    return doc.output("blob");
};
