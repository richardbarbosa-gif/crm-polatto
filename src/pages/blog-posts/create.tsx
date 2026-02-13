import { Create, useForm } from "@refinedev/antd";
import { Form, Input, Select, InputNumber, Row, Col, message } from "antd";
import { useState, useRef } from "react";

export const BlogPostCreate = () => {
    const { formProps, saveButtonProps, form } = useForm();
    const [paisSelecionado, setPaisSelecionado] = useState("+55");
    const numeroInputRef = useRef<any>(null);

    // --- MÁSCARAS ---
    const formatarTelefone = (valor: string, pais: string) => {
        let v = valor.replace(/\D/g, "");
        if (pais === "+55") { 
            v = v.replace(/^(\d{2})(\d)/g, "($1) $2");
            v = v.replace(/(\d)(\d{4})$/, "$1-$2");
            return v.substring(0, 15);
        } else if (pais === "+1") {
            v = v.replace(/^(\d{3})(\d)/g, "($1) $2");
            v = v.replace(/(\d)(\d{4})$/, "$1-$2");
            return v.substring(0, 14);
        }
        return v;
    };

    const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const valorFormatado = formatarTelefone(e.target.value, paisSelecionado);
        form.setFieldValue("telefone", valorFormatado);
    };

    const handleCepChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const cepRaw = e.target.value.replace(/\D/g, '');
        form.setFieldValue("cep", cepRaw.replace(/^(\d{5})(\d)/, "$1-$2"));

        if (cepRaw.length === 8) {
            try {
                const response = await fetch(`https://viacep.com.br/ws/${cepRaw}/json/`);
                const data = await response.json();
                if (!data.erro) {
                    form.setFieldValue("endereco_instalacao", `${data.logradouro}, ${data.bairro}, ${data.localidade} - ${data.uf}`);
                    message.success("📍 Endereço encontrado!");
                    setTimeout(() => numeroInputRef.current?.focus(), 100);
                }
            } catch (error) { console.error(error); }
        }
    };

    // --- SELETOR DE PAÍS ---
    const selectPais = (
        <Form.Item name="ddi" noStyle initialValue="+55">
            <Select style={{ width: 100 }} onChange={(v) => { setPaisSelecionado(v); form.setFieldValue("telefone", ""); }}>
                <Select.Option value="+55">🇧🇷 +55</Select.Option>
                <Select.Option value="+1">🇺🇸 +1</Select.Option>
                <Select.Option value="+351">🇵🇹 +351</Select.Option>
            </Select>
        </Form.Item>
    );

    return (
        <Create saveButtonProps={saveButtonProps} title="Novo Cliente Solar">
            <Form {...formProps} layout="vertical">
                <Row gutter={20}>
                    <Col xs={24} lg={12}><Form.Item label="Nome Completo" name="nome" rules={[{ required: true }]}><Input size="large" /></Form.Item></Col>
                    <Col xs={24} lg={12}><Form.Item label="CPF ou CNPJ" name="cpf_cnpj" rules={[{ required: true }]}><Input size="large" /></Form.Item></Col>
                </Row>

                <Row gutter={20}>
                    <Col xs={24} lg={12}>
                        <Form.Item label="WhatsApp / Telefone" name="telefone" rules={[{ required: true }]}>
                            <Input addonBefore={selectPais} size="large" onChange={handlePhoneChange} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} lg={12}><Form.Item label="E-mail" name="email"><Input size="large" /></Form.Item></Col>
                </Row>

                {/* ENDEREÇO */}
                <div style={{ background: "#f8f9fa", padding: "15px", borderRadius: "8px", marginBottom: "20px", border: "1px solid #ddd" }}>
                    <Row gutter={15}>
                        <Col xs={24} lg={5}><Form.Item label="CEP" name="cep" rules={[{ required: true }]}><Input onChange={handleCepChange} maxLength={9} /></Form.Item></Col>
                        <Col xs={24} lg={13}><Form.Item label="Logradouro" name="endereco_instalacao" rules={[{ required: true }]}><Input readOnly /></Form.Item></Col>
                        <Col xs={24} lg={3}><Form.Item label="Número" name="numero" rules={[{ required: true }]}><Input ref={numeroInputRef} /></Form.Item></Col>
                        <Col xs={24} lg={3}><Form.Item label="Compl." name="complemento"><Input /></Form.Item></Col>
                    </Row>
                </div>

                <Row gutter={20}>
                    <Col xs={24} lg={8}>
                        <Form.Item label="Média da Conta (R$)" name="conta_energia_media" rules={[{ required: true }]}>
                            <InputNumber style={{ width: "100%" }} size="large" formatter={v => `R$ ${v}`} parser={v => v!.replace('R$ ', '')} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} lg={8}>
                        <Form.Item label="Responsável" name="responsavel">
                            <Input placeholder="Ex: João (Comercial)" size="large" />
                        </Form.Item>
                    </Col>
                    <Col xs={24} lg={8}>
                        <Form.Item label="Status Inicial" name="status" initialValue="Novo Lead">
                            <Select size="large" options={[
                                { value: "Novo Lead", label: "🟦 Novo Lead" },
                                { value: "Visita Agendada", label: "🟨 Visita Agendada" },
                                { value: "Em Negociação", label: "🟧 Em Negociação" },
                                { value: "Fechado", label: "✅ Fechado" },
                                { value: "Perdido", label: "❌ Perdido" },
                            ]} />
                        </Form.Item>
                    </Col>
                </Row>
            </Form>
        </Create>
    );
};