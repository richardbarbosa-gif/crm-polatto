import { Form, Input, InputNumber, Switch, Tag } from "antd";
import { useCrmAccess } from "../../../hooks/useCrmAccess";
import { formatCurrencyBRL } from "../../../lib/formatters";
import { propsMoeda } from "../../../lib/moedaInput";
import { ConfigCrudTable, type ConfigRecord } from "./config-crud-table";

type ProdutoRecord = ConfigRecord & {
    nome?: string | null;
    descricao?: string | null;
    unidade?: string | null;
    preco_padrao?: number | string | null;
    ativo?: boolean | null;
};

/**
 * Catálogo de produtos e serviços usado nos orçamentos. Todo o time lê;
 * só gerente/admin cadastra (a RLS do banco garante, a tela só esconde).
 * Item de orçamento guarda cópia de descrição e preço: mudar ou apagar um
 * produto não altera proposta já emitida.
 */
export const ProdutosConfig = () => {
    const { isGerente: ehAdmin } = useCrmAccess();
    const [form] = Form.useForm();

    return (
        <ConfigCrudTable<ProdutoRecord>
            resource="produtos"
            titulo="Produtos e serviços"
            descricaoVazio="Cadastre o que a empresa vende para montar orçamentos em poucos cliques. Ex.: Módulo 550 W, Inversor 8 kW, Instalação."
            canManage={ehAdmin}
            form={form}
            sorters={[{ field: "nome", order: "asc" }]}
            columns={[
                {
                    title: "Produto ou serviço",
                    dataIndex: "nome",
                    render: (nome: string, record) => (
                        <div>
                            <div style={{ fontWeight: 600 }}>{nome}</div>
                            {record.descricao ? (
                                <div style={{ color: "var(--crm-ink-500)", fontSize: 12 }}>{record.descricao}</div>
                            ) : null}
                        </div>
                    ),
                },
                { title: "Unidade", dataIndex: "unidade", width: 100 },
                {
                    title: "Preço padrão",
                    dataIndex: "preco_padrao",
                    width: 150,
                    align: "right",
                    render: (preco: number | string | null) => formatCurrencyBRL(preco, "R$ 0,00"),
                },
                {
                    title: "Status",
                    dataIndex: "ativo",
                    width: 100,
                    render: (ativo: boolean | null) => (ativo === false ? <Tag>Inativo</Tag> : <Tag color="green">Ativo</Tag>),
                },
            ]}
            toFormValues={(record) => ({
                nome: record.nome,
                descricao: record.descricao ?? "",
                unidade: record.unidade ?? "un",
                preco_padrao: Number(record.preco_padrao ?? 0),
                ativo: record.ativo !== false,
            })}
            fromFormValues={(values) => ({
                nome: String(values.nome ?? "").trim(),
                descricao: String(values.descricao ?? "").trim() || null,
                unidade: String(values.unidade ?? "").trim() || "un",
                preco_padrao: Math.round(Number(values.preco_padrao ?? 0) * 100) / 100,
                ativo: values.ativo !== false,
            })}
            renderFormItems={() => (
                <>
                    <Form.Item
                        label="Nome"
                        name="nome"
                        rules={[
                            { required: true, whitespace: true, message: "Informe o nome." },
                            { max: 200, message: "Até 200 caracteres." },
                        ]}
                    >
                        <Input maxLength={200} placeholder="Ex.: Módulo fotovoltaico 550 W" />
                    </Form.Item>
                    <Form.Item label="Descrição (vai para os detalhes do item no PDF)" name="descricao" rules={[{ max: 2000 }]}>
                        <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} maxLength={2000} placeholder="Marca, modelo, garantia..." />
                    </Form.Item>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 12 }}>
                        <Form.Item
                            label="Unidade"
                            name="unidade"
                            initialValue="un"
                            rules={[
                                { required: true, whitespace: true, message: "Informe a unidade." },
                                { max: 20, message: "Até 20 caracteres." },
                            ]}
                        >
                            <Input maxLength={20} placeholder="un, m², kWp, serviço" />
                        </Form.Item>
                        <Form.Item label="Preço padrão" name="preco_padrao" initialValue={0} rules={[{ required: true, message: "Informe o preço." }]}>
                            <InputNumber {...propsMoeda} max={999999999999} />
                        </Form.Item>
                    </div>
                    <Form.Item label="Ativo (aparece na escolha do orçamento)" name="ativo" valuePropName="checked" initialValue={true}>
                        <Switch />
                    </Form.Item>
                </>
            )}
        />
    );
};
