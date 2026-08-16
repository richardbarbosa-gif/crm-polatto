import MDEditor from "@uiw/react-md-editor";
import "@uiw/react-md-editor/markdown-editor.css";
import "@uiw/react-markdown-preview/markdown.css";

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
        />
    </div>
);

export type MarkdownViewerProps = {
    source: string;
};

export const MarkdownViewerImpl = ({ source }: MarkdownViewerProps) => (
    <div data-color-mode="light">
        <MDEditor.Markdown source={source} style={{ background: "transparent", fontSize: 13 }} />
    </div>
);

export default MarkdownEditorImpl;
