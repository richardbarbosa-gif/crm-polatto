import { Card as AntdCard, type CardProps } from "antd";

type Props = CardProps & {
    interactive?: boolean;
};

export const Card = ({ interactive, hoverable, style, ...props }: Props) => {
    return (
        <AntdCard
            {...props}
            hoverable={interactive || hoverable}
            style={{
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                boxShadow: "0 1px 3px rgba(15, 23, 42, 0.06)",
                transition:
                    "box-shadow 0.2s ease, border-color 0.2s ease, transform 0.2s ease",
                ...style,
            }}
        />
    );
};
