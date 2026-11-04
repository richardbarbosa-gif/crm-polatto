import { useList } from "@refinedev/core";
import { useMemo } from "react";
import { isSupabaseMissingRelation } from "../lib/supabaseErrors";
import type { CustomFieldRecord } from "../types/db";

export type EntidadeCustomField = "negocio" | "pessoa" | "organizacao";

/**
 * Definições de campos customizados do tenant para uma entidade.
 *
 * O admin cadastra os campos em Configurações > Campos customizados; é este
 * hook que os traz para os formulários. Sem ele a tela de configuração seria
 * decorativa: o campo era definido e nunca aparecia em lugar nenhum.
 *
 * Resiliente: se a tabela ainda não existe no ambiente, devolve lista vazia
 * e o formulário segue funcionando com os campos fixos.
 */
export const useCustomFields = (entidade: EntidadeCustomField) => {
    const { query } = useList<CustomFieldRecord>({
        resource: "custom_fields",
        pagination: { mode: "off" },
        filters: [
            { field: "entidade", operator: "eq", value: entidade },
            { field: "ativo", operator: "eq", value: true },
        ],
        sorters: [{ field: "ordem", order: "asc" }],
        queryOptions: { retry: false },
    });

    const campos = useMemo(() => {
        if (isSupabaseMissingRelation(query?.error)) return [];
        return ((query?.data?.data as CustomFieldRecord[]) || []).filter(
            (campo) => campo?.chave && campo?.label,
        );
    }, [query?.data?.data, query?.error]);

    return {
        campos,
        isLoading: Boolean(query?.isLoading),
        temCampos: campos.length > 0,
    };
};

/**
 * Separa os valores dos campos customizados do restante do formulário.
 * O formulário os nomeia como ["dados_extras", chave] (caminho aninhado do
 * antd), então eles já chegam agrupados em values.dados_extras.
 */
export const extrairDadosExtras = (
    values: Record<string, unknown>,
    campos: CustomFieldRecord[],
    modo: "criar" | "editar" = "criar",
): Record<string, unknown> => {
    const brutos = (values?.dados_extras as Record<string, unknown>) || {};
    const saida: Record<string, unknown> = {};

    campos.forEach((campo) => {
        const valor = brutos[campo.chave];
        if (valor === undefined || valor === "" || valor === null) {
            // Na edição, campo esvaziado vai como null: o banco faz merge de
            // dados_extras e, sem a chave, o valor antigo voltava após salvar
            // — era impossível apagar um campo customizado.
            if (modo === "editar") saida[campo.chave] = null;
            return;
        }
        // Datas do antd chegam como Dayjs; grava em ISO para não perder o valor
        if (typeof valor === "object" && valor !== null && "toISOString" in valor) {
            saida[campo.chave] = (valor as { toISOString: () => string }).toISOString();
            return;
        }
        saida[campo.chave] = valor;
    });

    return saida;
};
