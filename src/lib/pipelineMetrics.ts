import { normalizeText, parseCurrencyLikeValue } from "./formatters";

/**
 * Regras de negócio do funil compartilhadas por Kanban, dashboard e
 * relatórios. Antes cada tela tinha a sua: o card mostrava a conta de luz
 * antes do valor do negócio, o dashboard só reconhecia etapas cujo NOME
 * continha "fechado", e os relatórios ignoravam os flags ganho/perdido que
 * o admin marca na configuração do funil. O mesmo negócio aparecia com
 * valores e desfechos diferentes em cada tela.
 */

export type EtapaFunil = {
    id?: string | number | null;
    nome?: string | null;
    cor?: string | null;
    ordem?: number | null;
    pipeline_id?: string | null;
    probabilidade?: number | string | null;
    ganho?: boolean | null;
    perdido?: boolean | null;
};

export type Desfecho = "ganho" | "perdido" | "aberto";

type LeadComValor = {
    valor?: unknown;
    conta_energia_media?: unknown;
};

/**
 * Valor do negócio: `valor` quando informado (> 0); senão a média da conta
 * (modelo solar legado). Mesma regra de coalesce das views do banco
 * (vw_kanban_kpis, vw_performance_vendedores), com uma diferença deliberada:
 * valor 0 conta como "não informado", porque o formulário antigo gravava 0
 * quando o campo ficava vazio.
 */
export const valorDoLead = (lead: LeadComValor | null | undefined): number => {
    if (!lead) return 0;
    const valor = parseCurrencyLikeValue(lead.valor);
    if (valor !== null && valor > 0) return valor;
    return parseCurrencyLikeValue(lead.conta_energia_media) ?? 0;
};

export const textoIndicaGanho = (texto?: string | null): boolean => {
    const valor = normalizeText(texto);
    return valor.includes("fechado") || valor.includes("ganho");
};

export const textoIndicaPerda = (texto?: string | null): boolean =>
    normalizeText(texto).includes("perdido");

export const indexarEtapas = (etapas: EtapaFunil[] | null | undefined): Map<string, EtapaFunil> => {
    const mapa = new Map<string, EtapaFunil>();
    (etapas ?? []).forEach((etapa) => {
        if (etapa?.id !== undefined && etapa?.id !== null) mapa.set(String(etapa.id), etapa);
    });
    return mapa;
};

/**
 * Desfecho de um negócio. Prioridade: flags ganho/perdido da etapa (o que o
 * admin configurou); sem etapa conhecida, o texto do status.
 */
export const classificarDesfecho = (
    registro: { stage_id?: unknown; status?: string | null } | null | undefined,
    etapasPorId: Map<string, EtapaFunil>,
): Desfecho => {
    if (!registro) return "aberto";
    const stageId = registro.stage_id;
    const etapa =
        stageId !== undefined && stageId !== null ? etapasPorId.get(String(stageId)) : undefined;

    if (etapa?.ganho) return "ganho";
    if (etapa?.perdido) return "perdido";

    const texto = etapa?.nome || registro.status;
    if (textoIndicaGanho(texto)) return "ganho";
    if (textoIndicaPerda(texto)) return "perdido";
    return "aberto";
};

/** Percentual seguro: nunca NaN nem Infinity. */
export const percentual = (parte: number, todo: number): number => {
    if (!Number.isFinite(parte) || !Number.isFinite(todo) || todo <= 0) return 0;
    return (parte / todo) * 100;
};

/** Linha da view agregada vw_kanban_kpis. */
export type LinhaKpi = {
    status?: string | null;
    stage_id?: string | number | null;
    pipeline_id?: string | null;
    responsavel?: string | null;
    temperatura?: string | null;
    total_leads?: number | string | null;
    valor_total?: number | string | null;
};

export type ResumoEtapa = {
    chave: string;
    nome: string;
    cor?: string | null;
    ordem: number;
    desfecho: Desfecho;
    total: number;
    valor: number;
};

export type ResumoResponsavel = {
    nome: string;
    total: number;
    abertos: number;
    ganhos: number;
    perdidos: number;
    valor: number;
    valorGanho: number;
};

export type ResumoFunil = {
    totalLeads: number;
    abertos: number;
    ganhos: number;
    perdidos: number;
    valorTotal: number;
    valorAberto: number;
    valorGanho: number;
    valorPerdido: number;
    /** Soma de valor × probabilidade da etapa, só dos negócios em aberto. */
    valorPonderado: number;
    /** Existe ao menos uma etapa com probabilidade configurada. */
    temProbabilidade: boolean;
    /** Ganhos sobre o total de negócios (definição usada no Kanban). */
    conversao: number;
    /** Ganhos sobre negócios decididos (ganhos + perdidos). */
    taxaDeGanho: number;
    porEtapa: ResumoEtapa[];
    porResponsavel: ResumoResponsavel[];
    porTemperatura: Record<"quente" | "morno" | "frio", number>;
};

const numero = (valor: unknown): number => parseCurrencyLikeValue(valor) ?? 0;

