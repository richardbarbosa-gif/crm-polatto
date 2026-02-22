import { Alert, Space, Typography } from "antd";
import type { ReactNode } from "react";
import { Card } from "../../components/ui";

type InsightsHeaderProps = {
    title: string;
    subtitle?: string;
    extra?: ReactNode;
};

export const InsightsHeader = ({ title, subtitle, extra }: InsightsHeaderProps) => {
    return (
        <div
            style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 16,
            }}
        >
            <Space direction="vertical" size={2}>
                <Typography.Title level={3} style={{ margin: 0 }}>
                    {title}
                </Typography.Title>
                {subtitle ? (
                    <Typography.Text type="secondary">{subtitle}</Typography.Text>
                ) : null}
            </Space>
            {extra}
        </div>
    );
};

type IntroCardProps = {
    title: string;
    description: string;
    extra?: ReactNode;
};

export const IntroCard = ({ title, description, extra }: IntroCardProps) => {
    return (
        <Card
            style={{
                marginBottom: 16,
                background:
                    "linear-gradient(120deg, rgba(0,21,41,0.96), rgba(20,62,111,0.95) 60%, rgba(31,95,164,0.92))",
                border: "none",
            }}
            bodyStyle={{ padding: 18 }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 14,
                    flexWrap: "wrap",
                }}
            >
                <div>
                    <Typography.Text
                        style={{
                            color: "#e3edf8",
                            display: "block",
                            fontSize: 12,
                            letterSpacing: 0.5,
                            textTransform: "uppercase",
                        }}
                    >
                        Insights
                    </Typography.Text>
                    <Typography.Title level={4} style={{ margin: "2px 0 4px", color: "#ffffff" }}>
                        {title}
                    </Typography.Title>
                    <Typography.Text style={{ color: "#c6d7eb" }}>{description}</Typography.Text>
                </div>
                {extra}
            </div>
        </Card>
    );
};

type MissingSchemaAlertProps = {
    title?: string;
    description: string;
};

export const MissingSchemaAlert = ({
    title = "Tabela de Insights nao encontrada no Supabase",
    description,
}: MissingSchemaAlertProps) => {
    return (
        <Alert
            type="warning"
            showIcon
            message={title}
            description={description}
            style={{ marginBottom: 16 }}
        />
    );
};
