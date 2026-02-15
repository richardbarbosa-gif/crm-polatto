import { InboxOutlined } from "@ant-design/icons";
import { Space, Typography } from "antd";
import type { ReactNode } from "react";
import { Button } from "./button";

type Props = {
    title: string;
    description?: string;
    actionLabel?: string;
    onAction?: () => void;
    icon?: ReactNode;
};

export const EmptyState = ({
    title,
    description,
    actionLabel,
    onAction,
    icon,
}: Props) => {
    return (
        <div
            style={{
                border: "1px dashed #d0d7e2",
                borderRadius: 12,
                background: "#fafbfd",
                padding: "36px 24px",
                textAlign: "center",
            }}
        >
            <Space direction="vertical" size={10}>
                <div
                    style={{
                        fontSize: 28,
                        color: "#94a3b8",
                        lineHeight: 1,
                    }}
                >
                    {icon ?? <InboxOutlined />}
                </div>
                <Typography.Title level={5} style={{ margin: 0 }}>
                    {title}
                </Typography.Title>
                {description ? (
                    <Typography.Text type="secondary">{description}</Typography.Text>
                ) : null}
                {actionLabel && onAction ? (
                    <Button type="primary" onClick={onAction} style={{ marginTop: 8 }}>
                        {actionLabel}
                    </Button>
                ) : null}
            </Space>
        </div>
    );
};
