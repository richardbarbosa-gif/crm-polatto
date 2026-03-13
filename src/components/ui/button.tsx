import { Button as AntdButton, type ButtonProps } from "antd";

type Props = ButtonProps & {
    fullWidth?: boolean;
};

export const Button = ({ fullWidth, style, className, type, ...props }: Props) => {
    const isPrimary = type === "primary";

    return (
        <AntdButton
            {...props}
            type={type}
            className={[
                "crm-button",
                isPrimary ? "crm-button-primary" : "crm-button-default",
                className || "",
            ]
                .filter(Boolean)
                .join(" ")}
            style={{
                borderRadius: 10,
                fontWeight: 500,
                letterSpacing: "-0.01em",
                ...(fullWidth ? { width: "100%" } : {}),
                ...style,
            }}
        />
    );
};
