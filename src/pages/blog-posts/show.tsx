import { DateField, Show, TextField } from "@refinedev/antd";
import { useList, useShow } from "@refinedev/core";
import { Typography, Tag, Timeline, Divider } from "antd";

const { Title, Text } = Typography;

export const BlogPostShow = () => {
  // CORREÇÃO AQUI: Mudamos de 'queryResult' para 'query'
  const { query } = useShow();
  const { data, isLoading } = query;

  const record = data?.data;

  const { query: historyQuery } = useList({
    resource: "cliente_status_history",
    filters: [
      { field: "cliente_id", operator: "eq", value: record?.id },
    ],
    sorters: [{ field: "movido_em", order: "desc" }],
    queryOptions: { enabled: !!record?.id },
  });

  const historico = (historyQuery?.data?.data as any[]) || [];
  const mostrarHistorico = historyQuery?.isSuccess && historico.length > 0;
  const mostrarSemHistorico = historyQuery?.isSuccess && historico.length === 0;

  // Função segura para formatar dinheiro
  const formatarDinheiro = (valor: any) => {
    if (!valor) return "R$ 0,00";
    return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  const formatarDataHora = (valor?: string) => {
    if (!valor) return "Data indisponível";
    return new Date(valor).toLocaleString("pt-BR");
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

      <Title level={5} style={{ marginTop: "20px" }}>Responsável</Title>
      <TextField value={record?.responsavel || "Não definido"} />

      <Title level={5} style={{ marginTop: "20px" }}>Cliente Cadastrado em</Title>
      <DateField value={record?.created_at} format="DD/MM/YYYY HH:mm" />

      <Divider />
      <Title level={5}>Histórico de Movimentações</Title>
      {mostrarHistorico ? (
        <Timeline
          items={historico.map((item) => ({
            children: (
              <div>
                <Text strong>{item.de_status}{" -> "}{item.para_status}</Text>
                <div style={{ fontSize: "12px", color: "#667085" }}>
                  {item.movido_por ? `por ${item.movido_por} - ` : ""}{formatarDataHora(item.movido_em)}
                </div>
              </div>
            ),
          }))}
        />
      ) : mostrarSemHistorico ? (
        <Text type="secondary">Sem histórico</Text>
      ) : null}

    </Show>
  );
};
