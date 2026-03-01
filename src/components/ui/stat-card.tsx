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
    accentColor = "#dbe4ee",
    style,
}: Props) => {
    return (
        <Card
            className="crm-stat-card"
            bodyStyle={{ padding: 16 }}
            style={{
                border: "1px solid rgba(148, 163, 184, 0.2)",
                boxShadow: "0 12px 26px rgba(15, 23, 42, 0.07)",
                background:
                    "linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(248,250,252,0.9) 100%)",
                ...style,
            }}
        >
            <div
                style={{
                    width: 44,
                    height: 4,
                    borderRadius: 999,
                    background: accentColor,
                    marginBottom: 12,
                }}
            />
            <Statistic
                title={title}
                value={value}
                prefix={prefix}
                suffix={suffix}
                valueStyle={{
                    fontSize: 22,
                    fontWeight: 800,
                    color: "#0f172a",
                    ...valueStyle,
                }}
            />
            {subtitle ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {subtitle}
                </Typography.Text>
            ) : null}
        </Card>
    );
};
