import { useGetIdentity } from "@refinedev/core";
import { Layout as AntdLayout, Avatar, Space, Typography, Switch } from "antd";
import { useContext } from "react";
import { ColorModeContext } from "../../contexts/color-mode";

const { Text } = Typography;

// Simplifiquei a definição aqui para não dar erro de versão
export const Header = ({ sticky }: { sticky?: boolean }) => {
  const { data: user } = useGetIdentity();
  const { mode, setMode } = useContext(ColorModeContext);

  const headerStyles: React.CSSProperties = {
    backgroundColor: "#001529", // AQUI ESTÁ O AZUL POLATTO
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    padding: "0px 24px",
    height: "64px",
    position: sticky ? "sticky" : "relative",
    top: 0,
    zIndex: 1,
    // Removi a borda para ficar liso com o menu lateral
  };

  return (
    <AntdLayout.Header style={headerStyles}>
      <Space>
        {/* Botão de Modo Escuro/Claro */}
        <Switch
          checkedChildren="🌛"
          unCheckedChildren="🔆"
          onChange={() => setMode(mode === "light" ? "dark" : "light")}
          defaultChecked={mode === "dark"}
          style={{ marginRight: "15px" }}
        />

        <Space size="middle">
          {user?.name && (
            <Text strong style={{ color: "#ffffff" }}> {/* Nome Branco */}
              {user.name}
            </Text>
          )}
          <Avatar src={user?.avatar} alt={user?.name} style={{ backgroundColor: "#fde3cf", color: "#f56a00" }}>
             {user?.name?.charAt(0)}
          </Avatar>
        </Space>
      </Space>
    </AntdLayout.Header>
  );
};