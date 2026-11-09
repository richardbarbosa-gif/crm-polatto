import { describe, expect, it } from "vitest";
import { rotuloTipoAtividade } from "../tiposAtividade";

describe("rotuloTipoAtividade", () => {
    it("tipos padrão saem com acento e grafia certa", () => {
        expect(rotuloTipoAtividade("ligacao")).toBe("Ligação");
        expect(rotuloTipoAtividade("reuniao")).toBe("Reunião");
        expect(rotuloTipoAtividade("email")).toBe("E-mail");
        expect(rotuloTipoAtividade("whatsapp")).toBe("WhatsApp");
        expect(rotuloTipoAtividade("visita_tecnica")).toBe("Visita técnica");
        expect(rotuloTipoAtividade("follow_up")).toBe("Follow-up");
    });
    it("tipo criado pela empresa vira texto legível; vazio e legado tratados", () => {
        expect(rotuloTipoAtividade("pos_venda")).toBe("Pos venda");
        expect(rotuloTipoAtividade("")).toBe("Sem tipo");
        expect(rotuloTipoAtividade(null)).toBe("Sem tipo");
        expect(rotuloTipoAtividade("etc")).toBe("Outro");
    });
});
