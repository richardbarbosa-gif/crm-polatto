import { classificarDesfecho, taxaDeConversao, type EtapaFunil } from "./pipelineMetrics";
import { parseCurrencyLikeValue } from "./formatters";

/**
 * Origem do lead (migration 16). O canal escolhido fica em
 * negocios.dados_extras como { origem_id, origem } — id para o relatório
 * seguir o canal mesmo se o gerente renomear, nome como cópia para o
 * lead continuar legível se o canal for apagado.
 */

export const RECURSO_CANAIS = "canais_origem";
export const RECURSO_VENDAS_POR_ORIGEM = "vw_vendas_por_origem";
export const SEM_ORIGEM = "Não informado";

export type CanalOrigem = { id: string; nome: string; ativo?: boolean | null; ordem?: number | null };

/**
 * Campos de origem que vão no dados_extras do payload.
 * criar: sem origem escolhida não manda nada.
 * editar: limpar a origem manda null (a view apaga a chave no merge).
 */
export const origemParaDadosExtras = (
    origemId: string | null | undefined,
    canais: CanalOrigem[],
    modo: "criar" | "editar" = "criar",
): Record<string, string | null> => {
    const canal = origemId ? canais.find((c) => c.id === origemId) : undefined;
    if (canal) return { origem_id: canal.id, origem: canal.nome };
    return modo === "editar" ? { origem_id: null, origem: null } : {};
};

/** Origem gravada no lead (para preencher o formulário e exibir). */
export const origemDoLead = (
    dadosExtras: Record<string, unknown> | null | undefined,
): { id?: string; nome?: string } => {
    const id = typeof dadosExtras?.origem_id === "string" ? dadosExtras.origem_id : undefined;
    const nome = typeof dadosExtras?.origem === "string" && dadosExtras.origem.trim() ? dadosExtras.origem.trim() : undefined;
    return { id, nome };
};

/** Linha da view vw_vendas_por_origem. */
export type LinhaOrigem = {
    origem?: string | null;
    stage_id?: string | number | null;
    status?: string | null;
    responsavel?: string | null;
    mes_cadastro?: string | null;
    total_leads?: number | string | null;
    valor_total?: number | string | null;
};

export type ResumoOrigem = {
    origem: string;
    leads: number;
    ganhos: number;
    perdidos: number;
    abertos: number;
    /** Taxa oficial do CRM: ganhos ÷ (ganhos + perdidos). */
    conversao: number;
    valorGanho: number;
};

/**
 * Agrupa a view por origem. Ganho/perdido pela etapa (flags do gerente),
 * igual ao resto do CRM (classificarDesfecho), e conversão por
 * taxaDeConversao. Ordena por valor ganho e, no empate, por leads.
 */
export const resumirPorOrigem = (
    linhas: LinhaOrigem[] | null | undefined,
    etapasPorId: Map<string, EtapaFunil>,
): ResumoOrigem[] => {
    const mapa = new Map<string, ResumoOrigem>();
    (linhas ?? []).forEach((linha) => {
        const origem = linha.origem?.trim() || SEM_ORIGEM;
        const quantidade = Number(linha.total_leads) || 0;
        if (quantidade <= 0) return;
        const atual =
            mapa.get(origem) ?? { origem, leads: 0, ganhos: 0, perdidos: 0, abertos: 0, conversao: 0, valorGanho: 0 };
        const desfecho = classificarDesfecho(linha, etapasPorId);
        atual.leads += quantidade;
        if (desfecho === "ganho") {
            atual.ganhos += quantidade;
            atual.valorGanho += parseCurrencyLikeValue(linha.valor_total) ?? 0;
        } else if (desfecho === "perdido") {
            atual.perdidos += quantidade;
        } else {
            atual.abertos += quantidade;
        }
        mapa.set(origem, atual);
    });
    return [...mapa.values()]
        .map((r) => ({ ...r, conversao: taxaDeConversao(r.ganhos, r.perdidos) }))
        .sort((a, b) => b.valorGanho - a.valorGanho || b.leads - a.leads || a.origem.localeCompare(b.origem));
};

/** Primeiro dia do mês, N meses atrás (filtro de período por mês de cadastro). */
export const inicioDoPeriodo = (meses: number, agora: Date = new Date()): string => {
    const data = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - Math.max(0, meses - 1), 1));
    return data.toISOString().slice(0, 10);
};
