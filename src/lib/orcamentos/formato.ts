/**
 * Regras de apresentação do orçamento que não dependem de tela nem de rede:
 * status, validade, nome do arquivo, links de compartilhamento e cores.
 * Tudo puro e testado em __tests__/orcamentos.test.ts.
 */

export const STATUS_ORCAMENTO = ["rascunho", "enviado", "aceito", "recusado", "expirado", "substituido"] as const;
export type StatusOrcamento = (typeof STATUS_ORCAMENTO)[number];

export const ROTULO_STATUS: Record<StatusOrcamento, string> = {
    rascunho: "Rascunho",
    enviado: "Enviado",
    aceito: "Aceito",
    recusado: "Recusado",
    expirado: "Expirado",
    substituido: "Substituído",
};

/** Cor do Tag do antd para cada status. */
export const COR_STATUS: Record<StatusOrcamento, string> = {
    rascunho: "default",
    enviado: "processing",
    aceito: "success",
    recusado: "error",
    expirado: "warning",
    substituido: "purple",
};

export const ehStatusOrcamento = (valor: unknown): valor is StatusOrcamento =>
    typeof valor === "string" && (STATUS_ORCAMENTO as readonly string[]).includes(valor);

/** Data de hoje (YYYY-MM-DD) no fuso de Brasília, igual ao default do banco. */
export const hojeEmBrasilia = (agora: Date = new Date()): string =>
    new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(agora);

/** Soma dias a uma data YYYY-MM-DD sem cair na armadilha do fuso. */
export const somarDias = (dataIso: string, dias: number): string => {
    const [ano, mes, dia] = dataIso.split("-").map(Number);
    const data = new Date(Date.UTC(ano, mes - 1, dia + dias));
    return data.toISOString().slice(0, 10);
};

/** YYYY-MM-DD → DD/MM/AAAA, sem converter para Date (evita o dia anterior em UTC-3). */
export const formatarDataIso = (dataIso?: string | null): string => {
    const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(dataIso ?? "");
    return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : "";
};

/**
 * Proposta aberta (rascunho/enviado) com validade já passada. O banco não
 * muda o status sozinho: a tela avisa e o vendedor decide marcar como
 * expirado ou renovar a validade.
 */
export const estaVencido = (
    validoAte: string | null | undefined,
    status: StatusOrcamento,
    hoje: string = hojeEmBrasilia(),
): boolean => Boolean(validoAte) && (status === "rascunho" || status === "enviado") && String(validoAte) < hoje;

const semAcentos = (texto: string): string => texto.normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Nome do arquivo: Proposta-<numero>[-RevN]-<cliente>.pdf, só com [A-Za-z0-9-].
 * Nada de barra, ponto, aspas ou caractere de controle vindo do nome do
 * cliente (path traversal no storage, nome quebrado no Windows/WhatsApp).
 * A partir da revisão 2 o nome leva "-RevN": o cliente distingue as versões.
 */
