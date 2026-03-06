import { FlagOutlined, PlusOutlined, TrophyOutlined } from "@ant-design/icons";
import { useList } from "@refinedev/core";
import {
    DatePicker,
    Form,
    Input,
    InputNumber,
    Modal,
    Progress,
    Segmented,
    Select,
    Skeleton,
    Space,
    Table,
    Typography,
    message,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, EmptyState, StatCard } from "../../components/ui";
import {
    loadEmployeeGoals,
    saveEmployeeGoal,
    type EmployeeGoalRecord,
} from "../../lib/employeeGoals";
import { formatCurrencyBRL, normalizeText } from "../../lib/formatters";
import {
    buildOwnerPerformance,
    isDateInMonth,
    type InsightClienteRecord,
} from "../../lib/insights";
import { isSupabaseMissingRelation } from "../../lib/supabaseErrors";
import { supabaseClient } from "../../utility";
import { InsightsHeader, IntroCard, MissingSchemaAlert } from "./shared";

type GoalsSourceMode = "current" | "legacy";

type EmployeeRecord = {
    id: string;
    full_name: string;
    email?: string | null;
    role?: string | null;
    active?: boolean | null;
};

type GoalFormValues = {
    employee_id: string;
    target_value?: number;
    target_wins?: number;
    notes?: string;
};

type GoalViewMode = "valor" | "quantidade";

type GoalTableRow = {
    employee: EmployeeRecord;
    goal?: EmployeeGoalRecord;
    targetValue: number;
    targetWins: number;
    actualValue: number;
    actualWins: number;
    valueProgress: number;
    winsProgress: number;
};

const matchOwner = (
    ownerRows: ReturnType<typeof buildOwnerPerformance>,
    employeeName: string,
) => {
    const employeeKey = normalizeText(employeeName);
    if (!employeeKey) {
        return null;
    }

    return (
        ownerRows.find((owner) => normalizeText(owner.owner) === employeeKey) ||
        ownerRows.find(
            (owner) =>
                normalizeText(owner.owner).includes(employeeKey) ||
                employeeKey.includes(normalizeText(owner.owner)),
        ) ||
        null
    );
};

