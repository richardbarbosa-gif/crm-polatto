import {
    PlusOutlined,
    TeamOutlined,
    TrophyOutlined,
    UserOutlined,
} from "@ant-design/icons";
import { useList } from "@refinedev/core";
import {
    Form,
    Input,
    InputNumber,
    Modal,
    Progress,
    Skeleton,
    Space,
    Switch,
    Table,
    Tag,
    Typography,
    message,
} from "antd";
import dayjs from "dayjs";
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

type EmployeeSourceTable = "funcionarios" | "crm_employees";

type EmployeeRecord = {
    id: string;
    full_name: string;
    email?: string | null;
    role?: string | null;
    active?: boolean | null;
    created_at?: string | null;
};

type EmployeeFormValues = {
    full_name: string;
    email?: string;
    role?: string;
    monthly_goal_value?: number;
    monthly_goal_count?: number;
    active?: boolean;
};

type EnrichedEmployeeRecord = EmployeeRecord & {
    atualValor: number;
    atualGanhos: number;
    monthly_goal_value: number;
    monthly_goal_count: number;
    valueProgress: number;
};

const matchOwnerPerformance = (
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

const toEmployeeRecord = (row: any, sourceTable: EmployeeSourceTable): EmployeeRecord => {
    if (sourceTable === "funcionarios") {
        return {
            id: String(row.id),
            full_name: row.nome || "Sem nome",
            email: row.email || null,
            role: row.cargo || null,
            active: row.ativo !== false,
            created_at: row.created_at || null,
        };
    }

    return {
        id: String(row.id),
        full_name: row.full_name || "Sem nome",
        email: row.email || null,
        role: row.role || null,
        active: row.active !== false,
        created_at: row.created_at || null,
    };
};

export const InsightsEmployeesPage = () => {
    const [form] = Form.useForm<EmployeeFormValues>();
    const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
    const [goals, setGoals] = useState<EmployeeGoalRecord[]>([]);
    const [isLoadingEmployees, setIsLoadingEmployees] = useState<boolean>(true);
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
    const [editingEmployee, setEditingEmployee] = useState<EmployeeRecord | null>(null);
    const [schemaMissing, setSchemaMissing] = useState<boolean>(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [sourceTable, setSourceTable] = useState<EmployeeSourceTable>("funcionarios");

    const monthRef = useMemo(() => dayjs().startOf("month"), []);
    const monthStart = useMemo(() => monthRef.format("YYYY-MM-DD"), [monthRef]);
    const supportsGoalCount = sourceTable === "crm_employees";

    const clientesResult = useList<InsightClienteRecord>({
        resource: "clientes",
        pagination: { mode: "off" },
    }) as any;
    const clientesQuery = clientesResult.query || clientesResult;
    const clientes = (clientesQuery?.data?.data || []) as InsightClienteRecord[];

    const loadEmployees = useCallback(async () => {
        setIsLoadingEmployees(true);
        setErrorMessage(null);

        try {
            const current = await supabaseClient
                .from("funcionarios")
                .select("*")
                .order("created_at", { ascending: false });

            if (!current.error) {
                const currentGoals = await loadEmployeeGoals("current", monthStart);
                setSourceTable("funcionarios");
                setEmployees(
                    ((current.data || []) as any[]).map((row) => toEmployeeRecord(row, "funcionarios")),
                );
                setGoals(currentGoals);
                setSchemaMissing(false);
                return;
            }

            if (!isSupabaseMissingRelation(current.error)) {
                throw current.error;
            }

            const legacy = await supabaseClient
                .from("crm_employees")
                .select("*")
                .order("created_at", { ascending: false });

            if (legacy.error) {
                throw legacy.error;
            }

            const legacyGoals = await loadEmployeeGoals("legacy", monthStart);
            setSourceTable("crm_employees");
            setEmployees(
                ((legacy.data || []) as any[]).map((row) => toEmployeeRecord(row, "crm_employees")),
            );
            setGoals(legacyGoals);
            setSchemaMissing(false);
        } catch (error: any) {
            if (isSupabaseMissingRelation(error)) {
                setSchemaMissing(true);
                setEmployees([]);
                setGoals([]);
            } else {
                setErrorMessage(error?.message || "Falha ao carregar funcionarios.");
            }
        } finally {
            setIsLoadingEmployees(false);
        }
    }, [monthStart]);

    useEffect(() => {
        loadEmployees();
    }, [loadEmployees]);

    const currentMonthClientes = useMemo(() => {
        return clientes.filter((cliente) => isDateInMonth(cliente.created_at, monthRef));
    }, [clientes, monthRef]);

    const ownerRows = useMemo(
        () => buildOwnerPerformance(currentMonthClientes),
        [currentMonthClientes],
    );

    const goalsByEmployee = useMemo(() => {
        const map = new Map<string, EmployeeGoalRecord>();

        goals.forEach((goal) => {
            if (!map.has(goal.employee_id)) {
                map.set(goal.employee_id, goal);
            }
        });

        return map;
    }, [goals]);

    const enrichedEmployees = useMemo<EnrichedEmployeeRecord[]>(() => {
        return employees.map((employee) => {
            const owner = matchOwnerPerformance(ownerRows, employee.full_name);
            const goal = goalsByEmployee.get(employee.id);
            const atualValor = owner?.valor || 0;
            const atualGanhos = owner?.ganhos || 0;
            const goalValue = Number(goal?.target_value || 0);
            const goalCount = Number(goal?.target_wins || 0);
            const valueProgress = goalValue > 0 ? (atualValor / goalValue) * 100 : 0;

            return {
                ...employee,
                atualValor,
                atualGanhos,
                monthly_goal_value: goalValue,
                monthly_goal_count: goalCount,
                valueProgress,
            };
        });
    }, [employees, goalsByEmployee, ownerRows]);

    const summary = useMemo(() => {
        const active = enrichedEmployees.filter((employee) => employee.active !== false).length;
        const totalGoal = enrichedEmployees.reduce(
            (acc, employee) => acc + Number(employee.monthly_goal_value || 0),
            0,
        );
        const totalRevenue = enrichedEmployees.reduce(
            (acc, employee) => acc + Number(employee.atualValor || 0),
            0,
        );
        const goalCoverage = totalGoal > 0 ? (totalRevenue / totalGoal) * 100 : 0;

        return { active, totalGoal, totalRevenue, goalCoverage };
    }, [enrichedEmployees]);

    const closeModal = useCallback(() => {
        setIsModalOpen(false);
        setEditingEmployee(null);
        form.resetFields();
    }, [form]);

    const openCreateModal = () => {
        setEditingEmployee(null);
        setIsModalOpen(true);
    };

    const openEditModal = (employee: EmployeeRecord) => {
        setEditingEmployee(employee);
        setIsModalOpen(true);
    };

    useEffect(() => {
        if (!isModalOpen) {
            return;
        }

        if (editingEmployee) {
            const goal = goalsByEmployee.get(editingEmployee.id);
            form.setFieldsValue({
                full_name: editingEmployee.full_name,
                email: editingEmployee.email || "",
                role: editingEmployee.role || "",
                monthly_goal_value: Number(goal?.target_value || 0),
                monthly_goal_count: Number(goal?.target_wins || 0),
                active: editingEmployee.active !== false,
            });
            return;
        }

        form.resetFields();
        form.setFieldsValue({
            active: true,
            monthly_goal_value: 0,
            monthly_goal_count: 0,
        });
    }, [editingEmployee, form, goalsByEmployee, isModalOpen]);

    const handleSave = async () => {
        const isEditing = Boolean(editingEmployee?.id);
        const goalCount = supportsGoalCount
            ? Number(form.getFieldValue("monthly_goal_count") || 0)
            : 0;

        try {
            setIsSaving(true);
            const values = await form.validateFields();
            let employeeId = editingEmployee?.id || null;

            if (sourceTable === "funcionarios") {
                const payload = {
                    nome: values.full_name.trim(),
                    email: values.email?.trim() || null,
                    cargo: values.role?.trim() || null,
                    ativo: values.active !== false,
                };

                if (editingEmployee?.id) {
                    const { error } = await supabaseClient
                        .from("funcionarios")
                        .update(payload)
                        .eq("id", editingEmployee.id);
                    if (error) {
                        throw error;
                    }
                } else {
                    const { data, error } = await supabaseClient
                        .from("funcionarios")
                        .insert(payload)
                        .select("id")
                        .single();

                    if (error) {
                        throw error;
                    }

                    employeeId = data?.id ? String(data.id) : null;
                }

                if (employeeId) {
                    await saveEmployeeGoal("current", {
                        employee_id: employeeId,
                        goal_month: monthStart,
                        target_value: Number(values.monthly_goal_value || 0),
                    });
                }
            } else {
                const payload = {
                    full_name: values.full_name.trim(),
                    email: values.email?.trim() || null,
                    role: values.role?.trim() || null,
                    monthly_goal_value: Number(values.monthly_goal_value || 0),
                    monthly_goal_count: goalCount,
                    active: values.active !== false,
                    updated_at: new Date().toISOString(),
                };

                if (editingEmployee?.id) {
                    const { error } = await supabaseClient
                        .from("crm_employees")
                        .update(payload)
                        .eq("id", editingEmployee.id);
                    if (error) {
                        throw error;
                    }
                } else {
                    const { data, error } = await supabaseClient
                        .from("crm_employees")
                        .insert({
                            ...payload,
                            created_at: new Date().toISOString(),
                        })
                        .select("id")
                        .single();

                    if (error) {
                        throw error;
                    }

                    employeeId = data?.id ? String(data.id) : null;
                }

                if (employeeId) {
                    await saveEmployeeGoal("legacy", {
                        employee_id: employeeId,
                        goal_month: monthStart,
                        target_value: Number(values.monthly_goal_value || 0),
                        target_wins: goalCount,
                    });
                }
            }

            message.success(isEditing ? "Funcionario atualizado." : "Funcionario criado.");
            closeModal();
            await loadEmployees();
        } catch (error: any) {
            if (error?.errorFields) {
                return;
            }

            message.error(error?.message || "Nao foi possivel salvar o funcionario.");
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoadingEmployees || clientesQuery?.isLoading) {
        return <Skeleton active />;
    }

    return (
        <div style={{ padding: 20 }}>
            <InsightsHeader
                title="Funcionarios"
                subtitle={`Cadastro do time comercial com metas do mes e produtividade vinculada ao CRM. Fonte: ${sourceTable}.`}
                extra={
                    <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
                        Novo funcionario
                    </Button>
                }
            />

            <IntroCard
                title="Gestao de equipe e performance"
                description="Receita, progresso e metas usam o mesmo recorte do mes atual para conversar com a aba de metas."
            />

            {schemaMissing ? (
                <MissingSchemaAlert description="Nenhuma tabela de funcionarios encontrada (`funcionarios` ou `crm_employees`)." />
            ) : null}

            {errorMessage ? (
                <MissingSchemaAlert
                    title="Falha ao carregar funcionarios"
                    description={errorMessage}
                />
            ) : null}

            <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <div
                    style={{
                        display: "grid",
                        gap: 12,
                        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    }}
                >
                    <StatCard
                        title="Ativos"
                        value={summary.active}
                        prefix={<TeamOutlined style={{ color: "#2563eb" }} />}
                        accentColor="#2563eb"
                    />
                    <StatCard
                        title="Meta mensal consolidada"
                        value={summary.totalGoal}
                        prefix={<TrophyOutlined style={{ color: "#f59e0b" }} />}
                        accentColor="#f59e0b"
                        subtitle={formatCurrencyBRL(summary.totalGoal, "R$ 0,00")}
                    />
                    <StatCard
                        title="Receita do mes"
                        value={summary.totalRevenue}
                        prefix={<UserOutlined style={{ color: "#16a34a" }} />}
                        accentColor="#16a34a"
                        subtitle={formatCurrencyBRL(summary.totalRevenue, "R$ 0,00")}
                    />
                    <StatCard
                        title="Cobertura da meta"
                        value={Number(summary.goalCoverage.toFixed(1))}
                        suffix="%"
                        accentColor="#0f766e"
                        valueStyle={{ color: "#115e59" }}
                    />
                </div>

                <Card
                    title="Equipe comercial"
                    extra={<Typography.Text type="secondary">Base do mes atual</Typography.Text>}
                >
                    {enrichedEmployees.length === 0 ? (
                        <EmptyState
                            title="Nenhum funcionario cadastrado"
                            description="Cadastre o time para acompanhar metas e desempenho no CRM."
                            actionLabel="Cadastrar funcionario"
                            onAction={openCreateModal}
                        />
                    ) : (
                        <Table
                            size="small"
                            rowKey={(record) => record.id}
                            pagination={{ pageSize: 10 }}
                            dataSource={enrichedEmployees}
                            columns={[
                                {
                                    title: "Funcionario",
                                    render: (_, record: EnrichedEmployeeRecord) => (
                                        <Space direction="vertical" size={0}>
                                            <Typography.Text strong>{record.full_name}</Typography.Text>
                                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                                {record.role || "Sem cargo"}
                                            </Typography.Text>
                                        </Space>
                                    ),
                                },
                                {
                                    title: "Contato",
                                    render: (_, record: EnrichedEmployeeRecord) => record.email || "-",
                                },
                                {
                                    title: "Status",
                                    width: 110,
                                    render: (_, record: EnrichedEmployeeRecord) =>
                                        record.active === false ? (
                                            <Tag color="default">Inativo</Tag>
                                        ) : (
                                            <Tag color="green">Ativo</Tag>
                                        ),
                                },
                                {
                                    title: "Ganhos",
                                    width: 80,
                                    render: (_, record: EnrichedEmployeeRecord) => record.atualGanhos || 0,
                                },
                                {
                                    title: "Receita",
                                    width: 130,
                                    render: (_, record: EnrichedEmployeeRecord) =>
                                        formatCurrencyBRL(record.atualValor, "R$ 0,00"),
                                },
                                {
                                    title: "Meta (R$)",
                                    width: 140,
                                    render: (_, record: EnrichedEmployeeRecord) =>
                                        formatCurrencyBRL(record.monthly_goal_value || 0, "R$ 0,00"),
                                },
                                {
                                    title: "Progresso",
                                    width: 190,
                                    render: (_, record: EnrichedEmployeeRecord) => (
                                        <Progress
                                            percent={Number(record.valueProgress.toFixed(1))}
                                            size="small"
                                            strokeColor={record.valueProgress >= 100 ? "#16a34a" : "#2563eb"}
                                        />
                                    ),
                                },
                                {
                                    title: "",
                                    width: 120,
                                    render: (_, record: EnrichedEmployeeRecord) => (
                                        <Button size="small" onClick={() => openEditModal(record)}>
                                            Editar
                                        </Button>
                                    ),
                                },
                            ]}
                        />
                    )}
                </Card>
            </Space>

            <Modal
                title={editingEmployee ? "Editar funcionario" : "Novo funcionario"}
                open={isModalOpen}
                onCancel={closeModal}
                onOk={handleSave}
                confirmLoading={isSaving}
                okText={editingEmployee ? "Salvar alteracoes" : "Criar funcionario"}
                cancelText="Cancelar"
                destroyOnClose
            >
                <Form form={form} layout="vertical" preserve={false}>
                    <Form.Item
                        label="Nome completo"
                        name="full_name"
                        rules={[{ required: true, message: "Informe o nome." }]}
                    >
                        <Input placeholder="Ex: Maria Carolina" />
                    </Form.Item>
                    <Form.Item label="E-mail" name="email">
                        <Input placeholder="maria@empresa.com" />
                    </Form.Item>
                    <Form.Item label="Cargo" name="role">
                        <Input placeholder="Ex: Consultor(a) comercial" />
                    </Form.Item>
                    <Space size={10} style={{ width: "100%" }}>
                        <Form.Item label="Meta mensal (R$)" name="monthly_goal_value" style={{ flex: 1 }}>
                            <InputNumber min={0} style={{ width: "100%" }} />
                        </Form.Item>
                        {supportsGoalCount ? (
                            <Form.Item
                                label="Meta de fechamentos"
                                name="monthly_goal_count"
                                style={{ flex: 1 }}
                            >
                                <InputNumber min={0} style={{ width: "100%" }} />
                            </Form.Item>
                        ) : null}
                    </Space>
                    <Form.Item label="Ativo" name="active" valuePropName="checked">
                        <Switch />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
};
