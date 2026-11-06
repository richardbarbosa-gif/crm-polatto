import { describe, expect, it } from "vitest";
import {
    acaoDoBanco,
    descreverAcao,
    descreverAutomacao,
    descreverCondicoes,
    descreverGatilho,
    formatarPrazo,
    mensagemErroAutomacao,
    montarPayloadSalvar,
    novaAcao,
    novaRegra,
    pendenciasParaAtivar,
    regraDoBanco,
    validarAutomacao,
    type ContextoAutomacao,
    type RegraAutomacao,
} from "../automacoes";

const ctx: ContextoAutomacao = {
    etapas: { "3": "Proposta Enviada", "2": "Visita Agendada" },
    funis: { "f-vendas": "Vendas" },
    usuarios: { "u-ana": "Ana Souza" },
    origens: { "o-insta": "Instagram" },
};

const regraProposta = (): RegraAutomacao => ({
    ...novaRegra(),
    nome: "Proposta enviada: ligar em 2 dias",
    gatilho: "etapa_entrou",
    gatilho_etapa_id: 3,
    acoes: [
        {
            tipo: "criar_tarefa",
            titulo: "Ligar",
            tipo_atividade_id: null,
            prazo_quantidade: 2,
            prazo_unidade: "dias",
            responsavel_modo: "responsavel_negocio",
            usuario_id: null,
        },
    ],
});

describe("descreverAutomacao", () => {
    it("monta a frase do exemplo do Richard", () => {
        expect(descreverAutomacao(regraProposta(), ctx)).toBe(
            "Quando o negócio entrar em Proposta Enviada → criar tarefa «Ligar» em 2 dias para o responsável",
        );
    });

    it("inclui condições e várias ações", () => {
        const regra: RegraAutomacao = {
            ...regraProposta(),
            gatilho: "negocio_ganho",
            cond_pipeline_id: "f-vendas",
            cond_temperatura: "quente",
            cond_valor_minimo: 20000,
            cond_origem_id: "o-insta",
            acoes: [
                { ...(regraProposta().acoes[0] as Extract<RegraAutomacao["acoes"][number], { tipo: "criar_tarefa" }>), titulo: "Agendar instalação", prazo_quantidade: 1 },
                { tipo: "notificar_gerente", titulo: "Negócio ganho", usuario_id: null },
            ],
        };
        const texto = descreverAutomacao(regra, ctx);
        expect(texto).toMatch(/^Quando o negócio for ganho, se o funil for Vendas, a temperatura for Quente, o valor for a partir de R\$\s20\.000,00 e a origem for Instagram → /);
        expect(texto).toContain("criar tarefa «Agendar instalação» em 1 dia para o responsável; avisar o gerente: «Negócio ganho»");
    });

    it("sem ação deixa claro", () => {
        expect(descreverAutomacao({ ...regraProposta(), acoes: [] }, ctx)).toContain("→ (nenhuma ação)");
    });
});

describe("descreverGatilho", () => {
    it("cobre os 7 gatilhos", () => {
        const base = { gatilho_etapa_id: null, gatilho_temperatura: null, gatilho_dias: null };
        expect(descreverGatilho({ ...base, gatilho: "negocio_criado" })).toBe("Quando um negócio for criado");
        expect(descreverGatilho({ ...base, gatilho: "negocio_perdido" })).toBe("Quando o negócio for perdido");
        expect(descreverGatilho({ ...base, gatilho: "temperatura_mudou", gatilho_temperatura: "quente" })).toBe(
            "Quando a temperatura mudar para Quente",
        );
        expect(descreverGatilho({ ...base, gatilho: "negocio_parado" })).toBe("Quando o negócio ficar parado");
        expect(descreverGatilho({ ...base, gatilho: "proposta_sem_resposta", gatilho_dias: 3 })).toBe(
            "Quando a proposta enviada ficar sem resposta há 3 dias",
        );
        expect(descreverGatilho({ ...base, gatilho: "proposta_sem_resposta", gatilho_dias: 1 })).toBe(
            "Quando a proposta enviada ficar sem resposta há 1 dia",
        );
    });

    it("etapa sem nome conhecido (modelo sem etapa ou excluída) pede para escolher", () => {
        expect(descreverGatilho({ gatilho: "etapa_entrou", gatilho_etapa_id: null, gatilho_temperatura: null, gatilho_dias: null }, ctx)).toBe(
            "Quando o negócio entrar na etapa (escolha a etapa)",
        );
        expect(descreverGatilho({ gatilho: "etapa_entrou", gatilho_etapa_id: 999, gatilho_temperatura: null, gatilho_dias: null }, ctx)).toContain(
            "(escolha a etapa)",
        );
    });
});

