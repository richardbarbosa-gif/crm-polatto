import { somenteDigitos, validarEmail } from "./documentos";
import { parseCurrencyLikeValue } from "./formatters";

/**
 * Regras da importação de leads por CSV, fora do componente para serem
 * testáveis. O fluxo antigo: aceitava só cabeçalhos com grafia exata
 * ("Nome", "nome", "Name"...), convertia valores com Number() — "1.234,56"
 * virava 0 —, não detectava duplicatas dentro da própria planilha, e uma
 * linha inválida derrubava a importação inteira sem dizer qual.
 */

export type CampoLead =
    | "nome"
    | "email"
    | "telefone"
    | "cpf_cnpj"
    | "responsavel"
    | "conta_energia_media"
    | "valor"
    | "status"
    | "temperatura";

const SINONIMOS: Record<CampoLead, string[]> = {
    nome: ["nome", "name", "nome_completo", "cliente", "lead", "contato", "razao_social"],
    email: ["email", "e_mail", "mail"],
    telefone: ["telefone", "phone", "celular", "whatsapp", "fone", "tel", "telefone_whatsapp"],
    cpf_cnpj: ["cpf_cnpj", "cpf", "cnpj", "documento", "cpf_ou_cnpj"],
    responsavel: ["responsavel", "vendedor", "consultor", "owner"],
    conta_energia_media: ["conta_energia_media", "conta_energia", "conta_de_luz", "media_conta", "conta_luz"],
    valor: ["valor", "valor_venda", "valor_negocio", "valor_do_negocio", "value"],
    status: ["status", "etapa", "fase", "stage"],
    temperatura: ["temperatura", "temperature"],
};

/** "E-mail", "Telefone/WhatsApp ", "Responsável" → "e_mail", "telefone_whatsapp", "responsavel" */
export const normalizarCabecalho = (cabecalho: string): string =>
    cabecalho
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

const CAMPO_POR_CABECALHO = new Map<string, CampoLead>(
    (Object.entries(SINONIMOS) as Array<[CampoLead, string[]]>).flatMap(([campo, nomes]) =>
        nomes.map((nome) => [nome, campo] as [string, CampoLead]),
    ),
);

export const campoDoCabecalho = (cabecalho: string): CampoLead | undefined =>
    CAMPO_POR_CABECALHO.get(normalizarCabecalho(cabecalho));

export type LinhaImportada = {
    /** Número da linha na planilha (1 = cabeçalho; dados a partir de 2). */
    linha: number;
    nome: string;
    email: string | null;
    telefone: string;
    cpf_cnpj: string | null;
    responsavel: string | null;
    conta_energia_media: number | null;
    valor: number | null;
    status: string | null;
    temperatura: "frio" | "morno" | "quente" | null;
};

export type ErroDeLinha = { linha: number; motivo: string };

const TEMPERATURAS = new Set(["frio", "morno", "quente"]);

const texto = (valor: unknown): string => (valor === null || valor === undefined ? "" : String(valor).trim());

/** Converte uma linha crua do CSV; devolve a linha ou o motivo da rejeição. */
export const mapearLinha = (
    bruta: Record<string, unknown>,
    linha: number,
): { ok: true; dados: LinhaImportada } | { ok: false; erro: ErroDeLinha } => {
    const valores: Partial<Record<CampoLead, string>> = {};
    Object.entries(bruta).forEach(([cabecalho, valor]) => {
        const campo = campoDoCabecalho(cabecalho);
        if (campo && !valores[campo]) valores[campo] = texto(valor);
    });

    const nome = valores.nome ?? "";
    const email = valores.email ?? "";
    const telefone = valores.telefone ?? "";

    if (!nome && !telefone && !email) {
        return { ok: false, erro: { linha, motivo: "sem nome, telefone ou e-mail" } };
    }
    if (email && !validarEmail(email)) {
        return { ok: false, erro: { linha, motivo: `e-mail inválido: "${email}"` } };
    }

    const valor = valores.valor ? parseCurrencyLikeValue(valores.valor) : null;
    const conta = valores.conta_energia_media ? parseCurrencyLikeValue(valores.conta_energia_media) : null;
    if ((valor !== null && valor < 0) || (conta !== null && conta < 0)) {
        return { ok: false, erro: { linha, motivo: "valor negativo" } };
    }
    if (valores.valor && valor === null) {
        return { ok: false, erro: { linha, motivo: `valor não reconhecido: "${valores.valor}"` } };
    }

    const temperatura = (valores.temperatura ?? "").toLowerCase();

    return {
        ok: true,
        dados: {
            linha,
            nome: nome || "Lead sem nome",
            email: email || null,
            telefone,
            cpf_cnpj: valores.cpf_cnpj || null,
            responsavel: valores.responsavel || null,
            conta_energia_media: conta,
            valor,
            status: valores.status || null,
            temperatura: TEMPERATURAS.has(temperatura) ? (temperatura as LinhaImportada["temperatura"]) : null,
        },
    };
};

/** Chaves de identidade de um lead para deduplicação. */
export const chavesDeIdentidade = (lead: Pick<LinhaImportada, "telefone" | "email" | "cpf_cnpj">): string[] => {
    const chaves: string[] = [];
    const tel = somenteDigitos(lead.telefone);
    if (tel.length >= 8) chaves.push(`tel:${tel.length > 11 && tel.startsWith("55") ? tel.slice(2) : tel}`);
    if (lead.email) chaves.push(`email:${lead.email.trim().toLowerCase()}`);
    const doc = somenteDigitos(lead.cpf_cnpj);
    if (doc.length === 11 || doc.length === 14) chaves.push(`doc:${doc}`);
    return chaves;
};

/**
 * Separa as linhas repetidas DENTRO da planilha (mesmo telefone, e-mail ou
 * documento de uma linha anterior). A primeira ocorrência fica.
 */
export const separarDuplicadasNaPlanilha = (
    linhas: LinhaImportada[],
): { unicas: LinhaImportada[]; repetidas: LinhaImportada[] } => {
    const vistas = new Set<string>();
    const unicas: LinhaImportada[] = [];
    const repetidas: LinhaImportada[] = [];
    linhas.forEach((linha) => {
        const chaves = chavesDeIdentidade(linha);
        if (chaves.some((chave) => vistas.has(chave))) {
            repetidas.push(linha);
            return;
        }
        chaves.forEach((chave) => vistas.add(chave));
        unicas.push(linha);
    });
    return { unicas, repetidas };
};

export const emLotesDe = <T>(itens: T[], tamanho: number): T[][] => {
    const lotes: T[][] = [];
    for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
    return lotes;
};
