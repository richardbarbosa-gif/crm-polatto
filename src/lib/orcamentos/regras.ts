/**
 * Regras do ciclo de vida da proposta (espelho da migration 14). O banco é
 * quem decide: aqui só se esconde da tela o que ele vai recusar, para o
 * vendedor nem ver o botão. Tudo puro e testado em
 * __tests__/orcamentosRegras.test.ts.
 */
import { ROTULO_STATUS, formatarDataIso, type StatusOrcamento } from "./formato";

/** Mesma frase do banco (fn_orcamentos_travar / fn_orcamento_itens_travar). */
export const MENSAGEM_PROPOSTA_TRAVADA = "Proposta já enviada não pode ser alterada. Use “Nova versão” para revisar.";

/**
 * Transições que o vendedor escolhe. "substituido" não está aqui: só o
 * banco define, quando a revisão é enviada.
 */
export const TRANSICOES_MANUAIS: Readonly<Record<StatusOrcamento, readonly StatusOrcamento[]>> = {
    rascunho: ["enviado"],
    enviado: ["aceito", "recusado", "expirado"],
    aceito: [],
    recusado: [],
    expirado: [],
    substituido: [],
};

/** Status de onde a proposta vira "substituída" quando a revisão é enviada. */
const SUBSTITUIVEIS: readonly StatusOrcamento[] = ["enviado", "expirado"];

/** O que o menu "Mudar status" pode oferecer a partir deste status. */
export const transicoesDisponiveis = (status: StatusOrcamento): readonly StatusOrcamento[] => TRANSICOES_MANUAIS[status];

/**
 * A mudança é aceita pelo banco? Inclui a automática (enviado/expirado ->
 * substituido), que o banco só aceita quando há revisão enviada.
 */
export const transicaoValida = (de: StatusOrcamento, para: StatusOrcamento): boolean =>
    TRANSICOES_MANUAIS[de].includes(para) || (para === "substituido" && SUBSTITUIVEIS.includes(de));

/** Status final: não muda mais (só uma nova versão revisa). */
export const statusFinal = (status: StatusOrcamento): boolean => TRANSICOES_MANUAIS[status].length === 0;

/** Só rascunho é editável. Qualquer outro status abre somente leitura. */
export const orcamentoEditavel = (status: StatusOrcamento): boolean => status === "rascunho";

/**
 * "Nova versão" faz sentido para proposta que o cliente já recebeu.
 * Rascunho se edita direto; substituída já tem uma revisão mais nova.
 */
export const podeCriarNovaVersao = (status: StatusOrcamento): boolean =>
    status !== "rascunho" && status !== "substituido";

/** O que acontece com ESTA proposta quando a nova versão dela for enviada. */
export const efeitoDaNovaVersao = (status: StatusOrcamento): string =>
    SUBSTITUIVEIS.includes(status)
        ? "Esta proposta continua valendo até a revisão ser enviada; aí passa a constar como substituída."
        : `Esta proposta continua registrada como "${ROTULO_STATUS[status]}".`;

/** "Revisão 2 de 2026-0003" (só quando a proposta é uma revisão). */
export const rotuloRevisao = (revisao: number | null | undefined, numeroOriginal: string | null | undefined): string | null => {
    if (!revisao || revisao < 2) return null;
    const origem = (numeroOriginal ?? "").trim();
    return origem ? `Revisão ${revisao} de ${origem}` : `Revisão ${revisao}`;
};

/** "Rev. 2" ao lado do número (PDF e listas compactas). */
export const siglaRevisao = (revisao: number | null | undefined): string | null =>
    revisao && revisao >= 2 ? `Rev. ${revisao}` : null;

/** O que fazer quando a validade passou, conforme o status. */
export const dicaVencido = (status: StatusOrcamento, validoAte: string | null | undefined): string => {
    const quando = `Validade terminou em ${formatarDataIso(validoAte)}.`;
    return status === "rascunho"
        ? `${quando} Ajuste a validade antes de enviar.`
        : `${quando} Marque como expirado ou crie uma nova versão.`;
};
