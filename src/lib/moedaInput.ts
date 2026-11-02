import type { InputNumberProps } from "antd";

/**
 * Formatter/parser de moeda (R$) para o InputNumber do antd.
 *
 * O par antigo era `R$ ${v}` com ponto de milhar via regex e um parser que
 * removia todos os pontos. Ele não era estável: o valor 1500,5 era exibido
 * como "R$ 1.500.5" (o ponto decimal do número também ganhava "milhar") e,
 * ao ser lido de volta, virava 15005. Um centavo digitado podia multiplicar
 * o valor do negócio por dez.
 *
 * Aqui o formato é o pt-BR (1.500,50): enquanto o usuário digita, o texto
 * fica como ele escreveu; ao sair do campo, é formatado.
 */

type InfoFormatter = { userTyping: boolean; input: string };

export const formatarMoedaInput = (
    valor: string | number | undefined | null,
    info?: InfoFormatter,
): string => {
    if (info?.userTyping) return info.input;
    if (valor === undefined || valor === null || valor === "") return "";
    const numero = typeof valor === "number" ? valor : Number(valor);
    if (!Number.isFinite(numero)) return "";
    return numero.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/**
 * Converte o texto exibido em número (como string, formato JS).
 * Vírgula é o separador decimal; pontos são milhar. Sem vírgula, um único
 * ponto seguido de 1 ou 2 dígitos é tratado como decimal ("1500.50").
 */
export const lerMoedaInput = (texto?: string | null): string => {
    let limpo = (texto ?? "").replace(/[^\d.,-]/g, "");
    if (!limpo) return "";
    if (limpo.includes(",")) {
        limpo = limpo.replace(/\./g, "").replace(/,(?=.*,)/g, "").replace(",", ".");
    } else if (!/^-?\d+\.\d{1,2}$/.test(limpo)) {
        limpo = limpo.replace(/\./g, "");
    }
    return limpo;
};

/** Props prontas para <InputNumber {...propsMoeda} />. */
export const propsMoeda: InputNumberProps<string | number> = {
    prefix: "R$",
    min: 0,
    precision: 2,
    formatter: formatarMoedaInput,
    parser: lerMoedaInput,
    style: { width: "100%" },
};
