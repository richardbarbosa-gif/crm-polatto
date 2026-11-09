import { InboxOutlined } from "@ant-design/icons";
import { Typography } from "antd";
import type { ReactNode } from "react";
import { Button } from "./button";

type Props = {
    title: string;
    description?: string;
    actionLabel?: string;
    onAction?: () => void;
    icon?: ReactNode;
};

/** Estado vazio padrão do CRM: ícone, título, orientação e uma ação. */
export const EmptyState = ({
    title,
    description,
    actionLabel,
    onAction,
    icon,
}: Props) => {
    return (
        <div className="crm-empty-state">
            <div className="crm-empty-state__icon" aria-hidden="true">
                {icon ?? <InboxOutlined />}
            </div>
            <Typography.Title level={5} className="crm-empty-state__title">
                {title}
            </Typography.Title>
            {description ? (
                <Typography.Text type="secondary" className="crm-empty-state__description">
                    {description}
                </Typography.Text>
            ) : null}
            {actionLabel && onAction ? (
                <Button type="primary" onClick={onAction} className="crm-empty-state__action">
                    {actionLabel}
                </Button>
            ) : null}
        </div>
    );
};
