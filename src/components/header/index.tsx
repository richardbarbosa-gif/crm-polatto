import { MoonOutlined, SunOutlined } from "@ant-design/icons";
import { useGetIdentity } from "@refinedev/core";
import { Avatar, Layout as AntdLayout, Space, Switch, Typography } from "antd";
import { useContext, useMemo, useState } from "react";
import { ColorModeContext } from "../../contexts/color-mode";
import { GlobalSearch } from "../global-search";

const { Text } = Typography;

type IdentityLike = {
    name?: string | null;
    email?: string | null;
    avatar?: string | null;
};

export const Header = ({ sticky }: { sticky?: boolean }) => {
    const { data } = useGetIdentity<IdentityLike>();
    const { mode, setMode } = useContext(ColorModeContext);
    const [searchOpen, setSearchOpen] = useState(false);

    const userName = (data?.name || data?.email || "Usuario").toString();
    const userInitial = userName.charAt(0).toUpperCase();

    const todayLabel = useMemo(() => {
        return new Date().toLocaleDateString("pt-BR", {
            weekday: "long",
            day: "2-digit",
            month: "long",
        });
    }, []);

    return (
        <AntdLayout.Header
            className="crm-topbar"
            style={{
                paddingInline: 24,
                height: 56,
                position: sticky ? "sticky" : "relative",
                top: 0,
                zIndex: 40,
            }}
        >
            <div className="crm-topbar-inner">
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div className="crm-topbar-dot" />
                    <Text className="crm-topbar-label">CRM Polatto</Text>
                    <div
                        style={{
                            width: 1,
                            height: 18,
                            background: "rgba(255,255,255,0.08)",
                            marginInline: 4,
                        }}
                    />
                    <Text
                        style={{
                            color: "rgba(203, 213, 225, 0.65)",
                            fontSize: 13,
                            fontWeight: 500,
                            letterSpacing: "-0.01em",
                        }}
                    >
                        Operação Comercial
                    </Text>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div className="crm-date-pill">{todayLabel}</div>

                    <Switch
                        checked={mode === "dark"}
                        checkedChildren={<MoonOutlined />}
                        unCheckedChildren={<SunOutlined />}
                        onChange={() => setMode(mode === "light" ? "dark" : "light")}
                        aria-label="Alternar tema"
                        style={{ minWidth: 44 }}
                    />

                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            borderLeft: "1px solid rgba(255, 255, 255, 0.06)",
                            paddingInlineStart: 14,
                        }}
                    >
                        <Text style={{ color: "#cbd5e1", fontWeight: 500, fontSize: 13 }}>
                            {userName}
                        </Text>
                        <Avatar
                            src={data?.avatar || undefined}
                            alt={userName}
                            size={30}
                            style={{
                                backgroundColor: "rgba(59, 130, 246, 0.18)",
                                color: "#93bbfc",
                                border: "1.5px solid rgba(96, 165, 250, 0.22)",
                                fontWeight: 600,
                                fontSize: 12,
                            }}
                        >
                            {userInitial}
                        </Avatar>
                    </div>
                </div>
            </div>

            <GlobalSearch open={searchOpen} setOpen={setSearchOpen} />
        </AntdLayout.Header>
    );
};
