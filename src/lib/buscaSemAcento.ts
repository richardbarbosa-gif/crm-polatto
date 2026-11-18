import type { CrudFilter } from "@refinedev/core";

/**
 * Busca que ignora acentos ("joao" acha "João"; "José" acha "Jose").
 *
 * O banco expõe, em cada fonte pesquisada pelas telas, a coluna calculada
 * `busca_sem_acento` (migration 23): os mesmos campos que a busca já
 * consultava, juntos e sem acento. O termo digitado passa pelo MESMO mapa
 * de letras de `public.sem_acento()` e o filtro continua sendo um ILIKE —
 * maiúsculas/minúsculas seguem tratadas pelo banco como antes.
 *
 * Campos por fonte (migration 23):
 *   clientes, vw_negocios_saude  nome, telefone
 *   pessoas                      nome, email, telefone, cargo
 *   organizacoes                 nome_fantasia, razao_social, cnpj, setor
 *   vw_orcamentos_lista          numero, titulo, cliente_nome
 */
export const CAMPO_BUSCA_SEM_ACENTO = "busca_sem_acento";

// Mantenha idêntico ao translate() de public.sem_acento (migration 23).
const COM_ACENTO = "ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇÑÝçñýÿ";
const SEM_ACENTO = "AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCNYcnyy";

const MAPA = new Map(Array.from(COM_ACENTO, (letra, i) => [letra, SEM_ACENTO[i]]));

/** Troca letra acentuada pela letra base, mantendo maiúscula/minúscula. */
export const semAcento = (texto: string): string =>
    Array.from(texto, (letra) => MAPA.get(letra) ?? letra).join("");

/** Filtro de busca (ILIKE na coluna calculada) para o termo já sanitizado. */
export const filtroBuscaSemAcento = (termo: string): CrudFilter => ({
    field: CAMPO_BUSCA_SEM_ACENTO,
    operator: "contains",
    value: semAcento(termo),
});

/** Só para o teste de paridade com o SQL. */
export const MAPA_DE_ACENTOS = { COM_ACENTO, SEM_ACENTO } as const;
