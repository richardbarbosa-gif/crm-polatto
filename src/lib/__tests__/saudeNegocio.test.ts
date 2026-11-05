import { describe, expect, it } from "vitest";
import {
    diasDesde,
    estaParado,
    filtrosDeSaude,
    filtrosQuentesSemContato,
    ordemDaTemperatura,
    ordenarPorTemperatura,
    ORDENACAO_KANBAN,
    proximaTarefaDaSaude,
    rotuloParado,
    rotuloPrazoEtapa,
    rotuloSemContato,
    semProximoPasso,
} from "../saudeNegocio";

const AGORA = new Date("2026-11-05T12:00:00Z");
const diasAtras = (dias: number) => new Date(AGORA.getTime() - dias * 24 * 60 * 60 * 1000).toISOString();

describe("diasDesde", () => {
    it("conta dias inteiros e nunca devolve negativo", () => {
        expect(diasDesde(diasAtras(3), AGORA)).toBe(3);
        expect(diasDesde(diasAtras(0.5), AGORA)).toBe(0);
        expect(diasDesde("2026-12-01T00:00:00Z", AGORA)).toBe(0);
    });

    it("data ausente ou inválida devolve null", () => {
        expect(diasDesde(null, AGORA)).toBeNull();
        expect(diasDesde("não é data", AGORA)).toBeNull();
    });
});

describe("estaParado (mesma regra da view vw_negocios_saude)", () => {
    it("parado quando passa do prazo da etapa", () => {
        expect(estaParado({ ultimaAtividadeEm: diasAtras(8), diasParaParado: 7, agora: AGORA })).toBe(true);
    });

    it("no limite exato do prazo ainda não está parado", () => {
        expect(estaParado({ ultimaAtividadeEm: diasAtras(7), diasParaParado: 7, agora: AGORA })).toBe(false);
    });

    it("etapa sem prazo (nulo) não monitora", () => {
        expect(estaParado({ ultimaAtividadeEm: diasAtras(400), diasParaParado: null, agora: AGORA })).toBe(false);
    });

    it("etapa de ganho ou perda nunca fica parada", () => {
        expect(
            estaParado({ ultimaAtividadeEm: diasAtras(30), diasParaParado: 3, etapaFinal: true, agora: AGORA }),
        ).toBe(false);
    });

    it("sem data de atividade não acusa parado", () => {
        expect(estaParado({ ultimaAtividadeEm: null, diasParaParado: 3, agora: AGORA })).toBe(false);
    });
});

describe("rótulos", () => {
    it("singular e plural do selo de parado", () => {
        expect(rotuloParado(1)).toBe("Parado há 1 dia");
        expect(rotuloParado(12)).toBe("Parado há 12 dias");
        expect(rotuloParado(null)).toBe("Parado há 0 dias");
    });

    it("prazo da etapa na configuração", () => {
        expect(rotuloPrazoEtapa(7)).toBe("7 dias");
        expect(rotuloPrazoEtapa(1)).toBe("1 dia");
        expect(rotuloPrazoEtapa(null)).toBe("Não monitora");
        expect(rotuloPrazoEtapa(5, true)).toBe("Não se aplica");
    });

    it("dias sem contato", () => {
        expect(rotuloSemContato(0)).toBe("Contato hoje");
        expect(rotuloSemContato(1)).toBe("Sem contato há 1 dia");
        expect(rotuloSemContato(4)).toBe("Sem contato há 4 dias");
    });
});

describe("semProximoPasso", () => {
    it("com a view, vale o cálculo do banco", () => {
        expect(semProximoPasso({ sem_proximo_passo: true }, { titulo: "x" })).toBe(true);
        expect(semProximoPasso({ sem_proximo_passo: false }, undefined)).toBe(false);
    });

    it("sem a view: negócio aberto sem próxima atividade", () => {
        expect(semProximoPasso({}, undefined)).toBe(true);
        expect(semProximoPasso({}, { titulo: "Ligar" })).toBe(false);
    });

    it("sem a view: etapa de ganho/perda não pede próximo passo", () => {
        expect(semProximoPasso({}, undefined, true)).toBe(false);
    });
});

describe("proximaTarefaDaSaude", () => {
    it("converte os campos da view para o formato do card", () => {
        expect(
            proximaTarefaDaSaude({
                proxima_tarefa_em: "2026-11-06T10:00:00Z",
                proxima_tarefa_titulo: "Visita técnica",
                proxima_tarefa_tipo: "visita",
            }),
        ).toEqual({ titulo: "Visita técnica", tipo: "visita", data_vencimento: "2026-11-06T10:00:00Z" });
    });

    it("sem tarefa devolve undefined", () => {
        expect(proximaTarefaDaSaude({ sem_proximo_passo: true })).toBeUndefined();
        expect(proximaTarefaDaSaude(null)).toBeUndefined();
    });
});

describe("ordenação por temperatura", () => {
    it("quente > morno > frio > sem temperatura, sem diferenciar maiúsculas", () => {
        expect(ordemDaTemperatura("Quente")).toBe(3);
        expect(ordemDaTemperatura("morno")).toBe(2);
        expect(ordemDaTemperatura("FRIO")).toBe(1);
        expect(ordemDaTemperatura(null)).toBe(0);
        expect(ordemDaTemperatura("fechado")).toBe(0);
    });

    it("mantém a ordem original como desempate (estável)", () => {
        const leads = [
            { id: 1, temperatura: "frio" },
            { id: 2, temperatura: "quente" },
            { id: 3, temperatura: null },
            { id: 4, temperatura: "morno" },
            { id: 5, temperatura: "quente" },
            { id: 6, temperatura: "frio" },
        ];
        expect(ordenarPorTemperatura(leads).map((l) => l.id)).toEqual([2, 5, 4, 1, 6, 3]);
    });

    it("não altera o array recebido", () => {
        const leads = [{ temperatura: "frio" }, { temperatura: "quente" }];
        ordenarPorTemperatura(leads);
        expect(leads[0].temperatura).toBe("frio");
    });

    it("ordenação do servidor: temperatura, cadastro e id como desempate final", () => {
        expect(ORDENACAO_KANBAN.map((s) => `${s.field}:${s.order}`)).toEqual([
            "temperatura_ordem:desc",
            "created_at:asc",
            "id:asc",
        ]);
    });
});

describe("filtros", () => {
    it("filtro de saúde do Kanban", () => {
        expect(filtrosDeSaude("todos")).toEqual([]);
        expect(filtrosDeSaude("parados")).toEqual([{ field: "parado", operator: "eq", value: true }]);
        expect(filtrosDeSaude("sem_proximo_passo")).toEqual([
            { field: "sem_proximo_passo", operator: "eq", value: true },
        ]);
    });

    it("quentes sem contato: abertos, quentes, 3+ dias por padrão", () => {
        expect(filtrosQuentesSemContato()).toEqual([
            { field: "temperatura", operator: "eq", value: "quente" },
            { field: "aberto", operator: "eq", value: true },
            { field: "dias_sem_contato", operator: "gte", value: 3 },
        ]);
        expect(filtrosQuentesSemContato(5)[2]).toMatchObject({ value: 5 });
    });
});
