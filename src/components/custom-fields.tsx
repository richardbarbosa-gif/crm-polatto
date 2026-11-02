import { DatePicker, Form, Input, InputNumber, Select, Switch, Typography } from "antd";
import dayjs from "dayjs";
import type { CustomFieldRecord } from "../types/db";

const { Text } = Typography;

type CustomFieldsFormProps = {
    campos: CustomFieldRecord[];
    /** Título da seção. Passe null para embutir sem cabeçalho. */
    titulo?: string | null;
};

const opcoesDoCampo = (campo: CustomFieldRecord) =>
    (Array.isArray(campo.opcoes) ? campo.opcoes : []).map((opcao) => ({
        value: String(opcao),
        label: String(opcao),
    }));

/**
 * Renderiza os campos que o tenant definiu em Configurações.
 *
 * Os valores vivem em dados_extras (jsonb), por isso o name é o caminho
 * aninhado ["dados_extras", chave] — o antd monta o objeto sozinho e o
 * payload sai pronto para o banco.
 */
export const CustomFieldsForm = ({ campos, titulo = "Informações adicionais" }: CustomFieldsFormProps) => {
    if (!campos.length) return null;

    return (
        <>
            {titulo ? (
                <div className="crm-form-section-title" style={{ marginTop: 8, marginBottom: 4 }}>
                    <Text strong>{titulo}</Text>
                </div>
            ) : null}

            {campos.map((campo) => {
                const name = ["dados_extras", campo.chave];
                const rules = campo.obrigatorio
                    ? [{ required: true, message: `Informe ${campo.label}.` }]
                    : undefined;

                if (campo.tipo === "numero") {
                    return (
                        <Form.Item key={campo.id} label={campo.label} name={name} rules={rules}>
                            <InputNumber style={{ width: "100%" }} placeholder={campo.label} />
                        </Form.Item>
                    );
                }

                if (campo.tipo === "data") {
                    return (
                        <Form.Item key={campo.id} label={campo.label} name={name} rules={rules}>
                            <DatePicker style={{ width: "100%" }} format="DD/MM/YYYY" placeholder="Selecione" />
                        </Form.Item>
                    );
                }

                if (campo.tipo === "select") {
                    return (
                        <Form.Item key={campo.id} label={campo.label} name={name} rules={rules}>
                            <Select
                                options={opcoesDoCampo(campo)}
                                allowClear
                                showSearch
                                optionFilterProp="label"
                                placeholder="Selecione"
                            />
                        </Form.Item>
                    );
                }

                if (campo.tipo === "boolean") {
                    return (
                        <Form.Item
                            key={campo.id}
                            label={campo.label}
                            name={name}
                            valuePropName="checked"
                            rules={rules}
                        >
                            <Switch />
                        </Form.Item>
                    );
                }

                return (
                    <Form.Item key={campo.id} label={campo.label} name={name} rules={rules}>
                        <Input placeholder={campo.label} />
                    </Form.Item>
                );
            })}
        </>
    );
};

/**
 * Converte os valores gravados em dados_extras para o formato que o
 * formulário espera (datas precisam voltar como Dayjs).
 */
export const dadosExtrasParaFormulario = (
    dadosExtras: Record<string, unknown> | null | undefined,
    campos: CustomFieldRecord[],
    // O retorno usa NonNullable porque o setFieldsValue do antd (RecursivePartial)
    // não aceita `unknown` em valor aninhado — e nunca devolvemos null aqui.
): Record<string, NonNullable<unknown>> => {
    const origem = dadosExtras || {};
    const saida: Record<string, NonNullable<unknown>> = {};

    campos.forEach((campo) => {
        const valor = origem[campo.chave];
        if (valor === undefined || valor === null) return;
        if (campo.tipo === "data") {
            const data = dayjs(String(valor));
            if (data.isValid()) saida[campo.chave] = data;
            return;
        }
        saida[campo.chave] = valor;
    });

    return saida;
};

type CustomFieldsViewProps = {
    campos: CustomFieldRecord[];
    dadosExtras?: Record<string, unknown> | null;
};

/** Exibição somente leitura, para telas de detalhe. */
export const CustomFieldsView = ({ campos, dadosExtras }: CustomFieldsViewProps) => {
    const preenchidos = campos.filter((campo) => {
        const valor = (dadosExtras || {})[campo.chave];
        return valor !== undefined && valor !== null && valor !== "";
    });

    if (!preenchidos.length) return null;

    return (
        <div style={{ display: "grid", gap: 8 }}>
            {preenchidos.map((campo) => {
                const valor = (dadosExtras || {})[campo.chave];
                let exibicao: string;

                if (campo.tipo === "boolean") {
                    exibicao = valor ? "Sim" : "Não";
                } else if (campo.tipo === "data") {
                    const data = dayjs(String(valor));
                    exibicao = data.isValid() ? data.format("DD/MM/YYYY") : String(valor);
                } else {
                    exibicao = String(valor);
                }

                return (
                    <div
                        key={campo.id}
                        style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
                    >
                        <Text type="secondary" style={{ fontSize: 12.5 }}>
                            {campo.label}
                        </Text>
                        <Text strong style={{ fontSize: 12.5, textAlign: "right" }}>
                            {exibicao}
                        </Text>
                    </div>
                );
            })}
        </div>
    );
};
