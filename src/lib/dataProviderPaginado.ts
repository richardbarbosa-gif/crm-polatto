import type { BaseRecord, CrudSort, DataProvider, GetListParams, GetListResponse } from "@refinedev/core";

/**
 * O Supabase (PostgREST) devolve no máximo `max-rows` linhas por requisição
 * — 1000 no padrão do projeto. O data provider do Refine, com
 * `pagination: { mode: "off" }`, faz UMA requisição sem range: a partir da
 * linha 1001 o resultado era cortado em silêncio, e dashboard, insights,
 * listas de contatos e organizações passavam a exibir números errados sem
 * nenhum erro na tela.
 *
 * Este wrapper mantém a semântica de "trazer tudo" do modo "off": busca
 * página a página (do tamanho do max-rows) até completar o total que o
 * próprio banco informa em `count`.
 */
export const TAMANHO_PAGINA_SUPABASE = 1000;

/** Teto de segurança: 50 páginas (50 mil linhas) por consulta. */
export const LIMITE_PAGINAS = 50;

/**
 * Sem ORDER BY determinístico, LIMIT/OFFSET em páginas diferentes pode
 * repetir ou pular linhas. Quando é preciso mais de uma página, acrescenta
 * a chave primária como desempate. Views agregadas (vw_*) não têm `id`.
 */
export const ordenacaoComDesempate = (
    resource: string,
    sorters: CrudSort[] | undefined,
    idColumn = "id",
): CrudSort[] | undefined => {
    if (resource.startsWith("vw_")) return sorters;
    const atuais = sorters ?? [];
    if (atuais.some((s) => s.field === idColumn)) return atuais;
    return [...atuais, { field: idColumn, order: "asc" }];
};

type GetList = DataProvider["getList"];

export const buscarTodasAsPaginas = async <T extends BaseRecord = BaseRecord>(
    getList: GetList,
    params: GetListParams,
    tamanhoPagina = TAMANHO_PAGINA_SUPABASE,
    limitePaginas = LIMITE_PAGINAS,
): Promise<GetListResponse<T>> => {
    const pagina = (currentPage: number, pageSize: number, sorters: CrudSort[] | undefined) =>
        getList<T>({
            ...params,
            sorters,
            pagination: { mode: "server", currentPage, pageSize },
        });

    const primeira = await pagina(1, tamanhoPagina, params.sorters);
    const total = typeof primeira.total === "number" ? primeira.total : primeira.data.length;

    if (primeira.data.length >= total || primeira.data.length === 0) {
        return { data: primeira.data, total };
    }

    // Se o servidor estiver configurado com max-rows menor que a página
    // pedida, a primeira resposta revela o tamanho real da página.
    const tamanhoEfetivo = Math.min(tamanhoPagina, primeira.data.length);

    // Mais de uma página: refaz a partir da primeira já com desempate, para
    // que todas as páginas usem exatamente a mesma ordenação.
    const meta = params.meta as { idColumnName?: string } | undefined;
    const sorters = ordenacaoComDesempate(params.resource, params.sorters, meta?.idColumnName);
    const dados: T[] = [];

    for (let atual = 1; atual <= limitePaginas; atual += 1) {
        const resposta = await pagina(atual, tamanhoEfetivo, sorters);
        dados.push(...resposta.data);
        if (resposta.data.length < tamanhoEfetivo || dados.length >= total) break;
        if (atual === limitePaginas) {
            console.warn(
                `[dados] ${params.resource}: resultado limitado a ${dados.length} de ${total} linhas.`,
            );
        }
    }

    return { data: dados, total };
};

/**
 * Envolve um data provider do Refine para que `pagination.mode === "off"`
 * traga todas as linhas, não apenas as 1000 primeiras.
 */
export const comPaginacaoCompleta = (base: DataProvider): DataProvider => ({
    ...base,
    getList: (params) => {
        if (params.pagination?.mode !== "off") {
            return base.getList(params);
        }
        return buscarTodasAsPaginas(base.getList, params);
    },
});

type ConsultaPaginada<T> = (
    inicio: number,
    fim: number,
) => PromiseLike<{ data: T[] | null; error: unknown }>;

/**
 * Mesmo princípio para consultas feitas direto no supabaseClient:
 * `montar(inicio, fim)` deve aplicar `.range(inicio, fim)` (e uma ordenação
 * estável) à consulta. Lança o erro do Supabase se houver.
 */
export const buscarTodasAsLinhas = async <T>(
    montar: ConsultaPaginada<T>,
    tamanhoPagina = TAMANHO_PAGINA_SUPABASE,
    limitePaginas = LIMITE_PAGINAS,
): Promise<T[]> => {
    const linhas: T[] = [];
    for (let pagina = 0; pagina < limitePaginas; pagina += 1) {
        const inicio = pagina * tamanhoPagina;
        const { data, error } = await montar(inicio, inicio + tamanhoPagina - 1);
        if (error) throw error;
        const lote = data ?? [];
        linhas.push(...lote);
        if (lote.length < tamanhoPagina) break;
    }
    return linhas;
};
