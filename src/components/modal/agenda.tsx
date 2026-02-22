import { useCreate, useInvalidate, useList, useUpdate } from "@refinedev/core";
import { DatePicker, Form, Input, Modal, Select, message } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useMemo, useState } from "react";

type ModalMode = "create" | "edit";

interface ClienteRecord {
    id: string | number;
    nome?: string | null;
    endereco_instalacao?: string | null;
}

export interface TarefaRecord {
    id: string | number;
    cliente_id?: string | number | null;
    cliente_nome?: string | null;
    titulo?: string | null;
    tipo?: string | null;
    descricao?: string | null;
    data_vencimento?: string | null;
}

export interface TaskContextData {
    clienteId: string | number;
    clienteNome?: string;
    clienteEndereco?: string;
}

interface TaskFormValues {
    cliente_id?: string | number;
    titulo: string;
    tipo: string;
    data_vencimento: Dayjs;
    descricao?: string;
}

interface TaskFormModalProps {
    open: boolean;
    onClose: () => void;
    mode?: ModalMode;
    task?: TarefaRecord | null;
    contextData?: TaskContextData | null;
    initialDate?: Dayjs | null;
    onSuccess?: () => void;
}

interface LegacyModalAgendaProps {
    open: boolean;
    onClose: () => void;
    clienteId: string | number;
    clienteNome: string;
}

const TIPO_OPTIONS = [
    { value: "visita", label: "Visita" },
    { value: "ligacao", label: "Ligacao" },
    { value: "whatsapp", label: "WhatsApp" },
    { value: "email", label: "Email" },
];
const TIPO_VALUES = new Set(TIPO_OPTIONS.map((item) => item.value));

const normalizeId = (value: string | number | null | undefined) => {
    if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
    return value;
};

const getTaskDateValue = (taskDate?: string | null, initialDate?: Dayjs | null) => {
    if (taskDate) {
        const parsed = dayjs(taskDate);
        if (parsed.isValid()) return parsed;
    }
    if (initialDate?.isValid()) return initialDate;
    return dayjs().add(1, "hour").startOf("hour");
};

const normalizeTipo = (tipo?: string | null) => {
    if (!tipo) return "visita";
    return TIPO_VALUES.has(tipo) ? tipo : "visita";
};

const getContextLabel = (contextData?: TaskContextData | null) => {
    if (!contextData) return undefined;
    return contextData.clienteNome || `Cliente #${contextData.clienteId}`;
};

