import { Typography, Tabs, Card, Switch, Select, Divider } from "antd";
import { SettingOutlined, GlobalOutlined, BgColorsOutlined, BellOutlined } from "@ant-design/icons";

const { Title, Text } = Typography;

export const ConfiguracoesPage = () => {
    return (
        <div style={{ padding: "24px", maxWidth: "900px", margin: "0 auto" }}>
            <Title level={2} style={{ marginBottom: "24px", color: '#1e293b' }}>
                <SettingOutlined style={{ marginRight: '10px', color: '#64748b' }} />
                Configurações do Sistema
            </Title>
            
            <Card bordered={false} style={{ borderRadius: "12px", boxShadow: "0 4px 12px rgba(0,0,0,0.03)" }}>
                <Tabs
                    defaultActiveKey="1"
                    tabPosition="left"
                    items={[
                        {
                            key: "1",
                            label: <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><GlobalOutlined /> Geral</span>,
                            children: (
                                <div style={{ padding: "0 16px" }}>
                                    <Title level={4}>Preferências Regionais</Title>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
                                        <div>
                                            <Text strong style={{ display: 'block', marginBottom: '8px' }}>Idioma do Sistema</Text>
                                            <Select defaultValue="pt-BR" style={{ width: 200 }} options={[{ value: 'pt-BR', label: 'Português (Brasil)' }, { value: 'en-US', label: 'English (US)' }, { value: 'es-ES', label: 'Español' }]} />
                                        </div>
                                        <div>
                                            <Text strong style={{ display: 'block', marginBottom: '8px' }}>Fuso Horário</Text>
                                            <Select defaultValue="utc-3" style={{ width: 200 }} options={[{ value: 'utc-3', label: 'Brasília (UTC-3)' }]} />
                                        </div>
                                    </div>
                                </div>
                            ),
                        },
                        {
                            key: "2",
                            label: <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><BgColorsOutlined /> Aparência</span>,
                            children: (
                                <div style={{ padding: "0 16px" }}>
                                    <Title level={4}>Interface e Tema</Title>
                                    <Divider />
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: '400px' }}>
                                        <div>
                                            <Text strong style={{ display: 'block' }}>Modo Noturno (Dark Mode)</Text>
                                            <Text type="secondary">Escurece a interface para ambientes com pouca luz.</Text>
                                        </div>
                                        <Switch />
                                    </div>
                                    <Divider />
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: '400px' }}>
                                        <div>
                                            <Text strong style={{ display: 'block' }}>Cores de Alto Contraste</Text>
                                            <Text type="secondary">Melhora a legibilidade do Kanban.</Text>
                                        </div>
                                        <Switch defaultChecked />
                                    </div>
                                </div>
                            ),
                        },
                        {
                            key: "3",
                            label: <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><BellOutlined /> Notificações</span>,
                            children: (
                                <div style={{ padding: "0 16px" }}>
                                    <Title level={4}>Alertas do CRM</Title>
                                    <Divider />
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: '400px', marginBottom: '16px' }}>
                                        <Text strong>Som ao receber novo lead</Text>
                                        <Switch defaultChecked />
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: '400px' }}>
                                        <Text strong>Avisos de tarefas atrasadas</Text>
                                        <Switch defaultChecked />
                                    </div>
                                </div>
                            ),
                        }
                    ]}
                />
            </Card>
        </div>
    );
};