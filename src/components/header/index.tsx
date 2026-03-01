import { MoonOutlined, SunOutlined } from "@ant-design/icons";
import { useGetIdentity } from "@refinedev/core";
import { Avatar, Layout as AntdLayout, Space, Switch, Typography } from "antd";
import { useContext, useMemo } from "react";
import { ColorModeContext } from "../../contexts/color-mode";

const { Text, Title } = Typography;

type IdentityLike = {
    name?: string | null;
    email?: string | null;
    avatar?: string | null;
};

export const Header = ({ sticky }: { sticky?: boolean }) => {
    const { data } = useGetIdentity<IdentityLike>();
    const { mode, setMode } = useContext(ColorModeContext);

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
                paddingInline: 22,
                height: 72,
                position: sticky ? "sticky" : "relative",
                top: 0,
                zIndex: 40,
            }}
        >
            <div className="crm-topbar-inner">
                <div>
                    <Space size={10} align="center">
                        <div className="crm-topbar-dot" />
                        <Text className="crm-topbar-label">CRM Polatto</Text>
                    </Space>
                    <Title level={4} style={{ margin: "4px 0 0 0", color: "#e2e8f0", fontWeight: 700 }}>
                        Operação Comercial
                    </Title>
                </div>

                <Space size={14} align="center" wrap>
                    <div className="crm-date-pill">{todayLabel}</div>
                    <Switch
                        checked={mode === "dark"}
                        checkedChildren={<MoonOutlined />}
                        unCheckedChildren={<SunOutlined />}
                        onChange={() => setMode(mode === "light" ? "dark" : "light")}
                        aria-label="Alternar tema"
                    />
                    <Space size={10} align="center">
                        <Text style={{ color: "#dbe5f5", fontWeight: 600 }}>{userName}</Text>
                        <Avatar
                            src={data?.avatar || undefined}
                            alt={userName}
                            style={{
                                backgroundColor: "rgba(76,139,245,0.2)",
                                color: "#8cc0ff",
                                border: "1px solid rgba(140,192,255,0.45)",
                                fontWeight: 700,
                            }}
                        >
                            {userInitial}
                        </Avatar>
                    </Space>
                </Space>
            </div>
        </AntdLayout.Header>
    );
};