export const TaskFormModal = ({
    open,
    onClose,
    mode = "create",
    task,
    contextData = null,
    initialDate = null,
    onSuccess,
}: TaskFormModalProps) => {
    const [form] = Form.useForm<TaskFormValues>();
    const [isSaving, setIsSaving] = useState(false);

    const invalidate = useInvalidate();
    const { mutateAsync: createTarefa } = useCreate();
    const { mutateAsync: updateTarefa } = useUpdate();

    const clientesResult = useList<ClienteRecord>({
        resource: "clientes",
        pagination: { mode: "off" },
        sorters: [{ field: "nome", order: "asc" }],
    }) as any;

    const clientesQuery = clientesResult.query || clientesResult;
    const clientes: ClienteRecord[] = clientesQuery?.data?.data || [];
    const isLoadingClientes = Boolean(clientesQuery?.isLoading);

    const clientesById = useMemo(() => {
        const map = new Map<string, ClienteRecord>();
        clientes.forEach((cliente) => map.set(String(cliente.id), cliente));
        return map;
    }, [clientes]);

    const clienteOptions = useMemo(() => {
        const map = new Map<string, { value: string | number; label: string }>();
        clientes.forEach((cliente) => {
            map.set(String(cliente.id), {
                value: cliente.id,
                label: cliente.nome || `Cliente #${cliente.id}`,
            });
        });

        if (contextData?.clienteId) {
            const contextKey = String(contextData.clienteId);
            if (!map.has(contextKey)) {
                map.set(contextKey, {
                    value: contextData.clienteId,
                    label: getContextLabel(contextData) || `Cliente #${contextData.clienteId}`,
                });
            }
        }

        return Array.from(map.values());
    }, [clientes, contextData]);

    const contextClienteId = normalizeId(contextData?.clienteId);
    const taskClienteId = normalizeId(task?.cliente_id);
    const lockedClienteId =
        contextClienteId !== undefined && contextClienteId !== null
            ? contextClienteId
            : mode === "edit"
              ? taskClienteId
              : undefined;
    const isClienteLocked = lockedClienteId !== undefined && lockedClienteId !== null;
    const clienteFromList = isClienteLocked ? clientesById.get(String(lockedClienteId)) : undefined;
    const clienteContextLabel =
        clienteFromList?.nome?.trim() ||
        getContextLabel(contextData) ||
        task?.cliente_nome?.trim() ||
        (isClienteLocked ? `Cliente #${lockedClienteId}` : "Cliente vinculado");
    const modalTitle = mode === "edit" ? "Editar agendamento" : "Novo agendamento";

    useEffect(() => {
        if (!open) return;

        const initialClienteId = normalizeId(lockedClienteId ?? task?.cliente_id ?? contextData?.clienteId);

        form.setFieldsValue({
            cliente_id: initialClienteId ?? undefined,
            titulo: task?.titulo || "",
            tipo: normalizeTipo(task?.tipo),
            data_vencimento: getTaskDateValue(task?.data_vencimento, initialDate),
            descricao: task?.descricao || "",
        });
    }, [contextData?.clienteId, form, initialDate, lockedClienteId, open, task]);

    const handleCancel = () => {
        form.resetFields();
        onClose();
    };

    const handleSave = async () => {
        try {
            setIsSaving(true);

            const values = await form.validateFields();
            const selectedClienteId = normalizeId(lockedClienteId ?? values.cliente_id);

            if (!selectedClienteId) {
                message.error("Selecione um cliente para continuar.");
                return;
            }

            if (values.data_vencimento.isBefore(dayjs(), "minute")) {
                message.warning("Nao e permitido agendar tarefas no passado.");
                return;
            }

            const selectedCliente = clientesById.get(String(selectedClienteId));
            const endereco =
                selectedCliente?.endereco_instalacao?.trim() ||
                contextData?.clienteEndereco?.trim() ||
                "";

            if (values.tipo === "visita" && !endereco) {
                message.warning("Visita tecnica exige cliente com endereco cadastrado.");
                return;
            }

            const payload = {
                cliente_id: selectedClienteId,
                titulo: values.titulo.trim(),
                tipo: values.tipo,
                data_vencimento: values.data_vencimento.toISOString(),
                descricao: values.descricao?.trim() || null,
            };

            if (mode === "edit" && task?.id) {
                await updateTarefa({
                    resource: "tarefas",
                    id: task.id,
                    values: payload,
                    successNotification: false,
                    errorNotification: false,
                });
            } else {
                await createTarefa({
                    resource: "tarefas",
                    values: payload,
                    successNotification: false,
                    errorNotification: false,
                });
            }

            await invalidate({
                resource: "tarefas",
                invalidates: ["list", "many", "detail"],
            });

            message.success(mode === "edit" ? "Agendamento atualizado com sucesso." : "Agendamento salvo com sucesso.");

            form.resetFields();
            onSuccess?.();
            onClose();
        } catch (error: any) {
            if (error?.errorFields) return;

            const backendMessage =
                error?.message ||
                error?.response?.data?.message ||
                error?.errors?.[0]?.message;

            message.error(
                backendMessage
                    ? `Nao foi possivel salvar: ${backendMessage}`
                    : "Nao foi possivel salvar o agendamento."
            );
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Modal
            title={modalTitle}
            open={open}
            onOk={handleSave}
            onCancel={handleCancel}
            okText={mode === "edit" ? "Salvar alteracoes" : "Salvar agendamento"}
            cancelText="Cancelar"
            confirmLoading={isSaving}
            destroyOnClose
        >
            <Form form={form} layout="vertical" preserve={false}>
                {isClienteLocked ? (
                    <>
                        <Form.Item
                            label="Cliente"
                            extra="Cliente vinculado ao agendamento. Para trocar, crie uma nova atividade."
                        >
                            <Input value={clienteContextLabel} disabled />
                        </Form.Item>
                        <Form.Item name="cliente_id" hidden>
                            <Input />
                        </Form.Item>
                    </>
                ) : (
                    <Form.Item
                        label="Cliente"
                        name="cliente_id"
                        rules={[{ required: true, message: "Selecione o cliente." }]}
                    >
                        <Select
                            showSearch
                            optionFilterProp="label"
                            options={clienteOptions}
                            placeholder="Selecione o cliente"
                            loading={isLoadingClientes}
                            notFoundContent="Nenhum cliente encontrado"
                        />
                    </Form.Item>
                )}

                <Form.Item
                    label="Titulo da atividade"
                    name="titulo"
                    rules={[{ required: true, message: "Informe o titulo da tarefa." }]}
                >
                    <Input placeholder="Ex: Visita tecnica, ligacao de alinhamento..." />
                </Form.Item>

                <div style={{ display: "flex", gap: 10 }}>
                    <Form.Item label="Tipo" name="tipo" style={{ flex: 1 }}>
                        <Select options={TIPO_OPTIONS} />
                    </Form.Item>

                    <Form.Item
                        label="Data e hora"
                        name="data_vencimento"
                        style={{ flex: 1 }}
                        rules={[{ required: true, message: "Informe data e hora." }]}
                    >
                        <DatePicker
                            showTime={{ format: "HH:mm" }}
                            format="DD/MM/YYYY HH:mm"
                            style={{ width: "100%" }}
                            placeholder="Selecione data e hora"
                        />
                    </Form.Item>
                </div>

                <Form.Item label="Observacoes" name="descricao">
                    <Input.TextArea rows={3} placeholder="Ex: cliente pediu para ligar antes da visita." />
                </Form.Item>
            </Form>
        </Modal>
    );
};

export const ModalAgenda = ({ open, onClose, clienteId, clienteNome }: LegacyModalAgendaProps) => (
    <TaskFormModal
        open={open}
        onClose={onClose}
        contextData={{ clienteId, clienteNome }}
    />
);
