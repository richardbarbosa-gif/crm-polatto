import { DateField, Show, useForm } from "@refinedev/antd"; // Importe useForm aqui
import { useShow } from "@refinedev/core";
import { Typography, Tag, Button, Space, Card, Divider, Skeleton, Modal, Form, Input, Select, DatePicker, message } from "antd";
import { EnvironmentOutlined, CalendarOutlined, PhoneOutlined, GoogleOutlined } from "@ant-design/icons";
import { useState } from "react";

const { Title, Text } = Typography;

// --- MODAL INTERNO ---
interface ModalAgendaProps {
    open: boolean;
    onClose: () => void;
    clienteId: number;
    clienteNome: string;
}

const ModalAgenda = ({ open, onClose, clienteId, clienteNome }: ModalAgendaProps) => {
    const { formProps, form } = useForm({
        resource: "tarefas",
        action: "create",
        redirect: false,
        onMutationSuccess: () => {
            message.success("✅ Agendamento salvo!");
            form.resetFields();
            onClose();
        }
    });

    const handleOk = () => form.submit();

    return (
        <Modal 
            title={`📅 Nova Tarefa para: ${clienteNome}`}
            open={open} onOk={handleOk} onCancel={onClose}
            okText="Salvar" cancelText="Cancelar"
            okButtonProps={{ style: { backgroundColor: "#25D366", borderColor: "#25D366" } }}
        >
            <Form {...formProps} layout="vertical">
                <Form.Item name="cliente_id" initialValue={clienteId} hidden><Input /></Form.Item>
                <Form.Item label="O que fazer?" name="titulo" rules={[{ required: true }]}><Input placeholder="Ex: Visita Técnica" /></Form.Item>
                <div style={{ display: 'flex', gap: 10 }}>
                    <Form.Item label="Tipo" name="tipo" style={{ flex: 1 }} initialValue="visita">
                        <Select options={[{ value: 'visita', label: '📍 Visita' }, { value: 'ligacao', label: '📞 Ligação' }, { value: 'whatsapp', label: '💬 WhatsApp' }]} />
                    </Form.Item>
                    <Form.Item label="Data" name="data_vencimento" style={{ flex: 1 }} rules={[{ required: true }]}>
                        <DatePicker showTime format="DD/MM/YYYY HH:mm" style={{ width: '100%' }} />
                    </Form.Item>
                </div>
                <Form.Item label="Obs" name="descricao"><Input.TextArea rows={2} /></Form.Item>
            </Form>
        </Modal>
    );
};

// --- PÁGINA PRINCIPAL ---
export const BlogPostShow = () => {
  const showResult = useShow() as any;
  const query = showResult.query || showResult;
  const { data, isLoading } = query;
  const record = data?.data;

  const [isModalOpen, setIsModalOpen] = useState(false);

  const formatarDinheiro = (valor: any) => {
    if (!valor) return "R$ 0,00";
    return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  const abrirNoMapa = () => {
    if (!record?.endereco_instalacao) {
        message.warning("Sem endereço cadastrado!");
        return;
    }
    // LÓGICA DO MAPA PRECISO: Junta Rua + Número
    const enderecoCompleto = `${record.endereco_instalacao}, ${record.numero || ''}`;
    const enderecoEncoded = encodeURIComponent(enderecoCompleto);
    window.open(`https://www.google.com/maps/search/?api=1&query=${enderecoEncoded}`, '_blank');
  };

  if (isLoading) return <Show isLoading={true}><Skeleton active /></Show>;

  return (
    <Show isLoading={isLoading} title="Detalhes do Cliente">
      
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <Tag color="blue" style={{ fontSize: 16, padding: "5px 15px" }}>{record?.status || "Novo Lead"}</Tag>
          <Button 
            type="primary" icon={<CalendarOutlined />} onClick={() => setIsModalOpen(true)} size="large"
            style={{ backgroundColor: "#25D366", borderColor: "#25D366", color: "white", fontWeight: "bold", boxShadow: "0 4px 14px rgba(37, 211, 102, 0.4)" }}
          >
            Agendar Visita
          </Button>
      </div>

      <Card bordered={false} style={{ borderRadius: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div>
                <Title level={3} style={{ margin: 0 }}>{record?.nome}</Title>
                <Text type="secondary" style={{ fontSize: 16 }}><PhoneOutlined /> {record?.telefone}</Text>
            </div>
            <div style={{ textAlign: "right" }}>
                <Text type="secondary">Conta de Energia</Text>
                <div style={{ fontSize: 28, fontWeight: "bold", color: "#389e0d" }}>{formatarDinheiro(record?.conta_energia_media)}</div>
            </div>
          </div>
          
          <Divider />

          <div style={{ background: "#f5f5f5", padding: 20, borderRadius: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                      <Title level={5} style={{ margin: 0 }}><EnvironmentOutlined /> Local da Instalação</Title>
                      <Text style={{ fontSize: 16, display: 'block', marginTop: 5 }}>
                        {record?.endereco_instalacao || "Endereço incompleto"}
                      </Text>
                      {/* MOSTRA NÚMERO E COMPLEMENTO */}
                      {(record?.numero || record?.complemento) && (
                          <Text type="secondary">
                              Número: <strong>{record?.numero || 'S/N'}</strong> 
                              {record?.complemento && ` - Compl: ${record.complemento}`}
                          </Text>
                      )}
                  </div>
                  <Button type="default" icon={<GoogleOutlined />} onClick={abrirNoMapa} style={{ color: "#1890ff", borderColor: "#1890ff" }}>
                    Ver no Google Maps
                  </Button>
              </div>
          </div>

          <Divider />
          <Space split={<Divider type="vertical" />}>
            <div><Text type="secondary">E-mail</Text><br /><Text strong>{record?.email || "-"}</Text></div>
            <div><Text type="secondary">CPF/CNPJ</Text><br /><Text strong>{record?.cpf_cnpj || "-"}</Text></div>
            <div><Text type="secondary">Cliente desde</Text><br /><DateField value={record?.created_at} format="DD/MM/YYYY" /></div>
          </Space>
      </Card>

      {record?.id && <ModalAgenda open={isModalOpen} onClose={() => setIsModalOpen(false)} clienteId={Number(record.id)} clienteNome={record.nome} />}
    </Show>
  );
};