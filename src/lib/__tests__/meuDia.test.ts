import { describe, expect, it } from "vitest";
import { deveAbrirMeuDia, filtrosDoDono, fimDoDia, separarTarefasDoDia } from "../meuDia";

const agora = new Date(2026, 10, 5, 14, 0, 0); // 05/11/2026 14:00 local
const em = (dia: number, hora: number) => new Date(2026, 10, dia, hora, 0, 0).toISOString();

describe("separarTarefasDoDia", () => {
    const tarefas = [
        { id: 1, titulo: "Amanhã", data_vencimento: em(6, 9) },
        { id: 2, titulo: "Hoje cedo (já passou)", data_vencimento: em(5, 8) },
        { id: 3, titulo: "Ontem", data_vencimento: em(4, 10) },
        { id: 4, titulo: "Hoje à noite", data_vencimento: em(5, 20) },
        { id: 5, titulo: "Semana passada", data_vencimento: em(1, 10) },
        { id: 6, titulo: "Concluída ontem", data_vencimento: em(4, 9), concluido: true },
        { id: 7, titulo: "Sem data", data_vencimento: null },
    ];

    it("atrasadas antes de hoje, em ordem de vencimento", () => {
        expect(separarTarefasDoDia(tarefas, agora).atrasadas.map((t) => t.id)).toEqual([5, 3]);
    });

    it("hoje inclui o horário que já passou; futuras, concluídas e sem data ficam de fora", () => {
        expect(separarTarefasDoDia(tarefas, agora).hoje.map((t) => t.id)).toEqual([2, 4]);
    });

    it("lista vazia", () => {
        expect(separarTarefasDoDia([], agora)).toEqual({ atrasadas: [], hoje: [] });
    });

    it("fim do dia é 23:59:59.999 local", () => {
        const fim = fimDoDia(agora);
        expect([fim.getDate(), fim.getHours(), fim.getMinutes(), fim.getMilliseconds()]).toEqual([5, 23, 59, 999]);
    });
});

describe("filtrosDoDono", () => {
    it("vendedor sempre vê só o que é dele, mesmo pedindo a equipe", () => {
        expect(filtrosDoDono({ ownerCandidates: ["Ana", "ana@x.com"], verEquipe: true, isGerente: false })).toEqual([
            { field: "responsavel", operator: "in", value: ["Ana", "ana@x.com"] },
        ]);
    });

    it("gerente com 'ver da equipe' não filtra; sem a opção, vê o dele", () => {
        expect(filtrosDoDono({ ownerCandidates: ["Gê"], verEquipe: true, isGerente: true })).toEqual([]);
        expect(filtrosDoDono({ ownerCandidates: ["Gê"], verEquipe: false, isGerente: true })).toHaveLength(1);
    });

    it("sem nome conhecido não abre a equipe inteira por engano", () => {
        expect(filtrosDoDono({ ownerCandidates: [], verEquipe: false, isGerente: false })).toEqual([
            { field: "responsavel", operator: "in", value: ["__sem_responsavel__"] },
        ]);
    });
});

describe("deveAbrirMeuDia", () => {
    it("vendedor cai no Meu dia só na primeira vez da sessão; gerente nunca", () => {
        expect(deveAbrirMeuDia({ isGerente: false, jaAbriuNestaSessao: false })).toBe(true);
        expect(deveAbrirMeuDia({ isGerente: false, jaAbriuNestaSessao: true })).toBe(false);
        expect(deveAbrirMeuDia({ isGerente: true, jaAbriuNestaSessao: false })).toBe(false);
    });
});
