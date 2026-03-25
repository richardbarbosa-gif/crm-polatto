import type { CSSProperties } from "react";

type PolattoLogoProps = {
    collapsed?: boolean;
    size?: "sm" | "md" | "lg";
    showTagline?: boolean;
    variant?: "sidebar" | "login" | "default";
    style?: CSSProperties;
};

const SolarPanelIcon = ({ size = 28 }: { size?: number }) => {
    const cellSize = size * 0.34;
    const gap = size * 0.08;
    const sunR = size * 0.13;
    const sunX = cellSize * 2 + gap + size * 0.22;
    const sunY = -size * 0.12;
    const rayLen = size * 0.09;

    return (
        <svg
            width={size * 1.6}
            height={size * 1.1}
            viewBox={`-2 ${-size * 0.5} ${size * 2} ${size * 1.6}`}
            fill="none"
            aria-hidden="true"
        >
            {/* Panel grid */}
            <g transform="skewY(-8)">
                <rect x={0} y={0} width={cellSize} height={cellSize} rx={cellSize * 0.15} fill="#1E3A5F" />
                <rect x={cellSize + gap} y={0} width={cellSize} height={cellSize} rx={cellSize * 0.15} fill="#2563EB" />
                <rect x={0} y={cellSize + gap} width={cellSize} height={cellSize} rx={cellSize * 0.15} fill="#2563EB" />
                <rect x={cellSize + gap} y={cellSize + gap} width={cellSize} height={cellSize} rx={cellSize * 0.15} fill="#1E3A5F" />
            </g>
            {/* Sun */}
            <circle cx={sunX} cy={sunY} r={sunR} fill="#F59E0B" />
            <line x1={sunX} y1={sunY - sunR - 2} x2={sunX} y2={sunY - sunR - 2 - rayLen} stroke="#F59E0B" strokeWidth={size * 0.07} strokeLinecap="round" />
            <line x1={sunX + sunR + 1} y1={sunY - sunR + 2} x2={sunX + sunR + 1 + rayLen * 0.7} y2={sunY - sunR + 2 - rayLen * 0.7} stroke="#F59E0B" strokeWidth={size * 0.07} strokeLinecap="round" />
            <line x1={sunX + sunR + 3} y1={sunY + 2} x2={sunX + sunR + 3 + rayLen} y2={sunY + 2} stroke="#F59E0B" strokeWidth={size * 0.07} strokeLinecap="round" />
        </svg>
    );
};

export const PolattoLogo = ({
    collapsed = false,
    size = "md",
    showTagline = false,
    variant = "default",
    style,
}: PolattoLogoProps) => {
    const iconSize = size === "sm" ? 22 : size === "lg" ? 38 : 28;
    const isLogin = variant === "login";
    const isSidebar = variant === "sidebar";

    if (collapsed && isSidebar) {
        return (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", ...style }}>
                <SolarPanelIcon size={20} />
            </div>
        );
    }

    return (
        <div
            style={{
                display: "flex",
                flexDirection: isLogin ? "column" : "row",
                alignItems: isLogin ? "center" : "center",
                gap: isLogin ? 12 : 10,
                ...style,
            }}
        >
            <SolarPanelIcon size={iconSize} />
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: isLogin ? "center" : "flex-start",
                    gap: 0,
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span
                        style={{
                            fontFamily: "'Sora', sans-serif",
                            fontSize: isLogin ? 28 : 15,
                            fontWeight: 700,
                            letterSpacing: "0.06em",
                            color: isSidebar ? "#f1f5f9" : "#0F172A",
                            lineHeight: 1,
                        }}
                    >
                        POLATTO
                    </span>
                    {!isLogin && (
                        <span
                            style={{
                                fontFamily: "'Inter', sans-serif",
                                fontSize: 8,
                                fontWeight: 600,
                                letterSpacing: "0.12em",
                                color: "#3B82F6",
                                background: isSidebar ? "rgba(59, 130, 246, 0.15)" : "rgba(59, 130, 246, 0.08)",
                                padding: "2px 5px",
                                borderRadius: 4,
                                lineHeight: 1,
                            }}
                        >
                            CRM
                        </span>
                    )}
                </div>
                {(showTagline || isLogin) && (
                    <span
                        style={{
                            fontFamily: "'Inter', sans-serif",
                            fontSize: isLogin ? 13 : 9,
                            fontWeight: 500,
                            letterSpacing: "0.12em",
                            color: isSidebar ? "rgba(148, 163, 184, 0.6)" : "#64748B",
                            lineHeight: 1,
                            marginTop: isLogin ? 4 : 2,
                        }}
                    >
                        ENERGIA SOLAR
                    </span>
                )}
            </div>
        </div>
    );
};
