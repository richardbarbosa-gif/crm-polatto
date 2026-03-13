import { Statistic, Typography, type StatisticProps } from "antd";
import type { CSSProperties, ReactNode } from "react";
import { Card } from "./card";

type Props = {
    title: StatisticProps["title"];
    value: StatisticProps["value"];
    prefix?: StatisticProps["prefix"];
    suffix?: StatisticProps["suffix"];
    subtitle?: ReactNode;
    valueStyle?: CSSProperties;
    accentColor?: string;
    style?: CSSProperties;
};

export const StatCard = ({
    title,
    value,
    prefix,
    suffix,
    subtitle,
    valueStyle,
    accentColor = "#94a3b8",
    style,
}: Props) => {
    return (
        <Card
            className="crm-stat-card"
            bodyStyle={{ padding: "16px 18px 14px" }}
            style={{
                border: "1px solid rgba(15, 23, 42, 0.06)",
                boxShadow: "0 1px 2px rgba(15, 23, 42, 0.03)",
                background: "#ffffff",
                ...style,
            }}
        >
            <div
                style={{
                    width: 28,
                    height: 2.5,
                    borderRadius: 999,
                    background: accentColor,
                    marginBottom: 12,
                    opacity: 0.6,
                }}
            />
            <Statistic
                title={title}
                value={value}
                prefix={prefix}
                suffix={suffix}
                valueStyle={{
                    fontSize: 22,
                    fontWeight: 700,
                    color: "#0f172a",
                    letterSpacing: "-0.03em",
                    fontFamily: "'Sora', 'Inter', sans-serif",
                    ...valueStyle,
                }}
            />
            {subtitle ? (
                <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
                    {subtitle}
                </Typography.Text>
            ) : null}
        </Card>
    );
};
