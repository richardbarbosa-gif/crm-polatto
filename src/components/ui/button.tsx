import { Button as AntdButton, type ButtonProps } from "antd";

type Props = ButtonProps & {
    fullWidth?: boolean;
};

export const Button = ({ fullWidth, style, ...props }: Props) => {
    return (
        <AntdButton
            {...props}
            style={{
                borderRadius: 8,
                fontWeight: 600,
                ...(fullWidth ? { width: "100%" } : {}),
                ...style,
            }}
        />
    );
};
