import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownViewerImpl } from "../markdown-impl";

const render = (source: string) => renderToStaticMarkup(<MarkdownViewerImpl source={source} />);

describe("MarkdownViewerImpl — sanitização de HTML bruto nas notas", () => {
    it("remove iframe com srcdoc (script na origem do CRM)", () => {
        const html = render('<iframe srcdoc="<script>parent.alert(localStorage)</script>"></iframe>');
        expect(html).not.toMatch(/<iframe/i);
        expect(html).not.toMatch(/srcdoc/i);
    });

    it("remove object/embed/form e atributos de evento", () => {
        const html = render(
            [
                '<object data="data:text/html,<script>alert(1)</script>"></object>',
                '<embed src="https://evil.example/x">',
                '<form action="https://evil.example"><button>ok</button></form>',
                '<img src="x" onerror="alert(1)">',
            ].join("\n\n"),
        );
        expect(html).not.toMatch(/<object|<embed|<form/i);
        expect(html).not.toMatch(/onerror/i);
    });

    it("descarta links javascript: e estilos que permitem sobrepor a tela", () => {
        const html = render(
            '[x](javascript:alert(1)) <a href="https://evil.example" style="position:fixed;inset:0">y</a>',
        );
        expect(html).not.toMatch(/javascript:/i);
        expect(html).not.toMatch(/position:\s*fixed/i);
    });

    it("mantém o markdown legítimo usado nas notas", () => {
        const html = render(
            "**negrito** _itálico_ `code` [site](https://example.com)\n\n- item 1\n- item 2",
        );
        expect(html).toContain("<strong>negrito</strong>");
        expect(html).toContain("<em>itálico</em>");
        expect(html).toContain("<code>code</code>");
        expect(html).toContain('href="https://example.com"');
        expect(html).toContain("<li>item 1</li>");
    });
});
