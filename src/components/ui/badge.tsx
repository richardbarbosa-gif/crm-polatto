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
        borderColor: "#cbd5e1",
    },
    info: {
        color: "#1d4ed8",
        backgroundColor: "#eff6ff",
        borderColor: "#bfdbfe",
    },
    success: {
        color: "#166534",
        backgroundColor: "#f0fdf4",
        borderColor: "#bbf7d0",
    },
    warning: {
        color: "#92400e",
        backgroundColor: "#fffbeb",
        borderColor: "#fde68a",
    },
    danger: {
        color: "#991b1b",
        backgroundColor: "#fef2f2",
        borderColor: "#fecaca",
    },
    cold: {
        color: "#475569",
        backgroundColor: "#f8fafc",
        borderColor: "#cbd5e1",
    },
    warm: {
        color: "#9a3412",
        backgroundColor: "#fff7ed",
        borderColor: "#fdba74",
    },
    hot: {
        color: "#b91c1c",
        backgroundColor: "#fef2f2",
        borderColor: "#fca5a5",
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
                fontSize: 12,
                fontWeight: 600,
                lineHeight: "18px",
                ...BADGE_TONE_STYLES[tone],
                ...style,
            }}
        >
            {children}
        </Tag>
    );
};
