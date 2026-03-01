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
                borderRadius: 16,
                border: "1px solid rgba(148, 163, 184, 0.22)",
                boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
                background: "linear-gradient(180deg, #ffffff 0%, #fcfdff 100%)",
                transition:
                    "box-shadow 0.25s ease, border-color 0.25s ease, transform 0.25s ease",
                ...style,
            }}
        />
    );
};
