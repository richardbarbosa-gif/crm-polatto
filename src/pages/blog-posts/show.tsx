import { DateField, Show, useForm } from "@refinedev/antd";
import { useShow } from "@refinedev/core";
import { Typography, Tag, Button, Space, Card, Divider, Skeleton, Modal, Form, Input, Select, DatePicker, message } from "antd";
import { EnvironmentOutlined, CalendarOutlined, PhoneOutlined, GoogleOutlined, UserOutlined } from "@ant-design/icons";
import { useState } from "react";

const { Title, Text } = Typography;

// --- MODAL DE AGENDA ---
interface ModalAgendaProps { open: boolean; onClose: () => void; clienteId: number; clienteNome: string; }

const ModalAgenda = ({ open, onClose, clienteId, clienteNome }: ModalAgendaProps) => {
    const { formProps, form } = useForm({
        resource: "tarefas", action: "create", redirect: false,
        onMutationSuccess: () => { message.success("✅ Agendamento salvo!"); form.resetFields(); onClose(); }
    });
    return (
        <Modal title={`📅 Tarefa: ${clienteNome}`} open={open} onOk={() => form.submit()} onCancel={onClose} okText="Salvar" cancelText="Cancelar" okButtonProps={{ style: { backgroundColor: "#25D366" } }}>
            <Form {...formProps} layout="vertical">
                <Form.Item name="cliente_id" initialValue={clienteId} hidden><Input /></Form.Item>
                <Form.Item label="O que fazer?" name="titulo" rules={[{ required: true }]}><Input placeholder="Ex: Visita Técnica" /></Form.Item>
                <div style={{ display: 'flex', gap: 10 }}>
                    <Form.Item label="Tipo" name="tipo" style={{ flex: 1 }} initialValue="visita"><Select options={[{ value: 'visita', label: '📍 Visita' }, { value: 'ligacao', label: '📞 Ligação' }, { value: 'whatsapp', label: '💬 WhatsApp' }]} /></Form.Item>
                    <Form.Item label="Data" name="data_vencimento" style={{ flex: 1 }} rules={[{ required: true }]}><DatePicker showTime format="DD/MM/YYYY HH:mm" style={{ width: '100%' }} /></Form.Item>
                </div>
                <Form.Item label="Obs" name="descricao"><Input.TextArea rows={2} /></Form.Item>
            </Form>
        </Modal>
    );
};

// --- PÁGINA PRINCIPAL ---
export const BlogPostShow = () => {
  const showResult = useShow() as any;
  const { data, isLoading } = showResult.query || showResult;
  const record = data?.data;
  const [isModalOpen, setIsModalOpen] = useState(false);

  const abrirNoMapa = () => {
    // Monta o endereço completo para o Google não se perder
    const endereco = `${record.endereco_instalacao}, ${record.numero || ''} - ${record.cep || ''}`;
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(endereco)}`;
    window.open(url, '_blank');
  };

  if (isLoading) return <Show isLoading={true}><Skeleton active /></Show>;

  return (
    <Show isLoading={isLoading} title="Detalhes do Cliente">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <Tag color="blue" style={{ fontSize: 16, padding: "5px 15px" }}>{record?.status || "Novo Lead"}</Tag>
          <Button type="primary" icon={<CalendarOutlined />} onClick={() => setIsModalOpen(true)} size="large" style={{ backgroundColor: "#25D366", borderColor: "#25D366", fontWeight: "bold" }}>
            Agendar Visita
          </Button>
      </div>

      <Card bordered={false} style={{ borderRadius: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div>
                <Title level={3} style={{ margin: 0 }}>{record?.nome}</Title>
                <Space style={{ marginTop: 5 }}>
                    <Text type="secondary" style={{ fontSize: 16 }}><PhoneOutlined /> {record?.ddi} {record?.telefone}</Text>
                    {record?.responsavel && <Tag icon={<UserOutlined />} color="purple">{record.responsavel}</Tag>}
                </Space>
            </div>
            <div style={{ textAlign: "right" }}>
                <Text type="secondary">Conta Média</Text>
                <div style={{ fontSize: 28, fontWeight: "bold", color: "#389e0d" }}>
                    {Number(record?.conta_energia_media).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </div>
            </div>
          </div>
          
          <Divider />

          <div style={{ background: "#f5f5f5", padding: 20, borderRadius: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                      <Title level={5} style={{ margin: 0 }}><EnvironmentOutlined /> Local da Instalação</Title>
                      <Text style={{ fontSize: 16 }}>
                        {record?.endereco_instalacao}, {record?.numero} {record?.complemento ? `- ${record.complemento}` : ''}
                      </Text>
                      <br/>
                      <Text type="secondary">CEP: {record?.cep}</Text>
                  </div>
                  <Button type="primary" ghost icon={<GoogleOutlined />} onClick={abrirNoMapa}>
                    Ver no Mapa
                  </Button>
              </div>
          </div>

          <Divider />
          <Space split={<Divider type="vertical" />}>
            <div><Text type="secondary">E-mail</Text><br /><Text strong>{record?.email || "-"}</Text></div>
            <div><Text type="secondary">CPF/CNPJ</Text><br /><Text strong>{record?.cpf_cnpj || "-"}</Text></div>
            <div><Text type="secondary">Cadastro</Text><br /><DateField value={record?.created_at} format="DD/MM/YYYY" /></div>
          </Space>
      </Card>

      {record?.id && <ModalAgenda open={isModalOpen} onClose={() => setIsModalOpen(false)} clienteId={Number(record.id)} clienteNome={record.nome} />}
    </Show>
  );
};