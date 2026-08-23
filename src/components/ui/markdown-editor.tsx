import { Skeleton } from "antd";
import { Suspense, lazy } from "react";
import type { MarkdownEditorProps, MarkdownViewerProps } from "./markdown-impl";

/**
 * O editor de markdown (@uiw/react-md-editor) pesa ~1,2MB com o realce de
 * sintaxe. Carregado sob demanda para não entrar no bundle inicial do CRM —
 * só baixa quando o usuário abre o detalhe de um lead.
 */
const LazyEditor = lazy(async () => {
    const mod = await import("./markdown-impl");
    return { default: mod.MarkdownEditorImpl };
});

const LazyViewer = lazy(async () => {
    const mod = await import("./markdown-impl");
    return { default: mod.MarkdownViewerImpl };
});

export const MarkdownEditor = (props: MarkdownEditorProps) => (
    <Suspense fallback={<Skeleton.Input active block style={{ height: props.height ?? 160 }} />}>
        <LazyEditor {...props} />
    </Suspense>
);

export const MarkdownViewer = (props: MarkdownViewerProps) => (
    <Suspense fallback={<Skeleton active paragraph={{ rows: 1 }} title={false} />}>
        <LazyViewer {...props} />
    </Suspense>
);
