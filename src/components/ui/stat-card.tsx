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
            bodyStyle={{ padding: 16 }}
            style={{
                borderLeft: `3px solid ${accentColor}`,
                ...style,
            }}
        >
            <Statistic
                title={title}
                value={value}
                prefix={prefix}
                suffix={suffix}
                valueStyle={{
                    fontSize: 20,
                    fontWeight: 700,
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
