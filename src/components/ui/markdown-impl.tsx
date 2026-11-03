import MDEditor from "@uiw/react-md-editor";
import "@uiw/react-md-editor/markdown-editor.css";
import "@uiw/react-markdown-preview/markdown.css";
import rehypeSanitize from "rehype-sanitize";
import type { ComponentProps } from "react";

/**
 * SEGURANÇA: o preview do @uiw/react-md-editor liga o rehype-raw por padrão,
 * ou seja, HTML bruto escrito na nota é renderizado como HTML de verdade.
 * Uma nota com <iframe srcdoc="<script>…</script>"> rodaria script na origem
 * do CRM para quem abrisse o lead (roubo da sessão salva no localStorage).
 * O rehype-sanitize roda DEPOIS do rehype-raw e filtra tudo por allowlist
 * (schema do GitHub): remove iframe/object/embed/form, atributos on*, style
 * e URLs fora de http(s)/mailto/tel — markdown comum continua igual.
 */
type PreviewRehypePlugins = NonNullable<ComponentProps<typeof MDEditor.Markdown>["rehypePlugins"]>;
const SANITIZE_PLUGINS: PreviewRehypePlugins = [[rehypeSanitize]];

export type MarkdownEditorProps = {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    height?: number;
};

export const MarkdownEditorImpl = ({
    value,
    onChange,
    placeholder,
    height = 160,
}: MarkdownEditorProps) => (
    <div data-color-mode="light">
        <MDEditor
            value={value}
            onChange={(next) => onChange(next ?? "")}
            preview="edit"
            height={height}
            textareaProps={{ placeholder }}
            previewOptions={{ rehypePlugins: SANITIZE_PLUGINS }}
        />
    </div>
);

export type MarkdownViewerProps = {
    source: string;
};

export const MarkdownViewerImpl = ({ source }: MarkdownViewerProps) => (
    <div data-color-mode="light">
        <MDEditor.Markdown
            source={source}
            rehypePlugins={SANITIZE_PLUGINS}
            style={{ background: "transparent", fontSize: 13 }}
        />
    </div>
);

export default MarkdownEditorImpl;