export const InsightsGoalsPage = () => {
    const [form] = Form.useForm<GoalFormValues>();
    const [monthRef, setMonthRef] = useState<Dayjs>(dayjs().startOf("month"));
    const [viewMode, setViewMode] = useState<GoalViewMode>("valor");
    const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
    const [goals, setGoals] = useState<EmployeeGoalRecord[]>([]);
    const [isLoadingData, setIsLoadingData] = useState<boolean>(true);
    const [schemaMissing, setSchemaMissing] = useState<boolean>(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [sourceMode, setSourceMode] = useState<GoalsSourceMode>("current");
    const [editingRow, setEditingRow] = useState<GoalTableRow | null>(null);

    const supportsGoalCount = sourceMode === "legacy";

    const clientesResult = useList<InsightClienteRecord>({
        resource: "clientes",
        pagination: { mode: "off" },
    }) as any;
    const clientesQuery = clientesResult.query || clientesResult;
    const clientes = (clientesQuery?.data?.data || []) as InsightClienteRecord[];

    const loadData = useCallback(async () => {
        setIsLoadingData(true);
        setErrorMessage(null);

        try {
            const monthStart = monthRef.startOf("month").format("YYYY-MM-DD");

            const currentEmployees = await supabaseClient
                .from("funcionarios")
                .select("*")
                .order("nome", { ascending: true });

            if (!currentEmployees.error) {
                const currentGoals = await loadEmployeeGoals("current", monthStart);

                setSourceMode("current");
                setEmployees(
                    ((currentEmployees.data || []) as any[]).map((row) => ({
                        id: String(row.id),
                        full_name: row.nome || "Sem nome",
                        email: row.email || null,
                        role: row.cargo || null,
                        active: row.ativo !== false,
                    })),
                );
                setGoals(currentGoals);
                setSchemaMissing(false);
                return;
            }

            if (!isSupabaseMissingRelation(currentEmployees.error)) {
                throw currentEmployees.error;
            }

            const legacyEmployees = await supabaseClient
                .from("crm_employees")
                .select("*")
                .order("full_name", { ascending: true });

            if (legacyEmployees.error) {
                throw legacyEmployees.error;
            }

            const legacyGoals = await loadEmployeeGoals("legacy", monthStart);

            setSourceMode("legacy");
            setEmployees(
                ((legacyEmployees.data || []) as any[]).map((row) => ({
                    id: String(row.id),
                    full_name: row.full_name || "Sem nome",
                    email: row.email || null,
                    role: row.role || null,
                    active: row.active !== false,
                })),
            );
            setGoals(legacyGoals);
            setSchemaMissing(false);
        } catch (error: any) {
            if (isSupabaseMissingRelation(error)) {
                setSchemaMissing(true);
                setEmployees([]);
                setGoals([]);
            } else {
                setErrorMessage(error?.message || "Falha ao carregar metas.");
            }
        } finally {
            setIsLoadingData(false);
        }
    }, [monthRef]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    useEffect(() => {
        if (!supportsGoalCount && viewMode === "quantidade") {
            setViewMode("valor");
        }
    }, [supportsGoalCount, viewMode]);

    const ownerRows = useMemo(() => {
        const monthClientes = clientes.filter((cliente) => isDateInMonth(cliente.created_at, monthRef));
        return buildOwnerPerformance(monthClientes);
    }, [clientes, monthRef]);

    const rows = useMemo<GoalTableRow[]>(() => {
        const goalsByEmployee = new Map<string, EmployeeGoalRecord>();

        goals.forEach((goal) => {
            if (!goalsByEmployee.has(goal.employee_id)) {
                goalsByEmployee.set(goal.employee_id, goal);
            }
        });

        return employees.map((employee) => {
            const goal = goalsByEmployee.get(employee.id);
            const owner = matchOwner(ownerRows, employee.full_name);
            const targetValue = Number(goal?.target_value || 0);
            const targetWins = Number(goal?.target_wins || 0);
            const actualValue = Number(owner?.valor || 0);
            const actualWins = Number(owner?.ganhos || 0);
            const valueProgress = targetValue > 0 ? (actualValue / targetValue) * 100 : 0;
            const winsProgress = targetWins > 0 ? (actualWins / targetWins) * 100 : 0;

            return {
                employee,
                goal,
                targetValue,
                targetWins,
                actualValue,
                actualWins,
                valueProgress,
                winsProgress,
            };
        });
    }, [employees, goals, ownerRows]);

    const summary = useMemo(() => {
        const totalTargetValue = rows.reduce((acc, row) => acc + row.targetValue, 0);
        const totalActualValue = rows.reduce((acc, row) => acc + row.actualValue, 0);
        const totalTargetWins = rows.reduce((acc, row) => acc + row.targetWins, 0);
        const totalActualWins = rows.reduce((acc, row) => acc + row.actualWins, 0);
        const valueProgress =
            totalTargetValue > 0 ? (totalActualValue / totalTargetValue) * 100 : 0;
        const winsProgress = totalTargetWins > 0 ? (totalActualWins / totalTargetWins) * 100 : 0;

        return {
            totalTargetValue,
            totalActualValue,
            totalTargetWins,
            totalActualWins,
            valueProgress,
            winsProgress,
        };
    }, [rows]);

    const closeModal = useCallback(() => {
        setIsModalOpen(false);
        setEditingRow(null);
        form.resetFields();
    }, [form]);

    const openCreateModal = () => {
        setEditingRow(null);
        setIsModalOpen(true);
    };

    const openEditModal = (row: GoalTableRow) => {
        setEditingRow(row);
        setIsModalOpen(true);
    };

    useEffect(() => {
        if (!isModalOpen) {
            return;
        }

        if (editingRow) {
            form.setFieldsValue({
                employee_id: editingRow.employee.id,
                target_value: editingRow.targetValue,
                target_wins: editingRow.targetWins,
                notes: editingRow.goal?.notes || "",
            });
            return;
        }

        form.resetFields();
        form.setFieldsValue({
            target_value: 0,
            target_wins: 0,
        });
    }, [editingRow, form, isModalOpen]);

    const columns = useMemo(() => {
        const baseColumns: any[] = [
            {
                title: "Funcionario",
                render: (_: unknown, record: GoalTableRow) => (
                    <Space direction="vertical" size={0}>
                        <Typography.Text strong>{record.employee.full_name}</Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {record.employee.role || "Sem cargo"}
                        </Typography.Text>
                    </Space>
                ),
            },
            {
                title: "Meta (R$)",
                width: 140,
                render: (_: unknown, record: GoalTableRow) =>
                    formatCurrencyBRL(record.targetValue, "R$ 0,00"),
            },
            {
                title: "Realizado (R$)",
                width: 150,
                render: (_: unknown, record: GoalTableRow) =>
                    formatCurrencyBRL(record.actualValue, "R$ 0,00"),
            },
        ];

        if (supportsGoalCount) {
            baseColumns.push(
                {
                    title: "Meta qtd",
                    width: 100,
                    render: (_: unknown, record: GoalTableRow) => record.targetWins,
                },
                {
                    title: "Realizado qtd",
                    width: 120,
                    render: (_: unknown, record: GoalTableRow) => record.actualWins,
                },
            );
        }

        baseColumns.push(
            {
                title: "Progresso",
                width: 200,
                render: (_: unknown, record: GoalTableRow) => {
                    const percent =
                        supportsGoalCount && viewMode === "quantidade"
                            ? record.winsProgress
                            : record.valueProgress;

                    return (
                        <Progress
                            percent={Number(percent.toFixed(1))}
                            size="small"
                            strokeColor={percent >= 100 ? "#16a34a" : "#2563eb"}
                        />
                    );
                },
            },
            {
                title: "",
                width: 110,
                render: (_: unknown, record: GoalTableRow) => (
                    <Button size="small" onClick={() => openEditModal(record)}>
                        Editar
                    </Button>
                ),
            },
        );

        return baseColumns;
    }, [supportsGoalCount, viewMode]);

    const handleSave = async () => {
        try {
            setIsSaving(true);
            const values = await form.validateFields();
            const monthStart = monthRef.startOf("month").format("YYYY-MM-DD");

            await saveEmployeeGoal(sourceMode, {
                employee_id: values.employee_id,
                goal_month: monthStart,
                target_value: Number(values.target_value || 0),
                target_wins: supportsGoalCount ? Number(values.target_wins || 0) : 0,
                notes: supportsGoalCount ? values.notes?.trim() || null : null,
            });

            message.success("Meta salva.");
            closeModal();
            await loadData();
        } catch (error: any) {
            if (error?.errorFields) {
                return;
            }

            message.error(error?.message || "Nao foi possivel salvar a meta.");
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoadingData || clientesQuery?.isLoading) {
        return <Skeleton active />;
    }

    return (
        <div style={{ padding: 20 }}>
            <InsightsHeader
                title="Relatorio de metas"
                subtitle={`Defina metas por funcionario e acompanhe o atingimento. Fonte: ${sourceMode === "current" ? "metas/funcionarios" : "crm_goals/crm_employees"}.`}
                extra={
                    <Space wrap>
                        <DatePicker
                            picker="month"
                            value={monthRef}
                            onChange={(value) => setMonthRef((value || dayjs()).startOf("month"))}
                            allowClear={false}
                        />
                        {supportsGoalCount ? (
                            <Segmented<GoalViewMode>
                                options={[
                                    { label: "Por venda", value: "valor" },
                                    { label: "Por quantidade", value: "quantidade" },
                                ]}
                                value={viewMode}
                                onChange={(value) => setViewMode(value)}
                            />
                        ) : null}
                        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
                            Definir metas
                        </Button>
                    </Space>
                }
            />

            <IntroCard
                title="Metas orientadas por dono da carteira"
                description="A pagina acompanha o mesmo recorte mensal usado na aba de equipe para evitar divergencias de receita e progresso."
            />

            {schemaMissing ? (
                <MissingSchemaAlert description="Nenhuma tabela de metas encontrada (`metas` ou `crm_goals`)." />
            ) : null}

            {errorMessage ? (
                <MissingSchemaAlert title="Falha ao carregar metas" description={errorMessage} />
            ) : null}

            <div
                style={{
                    display: "grid",
                    gap: 12,
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    marginBottom: 12,
                }}
            >
                <StatCard
                    title="Meta consolidada (R$)"
                    value={summary.totalTargetValue}
                    prefix={<FlagOutlined style={{ color: "#2563eb" }} />}
                    accentColor="#2563eb"
                    subtitle={formatCurrencyBRL(summary.totalTargetValue, "R$ 0,00")}
                />
                <StatCard
                    title="Realizado (R$)"
                    value={summary.totalActualValue}
                    prefix={<TrophyOutlined style={{ color: "#16a34a" }} />}
                    accentColor="#16a34a"
                    subtitle={formatCurrencyBRL(summary.totalActualValue, "R$ 0,00")}
                />
                <StatCard
                    title={supportsGoalCount ? "Meta de fechamentos" : "Ganhos no mes"}
                    value={supportsGoalCount ? summary.totalTargetWins : summary.totalActualWins}
                    accentColor="#f97316"
                    subtitle={
                        supportsGoalCount
                            ? `${summary.totalActualWins} fechamentos realizados`
                            : "Baseado nos leads fechados no mes"
                    }
                />
                <StatCard
                    title="Atingimento"
                    value={Number(
                        (
                            supportsGoalCount && viewMode === "quantidade"
                                ? summary.winsProgress
                                : summary.valueProgress
                        ).toFixed(1),
                    )}
                    suffix="%"
                    accentColor="#0f766e"
                    valueStyle={{ color: "#115e59" }}
                />
            </div>

            <Card title={`Metas de ${monthRef.format("MMMM [de] YYYY")}`}>
                {rows.length === 0 ? (
                    <EmptyState
                        title="Sem funcionarios cadastrados"
                        description="Cadastre funcionarios para vincular metas individuais."
                    />
                ) : (
                    <Table
                        size="small"
                        rowKey={(record) => record.employee.id}
                        pagination={{ pageSize: 10 }}
                        dataSource={rows}
                        columns={columns}
                    />
                )}
            </Card>

            <Modal
                title="Definir meta do funcionario"
                open={isModalOpen}
                onCancel={closeModal}
                onOk={handleSave}
                okText="Salvar meta"
                cancelText="Cancelar"
                confirmLoading={isSaving}
                destroyOnClose
            >
                <Form form={form} layout="vertical" preserve={false}>
                    <Form.Item
                        label="Funcionario"
                        name="employee_id"
                        rules={[{ required: true, message: "Selecione o funcionario." }]}
                    >
                        <Select
                            showSearch
                            optionFilterProp="label"
                            options={employees.map((employee) => ({
                                value: employee.id,
                                label: employee.full_name,
                            }))}
                            placeholder="Selecione"
                        />
                    </Form.Item>
                    <Space style={{ width: "100%" }} size={10}>
                        <Form.Item label="Meta valor (R$)" name="target_value" style={{ flex: 1 }}>
                            <InputNumber min={0} style={{ width: "100%" }} />
                        </Form.Item>
                        {supportsGoalCount ? (
                            <Form.Item
                                label="Meta fechamentos"
                                name="target_wins"
                                style={{ flex: 1 }}
                            >
                                <InputNumber min={0} style={{ width: "100%" }} />
                            </Form.Item>
                        ) : null}
                    </Space>
                    {supportsGoalCount ? (
                        <Form.Item label="Observacoes" name="notes">
                            <Input.TextArea rows={3} placeholder="Opcional: contexto da meta." />
                        </Form.Item>
                    ) : null}
                </Form>
            </Modal>
        </div>
    );
};
