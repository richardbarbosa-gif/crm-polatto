import { Tag, type TagProps } from "antd";
import type { CSSProperties, ReactNode } from "react";

export type BadgeTone =
    | "neutral"
    | "info"
    | "success"
    | "warning"
    | "danger"
    | "cold"
    | "warm"
    | "hot";

const BADGE_TONE_STYLES: Record<BadgeTone, CSSProperties> = {
    neutral: {
        color: "#475569",
        backgroundColor: "#f1f5f9",
        borderColor: "rgba(148, 163, 184, 0.25)",
    },
    info: {
        color: "#2563eb",
        backgroundColor: "#eff6ff",
        borderColor: "rgba(59, 130, 246, 0.2)",
    },
    success: {
        color: "#059669",
        backgroundColor: "#ecfdf5",
        borderColor: "rgba(16, 185, 129, 0.2)",
    },
    warning: {
        color: "#d97706",
        backgroundColor: "#fffbeb",
        borderColor: "rgba(245, 158, 11, 0.2)",
    },
    danger: {
        color: "#dc2626",
        backgroundColor: "#fef2f2",
        borderColor: "rgba(239, 68, 68, 0.2)",
    },
    cold: {
        color: "#64748b",
        backgroundColor: "#f8fafc",
        borderColor: "rgba(148, 163, 184, 0.2)",
    },
    warm: {
        color: "#ea580c",
        backgroundColor: "#fff7ed",
        borderColor: "rgba(234, 88, 12, 0.2)",
    },
    hot: {
        color: "#dc2626",
        backgroundColor: "#fef2f2",
        borderColor: "rgba(239, 68, 68, 0.2)",
    },
};

type Props = Omit<TagProps, "children"> & {
    tone?: BadgeTone;
    children: ReactNode;
};

export const Badge = ({ tone = "neutral", style, children, ...props }: Props) => {
    return (
        <Tag
            {...props}
            style={{
                marginInlineEnd: 0,
                borderRadius: 999,
                paddingInline: 10,
                paddingBlock: 2,
                fontSize: 11.5,
                fontWeight: 600,
                lineHeight: "18px",
                letterSpacing: "-0.01em",
                ...BADGE_TONE_STYLES[tone],
                ...style,
            }}
        >
            {children}
        </Tag>
    );
};
