/**
 * Totais do orçamento — mesma regra do banco (trigger fn_orcamento_itens_preparar
 * e fn_orcamentos_preparar, migration 13). O banco é a fonte da verdade:
 * esta função existe para a tela mostrar o total enquanto o vendedor digita,
 * e precisa bater centavo a centavo com o que o Postgres grava.
 *
 * Regras:
 *   bruto do item   = round(quantidade × valor unitário, 2)
 *   desconto item   = % → round(bruto × pct / 100, 2) | R$ → valor; limitado ao bruto
 *   total do item   = bruto − desconto
 *   subtotal        = soma dos totais dos itens
 *   desconto geral  = % → round(subtotal × pct / 100, 2) | R$ → valor; limitado ao subtotal
 *   total           = subtotal − desconto geral
 *
 * Contas em inteiros (BigInt): centavos para dinheiro e milésimos para
 * quantidade. Ponto flutuante faria 2,5 × 0,07 virar 0,17499999… e o
 * arredondamento sair diferente do Postgres (numeric é decimal exato).
 * Arredondamento "meio para cima", igual ao round() de numeric para
 * valores positivos.
 */

export type TipoDesconto = "percentual" | "valor";

export type ValorNumerico = number | string | null | undefined;

export interface ItemCalculavel {
    quantidade?: ValorNumerico;
    valor_unitario?: ValorNumerico;
    desconto_tipo?: TipoDesconto | null;
    desconto_valor?: ValorNumerico;
}

export interface TotaisItem {
    bruto: number;
    desconto: number;
    total: number;
}

export interface TotaisOrcamento {
    itens: TotaisItem[];
    subtotal: number;
    desconto: number;
    total: number;
}

const paraNumero = (valor: ValorNumerico): number => {
    if (valor === null || valor === undefined || valor === "") return 0;
    const numero = typeof valor === "number" ? valor : Number(String(valor).trim().replace(",", "."));
    return Number.isFinite(numero) && numero > 0 ? numero : 0;
};

/** Valor em unidades inteiras (10^casas). Negativo e inválido viram 0. */
const escalar = (valor: ValorNumerico, casas: number): bigint =>
    BigInt(Math.round(paraNumero(valor) * 10 ** casas));

/** Divisão inteira arredondando meio para cima (operandos não negativos). */
const dividirArredondando = (numerador: bigint, divisor: bigint): bigint =>
    (numerador + divisor / 2n) / divisor;

const menor = (a: bigint, b: bigint): bigint => (a < b ? a : b);

const paraReais = (centavos: bigint): number => Number(centavos) / 100;

const descontoEmCentavos = (baseCentavos: bigint, tipo: TipoDesconto | null | undefined, valor: ValorNumerico): bigint => {
    if (tipo === "percentual") {
        const pctCentesimos = menor(escalar(valor, 2), 10000n); // no máximo 100,00%
        return menor(dividirArredondando(baseCentavos * pctCentesimos, 10000n), baseCentavos);
    }
    return menor(escalar(valor, 2), baseCentavos);
};

const calcularItemCentavos = (item: ItemCalculavel) => {
    const quantidadeMilesimos = escalar(item.quantidade, 3);
    const unitarioCentavos = escalar(item.valor_unitario, 2);
    const bruto = dividirArredondando(quantidadeMilesimos * unitarioCentavos, 1000n);
    const desconto = descontoEmCentavos(bruto, item.desconto_tipo, item.desconto_valor);
    return { bruto, desconto, total: bruto - desconto };
};

export const calcularItem = (item: ItemCalculavel): TotaisItem => {
    const { bruto, desconto, total } = calcularItemCentavos(item);
    return { bruto: paraReais(bruto), desconto: paraReais(desconto), total: paraReais(total) };
};

export const calcularOrcamento = (
    itens: ItemCalculavel[],
    descontoGeral?: { tipo?: TipoDesconto | null; valor?: ValorNumerico },
): TotaisOrcamento => {
    const calculados = itens.map(calcularItemCentavos);
    const subtotal = calculados.reduce((soma, item) => soma + item.total, 0n);
    const desconto = descontoEmCentavos(subtotal, descontoGeral?.tipo, descontoGeral?.valor);
    return {
        itens: calculados.map((item) => ({
            bruto: paraReais(item.bruto),
            desconto: paraReais(item.desconto),
            total: paraReais(item.total),
        })),
        subtotal: paraReais(subtotal),
        desconto: paraReais(desconto),
        total: paraReais(subtotal - desconto),
    };
};
