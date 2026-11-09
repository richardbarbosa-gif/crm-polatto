import { Tag, type TagProps } from "antd";
import type { ReactNode } from "react";

export type BadgeTone =
    | "neutral"
    | "info"
    | "success"
    | "warning"
    | "danger"
    | "cold"
    | "warm"
    | "hot";

type Props = Omit<TagProps, "children"> & {
    tone?: BadgeTone;
    children: ReactNode;
};

/**
 * Selo em pílula (temperatura, status, papéis). As cores vêm dos tokens
 * --crm-badge-* do tema (premium-theme.css), com versão própria para o modo
 * escuro: antes eram hex fixos de fundo claro, que no escuro viravam
 * retângulos brancos.
 */
export const Badge = ({ tone = "neutral", className, children, ...props }: Props) => {
    return (
        <Tag {...props} className={["crm-badge", `crm-badge--${tone}`, className || ""].filter(Boolean).join(" ")}>
            {children}
        </Tag>
    );
};
