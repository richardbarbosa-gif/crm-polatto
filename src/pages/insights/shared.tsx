import { Alert, Typography } from "antd";
import type { ReactNode } from "react";
import { Card } from "../../components/ui";

type InsightsHeaderProps = {
    title: string;
    subtitle?: string;
    extra?: ReactNode;
    /** Ícone do quadrado à esquerda do título (mesmo da barra lateral). */
    icon?: ReactNode;
};

// Mesmo padrão de cabeçalho das demais telas (classes crm-page-header-*),
// para que Relatórios, Equipe e Metas não destoem de Orçamentos, Histórico etc.
export const InsightsHeader = ({ title, subtitle, extra, icon }: InsightsHeaderProps) => {
    return (
        <div className="crm-page-header" style={{ marginBottom: 16 }}>
            <div>
                <Typography.Title level={2} className="crm-page-header-title">
                    {icon}
                    {title}
                </Typography.Title>
                {subtitle ? (
                    <Typography.Text className="crm-page-header-subtitle">{subtitle}</Typography.Text>
                ) : null}
            </div>
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
    title = "Tabela de relatórios não encontrada no banco",
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
