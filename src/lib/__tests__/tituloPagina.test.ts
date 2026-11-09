import { describe, expect, it } from "vitest";
import { tituloDaPagina } from "../tituloPagina";

describe("tituloDaPagina", () => {
    it("dá nome em português a cada tela, com o nome do produto", () => {
        expect(tituloDaPagina("/")).toBe("Dashboard | CRM Polatto");
        expect(tituloDaPagina("/clientes")).toBe("Oportunidades | CRM Polatto");
        expect(tituloDaPagina("/configuracoes")).toBe("Configurações | CRM Polatto");
        expect(tituloDaPagina("/insights/roi")).toBe("Relatórios · ROI | CRM Polatto");
    });

    it("não expõe o id do registro nem texto em inglês nas telas de lead", () => {
        const id = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
        expect(tituloDaPagina(`/clientes/show/${id}`)).toBe("Detalhes do lead | CRM Polatto");
        expect(tituloDaPagina(`/clientes/edit/${id}`)).toBe("Editar lead | CRM Polatto");
        expect(tituloDaPagina("/clientes/create")).toBe("Novo lead | CRM Polatto");
        expect(tituloDaPagina(`/clientes/show/${id}`)).not.toMatch(/Show|Edit|Refine|3f2504e0/);
    });

    it("ignora barra final e cai em 'Página não encontrada' para rota desconhecida", () => {
        expect(tituloDaPagina("/agenda/")).toBe("Agenda | CRM Polatto");
        expect(tituloDaPagina("/rota-inexistente")).toBe("Página não encontrada | CRM Polatto");
        expect(tituloDaPagina(undefined)).toBe("Dashboard | CRM Polatto");
    });
});
