import { Form, Input, InputNumber, Select, Switch, Tag } from "antd";
import { useCrmAccess } from "../../../hooks/useCrmAccess";
import { normalizeText } from "../../../lib/formatters";
import type { CustomFieldRecord } from "../../../types/db";
import { ConfigCrudTable } from "./config-crud-table";

const ENTIDADE_OPTIONS = [
    { value: "negocio", label: "Negócio" },
    { value: "pessoa", label: "Pessoa (contato)" },
    { value: "organizacao", label: "Organização" },
];

const TIPO_OPTIONS = [
    { value: "texto", label: "Texto" },
    { value: "numero", label: "Número" },
    { value: "data", label: "Data" },
    { value: "select", label: "Lista de opções" },
    { value: "boolean", label: "Sim/Não" },
];

const ENTIDADE_LABELS: Record<string, string> = {
    negocio: "Negócio",
    pessoa: "Pessoa",
    organizacao: "Organização",
};

const gerarChave = (label: string): string =>
    normalizeText(label).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

export const CustomFieldsConfig = () => {
    const { canDeleteRecords } = useCrmAccess();
    const [form] = Form.useForm();

    return (
        <ConfigCrudTable<CustomFieldRecord>
            resource="custom_fields"
            titulo="Campos customizados"
            descricaoVazio="Crie campos próprios do seu negócio. Ex.: kWp e Tipo de telhado (solar); MRR e Stack (software)."
            canManage={canDeleteRecords}
            form={form}
            sorters={[{ field: "ordem", order: "asc" }]}
            columns={[
                { title: "Campo", dataIndex: "label" },
                {
                    title: "Entidade",
                    dataIndex: "entidade",
                    width: 130,
                    render: (entidade: string) => <Tag>{ENTIDADE_LABELS[entidade] || entidade}</Tag>,
                },
                {
                    title: "Tipo",
                    dataIndex: "tipo",
                    width: 130,
                    render: (tipo: string) =>
                        TIPO_OPTIONS.find((option) => option.value === tipo)?.label || tipo,
                },
                {
                    title: "Obrigatório",
                    dataIndex: "obrigatorio",
                    width: 110,
                    render: (obrigatorio: boolean | null) => (obrigatorio ? "Sim" : "Não"),
                },
                {
                    title: "Status",
                    dataIndex: "ativo",
                    width: 100,
                    render: (ativo: boolean | null) =>
                        ativo === false ? <Tag>Inativo</Tag> : <Tag color="green">Ativo</Tag>,
                },
            ]}
            toFormValues={(record) => ({
                label: record.label,
                entidade: record.entidade,
                tipo: record.tipo,
                opcoes: Array.isArray(record.opcoes) ? record.opcoes.map(String) : [],
                ordem: record.ordem ?? 1,
                obrigatorio: Boolean(record.obrigatorio),
                ativo: record.ativo !== false,
            })}
            fromFormValues={(values, editando) => ({
                ...values,
                chave: editando?.chave || gerarChave(String(values.label || "")),
                opcoes: Array.isArray(values.opcoes) ? values.opcoes : [],
            })}
            renderFormItems={() => (
                <>
                    <Form.Item
                        label="Nome do campo"
                        name="label"
                        rules={[{ required: true, message: "Informe o nome do campo." }]}
                    >
                        <Input placeholder="Ex.: Potência do sistema (kWp)" />
                    </Form.Item>
                    <Form.Item
                        label="Entidade"
                        name="entidade"
                        initialValue="negocio"
                        rules={[{ required: true }]}
                    >
                        <Select options={ENTIDADE_OPTIONS} />
                    </Form.Item>
                    <Form.Item label="Tipo" name="tipo" initialValue="texto" rules={[{ required: true }]}>
                        <Select options={TIPO_OPTIONS} />
                    </Form.Item>
                    <Form.Item noStyle shouldUpdate={(prev, next) => prev.tipo !== next.tipo}>
                        {({ getFieldValue }) =>
                            getFieldValue("tipo") === "select" ? (
                                <Form.Item
                                    label="Opções da lista"
                                    name="opcoes"
                                    rules={[{ required: true, message: "Informe ao menos uma opção." }]}
                                >
                                    <Select
                                        mode="tags"
                                        placeholder="Digite e pressione Enter para cada opção"
                                        open={false}
                                    />
                                </Form.Item>
                            ) : null
                        }
                    </Form.Item>
                    <Form.Item label="Ordem" name="ordem" initialValue={1}>
                        <InputNumber min={1} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item label="Obrigatório" name="obrigatorio" valuePropName="checked" initialValue={false}>
                        <Switch />
                    </Form.Item>
                    <Form.Item label="Ativo" name="ativo" valuePropName="checked" initialValue={true}>
                        <Switch />
                    </Form.Item>
                </>
            )}
        />
    );
};
