import type { CrudFilter, CrudSort } from "@refinedev/core";
import { normalizeText } from "./formatters";

/**
 * Saúde do negócio no funil (migration 15, view vw_negocios_saude).
 *
 * O cálculo oficial é do BANCO (última atividade, parado, sem próximo
 * passo). Estas funções puras só interpretam a linha da view para a tela
 * e cobrem o modo de compatibilidade, enquanto a view não existe no
 * ambiente (migration pendente): aí o Kanban continua lendo `clientes` e
 * a próxima atividade vem da consulta de tarefas que ele já fazia.
 */

export const RECURSO_SAUDE = "vw_negocios_saude";

/** Campos de saúde que a view acrescenta ao card. */
export type SaudeDoNegocio = {
    aberto?: boolean | null;
    parado?: boolean | null;
    dias_sem_atividade?: number | null;
    dias_sem_contato?: number | null;
    dias_para_parado?: number | null;
    ultima_atividade_em?: string | null;
    ultimo_contato_em?: string | null;
    sem_proximo_passo?: boolean | null;
    proxima_tarefa_em?: string | null;
    proxima_tarefa_titulo?: string | null;
    proxima_tarefa_tipo?: string | null;
    proxima_tarefa_atrasada?: boolean | null;
    temperatura?: string | null;
    temperatura_ordem?: number | null;
};

export type FiltroSaude = "todos" | "parados" | "sem_proximo_passo";

export const FILTRO_SAUDE_OPCOES: Array<{ value: FiltroSaude; label: string }> = [
    { value: "todos", label: "Todos os negócios" },
    { value: "parados", label: "Parados" },
    { value: "sem_proximo_passo", label: "Sem próximo passo" },
];

/** Limiar do card do Dashboard e do Meu dia: quente sem contato há N+ dias. */
export const DIAS_QUENTE_SEM_CONTATO = 3;

const MS_POR_DIA = 24 * 60 * 60 * 1000;

const paraData = (valor?: string | Date | null): Date | null => {
    if (!valor) return null;
    const data = valor instanceof Date ? valor : new Date(valor);
    return Number.isNaN(data.getTime()) ? null : data;
};

/** Dias inteiros entre a data e agora (nunca negativo). */
export const diasDesde = (valor?: string | Date | null, agora: Date = new Date()): number | null => {
    const data = paraData(valor);
    if (!data) return null;
    return Math.max(0, Math.floor((agora.getTime() - data.getTime()) / MS_POR_DIA));
};

/**
 * Mesma regra da view: negócio aberto, etapa monitorada e sem atividade há
 * MAIS de `diasParaParado` dias. Etapa de ganho/perda nunca fica parada.
 */
export const estaParado = (params: {
    ultimaAtividadeEm?: string | Date | null;
    diasParaParado?: number | null;
    etapaFinal?: boolean;
    agora?: Date;
}): boolean => {
    const { ultimaAtividadeEm, diasParaParado, etapaFinal = false, agora = new Date() } = params;
    if (etapaFinal) return false;
    if (diasParaParado === null || diasParaParado === undefined || diasParaParado <= 0) return false;
    const ultima = paraData(ultimaAtividadeEm);
    if (!ultima) return false;
    return agora.getTime() - ultima.getTime() > diasParaParado * MS_POR_DIA;
};

/** Texto do selo do card: "Parado há 1 dia" / "Parado há 12 dias". */
export const rotuloParado = (dias?: number | null): string => {
    const n = Math.max(0, Math.floor(Number(dias) || 0));
    return `Parado há ${n} ${n === 1 ? "dia" : "dias"}`;
};

/** Texto do prazo da etapa na configuração. */
export const rotuloPrazoEtapa = (dias?: number | null, etapaFinal = false): string => {
    if (etapaFinal) return "Não se aplica";
    if (dias === null || dias === undefined) return "Não monitora";
    return `${dias} ${dias === 1 ? "dia" : "dias"}`;
};

/**
 * Negócio aberto sem tarefa aberta = sem próximo passo. Com a view, vale o
 * que o banco calculou; sem ela, a próxima atividade carregada pelo Kanban
 * e as flags da etapa (ganho/perda) decidem.
 */
export const semProximoPasso = (
    lead: SaudeDoNegocio | null | undefined,
    proximaTarefa: unknown,
    etapaFinal = false,
): boolean => {
    if (lead && typeof lead.sem_proximo_passo === "boolean") return lead.sem_proximo_passo;
    if (etapaFinal) return false;
    return !proximaTarefa;
};

/** Próxima tarefa vinda da view, no formato que o card já usa. */
export const proximaTarefaDaSaude = (
    lead: SaudeDoNegocio | null | undefined,
): { titulo?: string | null; tipo?: string | null; data_vencimento?: string | null } | undefined => {
    if (!lead || (!lead.proxima_tarefa_em && !lead.proxima_tarefa_titulo)) return undefined;
    return {
        titulo: lead.proxima_tarefa_titulo ?? null,
        tipo: lead.proxima_tarefa_tipo ?? null,
        data_vencimento: lead.proxima_tarefa_em ?? null,
    };
};

/** quente = 3, morno = 2, frio = 1, sem temperatura = 0 (igual à view). */
export const ordemDaTemperatura = (temperatura?: string | null): number => {
    const valor = normalizeText(temperatura);
    if (valor === "quente") return 3;
    if (valor === "morno") return 2;
    if (valor === "frio") return 1;
    return 0;
};

/**
 * Quentes primeiro, depois mornos, depois frios; dentro da mesma
 * temperatura a ordem original é mantida (sort estável).
 */
export const ordenarPorTemperatura = <T extends { temperatura?: string | null }>(leads: readonly T[]): T[] =>
    leads
        .map((lead, indice) => ({ lead, indice, ordem: ordemDaTemperatura(lead.temperatura) }))
        .sort((a, b) => b.ordem - a.ordem || a.indice - b.indice)
        .map(({ lead }) => lead);

/**
 * Ordenação do Kanban no servidor (view de saúde): temperatura e, como
 * desempate, a ordem de cadastro (a mais antiga primeiro, como a coluna
 * já aparecia) e o id para a paginação nunca repetir nem pular card.
 */
export const ORDENACAO_KANBAN: CrudSort[] = [
    { field: "temperatura_ordem", order: "desc" },
    { field: "created_at", order: "asc" },
    { field: "id", order: "asc" },
];

/** Filtro do Kanban por saúde (só existe na view). */
export const filtrosDeSaude = (filtro: FiltroSaude): CrudFilter[] => {
    if (filtro === "parados") return [{ field: "parado", operator: "eq", value: true }];
    if (filtro === "sem_proximo_passo") return [{ field: "sem_proximo_passo", operator: "eq", value: true }];
    return [];
};

/** Filtros do card "Quentes sem contato há 3+ dias". */
export const filtrosQuentesSemContato = (dias = DIAS_QUENTE_SEM_CONTATO): CrudFilter[] => [
    { field: "temperatura", operator: "eq", value: "quente" },
    { field: "aberto", operator: "eq", value: true },
    { field: "dias_sem_contato", operator: "gte", value: dias },
];

/** "Sem contato há 1 dia" / "há 5 dias" / "Contato hoje". */
export const rotuloSemContato = (dias?: number | null): string => {
    const n = Math.max(0, Math.floor(Number(dias) || 0));
    if (n === 0) return "Contato hoje";
    return `Sem contato há ${n} ${n === 1 ? "dia" : "dias"}`;
};