export const nomeArquivoProposta = (numero: string, cliente?: string | null, revisao?: number | null): string => {
    const limpar = (texto: string) =>
        semAcentos(texto)
            .replace(/[^A-Za-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    const parteNumero = limpar(numero || "").slice(0, 20) || "sem-numero";
    const parteCliente = limpar(cliente || "").slice(0, 60).replace(/-+$/g, "") || "cliente";
    const parteRevisao = revisao && Number.isInteger(revisao) && revisao > 1 ? `-Rev${revisao}` : "";
    return `Proposta-${parteNumero}${parteRevisao}-${parteCliente}.pdf`;
};

/**
 * Telefone no formato do wa.me: só dígitos, com código do país.
 * Brasil: 10 ou 11 dígitos (DDD + número) ganham o 55 na frente; quem já
 * digitou 55 + DDD + número fica como está. Outro país: usa o DDI do lead.
 */
export const telefoneParaWhatsApp = (telefone?: string | null, ddi?: string | null): string | null => {
    const digitos = (telefone ?? "").replace(/\D/g, "").replace(/^0+/, "");
    const ddiDigitos = (ddi ?? "").replace(/\D/g, "") || "55";
    if (!digitos) return null;

    if (ddiDigitos === "55") {
        if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
        if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) return digitos;
        return null;
    }

    const completo = digitos.startsWith(ddiDigitos) ? digitos : `${ddiDigitos}${digitos}`;
    return completo.length >= 8 && completo.length <= 15 ? completo : null;
};

export const linkWhatsApp = (telefone: string | null | undefined, mensagem: string, ddi?: string | null): string | null => {
    const numero = telefoneParaWhatsApp(telefone, ddi);
    return numero ? `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}` : null;
};

// Sem "?" e "&" no endereço: impede injetar cc/bcc/body extras no mailto.
const EMAIL_SEGURO_RE = /^[^\s@?&,;<>"'()]+@[^\s@?&,;<>"'()]+\.[^\s@?&,;<>"'()]+$/;

export const linkEmail = (email: string | null | undefined, assunto: string, corpo: string): string | null => {
    const destino = (email ?? "").trim();
    if (!EMAIL_SEGURO_RE.test(destino)) return null;
    return `mailto:${destino}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
};

const formatarReais = (valor: number): string =>
    valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export interface DadosMensagem {
    cliente?: string | null;
    numero: string;
    total: number;
    validoAte?: string | null;
    empresa?: string | null;
    vendedor?: string | null;
}

/** Texto curto para WhatsApp/e-mail. O PDF vai anexado à mão pelo vendedor. */
export const mensagemProposta = ({ cliente, numero, total, validoAte, empresa, vendedor }: DadosMensagem): string => {
    const primeiroNome = (cliente ?? "").trim().split(/\s+/)[0];
    const saudacao = primeiroNome ? `Olá, ${primeiroNome}!` : "Olá!";
    const deQuem = empresa?.trim() ? ` da ${empresa.trim()}` : "";
    const validade = validoAte ? `, válida até ${formatarDataIso(validoAte)}` : "";
    const assinatura = vendedor?.trim() ? `\n\n${vendedor.trim()}` : "";
    return (
        `${saudacao} Segue a proposta ${numero}${deQuem}, no valor de ${formatarReais(total)}${validade}. ` +
        `O PDF com todos os detalhes está em anexo. Fico à disposição para qualquer dúvida.${assinatura}`
    );
};

export const assuntoProposta = (numero: string, empresa?: string | null): string =>
    `Proposta ${numero}${empresa?.trim() ? ` — ${empresa.trim()}` : ""}`;

// ---------------------------------------------------------------------
// Cores da marca
// ---------------------------------------------------------------------

export const COR_HEX_RE = /^#[0-9A-Fa-f]{6}$/;
export const ehCorHex = (cor?: string | null): cor is string => COR_HEX_RE.test(cor ?? "");

export type Rgb = [number, number, number];

export const hexParaRgb = (hex: string, padrao: Rgb = [15, 76, 129]): Rgb => {
    if (!ehCorHex(hex)) return padrao;
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
};

/** Mistura a cor com branco (0 = cor pura, 1 = branco). Usado para fundos suaves no PDF. */
export const clarear = ([r, g, b]: Rgb, quanto: number): Rgb =>
    [r, g, b].map((c) => Math.round(c + (255 - c) * quanto)) as Rgb;

const luminancia = ([r, g, b]: Rgb): number => {
    const canal = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
};

/** Contraste WCAG entre duas cores (1 a 21). */
export const contraste = (a: Rgb, b: Rgb): number => {
    const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
    return (claro + 0.05) / (escuro + 0.05);
};

const BRANCO: Rgb = [255, 255, 255];
const GRAFITE: Rgb = [17, 24, 39];

/** Texto legível sobre a cor: branco ou grafite, o que tiver mais contraste. */
export const corDeTextoSobre = (fundo: Rgb): Rgb => (contraste(fundo, BRANCO) >= contraste(fundo, GRAFITE) ? BRANCO : GRAFITE);

/**
 * Cor da marca usada como TEXTO sobre fundo branco (títulos do PDF). Uma
 * marca amarela clara some no papel: escurece até ter contraste 4,5:1.
 */
export const corLegivelEmBranco = (cor: Rgb): Rgb => {
    let atual = cor;
    for (let i = 0; i < 20 && contraste(atual, BRANCO) < 4.5; i += 1) {
        atual = atual.map((c) => Math.round(c * 0.85)) as Rgb;
    }
    return atual;
};

/** Quantidade no padrão brasileiro, até 3 casas, sem zeros sobrando. */
export const formatarQuantidade = (valor: number): string =>
    valor.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
