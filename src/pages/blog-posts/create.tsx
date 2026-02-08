import { Create, useForm } from "@refinedev/antd";
import { Form, Input, Select, InputNumber } from "antd";

export const BlogPostCreate = () => {
  const { formProps, saveButtonProps } = useForm();

  return (
    <Create saveButtonProps={saveButtonProps}>
      <Form {...formProps} layout="vertical">
        
        {/* Campo NOME */}
        <Form.Item
          label="Nome Completo"
          name="nome"
          rules={[
            {
              required: true,
              message: "Por favor, insira o nome do cliente.",
            },
          ]}
        >
          <Input />
        </Form.Item>

        {/* Campo EMAIL */}
        <Form.Item
          label="E-mail"
          name="email"
          rules={[
            {
              required: true,
              message: "Por favor, insira o e-mail.",
            },
          ]}
        >
          <Input />
        </Form.Item>

        {/* Campo TELEFONE */}
        <Form.Item
          label="Telefone / WhatsApp"
          name="telefone"
        >
          <Input />
        </Form.Item>

        {/* Campo CPF/CNPJ */}
        <Form.Item
          label="CPF ou CNPJ"
          name="cpf_cnpj"
        >
          <Input />
        </Form.Item>

        {/* Campo ENDEREÇO */}
        <Form.Item
          label="Endereço de Instalação"
          name="endereco_instalacao"
        >
          <Input />
        </Form.Item>

        {/* Campo CONTA DE ENERGIA */}
        <Form.Item
          label="Média da Conta de Energia (R$)"
          name="conta_energia_media"
        >
             {/* O InputNumber lida melhor com números/dinheiro */}
             <InputNumber 
                style={{ width: "200px" }} 
                formatter={(value) => `R$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                parser={(value) => value!.replace(/\R\$\s?|(,*)/g, '')}
             />
        </Form.Item>

        {/* Campo STATUS */}
        <Form.Item
          label="Status da Negociação"
          name="status"
          initialValue="Novo Lead"
        >
          <Select
            options={[
              { value: "Novo Lead", label: "Novo Lead (Chegou agora)" },
              { value: "Em Negociação", label: "Em Negociação" },
              { value: "Visita Agendada", label: "Visita Agendada" },
              { value: "Fechado", label: "✅ Fechado / Ganho" },
              { value: "Perdido", label: "❌ Perdido" },
            ]}
          />
        </Form.Item>

      </Form>
    </Create>
  );
};