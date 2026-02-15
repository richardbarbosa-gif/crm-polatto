import { Skeleton, Space } from "antd";

type SkeletonRowProps = {
    rows?: number;
};

export const SkeletonRow = ({ rows = 6 }: SkeletonRowProps) => {
    return (
        <Space direction="vertical" size={10} style={{ width: "100%" }}>
            {Array.from({ length: rows }).map((_, index) => (
                <Skeleton.Button
                    key={index}
                    active
                    block
                    size="small"
                    style={{ height: 18, borderRadius: 6 }}
                />
            ))}
        </Space>
    );
};

type SkeletonCardProps = {
    cards?: number;
};

export const SkeletonCard = ({ cards = 3 }: SkeletonCardProps) => {
    return (
        <div
            style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
            }}
        >
            {Array.from({ length: cards }).map((_, index) => (
                <div
                    key={index}
                    style={{
                        border: "1px solid #e5e7eb",
                        borderRadius: 12,
                        padding: 14,
                        background: "#ffffff",
                    }}
                >
                    <Skeleton active paragraph={{ rows: 2 }} title={{ width: "50%" }} />
                </div>
            ))}
        </div>
    );
};
