import { DateField, Show, TextField } from "@refinedev/antd";
import { useShow } from "@refinedev/core";
import { Typography, Tag } from "antd";

const { Title } = Typography;

export const BlogPostShow = () => {
  // CORREÇÃO AQUI: Mudamos de 'queryResult' para 'query'
  const { query } = useShow();
  const { data, isLoading } = query;

  const record = data?.data;

  // Função segura para formatar dinheiro
  const formatarDinheiro = (valor: any) => {
    if (!valor) return "R$ 0,00";
    return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  return (
    <Show isLoading={isLoading}>
      
      <Title level={5}>Nome do Cliente</Title>
      <TextField value={record?.nome} />

      <Title level={5} style={{ marginTop: "20px" }}>Status</Title>
      <Tag color={record?.status === "Fechado" ? "green" : "blue"}>
        {record?.status || "Sem Status"}
      </Tag>

      <Title level={5} style={{ marginTop: "20px" }}>E-mail</Title>
      <TextField value={record?.email} />

      <Title level={5} style={{ marginTop: "20px" }}>Telefone</Title>
      <TextField value={record?.telefone} />

      <Title level={5} style={{ marginTop: "20px" }}>CPF / CNPJ</Title>
      <TextField value={record?.cpf_cnpj} />

      <Title level={5} style={{ marginTop: "20px" }}>Endereço</Title>
      <TextField value={record?.endereco_instalacao} />

      <Title level={5} style={{ marginTop: "20px" }}>Média da Conta (R$)</Title>
      <TextField value={formatarDinheiro(record?.conta_energia_media)} />

      <Title level={5} style={{ marginTop: "20px" }}>Cliente Cadastrado em</Title>
      <DateField value={record?.created_at} format="DD/MM/YYYY HH:mm" />

    </Show>
  );
};