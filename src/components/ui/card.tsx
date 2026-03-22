import { Card as AntdCard, type CardProps } from "antd";

type Props = CardProps & {
    interactive?: boolean;
};

export const Card = ({ interactive, hoverable, style, className, ...props }: Props) => {
    return (
        <AntdCard
            {...props}
            hoverable={interactive || hoverable}
            className={["crm-card", interactive || hoverable ? "crm-card-interactive" : "", className || ""]
                .filter(Boolean)
                .join(" ")}
            style={{
                borderRadius: 14,
                border: "1px solid var(--crm-border)",
                boxShadow: "var(--crm-shadow-xs)",
                background: "var(--crm-surface-1)",
                transition:
                    "box-shadow 0.2s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.2s cubic-bezier(0.22, 1, 0.36, 1), transform 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
                ...style,
            }}
        />
    );
};
