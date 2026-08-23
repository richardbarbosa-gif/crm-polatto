import { Form, Input, InputNumber, Switch, Tag } from "antd";
import { useCrmAccess } from "../../../hooks/useCrmAccess";
import type { MotivoPerdaRecord } from "../../../types/db";
import { ConfigCrudTable } from "./config-crud-table";

export const MotivosPerdaConfig = () => {
    const { canDeleteRecords } = useCrmAccess();
    const [form] = Form.useForm();

    return (
        <ConfigCrudTable<MotivoPerdaRecord>
            resource="motivos_perda"
            titulo="Motivos de perda"
            descricaoVazio="Cadastre os motivos que o vendedor escolhe ao marcar um negócio como perdido. Ex.: Preço, Escolheu concorrente."
            canManage={canDeleteRecords}
            form={form}
            columns={[
                { title: "Motivo", dataIndex: "nome" },
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
            renderFormItems={() => (
                <>
                    <Form.Item
                        label="Motivo"
                        name="nome"
                        rules={[{ required: true, message: "Informe o motivo." }]}
                    >
                        <Input placeholder="Ex.: Telhado não compatível" />
                    </Form.Item>
                    <Form.Item label="Ordem" name="ordem" initialValue={1}>
                        <InputNumber min={1} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item label="Ativo" name="ativo" valuePropName="checked" initialValue={true}>
                        <Switch />
                    </Form.Item>
                </>
            )}
        />
    );
};
