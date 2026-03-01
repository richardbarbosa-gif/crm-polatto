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
                border: "1px dashed rgba(148, 163, 184, 0.45)",
                borderRadius: 16,
                background:
                    "linear-gradient(145deg, rgba(248,250,252,0.95) 0%, rgba(239,246,255,0.7) 100%)",
                padding: "42px 26px",
                textAlign: "center",
            }}
        >
            <Space direction="vertical" size={10}>
                <div
                    style={{
                        width: 54,
                        height: 54,
                        margin: "0 auto",
                        borderRadius: 14,
                        display: "grid",
                        placeItems: "center",
                        fontSize: 28,
                        color: "#3b82f6",
                        background: "rgba(59,130,246,0.12)",
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
