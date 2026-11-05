import { Form, Input, InputNumber, Switch, Tag } from "antd";
import { useCrmAccess } from "../../../hooks/useCrmAccess";
import { RECURSO_CANAIS } from "../../../lib/origemLead";
import { ConfigCrudTable, type ConfigRecord } from "./config-crud-table";

type CanalRecord = ConfigRecord & { nome?: string | null; ordem?: number | null; ativo?: boolean | null };

export const CanaisOrigemConfig = () => {
    const { canDeleteRecords } = useCrmAccess();
    const [form] = Form.useForm();

    return (
        <ConfigCrudTable<CanalRecord>
            resource={RECURSO_CANAIS}
            titulo="Origens do lead"
            descricaoVazio="Cadastre por onde os clientes chegam (Instagram, Google, Indicação...). O vendedor escolhe a origem no cadastro do lead."
            canManage={canDeleteRecords}
            form={form}
            columns={[
                { title: "Origem", dataIndex: "nome" },
                { title: "Ordem", dataIndex: "ordem", width: 90 },
                {
                    title: "Status",
                    dataIndex: "ativo",
                    width: 110,
                    render: (ativo: boolean | null) =>
                        ativo === false ? <Tag>Inativo</Tag> : <Tag color="green">Ativo</Tag>,
                },
            ]}
            toFormValues={(record) => ({
                nome: record.nome,
                ordem: record.ordem ?? 1,
                ativo: record.ativo !== false,
            })}
            fromFormValues={(values) => ({
                nome: String(values.nome ?? "").trim(),
                ordem: values.ordem ?? 1,
                ativo: values.ativo !== false,
            })}
            renderFormItems={() => (
                <>
                    <Form.Item
                        label="Origem"
                        name="nome"
                        rules={[{ required: true, whitespace: true, message: "Informe a origem." }]}
                        extra="Para tirar uma origem da lista sem perder o histórico dos leads, desative em vez de remover."
                    >
                        <Input maxLength={60} placeholder="Ex.: Feira de energia, Parceiro instalador" />
                    </Form.Item>
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
