import { describe, expect, it, vi } from "vitest";

vi.mock("../../utility", () => ({ supabaseClient: {} }));

import { hasTaskExecutionAction, resolveTaskExecutionStatus } from "../taskExecutionStatus";

describe("resolveTaskExecutionStatus", () => {
    it("retorna pendente sem registro", () => {
        expect(resolveTaskExecutionStatus(null)).toBe("pendente");
        expect(resolveTaskExecutionStatus(undefined)).toBe("pendente");
        expect(resolveTaskExecutionStatus({})).toBe("pendente");
    });

    it("lê o status direto do registro", () => {
        expect(resolveTaskExecutionStatus({ execucao_status: "resolvido" })).toBe("resolvido");
        expect(resolveTaskExecutionStatus({ execucao_status: "ligar_novamente" })).toBe("ligar_novamente");
    });

    it("aceita aliases de coluna", () => {
        expect(resolveTaskExecutionStatus({ execution_status: "resolvido" })).toBe("resolvido");
        expect(resolveTaskExecutionStatus({ status_execucao: "resolvido" })).toBe("resolvido");
    });

    it("normaliza sinônimos e acentuação", () => {
        expect(resolveTaskExecutionStatus({ execucao_status: "Concluída" })).toBe("resolvido");
        expect(resolveTaskExecutionStatus({ execucao_status: "ligar de novo" })).toBe("ligar_novamente");
        expect(resolveTaskExecutionStatus({ execucao_status: "em andamento" })).toBe("pendente");
    });

    it("volta a pendente quando o vencimento ainda está no futuro", () => {
        const futuro = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        expect(
            resolveTaskExecutionStatus({ execucao_status: "resolvido", data_vencimento: futuro }),
        ).toBe("pendente");
    });

    it("mantém o status quando o vencimento já passou", () => {
        const passado = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        expect(
            resolveTaskExecutionStatus({ execucao_status: "resolvido", data_vencimento: passado }),
        ).toBe("resolvido");
    });

    it("status desconhecido cai em pendente", () => {
        expect(resolveTaskExecutionStatus({ execucao_status: "qualquer_coisa" })).toBe("pendente");
    });
});

describe("hasTaskExecutionAction", () => {
    it("pendente não tem ação registrada; demais status têm", () => {
        expect(hasTaskExecutionAction("pendente")).toBe(false);
        expect(hasTaskExecutionAction("resolvido")).toBe(true);
        expect(hasTaskExecutionAction("ligar_novamente")).toBe(true);
        expect(hasTaskExecutionAction("voltar_outro_dia")).toBe(true);
    });
});
