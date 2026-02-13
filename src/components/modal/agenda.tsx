import { Modal, Form, Input, DatePicker, Select, message } from "antd";
import { useForm } from "@refinedev/antd";
import { useGo } from "@refinedev/core";
import dayjs from "dayjs";

interface ModalAgendaProps {
    open: boolean;
    onClose: () => void;
    clienteId: number;
    clienteNome: string;
}

export const ModalAgenda = ({ open, onClose, clienteId, clienteNome }: ModalAgendaProps) => {
    const go = useGo();
    
    // Configura o formulário para salvar na tabela 'tarefas'
    const { formProps, form } = useForm({
        resource: "tarefas",
        action: "create",
        redirect: false, // Não sai da tela depois de salvar
        onMutationSuccess: () => {
            message.success("Agendamento criado com sucesso!");
            form.resetFields();
            onClose();
            // Opcional: Redirecionar para a agenda
            // go({ to: "/agenda" }); 
        }
    });

    const handleOk = () => {
        form.submit();
    };

    return (
        <Modal 
            title={`📅 Agendar para: ${clienteNome}`}
            open={open} 
            onOk={handleOk} 
            onCancel={onClose}
            okText="Salvar Agendamento"
            cancelText="Cancelar"
        >
            <Form {...formProps} layout="vertical">
                {/* Campo Oculto para vincular ao cliente atual */}
                <Form.Item name="cliente_id" initialValue={clienteId} hidden>
                    <Input />
                </Form.Item>

                <Form.Item 
                    label="Título da Atividade" 
                    name="titulo" 
                    rules={[{ required: true, message: "O que será feito?" }]}
                >
                    <Input placeholder="Ex: Visita Técnica, Ligação de Alinhamento..." />
                </Form.Item>

                <div style={{ display: 'flex', gap: '10px' }}>
                    <Form.Item 
                        label="Tipo" 
                        name="tipo" 
                        style={{ flex: 1 }}
                        initialValue="visita"
                    >
                        <Select options={[
                            { value: 'visita', label: '📍 Visita Técnica' },
                            { value: 'ligacao', label: '📞 Ligação' },
                            { value: 'whatsapp', label: '💬 WhatsApp' },
                            { value: 'email', label: '📧 E-mail' }
                        ]} />
                    </Form.Item>

                    <Form.Item 
                        label="Data e Hora" 
                        name="data_vencimento" 
                        style={{ flex: 1 }}
                        rules={[{ required: true, message: "Quando?" }]}
                    >
                        <DatePicker 
                            showTime={{ format: 'HH:mm' }} 
                            format="DD/MM/YYYY HH:mm" 
                            style={{ width: '100%' }}
                            placeholder="Selecione data/hora"
                        />
                    </Form.Item>
                </div>

                <Form.Item label="Observações / Detalhes" name="descricao">
                    <Input.TextArea rows={3} placeholder="Ex: Levar escada, cliente pediu para ligar antes..." />
                </Form.Item>
            </Form>
        </Modal>
    );
};