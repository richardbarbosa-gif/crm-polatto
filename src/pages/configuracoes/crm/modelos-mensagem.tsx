import { MailOutlined, WhatsAppOutlined } from "@ant-design/icons";
import { Form, Input, InputNumber, Select, Switch, Tag, Typography } from "antd";
import { useCrmAccess } from "../../../hooks/useCrmAccess";
import {
    aplicarModelo,
    montarDadosModelo,
    VARIAVEIS_MODELO,
    type CanalModelo,
} from "../../../lib/modelosMensagem";
import { ConfigCrudTable, type ConfigRecord } from "./config-crud-table";

const { Text } = Typography;

type ModeloRecord = ConfigRecord & {
    nome?: string | null;
    canal?: CanalModelo | null;
    assunto?: string | null;
    texto?: string | null;
    ativo?: boolean | null;
    ordem?: number | null;
};

// Dados de exemplo só para a prévia na configuração
const EXEMPLO = montarDadosModelo({
    nomeCliente: "Maria da Silva",
    empresa: "Sua Empresa Solar",
    vendedor: "Ana",
    valor: 28500,
    propostaNumero: "2026-0007",
    validade: "2026-12-20",
});

const PreviaModelo = () => {
    const form = Form.useFormInstance();
    const texto = Form.useWatch("texto", form) as string | undefined;
    const assunto = Form.useWatch("assunto", form) as string | undefined;
    const canal = Form.useWatch("canal", form) as CanalModelo | undefined;
    if (!texto?.trim()) return null;
    return (
        <div
            style={{
                background: "var(--crm-surface-2, #f5f7fa)",
                border: "1px solid var(--crm-border, #e7edf5)",
                borderRadius: 10,
                padding: 12,
                marginBottom: 12,
            }}
        >
            <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 6 }}>
                Prévia com dados de exemplo
            </Text>
            {canal === "email" && assunto?.trim() ? (
                <Text strong style={{ display: "block", marginBottom: 6 }}>
                    {aplicarModelo(assunto, EXEMPLO)}
                </Text>
            ) : null}
            <Text style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{aplicarModelo(texto, EXEMPLO)}</Text>
        </div>
    );
};

export const ModelosMensagemConfig = () => {
    const { canDeleteRecords } = useCrmAccess();
    const [form] = Form.useForm();

    return (
        <ConfigCrudTable<ModeloRecord>
            resource="modelos_mensagem"
            titulo="Modelos de mensagem"
            descricaoVazio="Cadastre mensagens prontas para WhatsApp e e-mail. O vendedor escolhe o modelo antes de abrir a conversa."
            canManage={canDeleteRecords}
            form={form}
            sorters={[
                { field: "canal", order: "desc" },
                { field: "ordem", order: "asc" },
            ]}
            columns={[
                { title: "Modelo", dataIndex: "nome" },
                {
                    title: "Canal",
                    dataIndex: "canal",
                    width: 130,
                    render: (canal: CanalModelo | null) =>
                        canal === "email" ? (
                            <Tag icon={<MailOutlined />}>E-mail</Tag>
                        ) : (
                            <Tag icon={<WhatsAppOutlined />} color="green">
                                WhatsApp
                            </Tag>
                        ),
                },
                { title: "Ordem", dataIndex: "ordem", width: 80 },
                {
                    title: "Status",
                    dataIndex: "ativo",
                    width: 100,
                    render: (ativo: boolean | null) =>
                        ativo === false ? <Tag>Inativo</Tag> : <Tag color="green">Ativo</Tag>,
                },
            ]}
            toFormValues={(record) => ({
                nome: record.nome,
                canal: record.canal ?? "whatsapp",
                assunto: record.assunto ?? undefined,
                texto: record.texto,
                ordem: record.ordem ?? 1,
                ativo: record.ativo !== false,
            })}
            fromFormValues={(values) => ({
                nome: String(values.nome ?? "").trim(),
                canal: values.canal,
                assunto: values.canal === "email" ? String(values.assunto ?? "").trim() || null : null,
                texto: String(values.texto ?? "").trim(),
                ordem: values.ordem ?? 1,
                ativo: values.ativo !== false,
            })}
            renderFormItems={() => (
                <>
                    <Form.Item
                        label="Nome do modelo"
                        name="nome"
                        rules={[{ required: true, whitespace: true, message: "Informe o nome." }]}
                    >
                        <Input maxLength={80} placeholder="Ex.: Primeiro contato" />
                    </Form.Item>
                    <Form.Item label="Canal" name="canal" initialValue="whatsapp" rules={[{ required: true }]}>
                        <Select
                            options={[
                                { value: "whatsapp", label: "WhatsApp" },
                                { value: "email", label: "E-mail" },
                            ]}
                        />
                    </Form.Item>
                    <Form.Item noStyle shouldUpdate={(a, b) => a.canal !== b.canal}>
                        {({ getFieldValue }) =>
                            getFieldValue("canal") === "email" ? (
                                <Form.Item label="Assunto do e-mail" name="assunto">
                                    <Input maxLength={200} placeholder="Ex.: Sua proposta de energia solar - {empresa}" />
                                </Form.Item>
                            ) : null
                        }
                    </Form.Item>
                    <Form.Item
                        label="Texto"
                        name="texto"
                        rules={[{ required: true, whitespace: true, message: "Escreva a mensagem." }]}
                        extra={
                            <span>
                                Variáveis:{" "}
                                {VARIAVEIS_MODELO.map((v) => (
                                    <Tag key={v.chave} title={v.descricao} style={{ marginTop: 4 }}>
                                        {`{${v.chave}}`}
                                    </Tag>
                                ))}
                            </span>
                        }
                    >
                        <Input.TextArea autoSize={{ minRows: 4, maxRows: 10 }} maxLength={4000} showCount />
                    </Form.Item>
                    <PreviaModelo />
                    <Form.Item label="Ordem" name="ordem" initialValue={1}>
                        <InputNumber min={0} max={9999} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item label="Ativo" name="ativo" valuePropName="checked" initialValue={true}>
                        <Switch />
                    </Form.Item>
                </>
            )}
        />
    );
};
