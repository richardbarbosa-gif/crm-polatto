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
import { formatCurrencyBRL, normalizeText } from "../../lib/formatters";
import {
    buildOwnerPerformance,
    isDateInMonth,
    type InsightClienteRecord,
} from "../../lib/insights";
import { isSupabaseMissingRelation } from "../../lib/supabaseErrors";
import { supabaseClient } from "../../utility";
import { InsightsHeader, IntroCard, MissingSchemaAlert } from "./shared";

type EmployeeRecord = {
    id: string;
    full_name: string;
    email?: string | null;
    role?: string | null;
    active?: boolean | null;
};

type GoalRecord = {
    id: string;
    employee_id: string;
    goal_month: string;
    target_value?: number | null;
    target_wins?: number | null;
    notes?: string | null;
    crm_employees?:
        | {
              id: string;
              full_name?: string | null;
              email?: string | null;
              role?: string | null;
          }[]
        | null;
};

type GoalRecordRaw = {
    id: string;
    employee_id: string;
    goal_month: string;
    target_value?: number | null;
    target_wins?: number | null;
    notes?: string | null;
    crm_employees?: {
        id: string;
        full_name?: string | null;
        email?: string | null;
        role?: string | null;
    }[] | null;
};

type GoalFormValues = {
    employee_id: string;
    target_value?: number;
    target_wins?: number;
    notes?: string;
};

type GoalViewMode = "valor" | "quantidade";

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
    const [goals, setGoals] = useState<GoalRecord[]>([]);
    const [isLoadingData, setIsLoadingData] = useState<boolean>(true);
    const [schemaMissing, setSchemaMissing] = useState<boolean>(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
    const [isSaving, setIsSaving] = useState<boolean>(false);

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
            const [{ data: employeesData, error: employeesError }, { data: goalsData, error: goalsError }] =
                await Promise.all([
                    supabaseClient.from("crm_employees").select("*").order("full_name", { ascending: true }),
                    supabaseClient
                        .from("crm_goals")
                        .select(
                            "id, employee_id, goal_month, target_value, target_wins, notes, crm_employees(id, full_name, email, role)",
                        )
                        .eq("goal_month", monthStart),
                ]);

            if (employeesError) throw employeesError;
            if (goalsError) throw goalsError;

            setEmployees((employeesData || []) as EmployeeRecord[]);
            setGoals((goalsData || []) as GoalRecordRaw[]);
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

    const ownerRows = useMemo(() => {
        const monthClientes = clientes.filter((cliente) => isDateInMonth(cliente.created_at, monthRef));
        return buildOwnerPerformance(monthClientes);
    }, [clientes, monthRef]);

    const rows = useMemo(() => {
        const goalsByEmployee = new Map<string, GoalRecord>();
        goals.forEach((goal) => {
            goalsByEmployee.set(goal.employee_id, goal);
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

    const openCreateModal = () => {
        form.resetFields();
        form.setFieldsValue({
            target_value: 0,
            target_wins: 0,
        });
        setIsModalOpen(true);
    };

    const openEditModal = (row: any) => {
        form.setFieldsValue({
            employee_id: row.employee.id,
            target_value: row.targetValue,
            target_wins: row.targetWins,
            notes: row.goal?.notes || "",
        });
        setIsModalOpen(true);
    };

    const handleSave = async () => {
        try {
            setIsSaving(true);
            const values = await form.validateFields();
            const payload = {
                employee_id: values.employee_id,
                goal_month: monthRef.startOf("month").format("YYYY-MM-DD"),
                target_value: Number(values.target_value || 0),
                target_wins: Number(values.target_wins || 0),
                notes: values.notes?.trim() || null,
                updated_at: new Date().toISOString(),
            };

            const { error } = await supabaseClient
                .from("crm_goals")
                .upsert(payload, { onConflict: "employee_id,goal_month" });
            if (error) throw error;

            message.success("Meta salva.");
            setIsModalOpen(false);
            await loadData();
        } catch (error: any) {
            if (error?.errorFields) return;
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
                subtitle="Defina metas por funcionario e acompanhe o atingimento por valor ou quantidade."
                extra={
                    <Space wrap>
                        <DatePicker
                            picker="month"
                            value={monthRef}
                            onChange={(value) => setMonthRef((value || dayjs()).startOf("month"))}
                            allowClear={false}
                        />
                        <Segmented<GoalViewMode>
                            options={[
                                { label: "Por venda", value: "valor" },
                                { label: "Por quantidade", value: "quantidade" },
                            ]}
                            value={viewMode}
                            onChange={(value) => setViewMode(value)}
                        />
                        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
                            Definir metas
                        </Button>
                    </Space>
                }
            />

            <IntroCard
                title="Metas orientadas por dono da carteira"
                description="Estabeleca meta mensal por vendedor, acompanhe o realizado e ajuste previsoes rapidamente."
            />

            {schemaMissing ? (
                <MissingSchemaAlert description="Execute o script `database/insights_schema.sql` no Supabase SQL Editor para liberar o modulo de metas." />
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
                    title="Meta de fechamentos"
                    value={summary.totalTargetWins}
                    accentColor="#f97316"
                    subtitle={`${summary.totalActualWins} fechamentos realizados`}
                />
                <StatCard
                    title="Atingimento"
                    value={Number(
                        (viewMode === "valor" ? summary.valueProgress : summary.winsProgress).toFixed(1),
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
                        columns={[
                            {
                                title: "Funcionario",
                                render: (_, record: any) => (
                                    <Space direction="vertical" size={0}>
                                        <Typography.Text strong>
                                            {record.employee.full_name}
                                        </Typography.Text>
                                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                            {record.employee.role || "Sem cargo"}
                                        </Typography.Text>
                                    </Space>
                                ),
                            },
                            {
                                title: "Meta (R$)",
                                width: 140,
                                render: (_, record: any) =>
                                    formatCurrencyBRL(record.targetValue, "R$ 0,00"),
                            },
                            {
                                title: "Realizado (R$)",
                                width: 150,
                                render: (_, record: any) =>
                                    formatCurrencyBRL(record.actualValue, "R$ 0,00"),
                            },
                            {
                                title: "Meta qtd",
                                width: 100,
                                render: (_, record: any) => record.targetWins,
                            },
                            {
                                title: "Realizado qtd",
                                width: 120,
                                render: (_, record: any) => record.actualWins,
                            },
                            {
                                title: "Progresso",
                                width: 200,
                                render: (_, record: any) => {
                                    const percent =
                                        viewMode === "valor"
                                            ? record.valueProgress
                                            : record.winsProgress;
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
                                render: (_, record: any) => (
                                    <Button size="small" onClick={() => openEditModal(record)}>
                                        Editar
                                    </Button>
                                ),
                            },
                        ]}
                    />
                )}
            </Card>

            <Modal
                title="Definir meta do funcionario"
                open={isModalOpen}
                onCancel={() => setIsModalOpen(false)}
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
                        <Form.Item
                            label="Meta fechamentos"
                            name="target_wins"
                            style={{ flex: 1 }}
                        >
                            <InputNumber min={0} style={{ width: "100%" }} />
                        </Form.Item>
                    </Space>
                    <Form.Item label="Observacoes" name="notes">
                        <Input.TextArea rows={3} placeholder="Opcional: contexto da meta." />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
};