describe("descreverAcao e prazos", () => {
    it("formata prazo em horas e dias", () => {
        expect(formatarPrazo(0, "horas")).toBe("na hora");
        expect(formatarPrazo(1, "horas")).toBe("em 1 hora");
        expect(formatarPrazo(3, "horas")).toBe("em 3 horas");
        expect(formatarPrazo(1, "dias")).toBe("em 1 dia");
        expect(formatarPrazo(180, "dias")).toBe("em 180 dias");
    });

    it("descreve cada tipo de ação", () => {
        expect(descreverAcao({ tipo: "mudar_temperatura", temperatura: "frio" })).toBe("mudar a temperatura para Frio");
        expect(descreverAcao({ tipo: "atribuir_responsavel", atribuicao_modo: "rodizio", usuario_id: null })).toBe(
            "distribuir em rodízio entre os vendedores ativos",
        );
        expect(descreverAcao({ tipo: "atribuir_responsavel", atribuicao_modo: "usuario_fixo", usuario_id: "u-ana" }, ctx)).toBe(
            "atribuir a Ana Souza",
        );
        expect(
            descreverAcao(
                {
                    tipo: "criar_tarefa",
                    titulo: " Ligar em até 1 hora ",
                    tipo_atividade_id: null,
                    prazo_quantidade: 1,
                    prazo_unidade: "horas",
                    responsavel_modo: "usuario_fixo",
                    usuario_id: "u-ana",
                },
                ctx,
            ),
        ).toBe("criar tarefa «Ligar em até 1 hora» em 1 hora para Ana Souza");
        expect(descreverAcao({ tipo: "notificar_gerente", titulo: "Ver", usuario_id: "u-sumiu" }, ctx)).toBe(
            "avisar (usuário removido): «Ver»",
        );
    });

    it("condição apontando para item excluído aparece como removido", () => {
        expect(
            descreverCondicoes({ cond_pipeline_id: "f-x", cond_temperatura: null, cond_valor_minimo: null, cond_origem_id: "o-x" }, ctx),
        ).toBe("se o funil for (funil removido) e a origem for (origem removida)");
        expect(descreverCondicoes({ cond_pipeline_id: null, cond_temperatura: null, cond_valor_minimo: null, cond_origem_id: null })).toBeNull();
    });
});

describe("validarAutomacao / pendenciasParaAtivar", () => {
    it("regra completa é válida, inclusive ativa", () => {
        expect(validarAutomacao({ ...regraProposta(), ativo: true })).toEqual({ valida: true, erros: [] });
    });

    it("modelo sem etapa pode ser salvo desativado, mas não ativado", () => {
        const regra = { ...regraProposta(), gatilho_etapa_id: null };
        expect(validarAutomacao(regra).valida).toBe(true);
        expect(pendenciasParaAtivar(regra)).toEqual(["Escolha a etapa do gatilho."]);
        expect(validarAutomacao({ ...regra, ativo: true }).erros).toContain("Escolha a etapa do gatilho.");
    });

    it("aponta nome, título, prazo, dias e usuário fixo", () => {
        const regra: RegraAutomacao = {
            ...novaRegra(),
            nome: "  ",
            ativo: true,
            gatilho: "proposta_sem_resposta",
            gatilho_dias: 0,
            cond_valor_minimo: -1,
            acoes: [
                { ...(novaAcao("criar_tarefa") as Extract<RegraAutomacao["acoes"][number], { tipo: "criar_tarefa" }>), titulo: "", prazo_quantidade: 5000, responsavel_modo: "usuario_fixo" },
                { tipo: "notificar_gerente", titulo: "x".repeat(201), usuario_id: null },
            ],
        };
        const { valida, erros } = validarAutomacao(regra);
        expect(valida).toBe(false);
        expect(erros).toEqual(
            expect.arrayContaining([
                "Dê um nome à automação.",
                "Informe de 1 a 365 dias sem resposta.",
                "O valor mínimo não pode ser negativo.",
                "Ação 1: escreva o título.",
                "Ação 1: prazo de 0 a 3650.",
                "Ação 2: título com no máximo 200 caracteres.",
                "Escolha o usuário fixo da ação.",
            ]),
        );
    });

    it("sem ações e com ações demais", () => {
        expect(validarAutomacao({ ...regraProposta(), acoes: [] }).erros).toContain("Inclua pelo menos uma ação.");
        const muitas = Array.from({ length: 11 }, () => novaAcao("mudar_temperatura"));
        expect(validarAutomacao({ ...regraProposta(), acoes: muitas }).erros).toContain("Use no máximo 10 ações.");
    });

    it("temperatura obrigatória no gatilho de temperatura", () => {
        expect(validarAutomacao({ ...regraProposta(), gatilho: "temperatura_mudou" }).erros).toContain(
            "Escolha a temperatura do gatilho.",
        );
    });
});

