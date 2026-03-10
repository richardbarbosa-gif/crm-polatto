import {
    CalendarOutlined,
    EditOutlined,
    EyeOutlined,
    ReloadOutlined,
    UserOutlined,
} from "@ant-design/icons";
import { useList, useInvalidate } from "@refinedev/core"; // <-- Adicionado useInvalidate
import {
    Alert,
    Badge,
    Button,
    Calendar,
    Card,
    Drawer,
    Empty,
    List,
    Modal,
    Segmented,
    Skeleton,
    Tag,
    Typography,
    message,
} from "antd";
import type { CalendarProps } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { TaskFormModal, type TaskContextData, type TarefaRecord } from "../../components/modal/agenda";
import { getTaskSituation, type TaskSituation, isTaskOverdue } from "../../lib/insights";
import {
    resolveTaskExecutionStatus,
    updateTaskExecutionStatus,
    TASK_EXECUTION_STATUS_LABELS,
    TASK_EXECUTION_STATUS_OPTIONS,
    type TaskExecutionStatus,
} from "../../lib/taskExecutionStatus";
import { supabaseClient } from "../../utility";

const TIPO_LABELS: Record<string, string> = {
    visita: "Visita",
    ligacao: "Ligacao",
    whatsapp: "WhatsApp",
    email: "Email",
};

const getTipoLabel = (tipo?: string | null) => {
    if (!tipo) return "Sem tipo";
    if (tipo === "etec" || tipo === "etc") return "Outro";
    return TIPO_LABELS[tipo] || tipo;
};

const getClienteFallbackLabel = (clienteId?: string | number | null) => {
    if (!clienteId) return "Cliente nao informado";
    return `Cliente #${clienteId}`;
};

const getSituationBadgeStatus = (situation: TaskSituation) => {
    if (situation === "atrasada") return "error";
    if (situation === "tratada") return "success";
    if (situation === "hoje") return "processing";
    if (situation === "proxima") return "warning";
    return "default";
};

const getSituationLabel = (situation: TaskSituation) => {
    if (situation === "atrasada") return "Atrasada";
    if (situation === "hoje") return "Hoje";
    if (situation === "proxima") return "Proxima";
    if (situation === "tratada") return "Tratada";
    return "Agendada";
};

const TASK_EXECUTION_STATUS_COLORS: Record<TaskExecutionStatus, string> = {
    pendente: "default",
    resolvido: "success",
    ligar_novamente: "purple",
    voltar_outro_dia: "gold",
};

type ClienteAgendaRecord = {
    id: string | number;
    nome?: string | null;
};

