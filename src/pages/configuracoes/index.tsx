import {
    AppstoreOutlined,
    BgColorsOutlined,
    BranchesOutlined,
    CloseCircleOutlined,
    FormOutlined,
    FunnelPlotOutlined,
    IdcardOutlined,
    MessageOutlined,
    ScheduleOutlined,
    SettingOutlined,
    ThunderboltOutlined,
} from "@ant-design/icons";
import { Card, Grid, Select, Switch, Tabs, Typography } from "antd";
import {
    CanaisOrigemConfig,
    CustomFieldsConfig,
    ModelosMensagemConfig,
    MotivosPerdaConfig,
    PipelinesConfig,
    ProdutosConfig,
    TiposAtividadeConfig,
} from "./crm";
import { useContext } from "react";
import { useSearchParams } from "react-router";
import { ColorModeContext } from "../../contexts/color-mode";
import { AutomacoesConfig } from "./automacoes";
import { IdentidadePropostaConfig } from "./identidade-proposta";

const { Title, Text } = Typography;

const sectionTitleStyle = { margin: 0 };

export const ConfiguracoesPage = () => {
    // No celular, um seletor de seção substitui as abas: na lateral o conteúdo
    // ficava espremido e, no topo, só se via 3 abas sem pista de que havia mais.
    const telas = Grid.useBreakpoint();
    const celular = telas.md === false;
    // A aba fica na URL (?aba=funis): os atalhos do checklist de primeiro
    // acesso caem direto na seção certa e o F5 não volta para a primeira.
    const [parametros, setParametros] = useSearchParams();
    const { mode, setMode } = useContext(ColorModeContext);

    const itens = [
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
        {
            key: "origens",
            label: (
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <BranchesOutlined /> Origens do lead
                </span>
            ),
            children: (
                <div className="crm-form-section" style={{ marginBottom: 0 }}>
                    <Title level={4} style={sectionTitleStyle}>
                        Origens do lead
                    </Title>
                    <Text className="crm-form-section-subtitle" type="secondary">
                        Por onde os clientes chegam. O relatório Vendas por origem mostra quanto
                        cada canal traz de leads, vendas e receita.
                    </Text>
                    <CanaisOrigemConfig />
                </div>
            ),
        },
        {
            key: "automacoes",
            label: (
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <ThunderboltOutlined /> Automações
                </span>
            ),
            children: (
                <div className="crm-form-section" style={{ marginBottom: 0 }}>
                    <Title level={4} style={sectionTitleStyle}>
                        Automações do funil
                    </Title>
                    <Text className="crm-form-section-subtitle" type="secondary">
                        Quando algo acontece no funil, o CRM cria a tarefa, muda a temperatura,
                        distribui o lead ou avisa o gerente sozinho. Os modelos prontos vêm
                        desligados: revise e ligue com um clique.
                    </Text>
                    <AutomacoesConfig />
                </div>
            ),
        },
        {
            key: "modelos-mensagem",
            label: (
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <MessageOutlined /> Modelos de mensagem
                </span>
            ),
            children: (
                <div className="crm-form-section" style={{ marginBottom: 0 }}>
                    <Title level={4} style={sectionTitleStyle}>
                        Modelos de mensagem
                    </Title>
                    <Text className="crm-form-section-subtitle" type="secondary">
                        Mensagens prontas para WhatsApp e e-mail. No lead, o vendedor escolhe o
                        modelo, revisa o texto com os dados do cliente e abre a conversa.
                    </Text>
                    <ModelosMensagemConfig />
                </div>
            ),
        },
        {
            key: "identidade-proposta",
            label: (
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <IdcardOutlined /> Identidade e proposta
                </span>
            ),
            children: (
                <div className="crm-form-section" style={{ marginBottom: 0 }}>
                    <Title level={4} style={sectionTitleStyle}>
                        Identidade e proposta
                    </Title>
                    <Text className="crm-form-section-subtitle" type="secondary">
                        Logo, dados, cores e textos padrão que saem em todo PDF de orçamento.
                    </Text>
                    <IdentidadePropostaConfig />
                </div>
            ),
        },
        {
            key: "produtos",
            label: (
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <AppstoreOutlined /> Produtos e serviços
                </span>
            ),
            children: (
                <div className="crm-form-section" style={{ marginBottom: 0 }}>
                    <Title level={4} style={sectionTitleStyle}>
                        Catálogo de produtos e serviços
                    </Title>
                    <Text className="crm-form-section-subtitle" type="secondary">
                        Itens prontos para montar orçamentos. Mudar um preço aqui não altera
                        propostas já emitidas.
                    </Text>
                    <ProdutosConfig />
                </div>
            ),
        },
        {
            key: "aparencia",
            label: (
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <BgColorsOutlined /> Aparência
                </span>
            ),
            children: (
                <div className="crm-form-section" style={{ marginBottom: 0 }}>
                    <Title level={4} style={sectionTitleStyle}>
                        Interface e tema
                    </Title>
                    <Text className="crm-form-section-subtitle" type="secondary">
                        Vale para este navegador: cada pessoa do time escolhe o seu.
                    </Text>
                    <div className="crm-config-row">
                        <div>
                            <Text strong>Modo noturno</Text>
                            <Text type="secondary" style={{ display: "block" }}>
                                Escurece a interface para ambientes de baixa luz.
                            </Text>
                        </div>
                        <Switch
                            aria-label="Modo noturno"
                            checked={mode === "dark"}
                            onChange={(ligado) => setMode(ligado ? "dark" : "light")}
                        />
                    </div>
                </div>
            ),
        },
    ];

    const pedida = parametros.get("aba") ?? "";
    const aba = itens.some((item) => item.key === pedida) ? pedida : itens[0].key;
    const trocarAba = (chave: string) =>
        setParametros(
            (atuais) => {
                const proximos = new URLSearchParams(atuais);
                proximos.set("aba", chave);
                return proximos;
            },
            { replace: true },
        );

    return (
        <div className="crm-page-shell crm-config-page">
            <div className="crm-page-header">
                <div>
                    <Title level={2} className="crm-page-header-title">
                        <SettingOutlined style={{ marginRight: 10, color: "#64748b" }} />
                        Configurações
                    </Title>
                    <Text className="crm-page-header-subtitle">
                        Funis, campos, automações e a identidade das propostas da sua empresa.
                    </Text>
                </div>
            </div>

            <Card bordered={false} className="crm-card">
                {celular ? (
                    <Select
                        className="crm-config-secao"
                        aria-label="Seção das configurações"
                        value={aba}
                        onChange={trocarAba}
                        options={itens.map((item) => ({ value: item.key, label: item.label }))}
                        style={{ width: "100%", marginBottom: 16 }}
                        size="large"
                    />
                ) : null}
                <Tabs
                    activeKey={aba}
                    onChange={trocarAba}
                    tabPosition={celular ? "top" : "left"}
                    renderTabBar={celular ? () => <></> : undefined}
                    items={itens}
                />
            </Card>
        </div>
    );
};
