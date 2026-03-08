import { PlusOutlined, TeamOutlined, UserOutlined } from "@ant-design/icons";
import {
    Form,
    Input,
    InputNumber,
    Modal,
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
import { formatCurrencyBRL } from "../../lib/formatters";
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
    current_target_value?: number; // Trazemos a meta do mês atual de volta para a visão!
    current_target_wins?: number;
};

type EmployeeFormValues = {
    full_name: string;
    email?: string;
    role?: string;
    active?: boolean;
    target_value?: number;
    target_wins?: number;
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

    const loadEmployees = useCallback(async () => {
        setIsLoadingEmployees(true);
        setErrorMessage(null);
        try {
            const monthStart = dayjs().startOf("month").format("YYYY-MM-DD");

            const current = await supabaseClient
                .from("funcionarios")
                .select("*")
                .order("created_at", { ascending: false });

            if (!current.error) {
                // Busca as metas do mês atual para mostrar na tabela!
                const goalsRes = await supabaseClient.from("metas").select("*").eq("mes_referencia", monthStart);
                const goalsData = goalsRes.data || [];

                setSourceTable("funcionarios");
                setEmployees(((current.data || []) as any[]).map((row) => {
                    const goal = goalsData.find((g: any) => String(g.funcionario_id) === String(row.id));
                    return {
                        id: String(row.id),
                        full_name: row.nome || "Sem nome",
                        email: row.email || null,
                        role: row.cargo || null,
                        active: row.ativo !== false,
                        created_at: row.created_at || null,
                        current_target_value: goal ? Number(goal.valor_meta || 0) : 0,
                        current_target_wins: goal ? Number(goal.target_wins || 0) : 0,
                    };
                }));
                setSchemaMissing(false);
                return;
            }

            if (!isSupabaseMissingRelation(current.error)) {
                throw current.error;
            }

            // Fallback
            const legacy = await supabaseClient
                .from("crm_employees")
                .select("*")
                .order("created_at", { ascending: false });

            if (legacy.error) throw legacy.error;

            const legacyGoalsRes = await supabaseClient.from("crm_goals").select("*").eq("goal_month", monthStart);
            const legacyGoalsData = legacyGoalsRes.data || [];

            setSourceTable("crm_employees");
            setEmployees(((legacy.data || []) as any[]).map((row) => {
                const goal = legacyGoalsData.find((g: any) => String(g.employee_id) === String(row.id));
                return {
                    id: String(row.id),
                    full_name: row.full_name || "Sem nome",
                    email: row.email || null,
                    role: row.role || null,
                    active: row.active !== false,
                    created_at: row.created_at || null,
                    current_target_value: goal ? Number(goal.target_value || 0) : 0,
                    current_target_wins: goal ? Number(goal.target_wins || 0) : 0,
                };
            }));
            setSchemaMissing(false);
        } catch (error: any) {
            if (isSupabaseMissingRelation(error)) {
                setSchemaMissing(true);
                setEmployees([]);
            } else {
                setErrorMessage(error?.message || "Falha ao carregar funcionários.");
            }
        } finally {
            setIsLoadingEmployees(false);
        }
    }, []);

    useEffect(() => {
        loadEmployees();
    }, [loadEmployees]);

    // A SOLUÇÃO DO BUG DO FORMULÁRIO EM BRANCO ESTÁ AQUI:
    // O formulário agora espera o modal abrir para preencher os dados corretamente.
    useEffect(() => {
        if (isModalOpen) {
            if (editingEmployee) {
                form.setFieldsValue({
                    full_name: editingEmployee.full_name,
                    email: editingEmployee.email || "",
                    role: editingEmployee.role || "",
                    active: editingEmployee.active !== false,
                    target_value: editingEmployee.current_target_value || 0,
                    target_wins: editingEmployee.current_target_wins || 0,
                });
            } else {
                form.resetFields();
                form.setFieldsValue({
                    active: true,
                    target_value: 0,
                    target_wins: 0,
                });
            }
        }
    }, [isModalOpen, editingEmployee, form]);

    const summary = useMemo(() => {
        const active = employees.filter((employee) => employee.active !== false).length;
        const total = employees.length;
        return { active, total };
    }, [employees]);

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
            const monthStart = dayjs().startOf("month").format("YYYY-MM-DD");

            if (sourceTable === "funcionarios") {
                const payload = {
                    nome: values.full_name.trim(),
                    email: values.email?.trim() || null,
                    cargo: values.role?.trim() || null,
                    ativo: values.active !== false,
                };

                let savedEmployeeId = editingEmployee?.id;

                // 1. Salva os dados do RH
                if (savedEmployeeId) {
                    const { error } = await supabaseClient.from("funcionarios").update(payload).eq("id", savedEmployeeId);
                    if (error) throw error;
                } else {
                    const { data, error } = await supabaseClient.from("funcionarios").insert(payload).select("id").single();
                    if (error) throw error;
                    savedEmployeeId = String(data?.id);
                }

                // 2. Salva a Meta (Integrando os painéis!)
                if (savedEmployeeId) {
                    await supabaseClient.from("metas").upsert({
                        funcionario_id: savedEmployeeId,
                        mes_referencia: monthStart,
                        valor_meta: values.target_value || 0,
                        target_wins: values.target_wins || 0
                    }, { onConflict: "funcionario_id,mes_referencia" });
                }

                message.success("Funcionário e metas atualizados!");
            } else {
                // Legado
                const payload = {
                    full_name: values.full_name.trim(),
                    email: values.email?.trim() || null,
                    role: values.role?.trim() || null,
                    active: values.active !== false,
                    updated_at: new Date().toISOString(),
                };

                let savedEmployeeId = editingEmployee?.id;

                if (savedEmployeeId) {
                    await supabaseClient.from("crm_employees").update(payload).eq("id", savedEmployeeId);
                } else {
                    const { data, error } = await supabaseClient.from("crm_employees").insert({
                        ...payload,
                        created_at: new Date().toISOString(),
                    }).select("id").single();
                    if (error) throw error;
                    savedEmployeeId = String(data?.id);
                }

                if (savedEmployeeId) {
                    await supabaseClient.from("crm_goals").upsert({
                        employee_id: savedEmployeeId,
                        goal_month: monthStart,
                        target_value: values.target_value || 0,
                        target_wins: values.target_wins || 0
                    }, { onConflict: "employee_id,goal_month" });
                }

                message.success("Funcionário criado.");
            }

            setIsModalOpen(false);
            setEditingEmployee(null);
            await loadEmployees();
        } catch (error: any) {
            if (error?.errorFields) return;
            message.error(error?.message || "Não foi possível salvar o funcionário.");
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoadingEmployees) {
        return <Skeleton active />;
    }

    return (
        <div style={{ padding: 20 }}>
            <InsightsHeader
                title="Equipe e Metas (Mês Atual)"
                subtitle={`Gestão do diretório de utilizadores e acompanhamento imediato. Fonte: ${sourceTable}.`}
                extra={
                    <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
                        Novo funcionário
                    </Button>
                }
            />

            <IntroCard
                title="Gestão de utilizadores"
                description="Controle quem faz parte da sua operação comercial, os seus respetivos cargos e veja rapidamente a meta definida para o mês em curso."
            />

            {schemaMissing ? <MissingSchemaAlert description="Nenhuma tabela de funcionários encontrada (`funcionarios` ou `crm_employees`)." /> : null}
            {errorMessage ? <MissingSchemaAlert title="Falha ao carregar funcionários" description={errorMessage} /> : null}

            <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                    <StatCard title="Total de Funcionários" value={summary.total} prefix={<TeamOutlined style={{ color: "#2563eb" }} />} accentColor="#2563eb" />
                    <StatCard title="Ativos no momento" value={summary.active} prefix={<UserOutlined style={{ color: "#16a34a" }} />} accentColor="#16a34a" />
                </div>

                <Card title="Diretório da Equipe">
                    {employees.length === 0 ? (
                        <EmptyState title="Nenhum funcionário cadastrado" description="Cadastre o seu time para que eles possam assumir oportunidades no CRM." actionLabel="Cadastrar funcionário" onAction={openCreateModal} />
                    ) : (
                        <Table
                            size="small"
                            rowKey={(record) => record.id}
                            pagination={{ pageSize: 10 }}
                            dataSource={employees}
                            columns={[
                                {
                                    title: "Funcionário",
                                    render: (_, record: EmployeeRecord) => (
                                        <Space direction="vertical" size={0}>
                                            <Typography.Text strong>{record.full_name}</Typography.Text>
                                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{record.role || "Sem cargo"}</Typography.Text>
                                        </Space>
                                    ),
                                },
                                { title: "Contato (Login)", render: (_, record: EmployeeRecord) => record.email || "-" },
                                {
                                    title: "Meta (Mês Atual)",
                                    width: 150,
                                    render: (_, record: EmployeeRecord) => formatCurrencyBRL(record.current_target_value || 0, "R$ 0,00"),
                                },
                                {
                                    title: "Status",
                                    width: 100,
                                    render: (_, record: EmployeeRecord) =>
                                        record.active === false ? <Tag color="default">Inativo</Tag> : <Tag color="green">Ativo</Tag>,
                                },
                                {
                                    title: "",
                                    width: 100,
                                    align: "right",
                                    render: (_, record: EmployeeRecord) => (
                                        <Button size="small" onClick={() => openEditModal(record)}>Editar</Button>
                                    ),
                                },
                            ]}
                        />
                    )}
                </Card>
            </Space>

            <Modal
                title={editingEmployee ? "Editar Funcionário e Meta do Mês" : "Novo Funcionário"}
                open={isModalOpen}
                onCancel={() => setIsModalOpen(false)}
                onOk={handleSave}
                confirmLoading={isSaving}
                okText={editingEmployee ? "Salvar alterações" : "Criar funcionário"}
                cancelText="Cancelar"
                destroyOnClose
            >
                <Form form={form} layout="vertical" preserve={false}>
                    <Form.Item label="Nome completo" name="full_name" rules={[{ required: true, message: "Informe o nome." }]}>
                        <Input placeholder="Ex: Maria Carolina" />
                    </Form.Item>
                    <Form.Item label="E-mail (Usado para Login)" name="email">
                        <Input placeholder="maria@empresa.com" />
                    </Form.Item>
                    <Form.Item label="Cargo" name="role">
                        <Input placeholder="Ex: Consultor(a) comercial" />
                    </Form.Item>
                    
                    <Typography.Title level={5} style={{ marginTop: '20px' }}>Metas para o Mês Atual</Typography.Title>
                    <Space size={10} style={{ width: "100%" }}>
                        <Form.Item label="Meta Receita (R$)" name="target_value" style={{ flex: 1 }}>
                            <InputNumber 
                                min={0 as number} 
                                style={{ width: "100%" }} 
                                formatter={(value) => `R$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}
                                parser={(value) => value ? Number(value.replace(/[^0-9.-]+/g, "")) : 0}
                            />
                        </Form.Item>
                        <Form.Item label="Meta Fechamentos (Qtd)" name="target_wins" style={{ flex: 1 }}>
                            <InputNumber min={0} style={{ width: "100%" }} />
                        </Form.Item>
                    </Space>

                    <Form.Item label="Acesso Ativo no CRM" name="active" valuePropName="checked">
                        <Switch />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
};