import {
    CalendarOutlined,
    EditOutlined,
    EyeOutlined,
    ReloadOutlined,
} from "@ant-design/icons";
import { useList } from "@refinedev/core";
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
    Skeleton,
    Tag,
    Typography,
} from "antd";
import type { CalendarProps } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useMemo, useState } from "react";
import { TaskFormModal, type TaskContextData, type TarefaRecord } from "../../components/modal/agenda";

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

const getClienteLabel = (clienteId?: string | number | null) => {
    if (!clienteId) return "Cliente nao informado";
    return `Cliente #${clienteId}`;
};

export const AgendaPage = () => {
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
                      clienteNome: getClienteLabel(tarefa.cliente_id),
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
                        <Badge
                            status="warning"
                            text={
                                <span
                                    style={{ cursor: "pointer" }}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        abrirDrawerTarefa(tarefa);
                                    }}
                                >
                                    {tarefa.titulo || "Sem titulo"}
                                </span>
                            }
                        />
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
            <div style={{ padding: 20 }}>
                <Typography.Title level={2}>Agenda</Typography.Title>
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
        <div style={{ padding: 20 }}>
            <Typography.Title level={2}>Agenda</Typography.Title>

            <Card>
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
                        renderItem={(tarefa) => (
                            <List.Item
                                style={{ cursor: "pointer" }}
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

                                    <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                                        <Tag color="blue">{getTipoLabel(tarefa.tipo)}</Tag>
                                        <Tag>{getClienteLabel(tarefa.cliente_id)}</Tag>
                                    </div>

                                    <Typography.Paragraph style={{ margin: 0 }}>
                                        {tarefa.descricao?.trim() || "Sem observacoes."}
                                    </Typography.Paragraph>
                                </div>
                            </List.Item>
                        )}
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
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        <Typography.Title level={5} style={{ margin: 0 }}>
                            {tarefaEmFoco.titulo || "Sem titulo"}
                        </Typography.Title>

                        <div style={{ display: "flex", gap: 8 }}>
                            <Tag color="blue">{getTipoLabel(tarefaEmFoco.tipo)}</Tag>
                            <Tag>{getClienteLabel(tarefaEmFoco.cliente_id)}</Tag>
                        </div>

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
