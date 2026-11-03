import { useCreate, useInvalidate, useList, useUpdate } from "@refinedev/core";
import { DatePicker, Form, Input, Modal, Select, message } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCrmAccess } from "../../hooks/useCrmAccess";
import { useTenantSegmento } from "../../hooks/useTenantSegmento";
import { sanitizarBusca } from "../../lib/leadFilters";
import type { TipoAtividadeRecord } from "../../types/db";
import { supabaseClient } from "../../utility";

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
    /** Agendamento concluído — controla o sino e a próxima atividade do card */
    concluido?: boolean | null;
    responsavel?: string | null;
    execucao_status?: string | null;
    created_at?: string | null;
    /** Quem cadastrou (migration 12): decide se o vendedor pode excluir. */
    created_by?: string | null;
    deleted_at?: string | null;
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
    { value: "ligacao", label: "Ligação" },
    { value: "whatsapp", label: "WhatsApp" },
    { value: "email", label: "E-mail" },
];

const normalizeTipoValue = (nome: string) =>
    nome
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");

const normalizeId = (value: string | number | null | undefined) => {
    if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
    return value;
};

const getTaskDateValue = (taskDate?: string | null, initialDate?: Dayjs | null) => {
    if (taskDate) {
        const parsed = dayjs(taskDate);
        if (parsed.isValid()) return parsed;
    }
    if (initialDate?.isValid()) {
        // Dia clicado no calendário: usa o próximo horário cheio daquele dia
        // (ou de hoje), em vez da meia-noite que já passou.
        const agora = dayjs();
        const base = initialDate.isSame(agora, "day")
            ? agora.add(1, "hour").startOf("hour")
            : initialDate.hour(9).minute(0).second(0).millisecond(0);
        return base;
    }
    return dayjs().add(1, "hour").startOf("hour");
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
    const salvandoRef = useRef(false);
    const { ownerDisplayName } = useCrmAccess();
    const { isEnergiaSolar } = useTenantSegmento();

    const invalidate = useInvalidate();
    const { mutateAsync: createTarefa } = useCreate();
    const { mutateAsync: updateTarefa } = useUpdate();

    const contextClienteId = normalizeId(contextData?.clienteId);
    const taskClienteId = normalizeId(task?.cliente_id);
    const lockedClienteId =
        contextClienteId !== undefined && contextClienteId !== null
            ? contextClienteId
            : mode === "edit"
              ? taskClienteId
              : undefined;
    const isClienteLocked = lockedClienteId !== undefined && lockedClienteId !== null;

    // Busca de clientes no servidor, 20 por vez. Antes o modal carregava a
    // base INTEIRA (select * sem limite) ao montar — inclusive no Kanban,
    // onde fica sempre montado — e o Supabase cortava em 1000: quem tinha
    // mais leads não conseguia agendar para os que passavam desse corte.
    const [buscaCliente, setBuscaCliente] = useState("");
    const [buscaDebounced, setBuscaDebounced] = useState("");
    useEffect(() => {
        const timer = setTimeout(() => setBuscaDebounced(buscaCliente), 300);
        return () => clearTimeout(timer);
    }, [buscaCliente]);
    const termoBusca = sanitizarBusca(buscaDebounced);

    const { query: clientesQuery } = useList<ClienteRecord>({
        resource: "clientes",
        pagination: { currentPage: 1, pageSize: 20 },
        sorters: [{ field: "nome", order: "asc" }],
        filters: termoBusca ? [{ field: "nome", operator: "contains", value: termoBusca }] : [],
        meta: { select: "id,nome,endereco_instalacao" },
        queryOptions: { enabled: open && !isClienteLocked },
    });
    const clientes = useMemo(() => clientesQuery?.data?.data ?? [], [clientesQuery?.data?.data]);

    const { query: tiposAtividadeQuery } = useList<TipoAtividadeRecord>({
        resource: "tipos_atividade",
        pagination: { mode: "off" },
        filters: [{ field: "ativo", operator: "eq", value: true }],
        sorters: [{ field: "ordem", order: "asc" }],
        queryOptions: { retry: false, enabled: open },
    });

    const tipoOptions = useMemo(() => {
        const tipos = (tiposAtividadeQuery?.data?.data ?? []).filter((tipo) => tipo?.nome?.trim());
        if (!tipos.length) return TIPO_OPTIONS;
        return tipos.map((tipo) => ({ value: normalizeTipoValue(tipo.nome), label: tipo.nome }));
    }, [tiposAtividadeQuery?.data?.data]);

    const clienteOptions = useMemo(
        () => clientes.map((cliente) => ({ value: cliente.id, label: cliente.nome || `Cliente #${cliente.id}` })),
        [clientes],
    );

    const clienteContextLabel =
        getContextLabel(contextData) ||
        task?.cliente_nome?.trim() ||
        (isClienteLocked ? `Cliente #${lockedClienteId}` : "Cliente vinculado");
    const modalTitle = mode === "edit" ? "Editar agendamento" : "Novo agendamento";

    // Preenche o formulário só no momento em que o modal ABRE. Antes o efeito
    // rodava de novo sempre que a lista de tipos chegava ou o objeto de
    // contexto mudava de identidade (a tela de detalhes cria um a cada
    // render): o que o usuário já tinha digitado era apagado.
    const estavaAberto = useRef(false);
    useEffect(() => {
        if (open && !estavaAberto.current) {
            const initialClienteId = normalizeId(lockedClienteId ?? task?.cliente_id ?? contextData?.clienteId);
            form.setFieldsValue({
                cliente_id: initialClienteId ?? undefined,
                titulo: task?.titulo || "",
                tipo: task?.tipo || undefined,
                data_vencimento: getTaskDateValue(task?.data_vencimento, initialDate),
                descricao: task?.descricao || "",
            });
            setBuscaCliente("");
        }
        estavaAberto.current = open;
    }, [open, form, lockedClienteId, task, contextData?.clienteId, initialDate]);

    // Tipo padrão quando a lista de tipos chega e o campo ainda está vazio
    // (ou com um tipo que não existe mais).
    useEffect(() => {
        if (!open) return;
        const atual = form.getFieldValue("tipo") as string | undefined;
        if (!atual || !tipoOptions.some((opcao) => opcao.value === atual)) {
            if (!(mode === "edit" && atual)) form.setFieldValue("tipo", tipoOptions[0]?.value ?? "visita");
        }
    }, [form, mode, open, tipoOptions]);

    const handleCancel = () => {
        form.resetFields();
        onClose();
    };

    const buscarEndereco = async (clienteId: string | number): Promise<string> => {
        const daLista = clientes.find((c) => String(c.id) === String(clienteId))?.endereco_instalacao?.trim();
        if (daLista) return daLista;
        if (contextData?.clienteEndereco?.trim()) return contextData.clienteEndereco.trim();
        const { data } = await supabaseClient
            .from("clientes")
            .select("endereco_instalacao")
            .eq("id", clienteId)
            .maybeSingle();
        return String((data as { endereco_instalacao?: string | null } | null)?.endereco_instalacao ?? "").trim();
    };

    const handleSave = async () => {
        if (salvandoRef.current) return;
        salvandoRef.current = true;
        try {
            setIsSaving(true);

            const values = await form.validateFields();
            const selectedClienteId = normalizeId(lockedClienteId ?? values.cliente_id);

            if (!selectedClienteId) {
                message.error("Selecione um cliente para continuar.");
                return;
            }

            // Editar a descrição de uma tarefa vencida não pode ser bloqueado:
            // a regra de "não agendar no passado" vale para data nova.
            const dataAlterada =
                mode !== "edit" ||
                !task?.data_vencimento ||
                !dayjs(task.data_vencimento).isSame(values.data_vencimento, "minute");
            if (dataAlterada && values.data_vencimento.isBefore(dayjs(), "minute")) {
                message.warning("Não é permitido agendar tarefas no passado.");
                return;
            }

            if (isEnergiaSolar && values.tipo === "visita") {
                const endereco = await buscarEndereco(selectedClienteId);
                if (!endereco) {
                    message.warning("Visita técnica exige cliente com endereço cadastrado.");
                    return;
                }
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
                    // Dono da atividade: sem ele os relatórios por consultor
                    // não conseguiam atribuir a atividade a ninguém.
                    values: { ...payload, responsavel: ownerDisplayName || null },
                    successNotification: false,
                    errorNotification: false,
                });
            }

            await invalidate({ resource: "tarefas", invalidates: ["list", "many", "detail"] });

            message.success(mode === "edit" ? "Agendamento atualizado." : "Agendamento salvo.");

            form.resetFields();
            onSuccess?.();
            onClose();
        } catch (error: unknown) {
            if (typeof error === "object" && error && "errorFields" in error) return;
            const backendMessage = error instanceof Error ? error.message : (error as { message?: string })?.message;
            message.error(
                backendMessage
                    ? `Não foi possível salvar: ${backendMessage}`
                    : "Não foi possível salvar o agendamento.",
            );
        } finally {
            salvandoRef.current = false;
            setIsSaving(false);
        }
    };

    return (
        <Modal
            title={modalTitle}
            open={open}
            onOk={handleSave}
            onCancel={handleCancel}
            okText={mode === "edit" ? "Salvar alterações" : "Salvar agendamento"}
            cancelText="Cancelar"
            confirmLoading={isSaving}
            okButtonProps={{ className: "crm-focusable" }}
            destroyOnHidden
        >
            <Form form={form} layout="vertical" preserve={false} className="crm-form-row-tight">
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
                            filterOption={false}
                            onSearch={setBuscaCliente}
                            options={clienteOptions}
                            placeholder="Digite para buscar o cliente"
                            loading={Boolean(clientesQuery?.isFetching)}
                            notFoundContent={clientesQuery?.isFetching ? "Buscando..." : "Nenhum cliente encontrado"}
                        />
                    </Form.Item>
                )}

                <Form.Item
                    label="Título da atividade"
                    name="titulo"
                    rules={[{ required: true, whitespace: true, message: "Informe o título da tarefa." }]}
                >
                    <Input placeholder="Ex.: visita técnica, ligação de alinhamento..." />
                </Form.Item>

                <div className="crm-toolbar-group">
                    <Form.Item label="Tipo" name="tipo" style={{ flex: 1 }}>
                        <Select options={tipoOptions} />
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

                <Form.Item label="Observações" name="descricao">
                    <Input.TextArea rows={3} placeholder="Ex.: cliente pediu para ligar antes da visita." />
                </Form.Item>
            </Form>
        </Modal>
    );
};

export const ModalAgenda = ({ open, onClose, clienteId, clienteNome }: LegacyModalAgendaProps) => (
    <TaskFormModal open={open} onClose={onClose} contextData={{ clienteId, clienteNome }} />
);
