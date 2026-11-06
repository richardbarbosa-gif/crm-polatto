import { useList } from "@refinedev/core";
import { useMemo } from "react";
import { regraDoBanco, type ContextoAutomacao, type RegraAutomacao } from "../../../lib/automacoes";

type Linha = Record<string, unknown> & { id?: string | number };

export type OpcaoEtapa = { value: number; label: string; pipelineId: string | null };
export type Opcao = { value: string; label: string };

export type ResumoAutomacao = {
    totalExecucoes: number;
    totalErros: number;
    ultimaExecucaoEm: string | null;
};

export type RegraListada = {
    regra: RegraAutomacao;
    modeloChave: string | null;
    resumo: ResumoAutomacao;
};

const nome = (linha: Linha): string => (typeof linha.nome === "string" ? linha.nome.trim() : "");
const vivo = (linha: Linha): boolean => linha.deleted_at === null || linha.deleted_at === undefined;
const numero = (valor: unknown): number => {
    const n = typeof valor === "string" ? Number(valor) : valor;
    return typeof n === "number" && Number.isFinite(n) ? n : 0;
};

const indexar = (linhas: Linha[]): Record<string, string> =>
    Object.fromEntries(linhas.filter((l) => l.id !== undefined && nome(l)).map((l) => [String(l.id), nome(l)]));

const listaDe = (dados: unknown): Linha[] => (Array.isArray(dados) ? (dados as Linha[]).filter(Boolean) : []);

/**
 * Tudo o que a tela de automações precisa, em consultas pequenas (todas
 * filtradas pela RLS do tenant). As linhas do banco passam por
 * regraDoBanco (validação em tempo de execução).
 */
export const useDadosAutomacoes = () => {
    const off = { mode: "off" as const };
    const { query: qRegras } = useList<Linha>({ resource: "automacoes", pagination: off, sorters: [{ field: "created_at", order: "asc" }] });
    const { query: qAcoes } = useList<Linha>({ resource: "automacoes_acoes", pagination: off });
    const { query: qResumo } = useList<Linha>({ resource: "vw_automacoes_resumo", pagination: off });
    const { query: qEtapas } = useList<Linha>({ resource: "pipeline_stages", pagination: off, sorters: [{ field: "ordem", order: "asc" }] });
    const { query: qFunis } = useList<Linha>({ resource: "pipelines", pagination: off, sorters: [{ field: "ordem", order: "asc" }] });
    const { query: qUsuarios } = useList<Linha>({ resource: "funcionarios", pagination: off, sorters: [{ field: "nome", order: "asc" }] });
    const { query: qTipos } = useList<Linha>({ resource: "tipos_atividade", pagination: off, sorters: [{ field: "ordem", order: "asc" }] });
    const { query: qOrigens } = useList<Linha>({ resource: "canais_origem", pagination: off, sorters: [{ field: "ordem", order: "asc" }] });

    const regrasRaw = useMemo(() => listaDe(qRegras.data?.data), [qRegras.data?.data]);
    const acoesRaw = useMemo(() => listaDe(qAcoes.data?.data), [qAcoes.data?.data]);
    const resumoRaw = useMemo(() => listaDe(qResumo.data?.data), [qResumo.data?.data]);
    const etapasRaw = useMemo(() => listaDe(qEtapas.data?.data), [qEtapas.data?.data]);
    const funisRaw = useMemo(() => listaDe(qFunis.data?.data), [qFunis.data?.data]);
    const usuariosRaw = useMemo(() => listaDe(qUsuarios.data?.data), [qUsuarios.data?.data]);
    const tiposRaw = useMemo(() => listaDe(qTipos.data?.data), [qTipos.data?.data]);
    const origensRaw = useMemo(() => listaDe(qOrigens.data?.data), [qOrigens.data?.data]);

    const contexto = useMemo<ContextoAutomacao>(
        () => ({
            etapas: indexar(etapasRaw),
            funis: indexar(funisRaw),
            usuarios: indexar(usuariosRaw),
            tiposAtividade: indexar(tiposRaw),
            origens: indexar(origensRaw),
        }),
        [etapasRaw, funisRaw, usuariosRaw, tiposRaw, origensRaw],
    );

    const regras = useMemo<RegraListada[]>(() => {
        const acoesPorRegra = new Map<string, Linha[]>();
        acoesRaw.forEach((acao) => {
            const chave = String(acao.automacao_id ?? "");
            acoesPorRegra.set(chave, [...(acoesPorRegra.get(chave) ?? []), acao]);
        });
        const resumoPorRegra = new Map(resumoRaw.map((r) => [String(r.automacao_id ?? ""), r]));
        return regrasRaw.flatMap((linha) => {
            const regra = regraDoBanco(linha, acoesPorRegra.get(String(linha.id)) ?? []);
            if (!regra) return [];
            const resumo = resumoPorRegra.get(String(linha.id));
            return [
                {
                    regra,
                    modeloChave: typeof linha.modelo_chave === "string" ? linha.modelo_chave : null,
                    resumo: {
                        totalExecucoes: numero(resumo?.total_execucoes),
                        totalErros: numero(resumo?.total_erros),
                        ultimaExecucaoEm: typeof resumo?.ultima_execucao_em === "string" ? resumo.ultima_execucao_em : null,
                    },
                },
            ];
        });
    }, [regrasRaw, acoesRaw, resumoRaw]);

    const opcoes = useMemo(() => {
        const nomeFunil = indexar(funisRaw);
        const variosFunis = funisRaw.length > 1;
        const etapas: OpcaoEtapa[] = etapasRaw
            .filter((e) => nome(e) && e.id !== undefined)
            .map((e) => {
                const pipelineId = typeof e.pipeline_id === "string" ? e.pipeline_id : null;
                const funil = pipelineId ? nomeFunil[pipelineId] : undefined;
                return {
                    value: Number(e.id),
                    label: variosFunis && funil ? `${funil} · ${nome(e)}` : nome(e),
                    pipelineId,
                };
            });
        const ativos = (linhas: Linha[]): Opcao[] =>
            linhas
                .filter((l) => vivo(l) && l.ativo !== false && nome(l) && l.id !== undefined)
                .map((l) => ({ value: String(l.id), label: nome(l) }));
        return {
            etapas,
            funis: ativos(funisRaw),
            usuarios: ativos(usuariosRaw),
            tipos: ativos(tiposRaw),
            origens: ativos(origensRaw),
        };
    }, [etapasRaw, funisRaw, usuariosRaw, tiposRaw, origensRaw]);

    return {
        regras,
        contexto,
        opcoes,
        carregando: qRegras.isLoading || qAcoes.isLoading,
        erro: qRegras.error ?? qAcoes.error ?? null,
        recarregar: () => {
            void qRegras.refetch();
            void qAcoes.refetch();
            void qResumo.refetch();
        },
    };
};
