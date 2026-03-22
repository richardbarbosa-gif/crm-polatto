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
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Text className="crm-topbar-label">Operação Comercial</Text>
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

                    <div className="crm-topbar-user">
                        <Text className="crm-topbar-user__name">
                            {userName}
                        </Text>
                        <Avatar
                            src={data?.avatar || undefined}
                            alt={userName}
                            size={30}
                            style={{
                                backgroundColor: "rgba(59, 130, 246, 0.1)",
                                color: "#3b82f6",
                                border: "1.5px solid rgba(59, 130, 246, 0.15)",
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
