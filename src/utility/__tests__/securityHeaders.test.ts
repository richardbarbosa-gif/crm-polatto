import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * Os cabeçalhos de segurança vivem em dois arquivos (serve.json para o
 * container, .htaccess para a Hostinger). Este teste impede que um seja
 * alterado sem o outro e trava os pontos que não podem regredir na CSP.
 */
const raiz = path.resolve(__dirname, "../../..");

const doServeJson = (): Record<string, string> => {
    const config = JSON.parse(readFileSync(path.join(raiz, "public/serve.json"), "utf8")) as {
        headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    };
    const global = config.headers.find((r) => r.source === "**");
    return Object.fromEntries(
        (global?.headers ?? [])
            .filter((h) => h.key !== "Cache-Control")
            .map((h) => [h.key, h.value]),
    );
};

const doHtaccess = (): Record<string, string> => {
    const texto = readFileSync(path.join(raiz, "public/.htaccess"), "utf8");
    const pares = [...texto.matchAll(/^\s*Header always set ([\w-]+) "([^"]*)"/gm)];
    return Object.fromEntries(pares.map((m) => [m[1], m[2]]));
};

const diretivas = (csp: string) =>
    Object.fromEntries(
        csp
            .split(";")
            .map((d) => d.trim())
            .filter(Boolean)
            .map((d) => {
                const [nome, ...valores] = d.split(/\s+/);
                return [nome, valores];
            }),
    );

describe("cabeçalhos de segurança de produção", () => {
    it("serve.json e .htaccess definem exatamente os mesmos cabeçalhos", () => {
        expect(doHtaccess()).toEqual(doServeJson());
    });

    it("CSP bloqueia script inline/eval, iframe externo e embutir o CRM em outro site", () => {
        const csp = diretivas(doServeJson()["Content-Security-Policy"]);
        expect(csp["script-src"]).toEqual(["'self'"]);
        expect(csp["object-src"]).toEqual(["'none'"]);
        expect(csp["frame-ancestors"]).toEqual(["'none'"]);
        expect(csp["base-uri"]).toEqual(["'self'"]);
        expect(csp["default-src"]).toEqual(["'self'"]);
    });

    it("CSP libera o Supabase (REST, Storage e Realtime)", () => {
        const csp = diretivas(doServeJson()["Content-Security-Policy"]);
        expect(csp["connect-src"]).toEqual(
            expect.arrayContaining(["https://*.supabase.co", "wss://*.supabase.co"]),
        );
    });

    it("demais cabeçalhos obrigatórios presentes", () => {
        const h = doServeJson();
        expect(h["X-Frame-Options"]).toBe("DENY");
        expect(h["X-Content-Type-Options"]).toBe("nosniff");
        expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
        expect(h["Strict-Transport-Security"]).toMatch(/max-age=\d{7,}/);
        expect(h["Permissions-Policy"]).toContain("camera=()");
    });
});