describe("montarPayloadSalvar", () => {
    it("manda só o parâmetro do gatilho escolhido e limpa usuário que não se aplica", () => {
        const regra: RegraAutomacao = {
            ...regraProposta(),
            id: "a-1",
            gatilho: "negocio_ganho",
            gatilho_etapa_id: 3,
            gatilho_dias: 9,
            acoes: [
                { tipo: "atribuir_responsavel", atribuicao_modo: "rodizio", usuario_id: "u-ana" },
                { tipo: "notificar_gerente", titulo: "  Avisar  ", usuario_id: null },
            ],
        };
        const { p_automacao, p_acoes } = montarPayloadSalvar(regra);
        expect(p_automacao).toMatchObject({ id: "a-1", gatilho: "negocio_ganho", gatilho_etapa_id: null, gatilho_dias: null });
        expect(p_acoes).toEqual([
            { tipo: "atribuir_responsavel", atribuicao_modo: "rodizio", usuario_id: null },
            { tipo: "notificar_gerente", titulo: "Avisar", usuario_id: null },
        ]);
    });

    it("regra nova não manda id", () => {
        expect("id" in montarPayloadSalvar(regraProposta()).p_automacao).toBe(false);
    });
});

describe("leitura do banco", () => {
    it("monta a regra com as ações em ordem e descarta ação inválida", () => {
        const regra = regraDoBanco(
            { id: "a-1", nome: "R", ativo: true, gatilho: "etapa_entrou", gatilho_etapa_id: "3", cond_valor_minimo: "1500.50" },
            [
                { ordem: 2, tipo: "mudar_temperatura", temperatura: "morno" },
                { ordem: 1, tipo: "criar_tarefa", titulo: "Ligar", prazo_quantidade: 2, prazo_unidade: "dias", responsavel_modo: "responsavel_negocio" },
                { ordem: 3, tipo: "mudar_temperatura", temperatura: "fervendo" },
                { ordem: 4, tipo: "apagar_tudo" },
            ],
        );
        expect(regra?.gatilho_etapa_id).toBe(3);
        expect(regra?.cond_valor_minimo).toBe(1500.5);
        expect(regra?.acoes.map((a) => a.tipo)).toEqual(["criar_tarefa", "mudar_temperatura"]);
    });

    it("gatilho desconhecido é rejeitado", () => {
        expect(regraDoBanco({ id: "a", gatilho: "qualquer" }, [])).toBeNull();
        expect(acaoDoBanco({ tipo: "criar_tarefa", titulo: "x" })).toBeNull();
    });
});

describe("mensagemErroAutomacao", () => {
    it("traduz os erros do banco", () => {
        expect(mensagemErroAutomacao("Automação incompleta: Escolha a etapa do gatilho.")).toBe("Escolha a etapa do gatilho.");
        expect(mensagemErroAutomacao('duplicate key value violates unique constraint "automacoes_nome_uk"')).toBe(
            "Já existe uma automação com esse nome.",
        );
        expect(mensagemErroAutomacao("Somente o gerente pode criar ou editar automações.")).toBe(
            "Somente o gerente pode criar ou editar automações.",
        );
        expect(mensagemErroAutomacao("insert or update on table violates foreign key constraint")).toContain("não existe mais");
        expect(mensagemErroAutomacao("")).toBe("Não foi possível salvar a automação.");
    });
});
