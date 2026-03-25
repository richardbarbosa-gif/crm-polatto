import { MessageOutlined } from "@ant-design/icons";
import { Typography } from "antd";
import { EmptyState } from "../../components/ui";

const { Title, Text } = Typography;

export const ChatPlaceholderPage = () => {
    return (
        <div className="crm-page-shell">
            <div className="crm-page-header">
                <div>
                    <Title level={2} className="crm-page-header-title">
                        Chat
                    </Title>
                    <Text className="crm-page-header-subtitle">
                        Central de mensagens integrada ao CRM.
                    </Text>
                </div>
            </div>

            <EmptyState
                title="Chat em breve"
                description="Estamos integrando WhatsApp e email diretamente no CRM. Em breve você poderá conversar com seus leads sem sair do sistema."
                icon={<MessageOutlined />}
            />
        </div>
    );
};
