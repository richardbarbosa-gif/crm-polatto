import { describe, expect, it } from "vitest";
import {
    classificarDesfecho,
    indexarEtapas,
    percentual,
    resumirFunil,
    taxaDeConversao,
    totaisPorEtapa,
    valorDoLead,
    type EtapaFunil,
} from "../pipelineMetrics";

const etapas: EtapaFunil[] = [
    { id: 1, nome: "Contato inicial", ordem: 1, probabilidade: 10 },
    { id: 2, nome: "Proposta enviada", ordem: 2, probabilidade: 50 },
    { id: 3, nome: "Contrato assinado", ordem: 3, ganho: true, probabilidade: 100 },
    { id: 4, nome: "Desistiu", ordem: 4, perdido: true },
];

describe("valorDoLead", () => {
    it("prioriza o valor do negócio sobre a conta de luz", () => {
        expect(valorDoLead({ valor: 15000, conta_energia_media: 400 })).toBe(15000);
    });

    it("cai para a conta de luz quando o valor não foi informado", () => {
        expect(valorDoLead({ valor: null, conta_energia_media: 400 })).toBe(400);
        expect(valorDoLead({ valor: 0, conta_energia_media: "R$ 1.234,50" })).toBe(1234.5);
    });

    it("nunca devolve NaN", () => {
        expect(valorDoLead({ valor: "abc" })).toBe(0);
        expect(valorDoLead(null)).toBe(0);
    });
});

describe("classificarDesfecho", () => {
    const porId = indexarEtapas(etapas);

    it("REGRESSÃO: etapa marcada como ganho conta como ganho mesmo sem 'fechado' no nome", () => {
        expect(classificarDesfecho({ stage_id: 3, status: "Contrato assinado" }, porId)).toBe("ganho");
    });

    it("etapa marcada como perdido conta como perda", () => {
        expect(classificarDesfecho({ stage_id: "4" }, porId)).toBe("perdido");
    });

    it("etapa comum fica em aberto, qualquer que seja o nome", () => {
        expect(classificarDesfecho({ stage_id: 1, status: "Contato inicial" }, porId)).toBe("aberto");
    });

    it("sem etapa conhecida usa o texto do status", () => {
        expect(classificarDesfecho({ stage_id: null, status: "Fechado" }, porId)).toBe("ganho");
        expect(classificarDesfecho({ status: "Perdido" }, porId)).toBe("perdido");
        expect(classificarDesfecho({ status: "Qualquer" }, porId)).toBe("aberto");
    });
});

describe("percentual", () => {
    it("divisão por zero vira 0, não NaN nem Infinity", () => {
        expect(percentual(5, 0)).toBe(0);
        expect(percentual(0, 0)).toBe(0);
        expect(percentual(Number.NaN, 10)).toBe(0);
    });

    it("calcula normalmente", () => {
        expect(percentual(1, 4)).toBe(25);
    });
});

describe("resumirFunil", () => {
    const linhas = [
        { stage_id: 1, status: "Contato inicial", responsavel: "Ana", temperatura: "quente", total_leads: 4, valor_total: 4000 },
        { stage_id: 2, status: "Proposta enviada", responsavel: "Ana", temperatura: "morno", total_leads: 2, valor_total: "10000" },
        { stage_id: 3, status: "Contrato assinado", responsavel: "Bruno", temperatura: null, total_leads: 3, valor_total: 9000 },
        { stage_id: 4, status: "Desistiu", responsavel: "Bruno", temperatura: "frio", total_leads: 1, valor_total: 500 },
        { stage_id: null, status: "Novo Lead", responsavel: null, temperatura: "frio", total_leads: 2, valor_total: 0 },
    ];

    it("separa abertos, ganhos e perdidos pelos flags da etapa", () => {
        const resumo = resumirFunil(linhas, etapas);
        expect(resumo.totalLeads).toBe(12);
        expect(resumo.ganhos).toBe(3);
        expect(resumo.perdidos).toBe(1);
        expect(resumo.abertos).toBe(8);
        expect(resumo.valorGanho).toBe(9000);
        expect(resumo.valorAberto).toBe(14000);
    });

    it("previsão pondera só os negócios em aberto", () => {
        const resumo = resumirFunil(linhas, etapas);
        // 4000 × 10% + 10000 × 50% (o ganho com 100% fica de fora)
        expect(resumo.valorPonderado).toBe(5400);
        expect(resumo.temProbabilidade).toBe(true);
    });

    it("conversão = ganhos ÷ encerrados (ganhos + perdidos), sem divisão por zero", () => {
        const resumo = resumirFunil(linhas, etapas);
        // Antes: 25% (ganhos ÷ total, contando os abertos como se fossem perda)
        expect(resumo.conversao).toBe(75);
        expect(resumo.encerrados).toBe(resumo.ganhos + resumo.perdidos);
        const vazio = resumirFunil([], etapas);
        expect(vazio.conversao).toBe(0);
        expect(vazio.encerrados).toBe(0);
    });

    it("taxaDeConversao: lead novo em aberto não derruba a taxa", () => {
        expect(taxaDeConversao(3, 1)).toBe(75);
        expect(taxaDeConversao(0, 0)).toBe(0);
        expect(taxaDeConversao(5, 0)).toBe(100);
    });

    it("agrupa por etapa na ordem do funil", () => {
        const resumo = resumirFunil(linhas, etapas);
        expect(resumo.porEtapa.map((e) => e.nome)).toEqual([
            "Contato inicial",
            "Proposta enviada",
            "Contrato assinado",
            "Desistiu",
            "Novo Lead",
        ]);
    });

    it("agrupa por responsável com valor ganho separado", () => {
        const resumo = resumirFunil(linhas, etapas);
        const bruno = resumo.porResponsavel.find((r) => r.nome === "Bruno");
        expect(bruno).toMatchObject({ total: 4, ganhos: 3, perdidos: 1, valorGanho: 9000 });
        expect(resumo.porResponsavel.some((r) => r.nome === "Sem responsável")).toBe(true);
    });

    it("conta temperaturas", () => {
        expect(resumirFunil(linhas, etapas).porTemperatura).toEqual({ quente: 4, morno: 2, frio: 3 });
    });
});

describe("totaisPorEtapa", () => {
    it("soma total e valor por stage_id e agrupa os sem etapa em 'outros'", () => {
        const mapa = totaisPorEtapa([
            { stage_id: 1, total_leads: 2, valor_total: 100 },
            { stage_id: 1, total_leads: 3, valor_total: "50" },
            { stage_id: null, total_leads: 1, valor_total: 10 },
        ]);
        expect(mapa.get("1")).toEqual({ total: 5, valor: 150 });
        expect(mapa.get("outros")).toEqual({ total: 1, valor: 10 });
    });
});
