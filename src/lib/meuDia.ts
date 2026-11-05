import type { CrudFilter } from "@refinedev/core";

/**
 * Regras puras da tela "Meu dia".
 *
 * Decisão de produto: o vendedor cai no Meu dia ao entrar no CRM (uma vez
 * por sessão do navegador) e continua podendo abrir o Dashboard pelo
 * menu; o gerente entra direto no Dashboard, como sempre.
 */

export type TarefaDoDia = {
    id: string | number;
    titulo?: string | null;
    tipo?: string | null;
    data_vencimento?: string | null;
    cliente_id?: string | number | null;
    responsavel?: string | null;
    concluido?: boolean | null;
};

const paraData = (valor?: string | null): Date | null => {
    if (!valor) return null;
    const data = new Date(valor);
    return Number.isNaN(data.getTime()) ? null : data;
};

/** Fim do dia local (23:59:59.999) de `agora`. */
export const fimDoDia = (agora: Date = new Date()): Date => {
    const fim = new Date(agora);
    fim.setHours(23, 59, 59, 999);
    return fim;
};

const inicioDoDia = (agora: Date): Date => {
    const inicio = new Date(agora);
    inicio.setHours(0, 0, 0, 0);
    return inicio;
};

/**
 * Atrasadas: venceram antes de hoje. Hoje: vencem hoje (mesmo se o
 * horário já passou: ainda é "de hoje"). Concluídas e sem data ficam de
 * fora. Ordem por vencimento.
 */
export const separarTarefasDoDia = <T extends TarefaDoDia>(
    tarefas: readonly T[],
    agora: Date = new Date(),
): { atrasadas: T[]; hoje: T[] } => {
    const inicio = inicioDoDia(agora).getTime();
    const fim = fimDoDia(agora).getTime();
    const abertas = tarefas
        .filter((t) => !t.concluido)
        .map((t) => ({ t, quando: paraData(t.data_vencimento)?.getTime() ?? null }))
        .filter((x): x is { t: T; quando: number } => x.quando !== null && x.quando <= fim)
        .sort((a, b) => a.quando - b.quando);
    return {
        atrasadas: abertas.filter((x) => x.quando < inicio).map((x) => x.t),
        hoje: abertas.filter((x) => x.quando >= inicio).map((x) => x.t),
    };
};

/**
 * "Do usuário" = responsável é ele (nome/e-mail, igual ao Kanban).
 * Gerente pode ver a equipe toda; vendedor nunca recebe o filtro aberto.
 */
export const filtrosDoDono = (params: {
    ownerCandidates: string[];
    verEquipe: boolean;
    isGerente: boolean;
}): CrudFilter[] => {
    const { ownerCandidates, verEquipe, isGerente } = params;
    if (verEquipe && isGerente) return [];
    // Sem nenhum nome conhecido, filtra por um valor impossível em vez de
    // mostrar a equipe inteira por engano.
    const nomes = ownerCandidates.length > 0 ? ownerCandidates : ["__sem_responsavel__"];
    return [{ field: "responsavel", operator: "in", value: nomes }];
};

export const CHAVE_INICIO_MEU_DIA = "crm_inicio_meu_dia";

/** O "/" manda o vendedor para o Meu dia só na primeira vez da sessão. */
export const deveAbrirMeuDia = (params: { isGerente: boolean; jaAbriuNestaSessao: boolean }): boolean =>
    !params.isGerente && !params.jaAbriuNestaSessao;

/** O Meu dia marca que já foi visto nesta sessão (storage pode falhar). */
export const marcarMeuDiaVisto = (): void => {
    try {
        window.sessionStorage.setItem(CHAVE_INICIO_MEU_DIA, "1");
    } catch {
        // conveniência apenas
    }
};
