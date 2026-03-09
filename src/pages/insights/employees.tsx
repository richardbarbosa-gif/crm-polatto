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
import { formatCurrencyBRL, normalizeText } from "../../lib/formatters";
import { buildOwnerPerformance, type InsightClienteRecord } from "../../lib/insights";
import { isSupabaseMissingRelation } from "../../lib/supabaseErrors";
import { supabaseClient } from "../../utility";
import { InsightsHeader, IntroCard, MissingSchemaAlert } from "./shared";

type EmployeeSourceTable = "funcionarios" | "crm_employees";

type EmployeeRecord = {
    id: string;
    full_name: string;
    email?: string | null;
    role?: string | null;
    monthly_goal_value?: number | null;
    monthly_goal_count?: number | null;
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

const matchOwnerPerformance = (
    ownerRows: ReturnType<typeof buildOwnerPerformance>,
    employeeName: string,
) => {
    const employeeKey = normalizeText(employeeName);
    if (!employeeKey) return null;

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

const toEmployeeRecord = (row: any, sourceTable: EmployeeSourceTable, metaDoMes?: any): EmployeeRecord => {
    if (sourceTable === "funcionarios") {
        return {
            id: String(row.id),
            full_name: row.nome || "Sem nome",
            email: row.email || null,
            role: row.cargo || null,
            // AQUI O SEGREDO: Puxamos a meta cruzada da tabela "metas"
            monthly_goal_value: metaDoMes ? Number(metaDoMes.valor_meta) : 0,
            monthly_goal_count: metaDoMes ? Number(metaDoMes.target_wins || 0) : 0,
            active: row.ativo !== false,
            created_at: row.created_at || null,
        };
    }

    // Legado
    return {
        id: String(row.id),
        full_name: row.full_name || "Sem nome",
        email: row.email || null,
        role: row.role || null,
        monthly_goal_value: Number(row.monthly_goal_value || 0),
        monthly_goal_count: Number(row.monthly_goal_count || 0),
        active: row.active !== false,
        created_at: row.created_at || null,
    };
};

export const InsightsEmployeesPage = () => {
    const [form] = Form.useForm<EmployeeFormValues>();
    const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
    const [isLoadingEmployees, setIsLoadingEmployees] = useState<boolean>(true);
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
    const [editingEmployee, setEditingEmployee] = useState<EmployeeRecord | null>(null);
    const [schemaMissing, setSchemaMissing] = useState<boolean>(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [sourceTable, setSourceTable] = useState<EmployeeSourceTable>("funcionarios");

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
                setSourceTable("funcionarios");
                
                // BUSCA AS METAS DO MÊS ATUAL PARA MOSTRAR NA TABELA
                const monthStart = dayjs().startOf("month").format("YYYY-MM-DD");
                const metas = await supabaseClient
                    .from("metas")
                    .select("*")
                    .eq("mes_referencia", monthStart);
                
                const metasMap = new Map();
                if (!metas.error && metas.data) {
                    metas.data.forEach(m => metasMap.set(m.funcionario_id, m));
                }

                setEmployees(((current.data || []) as any[]).map((row) => {
                    const metaDoFuncionario = metasMap.get(row.id);
                    return toEmployeeRecord(row, "funcionarios", metaDoFuncionario);
                }));
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

            setSourceTable("crm_employees");
            setEmployees(((legacy.data || []) as any[]).map((row) => toEmployeeRecord(row, "crm_employees")));
            setSchemaMissing(false);
        } catch (error: any) {
            if (isSupabaseMissingRelation(error)) {
                setSchemaMissing(true);
                setEmployees([]);
            } else {
                setErrorMessage(error?.message || "Falha ao carregar funcionarios.");
            }
        } finally {
            setIsLoadingEmployees(false);
        }
    }, []);

    useEffect(() => {
        loadEmployees();
    }, [loadEmployees]);

    const ownerRows = useMemo(() => buildOwnerPerformance(clientes), [clientes]);

    const enrichedEmployees = useMemo(() => {
        return employees.map((employee) => {
            const owner = matchOwnerPerformance(ownerRows, employee.full_name);
            const atualValor = owner?.valor || 0;
            const atualGanhos = owner?.ganhos || 0;
            const goalValue = Number(employee.monthly_goal_value || 0);
            const goalCount = Number(employee.monthly_goal_count || 0);
            const valueProgress = goalValue > 0 ? (atualValor / goalValue) * 100 : 0;
            const winProgress = goalCount > 0 ? (atualGanhos / goalCount) * 100 : 0;

            return {
                ...employee,
                atualValor,
                atualGanhos,
                valueProgress,
                winProgress,
            };
        });
    }, [employees, ownerRows]);

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
        const avgProgress =
            enrichedEmployees.length > 0
                ? enrichedEmployees.reduce((acc, employee) => acc + employee.valueProgress, 0) /
                  enrichedEmployees.length
                : 0;

        return { active, totalGoal, totalRevenue, avgProgress };
    }, [enrichedEmployees]);

    // CORREÇÃO 1: Garante que os dados preencham o formulário APÓS o Modal renderizar
    useEffect(() => {
        if (isModalOpen) {
            if (editingEmployee) {
                form.setFieldsValue({
                    full_name: editingEmployee.full_name,
                    email: editingEmployee.email || "",
                    role: editingEmployee.role || "",
                    monthly_goal_value: Number(editingEmployee.monthly_goal_value || 0),
                    monthly_goal_count: Number(editingEmployee.monthly_goal_count || 0),
                    active: editingEmployee.active !== false,
                });
            } else {
                form.resetFields();
                form.setFieldsValue({
                    active: true,
                    monthly_goal_value: 0,
                    monthly_goal_count: 0,
                });
            }
        }
    }, [isModalOpen, editingEmployee, form]);

    const openCreateModal = () => {
        setEditingEmployee(null);
        setIsModalOpen(true);
    };

    const openEditModal = (employee: EmployeeRecord) => {
        setEditingEmployee(employee);
        setIsModalOpen(true);
    };

    const handleSave = async () => {
        try {
            setIsSaving(true);
            const values = await form.validateFields();

            if (sourceTable === "funcionarios") {
                const payloadFuncionario = {
                    nome: values.full_name.trim(),
                    email: values.email?.trim() || null,
                    cargo: values.role?.trim() || null,
                    ativo: values.active !== false,
                };

                let currentEmployeeId = editingEmployee?.id;

                // 1. Salva os dados na tabela 'funcionarios'
                if (currentEmployeeId) {
                    const { error } = await supabaseClient
                        .from("funcionarios")
                        .update(payloadFuncionario)
                        .eq("id", currentEmployeeId);
                    if (error) throw error;
                } else {
                    const { data, error } = await supabaseClient
                        .from("funcionarios")
                        .insert(payloadFuncionario)
                        .select("id")
                        .single();
                    if (error) throw error;
                    currentEmployeeId = data.id;
                }

                // 2. CORREÇÃO 2: Salva a Meta na tabela 'metas' (Seguro contra erros de banco)
                if (currentEmployeeId) {
                    const monthStart = dayjs().startOf("month").format("YYYY-MM-DD");
                    
                    const checkMeta = await supabaseClient
                        .from("metas")
                        .select("id")
                        .eq("funcionario_id", currentEmployeeId)
                        .eq("mes_referencia", monthStart)
                        .maybeSingle();

                    if (checkMeta.data?.id) {
                        await supabaseClient
                            .from("metas")
                            .update({ valor_meta: Number(values.monthly_goal_value || 0) })
                            .eq("id", checkMeta.data.id);
                    } else {
                        await supabaseClient
                            .from("metas")
                            .insert({
                                funcionario_id: currentEmployeeId,
                                mes_referencia: monthStart,
                                valor_meta: Number(values.monthly_goal_value || 0)
                            });
                    }
                }

                message.success(editingEmployee ? "Funcionário e metas atualizados." : "Funcionário criado com sucesso.");
            } else {
                const payload = {
                    full_name: values.full_name.trim(),
                    email: values.email?.trim() || null,
                    role: values.role?.trim() || null,
                    monthly_goal_value: Number(values.monthly_goal_value || 0),
                    monthly_goal_count: Number(values.monthly_goal_count || 0),
                    active: values.active !== false,
                    updated_at: new Date().toISOString(),
                };

                if (editingEmployee?.id) {
                    const { error } = await supabaseClient
                        .from("crm_employees")
                        .update(payload)
                        .eq("id", editingEmployee.id);
                    if (error) throw error;
                    message.success("Funcionário atualizado.");
                } else {
                    const { error } = await supabaseClient.from("crm_employees").insert({
                        ...payload,
                        created_at: new Date().toISOString(),
                    });
                    if (error) throw error;
                    message.success("Funcionário criado.");
                }
            }

            setIsModalOpen(false);
            setEditingEmployee(null);
            await loadEmployees(); // Força a tela a recarregar as metas salvas
        } catch (error: any) {
            if (error?.errorFields) return;
            message.error(error?.message || "Não foi possível salvar o funcionário.");
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
                title="Equipe e Funcionários"
                subtitle={`Cadastro do time comercial com metas e produtividade vinculada ao CRM.`}
                extra={
                    <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
                        Novo membro
                    </Button>
                }
            />

            <IntroCard
                title="Gestão de equipe e performance"
                description="Mapeie quem está batendo a meta, quem precisa de coaching e qual carteira gera mais resultado."
            />

            {schemaMissing ? (
                <MissingSchemaAlert description="Nenhuma tabela de funcionários encontrada." />
            ) : null}

            {errorMessage ? (
                <MissingSchemaAlert title="Falha ao carregar funcionários" description={errorMessage} />
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
                        title="Receita atribuída"
                        value={summary.totalRevenue}
                        prefix={<UserOutlined style={{ color: "#16a34a" }} />}
                        accentColor="#16a34a"
                        subtitle={formatCurrencyBRL(summary.totalRevenue, "R$ 0,00")}
                    />
                    <StatCard
                        title="Atingimento médio"
                        value={Number(summary.avgProgress.toFixed(1))}
                        suffix="%"
                        accentColor="#0f766e"
                        valueStyle={{ color: "#115e59" }}
                    />
                </div>

                <Card title="Equipe comercial">
                    {enrichedEmployees.length === 0 ? (
                        <EmptyState
                            title="Nenhum funcionário encontrado"
                            description="Cadastre seu time para acompanhar metas e performance."
                        />
                    ) : (
                        <Table
                            size="small"
                            rowKey="id"
                            pagination={{ pageSize: 10 }}
                            dataSource={enrichedEmployees}
                            columns={[
                                {
                                    title: "Nome",
                                    dataIndex: "full_name",
                                    render: (text, record: EmployeeRecord) => (
                                        <Space direction="vertical" size={0}>
                                            <Typography.Text strong>{text}</Typography.Text>
                                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                                {record.role || "Sem cargo"}
                                            </Typography.Text>
                                        </Space>
                                    ),
                                },
                                {
                                    title: "Email",
                                    dataIndex: "email",
                                    render: (_, record: EmployeeRecord) => record.email || "-",
                                },
                                {
                                    title: "Status",
                                    width: 110,
                                    render: (_, record: EmployeeRecord) =>
                                        record.active === false ? (
                                            <Tag color="default">Inativo</Tag>
                                        ) : (
                                            <Tag color="green">Ativo</Tag>
                                        ),
                                },
                                {
                                    title: "Ganhos",
                                    width: 80,
                                    render: (_, record: any) => record.atualGanhos || 0,
                                },
                                {
                                    title: "Receita",
                                    width: 130,
                                    render: (_, record: any) =>
                                        formatCurrencyBRL(record.atualValor, "R$ 0,00"),
                                },
                                {
                                    title: "Meta mensal",
                                    width: 130,
                                    render: (_, record: any) =>
                                        formatCurrencyBRL(record.monthly_goal_value, "R$ 0,00"),
                                },
                                {
                                    title: "Progresso",
                                    width: 180,
                                    render: (_, record: any) => (
                                        <Progress
                                            percent={Number(record.valueProgress.toFixed(1))}
                                            size="small"
                                            strokeColor={
                                                record.valueProgress >= 100 ? "#16a34a" : "#2563eb"
                                            }
                                        />
                                    ),
                                },
                                {
                                    title: "Ações",
                                    width: 100,
                                    render: (_, record) => (
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
                title={editingEmployee ? "Editar funcionário e metas" : "Novo funcionário"}
                open={isModalOpen}
                onCancel={() => {
                    setIsModalOpen(false);
                    setEditingEmployee(null);
                }}
                onOk={handleSave}
                confirmLoading={isSaving}
                destroyOnClose={false}
            >
                <Form form={form} layout="vertical">
                    <Form.Item label="Nome" name="full_name" rules={[{ required: true }]}>
                        <Input />
                    </Form.Item>

                    <Form.Item label="Email" name="email">
                        <Input />
                    </Form.Item>

                    <Form.Item label="Cargo / Função" name="role">
                        <Input />
                    </Form.Item>

                    <Space size="large" style={{ width: "100%", marginBottom: 16 }}>
                        <Form.Item label="Meta de faturamento (R$)" name="monthly_goal_value" style={{ margin: 0 }}>
                            <InputNumber style={{ width: 180 }} min={0} step={100} prefix="R$" />
                        </Form.Item>
                    </Space>

                    <Form.Item label="Status" name="active" valuePropName="checked">
                        <Switch checkedChildren="Ativo" unCheckedChildren="Inativo" />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
};