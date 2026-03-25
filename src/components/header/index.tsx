import { MoonOutlined, SunOutlined, UserOutlined } from "@ant-design/icons";
import { useGetIdentity } from "@refinedev/core";
import { Avatar, Layout as AntdLayout, Switch, Typography } from "antd";
import { useContext } from "react";
import { ColorModeContext } from "../../contexts/color-mode";
import { CompanySelector } from "./company-selector";

const { Text } = Typography;

export const Header = () => {
    const { data } = useGetIdentity<any>();
    const { mode, setMode } = useContext(ColorModeContext);

    const userName = data?.name || "Usuário";
    const userEmail = data?.email || "";

    return (
        <AntdLayout.Header className="crm-topbar">
            <div className="crm-topbar-inner">
                <div className="crm-topbar-actions">
                    {/* Seletor de empresa */}
                    <CompanySelector />

                    <div className="crm-topbar-divider" />

                    <Switch
                        checked={mode === "dark"}
                        checkedChildren={<MoonOutlined />}
                        unCheckedChildren={<SunOutlined />}
                        onChange={() => setMode(mode === "light" ? "dark" : "light")}
                        aria-label="Alternar tema"
                    />

                    <div className="crm-topbar-divider" />

                    <div className="crm-topbar-user-profile">
                        <div className="crm-topbar-user-info">
                            <Text className="crm-topbar-user-name">{userName}</Text>
                            <Text className="crm-topbar-user-email">{userEmail}</Text>
                        </div>
                        <Avatar
                            size={36}
                            className="crm-topbar-avatar"
                            icon={!data?.avatar ? <UserOutlined /> : undefined}
                            src={data?.avatar}
                        >
                            {!data?.avatar && userName.charAt(0).toUpperCase()}
                        </Avatar>
                    </div>
                </div>
            </div>
        </AntdLayout.Header>
    );
};