/**
 * Resumo do funil a partir das linhas JÁ AGREGADAS no banco
 * (vw_kanban_kpis). Não depende de carregar os negócios um a um — por isso
 * os números continuam certos com 50 mil leads.
 */
export const resumirFunil = (
    linhas: LinhaKpi[] | null | undefined,
    etapas: EtapaFunil[] | null | undefined,
): ResumoFunil => {
    const etapasPorId = indexarEtapas(etapas);
    const porEtapa = new Map<string, ResumoEtapa>();
    const porResponsavel = new Map<string, ResumoResponsavel>();
    const porTemperatura = { quente: 0, morno: 0, frio: 0 };

    const resumo: ResumoFunil = {
        totalLeads: 0,
        abertos: 0,
        ganhos: 0,
        perdidos: 0,
        valorTotal: 0,
        valorAberto: 0,
        valorGanho: 0,
        valorPerdido: 0,
        valorPonderado: 0,
        temProbabilidade: (etapas ?? []).some((e) => numero(e?.probabilidade) > 0),
        conversao: 0,
        taxaDeGanho: 0,
        porEtapa: [],
        porResponsavel: [],
        porTemperatura,
    };

    (linhas ?? []).forEach((linha) => {
        const quantidade = numero(linha.total_leads);
        const valor = numero(linha.valor_total);
        if (quantidade <= 0) return;

        const desfecho = classificarDesfecho(linha, etapasPorId);
        const etapa =
            linha.stage_id !== undefined && linha.stage_id !== null
                ? etapasPorId.get(String(linha.stage_id))
                : undefined;

        resumo.totalLeads += quantidade;
        resumo.valorTotal += valor;
        if (desfecho === "ganho") {
            resumo.ganhos += quantidade;
            resumo.valorGanho += valor;
        } else if (desfecho === "perdido") {
            resumo.perdidos += quantidade;
            resumo.valorPerdido += valor;
        } else {
            resumo.abertos += quantidade;
            resumo.valorAberto += valor;
            const probabilidade = Math.min(Math.max(numero(etapa?.probabilidade), 0), 100);
            resumo.valorPonderado += (valor * probabilidade) / 100;
        }

        const chaveEtapa = etapa?.id != null ? String(etapa.id) : `status:${normalizeText(linha.status) || "sem-etapa"}`;
        const atualEtapa = porEtapa.get(chaveEtapa) ?? {
            chave: chaveEtapa,
            nome: etapa?.nome || linha.status || "Sem etapa",
            cor: etapa?.cor ?? null,
            ordem: typeof etapa?.ordem === "number" ? etapa.ordem : Number.MAX_SAFE_INTEGER,
            desfecho,
            total: 0,
            valor: 0,
        };
        atualEtapa.total += quantidade;
        atualEtapa.valor += valor;
        porEtapa.set(chaveEtapa, atualEtapa);

        const nomeResponsavel = (linha.responsavel || "").trim() || "Sem responsável";
        const chaveResponsavel = normalizeText(nomeResponsavel);
        const atualResponsavel = porResponsavel.get(chaveResponsavel) ?? {
            nome: nomeResponsavel,
            total: 0,
            abertos: 0,
            ganhos: 0,
            perdidos: 0,
            valor: 0,
            valorGanho: 0,
        };
        atualResponsavel.total += quantidade;
        atualResponsavel.valor += valor;
        if (desfecho === "ganho") {
            atualResponsavel.ganhos += quantidade;
            atualResponsavel.valorGanho += valor;
        } else if (desfecho === "perdido") {
            atualResponsavel.perdidos += quantidade;
        } else {
            atualResponsavel.abertos += quantidade;
        }
        porResponsavel.set(chaveResponsavel, atualResponsavel);

        const temperatura = normalizeText(linha.temperatura);
        if (temperatura === "quente" || temperatura === "morno" || temperatura === "frio") {
            porTemperatura[temperatura] += quantidade;
        }
    });

    resumo.conversao = percentual(resumo.ganhos, resumo.totalLeads);
    resumo.taxaDeGanho = percentual(resumo.ganhos, resumo.ganhos + resumo.perdidos);
    resumo.porEtapa = Array.from(porEtapa.values()).sort(
        (a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome),
    );
    resumo.porResponsavel = Array.from(porResponsavel.values()).sort((a, b) => b.valor - a.valor);
    return resumo;
};

/** Total de leads e valor somado por etapa (chave = stage_id). */
export const totaisPorEtapa = (
    linhas: LinhaKpi[] | null | undefined,
): Map<string, { total: number; valor: number }> => {
    const mapa = new Map<string, { total: number; valor: number }>();
    (linhas ?? []).forEach((linha) => {
        const chave =
            linha.stage_id === null || linha.stage_id === undefined ? "outros" : String(linha.stage_id);
        const atual = mapa.get(chave) ?? { total: 0, valor: 0 };
        atual.total += numero(linha.total_leads);
        atual.valor += numero(linha.valor_total);
        mapa.set(chave, atual);
    });
    return mapa;
};
