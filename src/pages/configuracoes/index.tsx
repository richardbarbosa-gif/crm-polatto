import {
    BellOutlined,
    BgColorsOutlined,
    CloseCircleOutlined,
    FormOutlined,
    FunnelPlotOutlined,
    GlobalOutlined,
    ScheduleOutlined,
    SettingOutlined,
} from "@ant-design/icons";
import { Card, Divider, Select, Switch, Tabs, Typography } from "antd";
import {
    CustomFieldsConfig,
    MotivosPerdaConfig,
    PipelinesConfig,
    TiposAtividadeConfig,
} from "./crm";

const { Title, Text } = Typography;

const sectionTitleStyle = { margin: 0 };

export const ConfiguracoesPage = () => {
    return (
        <div className="crm-page-shell crm-config-page">
            <div className="crm-page-header">
                <div>
                    <Title level={2} className="crm-page-header-title">
                        <SettingOutlined style={{ marginRight: 10, color: "#64748b" }} />
                        Configuracoes
                    </Title>
                    <Text className="crm-page-header-subtitle">
                        Preferencias visuais e operacionais do CRM para o seu time.
                    </Text>
                </div>
            </div>

            <Card bordered={false} className="crm-card">
                <Tabs
                    defaultActiveKey="geral"
                    tabPosition="left"
                    items={[
                        {
                            key: "geral",
                            label: (
                                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <GlobalOutlined /> Geral
                                </span>
                            ),
                            children: (
                                <div className="crm-form-section" style={{ marginBottom: 0 }}>
                                    <Title level={4} style={sectionTitleStyle}>
                                        Preferencias regionais
                                    </Title>
                                    <Text className="crm-form-section-subtitle" type="secondary">
                                        Defina idioma e fuso para padronizar datas, horarios e mensagens.
                                    </Text>
                                    <div className="crm-config-row">
                                        <div>
                                            <Text strong>Idioma do sistema</Text>
                                        </div>
                                        <Select
                                            defaultValue="pt-BR"
                                            style={{ width: 240 }}
                                            options={[
                                                { value: "pt-BR", label: "Portugues (Brasil)" },
                                                { value: "en-US", label: "English (US)" },
                                                { value: "es-ES", label: "Espanol" },
                                            ]}
                                        />
                                    </div>
                                    <div className="crm-config-row">
                                        <div>
                                            <Text strong>Fuso horario</Text>
                                        </div>
                                        <Select
                                            defaultValue="utc-3"
                                            style={{ width: 240 }}
                                            options={[{ value: "utc-3", label: "Brasilia (UTC-3)" }]}
                                        />
                                    </div>
                                </div>
                            ),
                        },
                        {
                            key: "aparencia",
                            label: (
                                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <BgColorsOutlined /> Aparencia
                                </span>
                            ),
                            children: (
                                <div className="crm-form-section" style={{ marginBottom: 0 }}>
                                    <Title level={4} style={sectionTitleStyle}>
                                        Interface e tema
                                    </Title>
                                    <Text className="crm-form-section-subtitle" type="secondary">
                                        Ajustes de leitura e contraste para o dia a dia comercial.
                                    </Text>
                                    <div className="crm-config-row">
                                        <div>
                                            <Text strong>Modo noturno</Text>
                                            <Text type="secondary" style={{ display: "block" }}>
                                                Escurece a interface para ambientes de baixa luz.
                                            </Text>
                                        </div>
                                        <Switch />
                                    </div>
                                    <div className="crm-config-row">
                                        <div>
                                            <Text strong>Alto contraste</Text>
                                            <Text type="secondary" style={{ display: "block" }}>
                                                Melhora a legibilidade de cards, funil e tabelas.
                                            </Text>
                                        </div>
                                        <Switch defaultChecked />
                                    </div>
                                </div>
                            ),
                        },
                        {
                            key: "notificacoes",
                            label: (
                                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <BellOutlined /> Notificacoes
                                </span>
                            ),
                            children: (
                                <div className="crm-form-section" style={{ marginBottom: 0 }}>
                                    <Title level={4} style={sectionTitleStyle}>
                                        Alertas do CRM
                                    </Title>
                                    <Text className="crm-form-section-subtitle" type="secondary">
                                        Configure avisos para manter o time atento ao pipeline.
                                    </Text>
                                    <div className="crm-config-row">
                                        <div>
                                            <Text strong>Som ao receber novo lead</Text>
                                        </div>
                                        <Switch defaultChecked />
                                    </div>
                                    <div className="crm-config-row">
                                        <div>
                                            <Text strong>Avisos de tarefas atrasadas</Text>
                                        </div>
                                        <Switch defaultChecked />
                                    </div>
                                    <Divider style={{ margin: "10px 0 0" }} />
                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                        Essas preferencias sao locais da interface nesta etapa.
                                    </Text>
                                </div>
                            ),
                        },
                        {
                            key: "funis",
                            label: (
                                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <FunnelPlotOutlined /> Funis e etapas
                                </span>
                            ),
                            children: (
                                <div className="crm-form-section" style={{ marginBottom: 0 }}>
                                    <Title level={4} style={sectionTitleStyle}>
                                        Funis de venda
                                    </Title>
                                    <Text className="crm-form-section-subtitle" type="secondary">
                                        Crie múltiplos funis (Vendas, Pós-venda...) e configure as etapas
                                        com cor, ordem e probabilidade de fechamento.
                                    </Text>
                                    <PipelinesConfig />
                                </div>
                            ),
                        },
                        {
                            key: "campos",
                            label: (
                                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <FormOutlined /> Campos customizados
                                </span>
                            ),
                            children: (
                                <div className="crm-form-section" style={{ marginBottom: 0 }}>
                                    <Title level={4} style={sectionTitleStyle}>
                                        Campos do seu negócio
                                    </Title>
                                    <Text className="crm-form-section-subtitle" type="secondary">
                                        Cada empresa cadastra os campos que fazem sentido para o seu segmento
                                        — sem depender de desenvolvimento.
                                    </Text>
                                    <CustomFieldsConfig />
                                </div>
                            ),
                        },
                        {
                            key: "motivos-perda",
                            label: (
                                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <CloseCircleOutlined /> Motivos de perda
                                </span>
                            ),
                            children: (
                                <div className="crm-form-section" style={{ marginBottom: 0 }}>
                                    <Title level={4} style={sectionTitleStyle}>
                                        Motivos de perda
                                    </Title>
                                    <Text className="crm-form-section-subtitle" type="secondary">
                                        O vendedor escolhe um destes motivos ao marcar um negócio como
                                        perdido — os relatórios de ganhos e perdas usam essa lista.
                                    </Text>
                                    <MotivosPerdaConfig />
                                </div>
                            ),
                        },
                        {
                            key: "tipos-atividade",
                            label: (
                                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <ScheduleOutlined /> Tipos de atividade
                                </span>
                            ),
                            children: (
                                <div className="crm-form-section" style={{ marginBottom: 0 }}>
                                    <Title level={4} style={sectionTitleStyle}>
                                        Tipos de atividade
                                    </Title>
                                    <Text className="crm-form-section-subtitle" type="secondary">
                                        Configure os tipos usados na agenda e na timeline dos negócios
                                        (Ligação, Reunião, Demo, Follow-up...).
                                    </Text>
                                    <TiposAtividadeConfig />
                                </div>
                            ),
                        },
                    ]}
                />
            </Card>
        </div>
    );
};
