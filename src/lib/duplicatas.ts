import { variantesDocumento, variantesTelefone } from "./documentos";

/**
 * Valor dentro de um filtro .or() do PostgREST: entre aspas duplas, com
 * aspas e barras escapadas — "(11) 99999-9999" tem parênteses e vírgulas
 * seriam separadores.
 */
export const valorPostgrest = (valor: string): string =>
    `"${valor.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const lista = (valores: string[]): string => `(${valores.map(valorPostgrest).join(",")})`;

type CamposDuplicata = {
    telefone?: string | null;
    documento?: string | null;
    email?: string | null;
};

type ColunasDuplicata = {
    telefone?: string;
    documento?: string;
    email?: string;
};

/**
 * Monta o filtro .or() que procura cadastro com o mesmo telefone, CPF/CNPJ
 * ou e-mail. Telefone e documento são comparados em todas as formas em que
 * podem estar gravados (crus, formatados, com 55): a comparação exata
 * deixava passar "(11) 99999-8888" contra "11999998888".
 *
 * Devolve null quando não há o que comparar.
 */
export const montarFiltroDuplicata = (
    { telefone, documento, email }: CamposDuplicata,
    colunas: ColunasDuplicata = {},
): string | null => {
    const colTelefone = colunas.telefone ?? "telefone";
    const colDocumento = colunas.documento ?? "cpf_cnpj";
    const colEmail = colunas.email ?? "email";
    const condicoes: string[] = [];

    const telefones = variantesTelefone(telefone);
    if (telefones.length) condicoes.push(`${colTelefone}.in.${lista(telefones)}`);

    const documentos = variantesDocumento(documento);
    if (documentos.length) condicoes.push(`${colDocumento}.in.${lista(documentos)}`);

    const emailLimpo = (email ?? "").trim();
    if (emailLimpo) condicoes.push(`${colEmail}.ilike.${valorPostgrest(emailLimpo.replace(/[%_]/g, ""))}`);

    return condicoes.length ? condicoes.join(",") : null;
};
