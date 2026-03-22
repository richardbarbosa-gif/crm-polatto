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
            className="crm-empty-state"
            style={{
                border: "1.5px dashed var(--crm-border)",
                borderRadius: 16,
                background: "var(--crm-surface-1)",
                padding: "48px 32px",
                textAlign: "center",
            }}
        >
            <Space direction="vertical" size={12}>
                <div
                    style={{
                        width: 52,
                        height: 52,
                        margin: "0 auto",
                        borderRadius: 14,
                        display: "grid",
                        placeItems: "center",
                        fontSize: 24,
                        color: "#3b82f6",
                        background: "rgba(59,130,246,0.08)",
                        border: "1px solid rgba(59, 130, 246, 0.1)",
                        lineHeight: 1,
                    }}
                >
                    {icon ?? <InboxOutlined />}
                </div>
                <Typography.Title level={5} style={{ margin: 0, fontWeight: 600, letterSpacing: "-0.02em" }}>
                    {title}
                </Typography.Title>
                {description ? (
                    <Typography.Text type="secondary" style={{ fontSize: 13 }}>{description}</Typography.Text>
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
