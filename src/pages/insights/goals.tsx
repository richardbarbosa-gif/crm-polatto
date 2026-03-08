import { FlagOutlined, PlusOutlined, TrophyOutlined } from "@ant-design/icons";
import { useList } from "@refinedev/core";
import {
    DatePicker,
    Form,
    InputNumber,
    Modal,
    Progress,
    Segmented,
    Skeleton,
    Space,
    Table,
    Typography,
    message,
    Divider
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

type GoalsSourceMode = "current" | "legacy";

type EmployeeRecord = {
    id: string;
    full_name: string;
    role?: string | null;
    active?: boolean | null;
};

type GoalRecord = {
    id?: string;
    employee_id: string;
    goal_month: string;
    target_value: number;
    target_wins: number;
};

type BatchGoalFormValues = {
    goals: Array<{
        employee_id: string;
        employee_name: string;
        target_value: number;
        target_wins: number;
    }>;
};

type GoalViewMode = "valor" | "quantidade";

const matchOwner = (
    ownerRows: ReturnType<typeof buildOwnerPerformance>,
    employeeId: string,
    employeeName: string,
) => {
    // 1. Tenta cruzar pelo ID relacional (Novo Padrão)
    const exactMatch = ownerRows.find((owner) => owner.owner_id === employeeId);
    if (exactMatch) return exactMatch;

    // 2. Fallback: Cruza pelo nome para vendas antigas que não têm ID
    const employeeKey = normalizeText(employeeName);
    if (!employeeKey) return null;

    return (
        ownerRows.find((owner) => !owner.owner_id && normalizeText(owner.owner) === employeeKey) ||
        ownerRows.find(
            (owner) =>
                !owner.owner_id && (
                normalizeText(owner.owner).includes(employeeKey) ||
                employeeKey.includes(normalizeText(owner.owner)))
        ) || null
    );
};

export const InsightsGoalsPage = () => {
    const [form] = Form.useForm<BatchGoalFormValues>();
    const [monthRef, setMonthRef] = useState<Dayjs>(dayjs().startOf("month"));
    const [viewMode, setViewMode] = useState<GoalViewMode>("valor");
    const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
    const [goals, setGoals] = useState<GoalRecord[]>([]);
    const [isLoadingData, setIsLoadingData] = useState<boolean>(true);
    const [schemaMissing, setSchemaMissing] = useState<boolean>(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [sourceMode, setSourceMode] = useState<GoalsSourceMode>("current");

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
                .select("id, nome, cargo, ativo")
                .eq("ativo", true)
                .order("nome", { ascending: true });

            if (!currentEmployees.error) {
                const currentGoals = await supabaseClient
                    .from("metas")
                    .select("*")
                    .eq("mes_referencia", monthStart);

                if (currentGoals.error && !isSupabaseMissingRelation(currentGoals.error)) {
                    throw currentGoals.error;
                }

                setSourceMode("current");
                setEmployees(
                    ((currentEmployees.data || []) as any[]).map((row) => ({
                        id: String(row.id),
                        full_name: row.nome || "Sem nome",
                        role: row.cargo || null,
                        active: row.ativo !== false,
                    })),
                );
                setGoals(
                    ((currentGoals.data || []) as any[]).map((row) => ({
                        id: String(row.id),
                        employee_id: String(row.funcionario_id),
                        goal_month: row.mes_referencia,
                        target_value: Number(row.valor_meta || 0),
                        target_wins: Number(row.target_wins || 0),
                    })),
                );
                setSchemaMissing(false);
                return;
            }

            if (!isSupabaseMissingRelation(currentEmployees.error)) {
                throw currentEmployees.error;
            }

            const [legacyEmployees, legacyGoals] = await Promise.all([
                supabaseClient.from("crm_employees").select("*").eq("active", true).order("full_name", { ascending: true }),
                supabaseClient.from("crm_goals").select("*").eq("goal_month", monthStart),
            ]);

            if (legacyEmployees.error) throw legacyEmployees.error;
            if (legacyGoals.error) throw legacyGoals.error;

            setSourceMode("legacy");
            setEmployees(
                ((legacyEmployees.data || []) as any[]).map((row) => ({
                    id: String(row.id),
                    full_name: row.full_name || "Sem nome",
                    role: row.role || null,
                    active: row.active !== false,
                })),
            );
            setGoals(
                ((legacyGoals.data || []) as any[]).map((row) => ({
                    id: String(row.id),
                    employee_id: String(row.employee_id),
                    goal_month: row.goal_month,
                    target_value: Number(row.target_value || 0),
                    target_wins: Number(row.target_wins || 0),
                })),
            );
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
            const owner = matchOwner(ownerRows, employee.id, employee.full_name);
            const targetValue = Number(goal?.target_value || 0);
            const targetWins = Number(goal?.target_wins || 0);
            const actualValue = Number(owner?.valor || 0);
            const actualWins = Number(owner?.ganhos || 0);
            const valueProgress = targetValue > 0 ? (actualValue / targetValue) * 100 : 0;
            const winsProgress = targetWins > 0 ? (actualWins / targetWins) * 100 : 0;

            return {
                employee,
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
        const valueProgress = totalTargetValue > 0 ? (totalActualValue / totalTargetValue) * 100 : 0;
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

    const openBatchModal = () => {
        const formData = employees.map(emp => {
            const existingGoal = goals.find(g => g.employee_id === emp.id);
            return {
                employee_id: emp.id,
                employee_name: emp.full_name,
                target_value: existingGoal?.target_value || 0,
                target_wins: existingGoal?.target_wins || 0,
            };
        });

        form.setFieldsValue({ goals: formData });
        setIsModalOpen(true);
    };

    const handleSaveBatch = async () => {
        try {
            setIsSaving(true);
            const values = await form.validateFields();
            const monthStart = monthRef.startOf("month").format("YYYY-MM-DD");

            if (sourceMode === "current") {
                const payload = values.goals.map(g => ({
                    funcionario_id: g.employee_id,
                    mes_referencia: monthStart,
                    valor_meta: g.target_value,
                    target_wins: g.target_wins
                }));

                const { error } = await supabaseClient
                    .from("metas")
                    .upsert(payload, { onConflict: "funcionario_id,mes_referencia" });
                if (error) throw error;
            } else {
                const payload = values.goals.map(g => ({
                    employee_id: g.employee_id,
                    goal_month: monthStart,
                    target_value: g.target_value,
                    target_wins: g.target_wins,
                    updated_at: new Date().toISOString(),
                }));

                const { error } = await supabaseClient
                    .from("crm_goals")
                    .upsert(payload, { onConflict: "employee_id,goal_month" });
                if (error) throw error;
            }

            message.success(`Metas de ${monthRef.format("MMMM")} salvas com sucesso.`);
            setIsModalOpen(false);
            await loadData();
        } catch (error: any) {
            if (error?.errorFields) return;
            message.error(error?.message || "Não foi possível salvar as metas.");
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
                title="Quadro de Metas"
                subtitle={`Acompanhamento financeiro e performance da equipa. Mês: ${monthRef.format("MM/YYYY")}`}
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
                                { label: "Por Receita (R$)", value: "valor" },
                                { label: "Por Fechamentos", value: "quantidade" },
                            ]}
                            value={viewMode}
                            onChange={(value) => setViewMode(value)}
                        />
                        <Button type="primary" icon={<PlusOutlined />} onClick={openBatchModal}>
                            Definir Metas do Mês
                        </Button>
                    </Space>
                }
            />

            <IntroCard
                title="Previsibilidade e Sazonalidade"
                description="As metas são exclusivas para o mês selecionado. Altere as expectativas da equipa consoante a sazonalidade sem afetar o histórico de meses anteriores."
            />

            {schemaMissing ? <MissingSchemaAlert description="Tabela de metas não encontrada." /> : null}
            {errorMessage ? <MissingSchemaAlert title="Falha ao carregar" description={errorMessage} /> : null}

            <div
                style={{
                    display: "grid",
                    gap: 12,
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    marginBottom: 12,
                }}
            >
                <StatCard
                    title={viewMode === "valor" ? "Meta da Equipa (R$)" : "Meta de Vendas (Qtd)"}
                    value={viewMode === "valor" ? summary.totalTargetValue : summary.totalTargetWins}
                    prefix={<FlagOutlined style={{ color: "#2563eb" }} />}
                    accentColor="#2563eb"
                    subtitle={viewMode === "valor" ? formatCurrencyBRL(summary.totalTargetValue, "R$ 0,00") : `${summary.totalTargetWins} negócios`}
                />
                <StatCard
                    title="Realizado"
                    value={viewMode === "valor" ? summary.totalActualValue : summary.totalActualWins}
                    prefix={<TrophyOutlined style={{ color: "#16a34a" }} />}
                    accentColor="#16a34a"
                    subtitle={viewMode === "valor" ? formatCurrencyBRL(summary.totalActualValue, "R$ 0,00") : `${summary.totalActualWins} ganhos`}
                />
                <StatCard
                    title="Atingimento Global"
                    value={Number((viewMode === "valor" ? summary.valueProgress : summary.winsProgress).toFixed(1))}
                    suffix="%"
                    accentColor="#0f766e"
                    valueStyle={{ color: "#115e59" }}
                />
            </div>

            <Card title={`Performance de Vendas - ${monthRef.format("MMMM [de] YYYY")}`}>
                {rows.length === 0 ? (
                    <EmptyState
                        title="Sem equipa ativa"
                        description="Cadastre utilizadores no menu 'Equipe' para definir metas."
                    />
                ) : (
                    <Table
                        size="small"
                        rowKey={(record) => record.employee.id}
                        pagination={{ pageSize: 15 }}
                        dataSource={rows}
                        columns={[
                            {
                                title: "Consultor",
                                render: (_, record: any) => (
                                    <Space direction="vertical" size={0}>
                                        <Typography.Text strong>{record.employee.full_name}</Typography.Text>
                                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                            {record.employee.role || "Sem cargo"}
                                        </Typography.Text>
                                    </Space>
                                ),
                            },
                            {
                                title: viewMode === "valor" ? "Meta (R$)" : "Meta (Qtd)",
                                width: 140,
                                render: (_, record: any) =>
                                    viewMode === "valor" 
                                        ? formatCurrencyBRL(record.targetValue, "R$ 0,00")
                                        : record.targetWins,
                            },
                            {
                                title: "Realizado",
                                width: 150,
                                render: (_, record: any) =>
                                    viewMode === "valor"
                                        ? formatCurrencyBRL(record.actualValue, "R$ 0,00")
                                        : record.actualWins,
                            },
                            {
                                title: "Progresso Mensal",
                                width: 250,
                                render: (_, record: any) => {
                                    const percent = viewMode === "valor" ? record.valueProgress : record.winsProgress;
                                    return (
                                        <Progress
                                            percent={Number(percent.toFixed(1))}
                                            size="small"
                                            strokeColor={percent >= 100 ? "#16a34a" : "#2563eb"}
                                        />
                                    );
                                },
                            }
                        ]}
                    />
                )}
            </Card>

            <Modal
                title={`Metas de Vendas: ${monthRef.format("MMMM [de] YYYY")}`}
                open={isModalOpen}
                width={700}
                onCancel={() => setIsModalOpen(false)}
                onOk={handleSaveBatch}
                okText="Salvar todas as metas"
                cancelText="Cancelar"
                confirmLoading={isSaving}
                destroyOnClose
            >
                <Typography.Paragraph type="secondary">
                    Defina os objetivos de receita e quantidade de fechamentos para toda a equipa ativa neste mês.
                </Typography.Paragraph>
                <Form form={form} layout="vertical">
                    <Form.List name="goals">
                        {(fields) => (
                            <div style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: 10 }}>
                                {fields.map((field, index) => (
                                    <div key={field.key}>
                                        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end' }}>
                                            <Form.Item
                                                {...field}
                                                name={[field.name, 'employee_id']}
                                                hidden
                                            ><InputNumber /></Form.Item>
                                            
                                            <Form.Item
                                                label={index === 0 ? "Consultor" : ""}
                                                {...field}
                                                name={[field.name, 'employee_name']}
                                                style={{ flex: 2, marginBottom: 12 }}
                                            >
                                                <Typography.Text strong>{form.getFieldValue(['goals', field.name, 'employee_name'])}</Typography.Text>
                                            </Form.Item>

                                            <Form.Item
                                                label={index === 0 ? "Meta Receita (R$)" : ""}
                                                {...field}
                                                name={[field.name, 'target_value']}
                                                style={{ flex: 1.5, marginBottom: 12 }}
                                            >
                                                <InputNumber
                                                    style={{ width: '100%' }}
                                                    min={0 as number}
                                                    formatter={(value) => `R$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}
                                                    parser={(value) => value ? Number(value.replace(/[^0-9.-]+/g, "")) : 0}
                                                />
                                            </Form.Item>

                                            <Form.Item
                                                label={index === 0 ? "Meta Qtd." : ""}
                                                {...field}
                                                name={[field.name, 'target_wins']}
                                                style={{ flex: 1, marginBottom: 12 }}
                                            >
                                                <InputNumber style={{ width: '100%' }} min={0} />
                                            </Form.Item>
                                        </div>
                                        {index < fields.length - 1 && <Divider style={{ margin: '8px 0' }} />}
                                    </div>
                                ))}
                            </div>
                        )}
                    </Form.List>
                </Form>
            </Modal>
        </div>
    );
};