/**
 * Checklist de primeiro acesso do gerente (migration 16).
 * O banco (status_primeiro_acesso) mede o estado real dos dados; aqui só
 * se valida a resposta e se monta a lista para a tela.
 */

export type ChavePasso = "identidade" | "produtos" | "equipe" | "funil" | "primeiro_lead";

export type StatusPrimeiroAcesso = Record<ChavePasso, boolean> & { dispensado: boolean };

export const PASSOS_PRIMEIRO_ACESSO: Array<{ chave: ChavePasso; titulo: string; descricao: string; rota: string; acao: string }> = [
    {
        chave: "identidade",
        titulo: "Logo e identidade da empresa",
        descricao: "Logo, dados e cores que saem nas propostas em PDF.",
        rota: "/configuracoes",
        acao: "Configurar",
    },
    {
        chave: "produtos",
        titulo: "Cadastrar produtos",
        descricao: "Kits, módulos e serviços para montar orçamentos em segundos.",
        rota: "/configuracoes",
        acao: "Cadastrar",
    },
    {
        chave: "equipe",
        titulo: "Convidar a equipe",
        descricao: "Dê acesso aos vendedores para cada um cuidar dos próprios negócios.",
        rota: "/equipe",
        acao: "Convidar",
    },
    {
        chave: "funil",
        titulo: "Revisar o funil",
        descricao: "Ajuste etapas, probabilidades e o prazo de negócio parado.",
        rota: "/configuracoes",
        acao: "Revisar",
    },
    {
        chave: "primeiro_lead",
        titulo: "Criar o primeiro lead",
        descricao: "Cadastre um cliente e veja o funil andar.",
        rota: "/clientes/create",
        acao: "Criar lead",
    },
];

/** Valida a resposta da RPC: qualquer coisa fora do formato vira null (card some). */
export const lerStatusPrimeiroAcesso = (dado: unknown): StatusPrimeiroAcesso | null => {
    if (!dado || typeof dado !== "object" || Array.isArray(dado)) return null;
    const bruto = dado as Record<string, unknown>;
    const chaves: Array<keyof StatusPrimeiroAcesso> = [...PASSOS_PRIMEIRO_ACESSO.map((p) => p.chave), "dispensado"];
    if (!chaves.every((c) => typeof bruto[c] === "boolean")) return null;
    return Object.fromEntries(chaves.map((c) => [c, bruto[c] as boolean])) as StatusPrimeiroAcesso;
};

export type Checklist = {
    itens: Array<(typeof PASSOS_PRIMEIRO_ACESSO)[number] & { feito: boolean }>;
    feitos: number;
    total: number;
    percentual: number;
    completo: boolean;
    /** Mostrar o card: só gerente, não dispensado e com passo pendente. */
    visivel: boolean;
};

export const montarChecklist = (status: StatusPrimeiroAcesso | null, isGerente: boolean): Checklist => {
    const itens = PASSOS_PRIMEIRO_ACESSO.map((passo) => ({ ...passo, feito: Boolean(status?.[passo.chave]) }));
    const feitos = itens.filter((i) => i.feito).length;
    const total = itens.length;
    const completo = feitos === total;
    return {
        itens,
        feitos,
        total,
        percentual: Math.round((feitos / total) * 100),
        completo,
        visivel: Boolean(status) && isGerente && !status?.dispensado && !completo,
    };
};
