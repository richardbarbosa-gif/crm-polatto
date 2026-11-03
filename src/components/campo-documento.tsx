import { Col, Form, Input, Radio, Row, type FormInstance } from "antd";
import { formatarDocumento, regraCpfCnpj, somenteDigitos, type TipoPessoa } from "../lib/documentos";

type CampoDocumentoProps = {
    form: FormInstance;
    tipo: TipoPessoa;
    onTipoChange: (tipo: TipoPessoa) => void;
    size?: "large" | "middle";
};

/**
 * Tipo de cliente + documento obrigatório (regra do Richard):
 * pessoa física cadastra CPF; empresa cadastra CNPJ. Os dígitos verificadores
 * são conferidos. O tipo não vai para o banco: é inferido do documento salvo.
 */
export const CampoDocumento = ({ form, tipo, onTipoChange, size = "large" }: CampoDocumentoProps) => {
    const ehPf = tipo === "pf";

    const trocarTipo = (novo: TipoPessoa) => {
        onTipoChange(novo);
        const atual = form.getFieldValue("cpf_cnpj") as string | undefined;
        if (somenteDigitos(atual)) {
            form.setFieldValue("cpf_cnpj", formatarDocumento(atual, novo));
            // revalida com a regra do novo tipo (CPF x CNPJ)
            setTimeout(() => void form.validateFields(["cpf_cnpj"]).catch(() => undefined), 0);
        }
    };

    return (
        <Row gutter={20}>
            <Col xs={24} lg={12}>
                <Form.Item label="Tipo de cliente" required>
                    <Radio.Group
                        value={tipo}
                        onChange={(e) => trocarTipo(e.target.value as TipoPessoa)}
                        optionType="button"
                        buttonStyle="solid"
                        size={size}
                        options={[
                            { value: "pf", label: "Pessoa física" },
                            { value: "pj", label: "Empresa" },
                        ]}
                    />
                </Form.Item>
            </Col>
            <Col xs={24} lg={12}>
                <Form.Item
                    label={ehPf ? "CPF" : "CNPJ"}
                    name="cpf_cnpj"
                    rules={[
                        { required: true, message: ehPf ? "Informe o CPF." : "Informe o CNPJ." },
                        regraCpfCnpj(ehPf ? "cpf" : "cnpj"),
                    ]}
                >
                    <Input
                        size={size}
                        maxLength={ehPf ? 14 : 18}
                        placeholder={ehPf ? "000.000.000-00" : "00.000.000/0000-00"}
                        inputMode="numeric"
                        onChange={(e) => form.setFieldValue("cpf_cnpj", formatarDocumento(e.target.value, tipo))}
                    />
                </Form.Item>
            </Col>
        </Row>
    );
};