export const AgendaPage = () => {
    const invalidate = useInvalidate(); // <-- Inicializando o invalidate do Refine

    const [visibleDate, setVisibleDate] = useState(dayjs());
    const [diaSelecionado, setDiaSelecionado] = useState<Dayjs | null>(null);

    const [tarefaEmFoco, setTarefaEmFoco] = useState<TarefaRecord | null>(null);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);

    const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
    const [taskModalMode, setTaskModalMode] = useState<"create" | "edit">("create");
    const [taskEditRecord, setTaskEditRecord] = useState<TarefaRecord | null>(null);
    const [taskContextData, setTaskContextData] = useState<TaskContextData | null>(null);
    const [taskInitialDate, setTaskInitialDate] = useState<Dayjs | null>(null);

    const rangeStart = useMemo(
        () => visibleDate.startOf("month").subtract(1, "month").startOf("day"),
        [visibleDate]
    );
    const rangeEnd = useMemo(
        () => visibleDate.endOf("month").add(1, "month").endOf("day"),
        [visibleDate]
    );

    const listResult = useList<TarefaRecord>({
        resource: "tarefas",
        pagination: { mode: "off" },
        sorters: [{ field: "data_vencimento", order: "asc" }],
        liveMode: "auto",
        filters: [
            {
                field: "data_vencimento",
                operator: "gte",
                value: rangeStart.toISOString(),
            },
            {
                field: "data_vencimento",
                operator: "lte",
                value: rangeEnd.toISOString(),
            },
        ],
    }) as any;

    const query = listResult.query || listResult;
    const { data, isLoading, isError, error, refetch } = query;
    const tarefas: TarefaRecord[] = data?.data || [];

    useEffect(() => {
        const channel = supabaseClient
            .channel("crm-tasks-realtime-notifications")
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: "tarefas" },
                (payload) => {
                    const titulo = (payload.new as Record<string, unknown>)?.titulo;
                    message.info(
                        `Novo agendamento: ${typeof titulo === "string" ? titulo : "Tarefa sem titulo"}`,
                    );
                    refetch?.();
                },
            )
            .subscribe();

        return () => {
            supabaseClient.removeChannel(channel);
        };
    }, [refetch]);

    const clientesResult = useList<ClienteAgendaRecord>({
        resource: "clientes",
        pagination: { mode: "off" },
        sorters: [{ field: "nome", order: "asc" }],
    }) as any;

    const clientesQuery = clientesResult.query || clientesResult;
    const clientes: ClienteAgendaRecord[] = clientesQuery?.data?.data || [];

    const clientesById = useMemo(() => {
        const map = new Map<string, ClienteAgendaRecord>();
        clientes.forEach((cliente) => map.set(String(cliente.id), cliente));
        return map;
    }, [clientes]);

    const getClienteLabel = (
        clienteId?: string | number | null,
        fallbackName?: string | null,
    ) => {
        if (!clienteId) {
            return "Cliente nao informado";
        }

        const nome =
            clientesById.get(String(clienteId))?.nome?.trim() ||
            fallbackName?.trim() ||
            "";

        if (nome) {
            return nome;
        }

        return getClienteFallbackLabel(clienteId);
    };

    const getExecutionStatus = (tarefa?: TarefaRecord | null): TaskExecutionStatus => {
        return resolveTaskExecutionStatus(tarefa as Record<string, any>);
    };

    const getTaskStatusTag = (tarefa: TarefaRecord) => {
        const executionStatus = getExecutionStatus(tarefa);
        if (executionStatus !== "pendente") {
            return (
                <Tag color={TASK_EXECUTION_STATUS_COLORS[executionStatus]}>
                    {TASK_EXECUTION_STATUS_LABELS[executionStatus]}
                </Tag>
            );
        }

        const situation = getTaskSituation(tarefa.data_vencimento, dayjs(), executionStatus);
        if (situation === "atrasada") {
            return <Tag color="red">Atrasada</Tag>;
        }

        return <Tag color="processing">{TASK_EXECUTION_STATUS_LABELS.pendente}</Tag>;
    };

    const tarefasPorDia = useMemo(() => {
        const map = new Map<string, TarefaRecord[]>();

        tarefas.forEach((tarefa) => {
            if (!tarefa.data_vencimento) return;

            const dataTarefa = dayjs(tarefa.data_vencimento);
            if (!dataTarefa.isValid()) return;

            const dia = dataTarefa.format("YYYY-MM-DD");
            if (!map.has(dia)) map.set(dia, []);
            map.get(dia)?.push(tarefa);
        });

        map.forEach((tarefasDoDia) => {
            tarefasDoDia.sort((a, b) => {
                const aValue = dayjs(a.data_vencimento).valueOf();
                const bValue = dayjs(b.data_vencimento).valueOf();
                return aValue - bValue;
            });
        });

        return map;
    }, [tarefas]);

    const getTarefasDoDia = (dia: Dayjs) => tarefasPorDia.get(dia.format("YYYY-MM-DD")) || [];

    const abrirDrawerTarefa = (tarefa: TarefaRecord) => {
        setTarefaEmFoco(tarefa);
        setIsDrawerOpen(true);
    };

    const abrirModalNovoAgendamento = (initialDate?: Dayjs | null) => {
        setTaskModalMode("create");
        setTaskEditRecord(null);
        setTaskContextData(null);
        setTaskInitialDate(initialDate || null);
        setIsTaskModalOpen(true);
    };

    const abrirModalEdicao = (tarefa: TarefaRecord) => {
        setTaskModalMode("edit");
        setTaskEditRecord(tarefa);
        setTaskContextData(
            tarefa.cliente_id
                ? {
                      clienteId: tarefa.cliente_id,
                      clienteNome: getClienteLabel(tarefa.cliente_id, tarefa.cliente_nome),
                  }
                : null
        );
        setTaskInitialDate(null);
        setIsTaskModalOpen(true);
    };

    const fecharTaskModal = () => {
        setIsTaskModalOpen(false);
        setTaskEditRecord(null);
        setTaskContextData(null);
        setTaskInitialDate(null);
    };

    const dateCellRender = (value: Dayjs) => {
        const tarefasDoDia = getTarefasDoDia(value);
        if (!tarefasDoDia.length) return null;

        return (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {tarefasDoDia.slice(0, 3).map((tarefa) => (
                    <li key={tarefa.id}>
                        {(() => {
                            const clienteLabel = getClienteLabel(
                                tarefa.cliente_id,
                                tarefa.cliente_nome,
                            );
                            const executionStatus = getExecutionStatus(tarefa);
                            const situation = getTaskSituation(
                                tarefa.data_vencimento,
                                dayjs(),
                                executionStatus,
                            );
                            const statusLabel =
                                executionStatus !== "pendente"
                                    ? TASK_EXECUTION_STATUS_LABELS[executionStatus]
                                    : situation === "atrasada"
                                      ? getSituationLabel(situation)
                                      : TASK_EXECUTION_STATUS_LABELS.pendente;

                            return (
                                <Badge
                                    status={getSituationBadgeStatus(situation)}
                                    text={
                                        <span
                                            style={{
                                                cursor: "pointer",
                                                display: "inline-flex",
                                                flexDirection: "column",
                                                lineHeight: 1.25,
                                            }}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                abrirDrawerTarefa(tarefa);
                                            }}
                                        >
                                            <span>{tarefa.titulo || "Sem titulo"}</span>
                                            <Typography.Text
                                                type="secondary"
                                                style={{ fontSize: 11 }}
                                            >
                                                {clienteLabel}
                                            </Typography.Text>
                                            <Typography.Text
                                                type="secondary"
                                                style={{ fontSize: 10 }}
                                            >
                                                {statusLabel}
                                            </Typography.Text>
                                        </span>
                                    }
                                />
                            );
                        })()}
                    </li>
                ))}
                {tarefasDoDia.length > 3 && (
                    <li>
                        <Typography.Text type="secondary">
                            +{tarefasDoDia.length - 3} mais
                        </Typography.Text>
                    </li>
                )}
            </ul>
        );
    };

    const handleDateSelect: CalendarProps<Dayjs>["onSelect"] = (value, info) => {
        if (info?.source && info.source !== "date") return;
        setDiaSelecionado(value);
    };

    const handlePanelChange: CalendarProps<Dayjs>["onPanelChange"] = (value) => {
        setVisibleDate(value);
    };

    const tarefasSelecionadas = diaSelecionado ? getTarefasDoDia(diaSelecionado) : [];

    if (isLoading) return <Skeleton active />;

    if (isError) {
        return (
            <div className="crm-page-shell">
                <Typography.Title level={2} className="crm-page-header-title">
                    Agenda
                </Typography.Title>
                <Alert
                    type="error"
                    showIcon
                    message="Nao foi possivel carregar sua agenda."
                    description={error?.message || "Tente novamente em alguns instantes."}
                    action={
                        <Button
                            size="small"
                            icon={<ReloadOutlined />}
                            onClick={() => refetch?.()}
                        >
                            Tentar novamente
                        </Button>
                    }
                />
            </div>
        );
    }

    return (
        <div className="crm-page-shell">
            <div className="crm-page-header">
                <div>
                    <Typography.Title level={2} className="crm-page-header-title">
                        Agenda
                    </Typography.Title>
                    <Typography.Text className="crm-page-header-subtitle">
                        Organize visitas, contatos e pendencias com visao diaria e mensal.
                    </Typography.Text>
                </div>
                <Button
                    type="primary"
                    icon={<CalendarOutlined />}
                    onClick={() => abrirModalNovoAgendamento(dayjs())}
                >
                    Novo agendamento
                </Button>
            </div>

            <Card className="crm-card crm-agenda-calendar-card">
                <Calendar
                    dateCellRender={dateCellRender}
                    onSelect={handleDateSelect}
                    onPanelChange={handlePanelChange}
                />
            </Card>

            <Modal
                title={
                    diaSelecionado
                        ? `Agendamentos de ${diaSelecionado.format("DD/MM/YYYY")}`
                        : "Agendamentos do dia"
                }
                open={Boolean(diaSelecionado)}
                onCancel={() => setDiaSelecionado(null)}
                width={640}
                destroyOnClose
                footer={[
                    <Button key="close" onClick={() => setDiaSelecionado(null)}>
                        Fechar
                    </Button>,
                    <Button
                        key="new"
                        type="primary"
                        icon={<CalendarOutlined />}
                        onClick={() => abrirModalNovoAgendamento(diaSelecionado)}
                    >
                        Novo agendamento
                    </Button>,
                ]}
            >
                {tarefasSelecionadas.length === 0 ? (
                    <Empty description="Sem agendamentos para esta data." />
                ) : (
                    <List
                        dataSource={tarefasSelecionadas}
                        rowKey="id"
                        renderItem={(tarefa) => {
                            const clienteLabel = getClienteLabel(
                                tarefa.cliente_id,
                                tarefa.cliente_nome,
                            );

                            return (
                                <List.Item
                                    className="crm-agenda-day-item"
                                    onClick={() => abrirDrawerTarefa(tarefa)}
                                    actions={[
                                        <Button
                                            key={`view-${tarefa.id}`}
                                            size="small"
                                            icon={<EyeOutlined />}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                abrirDrawerTarefa(tarefa);
                                            }}
                                        >
                                            Ver
                                        </Button>,
                                    ]}
                                >
                                    <div style={{ width: "100%" }}>
                                        <div
                                            style={{
                                                display: "flex",
                                                justifyContent: "space-between",
                                                alignItems: "center",
                                                gap: 12,
                                                marginBottom: 6,
                                            }}
                                        >
                                            <Typography.Text strong>
                                                {tarefa.titulo || "Sem titulo"}
                                            </Typography.Text>
                                            <Typography.Text type="secondary">
                                                {tarefa.data_vencimento
                                                    ? dayjs(tarefa.data_vencimento).format("HH:mm")
                                                    : "-"}
                                            </Typography.Text>
                                        </div>

                                        <div
                                            style={{
                                                display: "flex",
                                                gap: 8,
                                                marginBottom: 8,
                                                flexWrap: "wrap",
                                            }}
                                        >
                                            <Tag color="blue">{getTipoLabel(tarefa.tipo)}</Tag>
                                            <Tag icon={<UserOutlined />} color="default">
                                                {clienteLabel}
                                            </Tag>
                                            {getTaskStatusTag(tarefa)}
                                        </div>

                                        <Typography.Paragraph style={{ margin: 0 }}>
                                            {tarefa.descricao?.trim() || "Sem observacoes."}
                                        </Typography.Paragraph>
                                    </div>
                                </List.Item>
                            );
                        }}
                    />
                )}
            </Modal>

            <Drawer
                title="Visualizacao rapida"
                open={isDrawerOpen}
                onClose={() => setIsDrawerOpen(false)}
                width={420}
                extra={
                    tarefaEmFoco ? (
                        <Button
                            type="primary"
                            icon={<EditOutlined />}
                            onClick={() => abrirModalEdicao(tarefaEmFoco)}
                        >
                            Editar
                        </Button>
                    ) : null
                }
            >
                {!tarefaEmFoco ? (
                    <Empty description="Nenhuma tarefa selecionada." />
                ) : (
                    <div className="crm-agenda-drawer-stack">
                        {(() => {
                            const clienteLabel = getClienteLabel(
                                tarefaEmFoco.cliente_id,
                                tarefaEmFoco.cliente_nome,
                            );
                            const executionStatus = getExecutionStatus(tarefaEmFoco);
                            const canUpdateExecutionStatus = isTaskOverdue(
                                tarefaEmFoco.data_vencimento,
                            );

                            return (
                                <>
                                    <Typography.Title level={5} style={{ margin: 0 }}>
                                        {tarefaEmFoco.titulo || "Sem titulo"}
                                    </Typography.Title>

                                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                        <Tag color="blue">{getTipoLabel(tarefaEmFoco.tipo)}</Tag>
                                        <Tag icon={<UserOutlined />} color="default">
                                            {clienteLabel}
                                        </Tag>
                                        {getTaskStatusTag(tarefaEmFoco)}
                                    </div>

                                    {canUpdateExecutionStatus ? (
                                        <div className="crm-agenda-treatment">
                                            <Typography.Text strong>
                                                Tratativa da atividade
                                            </Typography.Text>
                                            <Segmented
                                                block
                                                size="middle"
                                                options={TASK_EXECUTION_STATUS_OPTIONS}
                                                value={executionStatus}
                                                // -- AQUI ESTÁ A CORREÇÃO PRINCIPAL --
                                                onChange={async (value) => {
                                                    if (!tarefaEmFoco?.id) {
                                                        return;
                                                    }

                                                    try {
                                                        // Chama a nova função conectada ao Supabase
                                                        await updateTaskExecutionStatus(
                                                            tarefaEmFoco.id,
                                                            value as TaskExecutionStatus,
                                                        );

                                                        // Força a atualização da lista no Refine (rebusca no banco)
                                                        invalidate({
                                                            resource: "tarefas",
                                                            invalidates: ["list"],
                                                        });

                                                        // Atualiza o estado local para a UI responder na hora
                                                        setTarefaEmFoco({
                                                            ...tarefaEmFoco,
                                                            execucao_status: value as TaskExecutionStatus,
                                                        } as TarefaRecord);

                                                    } catch (error) {
                                                        console.error("Erro ao atualizar o status:", error);
                                                        message.error("Não foi possível salvar o status no banco de dados.");
                                                    }
                                                }}
                                            />
                                            <Typography.Text
                                                type="secondary"
                                                style={{ fontSize: 12 }}
                                            >
                                                Ao definir uma tratativa, a atividade deixa de contar
                                                como atrasada nos Insights.
                                            </Typography.Text>
                                        </div>
                                    ) : (
                                        <Alert
                                            type="info"
                                            showIcon
                                            message="Tratativa habilita apenas apos o vencimento da atividade."
                                        />
                                    )}
                                </>
                            );
                        })()}
                        <Typography.Text>
                            Data:{" "}
                            {tarefaEmFoco.data_vencimento
                                ? dayjs(tarefaEmFoco.data_vencimento).format("DD/MM/YYYY HH:mm")
                                : "-"}
                        </Typography.Text>

                        <Typography.Text type="secondary">Observacoes</Typography.Text>
                        <Typography.Paragraph style={{ marginBottom: 0 }}>
                            {tarefaEmFoco.descricao?.trim() || "Sem observacoes."}
                        </Typography.Paragraph>
                    </div>
                )}
            </Drawer>

            <TaskFormModal
                open={isTaskModalOpen}
                onClose={fecharTaskModal}
                mode={taskModalMode}
                task={taskEditRecord}
                contextData={taskContextData}
                initialDate={taskInitialDate}
                onSuccess={() => {
                    if (taskModalMode === "edit") {
                        setIsDrawerOpen(false);
                        setTarefaEmFoco(null);
                    }
                }}
            />
        </div>
    );
};