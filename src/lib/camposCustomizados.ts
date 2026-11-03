import dayjs from "dayjs";
import type { CustomFieldRecord } from "../types/db";

/**
 * Converte os valores gravados em dados_extras para o formato que o
 * formulário espera (datas precisam voltar como Dayjs).
 *
 * O retorno usa NonNullable porque o setFieldsValue do antd
 * (RecursivePartial) não aceita `unknown` em valor aninhado — e nunca
 * devolvemos null aqui.
 */
export const dadosExtrasParaFormulario = (
    dadosExtras: Record<string, unknown> | null | undefined,
    campos: CustomFieldRecord[],
): Record<string, NonNullable<unknown>> => {
    const origem = dadosExtras || {};
    const saida: Record<string, NonNullable<unknown>> = {};

    campos.forEach((campo) => {
        const valor = origem[campo.chave];
        if (valor === undefined || valor === null) return;
        if (campo.tipo === "data") {
            const data = dayjs(String(valor));
            if (data.isValid()) saida[campo.chave] = data;
            return;
        }
        saida[campo.chave] = valor;
    });

    return saida;
};
