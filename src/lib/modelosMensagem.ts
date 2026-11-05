/**
 * Modelos de mensagem (WhatsApp / e-mail) com variáveis — migration 15.
 *
 * Funções puras: a substituição é de UMA passada (o valor de uma variável
 * nunca é reinterpretado como outra variável) e o texto final só vira URL
 * por encodeURIComponent, então "&", "?", "#" e quebras de linha do texto
 * ou dos dados do cliente não injetam parâmetros no wa.me nem no mailto.
 */

export type CanalModelo = "whatsapp" | "email";

export type ModeloMensagem = {
    id: string;
    nome: string;
    canal: CanalModelo;
    assunto?: string | null;
    texto: string;
    ativo?: boolean | null;
    ordem?: number | null;
};

export const VARIAVEIS_MODELO = [
    { chave: "nome", descricao: "Nome completo do cliente" },
    { chave: "primeiro_nome", descricao: "Primeiro nome do cliente" },
    { chave: "empresa", descricao: "Nome da sua empresa" },
    { chave: "vendedor", descricao: "Seu nome" },
    { chave: "valor", descricao: "Valor do negócio ou da proposta (R$)" },
    { chave: "proposta_numero", descricao: "Número da proposta" },
    { chave: "validade", descricao: "Validade da proposta (dd/mm/aaaa)" },
] as const;

export type VariavelModelo = (typeof VARIAVEIS_MODELO)[number]["chave"];
export type DadosModelo = Partial<Record<VariavelModelo, string | null | undefined>>;

const CHAVES = new Set<string>(VARIAVEIS_MODELO.map((v) => v.chave));
const VARIAVEL_RE = /\{([a-z_]+)\}/g;

/**
 * Troca {variavel} pelo valor. Variável sem valor some (e o espaço duplo
 * que sobraria é limpo); chave desconhecida fica como está, para o
 * vendedor ver que digitou errado.
 */
export const aplicarModelo = (texto: string, dados: DadosModelo): string => {
    const substituido = (texto ?? "").replace(VARIAVEL_RE, (trecho, chave: string) => {
        if (!CHAVES.has(chave)) return trecho;
        const valor = dados[chave as VariavelModelo];
        return typeof valor === "string" ? valor.trim() : "";
    });
    return substituido
        .split("\n")
        .map((linha) => linha.replace(/[ \t]{2,}/g, " ").replace(/ +([,.!?;:])/g, "$1").trimEnd())
        .join("\n")
        .trim();
};

/** Variáveis usadas no texto que não têm valor nos dados. */
export const variaveisSemValor = (texto: string, dados: DadosModelo): VariavelModelo[] => {
    const faltando = new Set<VariavelModelo>();
    for (const [, chave] of (texto ?? "").matchAll(VARIAVEL_RE)) {
        if (CHAVES.has(chave) && !dados[chave as VariavelModelo]?.trim()) faltando.add(chave as VariavelModelo);
    }
    return [...faltando];
};

export const primeiroNome = (nome?: string | null): string => (nome ?? "").trim().split(/\s+/)[0] ?? "";

const formatarReais = (valor: number): string =>
    valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatarDataIso = (iso?: string | null): string => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
    return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};

/** Monta as variáveis a partir do lead, do vendedor, da empresa e (opcional) da proposta. */
export const montarDadosModelo = (params: {
    nomeCliente?: string | null;
    empresa?: string | null;
    vendedor?: string | null;
    valor?: number | null;
    propostaNumero?: string | null;
    validade?: string | null;
}): DadosModelo => {
    const nome = (params.nomeCliente ?? "").trim();
    const valor = typeof params.valor === "number" && Number.isFinite(params.valor) && params.valor > 0
        ? formatarReais(params.valor)
        : "";
    return {
        nome,
        primeiro_nome: primeiroNome(nome),
        empresa: (params.empresa ?? "").trim(),
        vendedor: (params.vendedor ?? "").trim(),
        valor,
        proposta_numero: (params.propostaNumero ?? "").trim(),
        validade: formatarDataIso(params.validade),
    };
};

/**
 * Telefone no formato do wa.me: só dígitos com o código do país.
 * Brasil: 10 ou 11 dígitos (DDD + número) ganham o 55; 12/13 dígitos que
 * já começam com 55 ficam como estão. Outro país: usa o DDI do lead.
 */
export const telefoneWhatsApp = (telefone?: string | null, ddi?: string | null): string | null => {
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

export const linkWhatsAppModelo = (
    telefone: string | null | undefined,
    mensagem: string,
    ddi?: string | null,
): string | null => {
    const numero = telefoneWhatsApp(telefone, ddi);
    if (!numero) return null;
    const texto = mensagem.trim();
    return texto ? `https://wa.me/${numero}?text=${encodeURIComponent(texto)}` : `https://wa.me/${numero}`;
};

// Sem "?", "&", "," ou ";" no endereço: impede injetar cc/bcc/body extras.
const EMAIL_SEGURO_RE = /^[^\s@?&,;<>"'()%]+@[^\s@?&,;<>"'()%]+\.[^\s@?&,;<>"'()%]+$/;

export const emailValido = (email?: string | null): boolean => EMAIL_SEGURO_RE.test((email ?? "").trim());

export const linkEmailModelo = (
    email: string | null | undefined,
    assunto: string,
    corpo: string,
): string | null => {
    const destino = (email ?? "").trim();
    if (!EMAIL_SEGURO_RE.test(destino)) return null;
    const partes = [
        assunto.trim() ? `subject=${encodeURIComponent(assunto.trim())}` : "",
        corpo.trim() ? `body=${encodeURIComponent(corpo.trim())}` : "",
    ].filter(Boolean);
    return `mailto:${destino}${partes.length ? `?${partes.join("&")}` : ""}`;
};
