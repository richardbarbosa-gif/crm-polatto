import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STATUS_ORCAMENTO, nomeArquivoProposta, type StatusOrcamento } from "../orcamentos/formato";
import {
    MENSAGEM_PROPOSTA_TRAVADA,
    TRANSICOES_MANUAIS,
    dicaVencido,
    efeitoDaNovaVersao,
    orcamentoEditavel,
    podeCriarNovaVersao,
    rotuloRevisao,
    siglaRevisao,
    statusFinal,
    transicaoValida,
    transicoesDisponiveis,
} from "../orcamentos/regras";
import { paraOrcamento } from "../orcamentos/tipos";

const MIGRATION_14 = readFileSync(
    path.resolve(__dirname, "../../../database/migrations/2026-11-04_14_orcamento_travado.sql"),
    "utf8",
);

describe("transições de status (espelho do trigger fn_orcamentos_travar)", () => {
    // A tabela completa que o banco aceita (suíte SQL 9, T2/T3/T4/T6).
    const ACEITAS = new Set([
        "rascunho>enviado",
        "enviado>aceito",
        "enviado>recusado",
        "enviado>expirado",
        "enviado>substituido",
        "expirado>substituido",
    ]);

    it("aceita exatamente as transições do banco, de todos os status para todos", () => {
        for (const de of STATUS_ORCAMENTO) {
            for (const para of STATUS_ORCAMENTO) {
                if (de === para) continue;
                expect(transicaoValida(de, para), `${de} -> ${para}`).toBe(ACEITAS.has(`${de}>${para}`));
            }
        }
    });

    it("o menu de status só oferece transições manuais (substituído é do banco)", () => {
        expect(transicoesDisponiveis("rascunho")).toEqual(["enviado"]);
        expect(transicoesDisponiveis("enviado")).toEqual(["aceito", "recusado", "expirado"]);
        for (const status of STATUS_ORCAMENTO) {
            expect(transicoesDisponiveis(status)).not.toContain("substituido");
            for (const destino of transicoesDisponiveis(status)) {
                expect(transicaoValida(status, destino)).toBe(true);
            }
        }
    });

    it("aceito, recusado, expirado e substituído são finais", () => {
        const finais = STATUS_ORCAMENTO.filter(statusFinal);
        expect(finais).toEqual(["aceito", "recusado", "expirado", "substituido"]);
        expect(Object.keys(TRANSICOES_MANUAIS).sort()).toEqual([...STATUS_ORCAMENTO].sort());
    });
});

describe("regra de editável e nova versão", () => {
    it("só rascunho é editável", () => {
        const editaveis = STATUS_ORCAMENTO.filter(orcamentoEditavel);
        expect(editaveis).toEqual(["rascunho"]);
    });

    it("nova versão só para quem o cliente já recebeu e ainda não foi substituído", () => {
        const comVersao: StatusOrcamento[] = STATUS_ORCAMENTO.filter(podeCriarNovaVersao);
        expect(comVersao).toEqual(["enviado", "aceito", "recusado", "expirado"]);
    });

    it("explica o que acontece com a proposta atual quando a revisão for enviada", () => {
        expect(efeitoDaNovaVersao("enviado")).toContain("substituída");
        expect(efeitoDaNovaVersao("expirado")).toContain("substituída");
        expect(efeitoDaNovaVersao("aceito")).toBe('Esta proposta continua registrada como "Aceito".');
        expect(efeitoDaNovaVersao("recusado")).toBe('Esta proposta continua registrada como "Recusado".');
    });

    it("a mensagem da tela é a mesma que o banco devolve", () => {
        expect(MENSAGEM_PROPOSTA_TRAVADA).toBe("Proposta já enviada não pode ser alterada. Use “Nova versão” para revisar.");
        // cabeçalho e itens usam a mesma frase na migration
        expect(MIGRATION_14.split(MENSAGEM_PROPOSTA_TRAVADA).length - 1).toBeGreaterThanOrEqual(2);
    });

    it("os status do front batem com o CHECK da migration 14", () => {
        const check = /check \(status in \(([^)]*)\)\)/.exec(MIGRATION_14)?.[1] ?? "";
        const doBanco = [...check.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
        expect(doBanco).toEqual([...STATUS_ORCAMENTO]);
    });
});

describe("rótulo de revisão", () => {
    it("mostra 'Revisão N de <original>' só a partir da revisão 2", () => {
        expect(rotuloRevisao(2, "2026-0003")).toBe("Revisão 2 de 2026-0003");
        expect(rotuloRevisao(3, " 2026-0003 ")).toBe("Revisão 3 de 2026-0003");
        expect(rotuloRevisao(2, null)).toBe("Revisão 2");
        expect(rotuloRevisao(1, "2026-0003")).toBeNull();
        expect(rotuloRevisao(undefined, null)).toBeNull();
    });

    it("sigla 'Rev. N' para o PDF", () => {
        expect(siglaRevisao(2)).toBe("Rev. 2");
        expect(siglaRevisao(1)).toBeNull();
        expect(siglaRevisao(null)).toBeNull();
    });

    it("nome do arquivo leva -RevN a partir da revisão 2", () => {
        expect(nomeArquivoProposta("2026-0005", "João", 2)).toBe("Proposta-2026-0005-Rev2-Joao.pdf");
        expect(nomeArquivoProposta("2026-0005", "João", 1)).toBe("Proposta-2026-0005-Joao.pdf");
        expect(nomeArquivoProposta("2026-0005", "João")).toBe("Proposta-2026-0005-Joao.pdf");
    });

    it("paraOrcamento lê as colunas de versão (e tolera banco sem a migration 14)", () => {
        const revisao = paraOrcamento({ id: "b", status: "substituido", revisao: "3", versao_de: "a", numero_original: "2026-0003" });
        expect(revisao.status).toBe("substituido");
        expect(revisao.revisao).toBe(3);
        expect(revisao.versao_de).toBe("a");
        expect(revisao.numero_original).toBe("2026-0003");

        const antigo = paraOrcamento({ id: "a", status: "enviado" });
        expect(antigo.revisao).toBe(1);
        expect(antigo.versao_de).toBeNull();
        expect(antigo.numero_original).toBeNull();
    });
});

describe("dica de proposta vencida", () => {
    it("rascunho ajusta a validade; enviado expira ou ganha nova versão", () => {
        expect(dicaVencido("rascunho", "2026-11-02")).toBe("Validade terminou em 02/11/2026. Ajuste a validade antes de enviar.");
        expect(dicaVencido("enviado", "2026-11-02")).toBe(
            "Validade terminou em 02/11/2026. Marque como expirado ou crie uma nova versão.",
        );
    });
});
