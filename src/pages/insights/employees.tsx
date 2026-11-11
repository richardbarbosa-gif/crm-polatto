import {
    CrownOutlined,
    DeleteOutlined,
    KeyOutlined,
    LockOutlined,
    MailOutlined,
    PlusOutlined,
    TeamOutlined,
    TrophyOutlined,
    UserOutlined,
    UsergroupAddOutlined,
} from "@ant-design/icons";
import {
    Alert,
    Form,
    Input,
    InputNumber,
    Modal,
    Progress,
    Select,
    Skeleton,
    Space,
    Switch,
    Table,
    Tag,
    Tooltip,
    Typography,
    message,
} from "antd";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, EmptyState, StatCard } from "../../components/ui";
import { formatCurrencyBRL, formatoProgresso } from "../../lib/formatters";
import { percentual } from "../../lib/pipelineMetrics";
import { isSupabaseMissingRelation } from "../../lib/supabaseErrors";
import { useCrmAccess } from "../../hooks/useCrmAccess";
import { normalizarPapel, rotuloDoPapel } from "../../lib/permissions";
import { criarMembroEquipe, removerMembroEquipe } from "../../lib/equipe";
import { supabaseClient } from "../../utility";
import { InsightsHeader, IntroCard, MissingSchemaAlert } from "./shared";

const { Text } = Typography;

type EmployeeRecord = {
    id: string;
    full_name: string;
    email?: string | null;
    role?: string | null;
    monthly_goal_value?: number | null;
    active?: boolean | null;
    created_at?: string | null;
    has_login?: boolean;
    /** Id do login (auth) — o vínculo com a empresa é por ele. */
    auth_uid?: string | null;
    realizado_valor?: number;
    realizado_qtd?: number;
};

type EmployeeRow = EmployeeRecord & {
    atualValor: number;
    atualGanhos: number;
    valueProgress: number;
};

type FuncionarioRow = {
    id: string;
    user_id?: string | null;
    nome?: string | null;
    email?: string | null;
    cargo?: string | null;
    ativo?: boolean | null;
    created_at?: string | null;
};
type MetaRow = { id?: string; funcionario_id?: string | null; valor_meta?: number | string | null };
type PerformanceRow = {
    funcionario_id?: string | null;
    vendas_qtd?: number | string | null;
    vendas_valor?: number | string | null;
};
type RespostaRpcEquipe = {
    success?: boolean;
    error?: string;
    message?: string;
    user_id?: string;
    tenant_id?: string | number;
};

/** Erros das chamadas diretas ao banco nesta tela (funcionários, metas, papel). */
const mensagemDeErroDaEquipe = (error: unknown, padrao: string): string => {
    const texto = String((error as { message?: unknown })?.message ?? "");
    const codigo = String((error as { code?: unknown })?.code ?? "");
    if (codigo === "PGRST202" || /could not find the function/i.test(texto)) {
        return "A função de gestão de usuários não está instalada neste banco. Fale com o administrador do sistema.";
    }
    return texto || padrao;
};

type EmployeeFormValues = {
    full_name: string;
    email: string;
    senha?: string;
    role?: string;
    cargo?: string;
    monthly_goal_value?: number;
    active?: boolean;
};

// Dois papéis (regra do Richard): gerente faz tudo; vendedor vê tudo e só
// exclui o que é dele. O banco normaliza qualquer outro valor para estes dois.
const ROLE_OPTIONS = [
    { value: "vendedor", label: "Vendedor" },
    { value: "gerente", label: "Gerente" },
];

const ROLE_COLORS: Record<string, string> = {
    gerente: "blue",
    admin: "blue",
    gestor: "purple",
    vendedor: "default",
    manager: "purple",
    superadmin: "gold",
};

export const InsightsEmployeesPage = () => {
    const [form] = Form.useForm<EmployeeFormValues>();
    // Criar, editar e excluir membros (e logins) é tarefa de administrador.
    const { canDeleteRecords: podeGerenciarEquipe } = useCrmAccess();

    const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
    const [isLoadingEmployees, setIsLoadingEmployees] = useState<boolean>(true);
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
    const [editingEmployee, setEditingEmployee] = useState<EmployeeRecord | null>(null);
    const [schemaMissing, setSchemaMissing] = useState<boolean>(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [deletingEmployee, setDeletingEmployee] = useState<EmployeeRecord | null>(null);
    const [isDeleting, setIsDeleting] = useState<boolean>(false);

    const loadEmployees = useCallback(async () => {
        setIsLoadingEmployees(true);
        setErrorMessage(null);
        try {
            const { data: funcData, error: funcError } = await supabaseClient
                .from("funcionarios")
                .select("*")
                .is("deleted_at", null)
                .order("created_at", { ascending: false });

            if (funcError) {
                if (isSupabaseMissingRelation(funcError)) {
                    setSchemaMissing(true);
                    setEmployees([]);
                    return;
                }
                throw funcError;
            }

            // Busca metas do mês atual
            const monthStart = dayjs().startOf("month").format("YYYY-MM-DD");
            const { data: metasData } = await supabaseClient
                .from("metas")
                .select("*")
                .eq("mes_referencia", monthStart);

            const metasMap = new Map<string, MetaRow>();
            ((metasData || []) as MetaRow[]).forEach((m) => {
                if (m.funcionario_id) metasMap.set(String(m.funcionario_id), m);
            });

            // Realizado do mês calculado no banco (ganhos com data de fechamento
            // no mês). Antes a "Receita" somava TODOS os negócios do vendedor —
            // abertos e perdidos, de todos os tempos — e era comparada com a
            // meta MENSAL: o progresso não significava nada.
            const { data: perfData, error: perfError } = await supabaseClient
                .from("vw_performance_vendedores")
                .select("funcionario_id,vendas_qtd,vendas_valor")
                .eq("mes_referencia", monthStart);
            if (perfError && !isSupabaseMissingRelation(perfError)) throw perfError;
            const realizadoMap = new Map<string, PerformanceRow>();
            ((perfData || []) as PerformanceRow[]).forEach((p) => {
                if (p.funcionario_id) realizadoMap.set(String(p.funcionario_id), p);
            });

            // Login: a RLS de utilizadores_empresas mostra o próprio vínculo e os
            // da empresa ATIVA (migration 10). funcionarios.user_id (preenchido
            // quando o login é criado) segue como fonte de reserva.
            const { data: vinculos } = await supabaseClient
                .from("utilizadores_empresas")
                .select("auth_uid, role");

            const vinculoMap = new Map<string, string>();
            ((vinculos || []) as Array<{ auth_uid?: string | null; role?: string | null }>).forEach((v) => {
                if (v.auth_uid) vinculoMap.set(v.auth_uid, v.role || "vendedor");
            });

            const mapped: EmployeeRecord[] = ((funcData || []) as FuncionarioRow[]).map((row) => {
                const id = String(row.id);
                const meta = metasMap.get(id);
                const realizado = realizadoMap.get(id);
                const vinculo = vinculoMap.get(id) ?? (row.user_id ? vinculoMap.get(String(row.user_id)) : undefined);
                return {
                    id,
                    full_name: row.nome || "Sem nome",
                    email: row.email || null,
                    // Papel = vínculo com a empresa (fonte do banco); sem login, "vendedor".
                    role: normalizarPapel(vinculo),
                    auth_uid: vinculoMap.has(id) ? id : row.user_id ? String(row.user_id) : null,
                    monthly_goal_value: meta ? Number(meta.valor_meta) || 0 : 0,
                    active: row.ativo !== false,
                    created_at: row.created_at || null,
                    has_login: Boolean(vinculo || row.user_id),
                    realizado_valor: Number(realizado?.vendas_valor) || 0,
                    realizado_qtd: Number(realizado?.vendas_qtd) || 0,
                };
            });

            setEmployees(mapped);
            setSchemaMissing(false);
        } catch (error: unknown) {
            setErrorMessage((error as { message?: string })?.message || "Falha ao carregar a equipe.");
        } finally {
            setIsLoadingEmployees(false);
        }
    }, []);

    useEffect(() => {
        loadEmployees();
    }, [loadEmployees]);

    const enrichedEmployees = useMemo(() => {
        return employees.map((employee) => {
            const atualValor = employee.realizado_valor || 0;
            const atualGanhos = employee.realizado_qtd || 0;
            const goalValue = Number(employee.monthly_goal_value || 0);
            const valueProgress = percentual(atualValor, goalValue);

            return { ...employee, atualValor, atualGanhos, valueProgress };
        });
    }, [employees]);

    const summary = useMemo(() => {
        const active = enrichedEmployees.filter((e) => e.active !== false).length;
        const withLogin = enrichedEmployees.filter((e) => e.has_login).length;
        const totalGoal = enrichedEmployees.reduce((acc, e) => acc + Number(e.monthly_goal_value || 0), 0);
        const totalRevenue = enrichedEmployees.reduce((acc, e) => acc + (e.atualValor || 0), 0);
        return { active, withLogin, totalGoal, totalRevenue };
    }, [enrichedEmployees]);

    const handleDelete = (employee: EmployeeRecord) => {
        setDeletingEmployee(employee);
    };

    const confirmDelete = async () => {
        if (!deletingEmployee) return;
        setIsDeleting(true);
        try {
            const result = await removerMembroEquipe(deletingEmployee.id);
            if (!result.success) {
                message.error(result.error || "Não foi possível excluir.");
                return;
            }

            message.success(result.message || `${deletingEmployee.full_name} removido.`);
            setDeletingEmployee(null);
            await loadEmployees();
        } catch (error: unknown) {
            message.error(mensagemDeErroDaEquipe(error, "Não foi possível excluir o membro."));
        } finally {
            setIsDeleting(false);
        }
    };

    // ---------- Modal ----------

    const isCreating = !editingEmployee;

    useEffect(() => {
        if (isModalOpen) {
            if (editingEmployee) {
                form.setFieldsValue({
                    full_name: editingEmployee.full_name,
                    email: editingEmployee.email || "",
                    role: editingEmployee.role || "vendedor",
                    cargo: editingEmployee.role || "vendedor",
                    monthly_goal_value: Number(editingEmployee.monthly_goal_value || 0),
                    active: editingEmployee.active !== false,
                    senha: undefined,
                });
            } else {
                form.resetFields();
                form.setFieldsValue({
                    full_name: "",
                    email: "",
                    senha: "",
                    active: true,
                    role: "vendedor",
                    cargo: "",
                    monthly_goal_value: 0,
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

            if (isCreating) {
                // ========== CRIAR NOVO MEMBRO COM LOGIN ==========
                const result = await criarMembroEquipe({
                    email: values.email.trim(),
                    senha: values.senha?.trim() || "",
                    nome: values.full_name.trim(),
                    cargo: values.cargo || values.role || "vendedor",
                    papel: values.role || "vendedor",
                });
                if (!result.success) {
                    message.error(result.error || "Não foi possível criar o usuário.");
                    return;
                }

                // Salva a meta se definida
                if (values.monthly_goal_value && values.monthly_goal_value > 0 && result.user_id) {
                    const monthStart = dayjs().startOf("month").format("YYYY-MM-DD");
                    await supabaseClient.from("metas").insert({
                        funcionario_id: result.user_id,
                        mes_referencia: monthStart,
                        valor_meta: Number(values.monthly_goal_value),
                        tenant_id: result.tenant_id?.toString() || undefined,
                    });
                }

                message.success("Membro criado com sucesso! Ele já pode fazer login.");
            } else {
                // ========== EDITAR MEMBRO EXISTENTE ==========
                const { error: updateError } = await supabaseClient
                    .from("funcionarios")
                    .update({
                        nome: values.full_name.trim(),
                        email: values.email?.trim() || null,
                        cargo: values.cargo || values.role || null,
                        ativo: values.active !== false,
                    })
                    .eq("id", editingEmployee!.id);

                if (updateError) throw updateError;

                // Atualiza meta
                if (editingEmployee!.id) {
                    const monthStart = dayjs().startOf("month").format("YYYY-MM-DD");
                    const { data: existingMeta } = await supabaseClient
                        .from("metas")
                        .select("id")
                        .eq("funcionario_id", editingEmployee!.id)
                        .eq("mes_referencia", monthStart)
                        .maybeSingle();

                    if (existingMeta?.id) {
                        await supabaseClient
                            .from("metas")
                            .update({ valor_meta: Number(values.monthly_goal_value || 0) })
                            .eq("id", existingMeta.id);
                    } else if (values.monthly_goal_value && values.monthly_goal_value > 0) {
                        await supabaseClient.from("metas").insert({
                            funcionario_id: editingEmployee!.id,
                            mes_referencia: monthStart,
                            valor_meta: Number(values.monthly_goal_value),
                        });
                    }
                }

                // Papel: RPC alterar_papel_membro (só gerente, nunca o próprio, a
                // empresa nunca fica sem gerente). Antes era um update direto que a
                // RLS ignorava em silêncio.
                const papelNovo = values.role ? normalizarPapel(values.role) : null;
                const authUid = editingEmployee!.auth_uid;
                let avisoPapel: string | null = null;
                if (editingEmployee!.has_login && authUid && papelNovo && papelNovo !== normalizarPapel(editingEmployee!.role)) {
                    const { data: resultado, error: papelError } = await supabaseClient.rpc("alterar_papel_membro", {
                        p_user_id: authUid,
                        p_papel: papelNovo,
                    });
                    const resposta = (resultado ?? {}) as RespostaRpcEquipe;
                    if (papelError || !resposta.success) {
                        avisoPapel = papelError?.message || resposta.error || "O nível de acesso não foi alterado.";
                    }
                }

                message.success("Membro atualizado.");
                if (avisoPapel) {
                    message.warning(avisoPapel);
                }
            }

            setIsModalOpen(false);
            setEditingEmployee(null);
            await loadEmployees();
        } catch (error: unknown) {
            if (typeof error === "object" && error && "errorFields" in error) return;
            message.error(mensagemDeErroDaEquipe(error, "Não foi possível salvar."));
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
                icon={<UsergroupAddOutlined />}
                title="Equipe"
                subtitle="Gerencie membros, permissões de acesso e metas do time comercial."
                extra={
                    podeGerenciarEquipe ? (
                        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
                            Novo membro
                        </Button>
                    ) : null
                }
            />

            <IntroCard
                title="Gestão de equipe com login integrado"
                description="Ao criar um novo membro, o sistema gera automaticamente o login. O vendedor já pode acessar o CRM com email e senha."
            />

            {schemaMissing && <MissingSchemaAlert description="Tabela de funcionários não encontrada." />}
            {errorMessage && <MissingSchemaAlert title="Erro" description={errorMessage} />}

            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", marginBottom: 20 }}>
                <StatCard
                    title="Membros ativos"
                    value={summary.active}
                    prefix={<TeamOutlined style={{ color: "#2563eb" }} />}
                    accentColor="#2563eb"
                />
                <StatCard
                    title="Com acesso ao CRM"
                    value={summary.withLogin}
                    prefix={<KeyOutlined style={{ color: "#16a34a" }} />}
                    accentColor="#16a34a"
                    subtitle="Possuem login ativo"
                />
                <StatCard
                    title="Meta consolidada"
                    value={formatCurrencyBRL(summary.totalGoal, "R$ 0,00")}
                    prefix={<TrophyOutlined style={{ color: "#f59e0b" }} />}
                    accentColor="#f59e0b"
                />
                <StatCard
                    title="Vendido no mês"
                    value={formatCurrencyBRL(summary.totalRevenue, "R$ 0,00")}
                    prefix={<UserOutlined style={{ color: "#0f766e" }} />}
                    accentColor="#0f766e"
                />
            </div>

            <Card title="Time comercial">
                {enrichedEmployees.length === 0 ? (
                    <EmptyState
                        title="Nenhum membro cadastrado"
                        description="Crie o primeiro membro da equipe para começar a distribuir leads."
                        actionLabel={podeGerenciarEquipe ? "Novo membro" : undefined}
                        onAction={podeGerenciarEquipe ? openCreateModal : undefined}
                    />
                ) : (
                    <Table
                        size="small"
                        rowKey="id"
                        pagination={{ pageSize: 10 }}
                        dataSource={enrichedEmployees}
                        columns={[
                            {
                                title: "Membro",
                                render: (_, record: EmployeeRow) => (
                                    <Space direction="vertical" size={0}>
                                        <Space size={6}>
                                            <Text strong>{record.full_name}</Text>
                                            {record.has_login ? (
                                                <Tooltip title="Possui login ativo no CRM">
                                                    <KeyOutlined style={{ color: "#16a34a", fontSize: 12 }} />
                                                </Tooltip>
                                            ) : (
                                                <Tooltip title="Sem login — apenas cadastro interno">
                                                    <LockOutlined style={{ color: "#94a3b8", fontSize: 12 }} />
                                                </Tooltip>
                                            )}
                                        </Space>
                                        <Text type="secondary" style={{ fontSize: 12 }}>
                                            {record.email || "Sem email"}
                                        </Text>
                                    </Space>
                                ),
                            },
                            {
                                title: "Permissão",
                                width: 130,
                                render: (_, record: EmployeeRow) => {
                                    const papel = normalizarPapel(record.role);
                                    return (
                                        <Tag color={ROLE_COLORS[papel] || "default"} style={{ borderRadius: 6 }}>
                                            {papel === "gerente" && <CrownOutlined style={{ marginRight: 4 }} />}
                                            {rotuloDoPapel(record.role)}
                                        </Tag>
                                    );
                                },
                            },
                            {
                                title: "Status",
                                width: 100,
                                render: (_, record: EmployeeRow) => (
                                    <Tag color={record.active !== false ? "green" : "default"} style={{ borderRadius: 6 }}>
                                        {record.active !== false ? "Ativo" : "Inativo"}
                                    </Tag>
                                ),
                            },
                            {
                                title: "Vendido no mês",
                                className: "crm-nowrap",
                                width: 130,
                                render: (_, record: EmployeeRow) => formatCurrencyBRL(record.atualValor, "R$ 0,00"),
                            },
                            {
                                title: "Meta mensal",
                                className: "crm-nowrap",
                                width: 130,
                                render: (_, record: EmployeeRow) => formatCurrencyBRL(record.monthly_goal_value, "R$ 0,00"),
                            },
                            {
                                title: "Progresso",
                                width: 180,
                                render: (_, record: EmployeeRow) => (
                                    <Progress format={formatoProgresso}
                                        percent={Number(record.valueProgress?.toFixed(1) || 0)}
                                        size="small"
                                        strokeColor={record.valueProgress >= 100 ? "#16a34a" : "#2563eb"}
                                    />
                                ),
                            },
                            {
                                title: "",
                                width: 160,
                                render: (_, record: EmployeeRow) => !podeGerenciarEquipe ? null : (
                                    <Space size={4}>
                                        <Button size="small" onClick={() => openEditModal(record)}>
                                            Editar
                                        </Button>
                                        <Button
                                            size="small"
                                            danger
                                            icon={<DeleteOutlined />}
                                            onClick={() => handleDelete(record)}
                                        >
                                            Excluir
                                        </Button>
                                    </Space>
                                ),
                            },
                        ]}
                    />
                )}
            </Card>

            {/* ========== MODAL CRIAR / EDITAR ========== */}
            <Modal
                title={isCreating ? "Novo membro da equipe" : "Editar membro"}
                open={isModalOpen}
                onCancel={() => {
                    setIsModalOpen(false);
                    setEditingEmployee(null);
                }}
                onOk={handleSave}
                okText={isCreating ? "Criar membro com login" : "Salvar alterações"}
                confirmLoading={isSaving}
                destroyOnClose
                width={520}
            >
                <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
                    <Form.Item
                        label="Nome completo"
                        name="full_name"
                        rules={[{ required: true, message: "Informe o nome." }]}
                    >
                        <Input prefix={<UserOutlined />} placeholder="Ex: João Silva" autoComplete="off" />
                    </Form.Item>

                    <Form.Item
                        label="Email"
                        name="email"
                        rules={[
                            { required: true, message: "Informe o email." },
                            { type: "email", message: "Email inválido." },
                        ]}
                    >
                        <Input
                            prefix={<MailOutlined />}
                            placeholder="joao@empresa.com"
                            autoComplete="off"
                            data-lpignore="true"
                            data-form-type="other"
                            disabled={!isCreating && !!editingEmployee?.has_login}
                        />
                    </Form.Item>

                    {isCreating && (
                        <Form.Item
                            label="Senha inicial"
                            name="senha"
                            rules={[
                                { required: true, message: "Defina uma senha inicial." },
                                { min: 8, message: "Mínimo 8 caracteres." },
                            ]}
                            extra="O membro poderá alterar a senha depois."
                        >
                            <Input.Password prefix={<LockOutlined />} placeholder="Mínimo 8 caracteres" autoComplete="new-password" data-lpignore="true" data-form-type="other" />
                        </Form.Item>
                    )}

                    <Space size={16} style={{ width: "100%", display: "flex" }}>
                        <Form.Item
                            label="Permissão de acesso"
                            name="role"
                            style={{ flex: 1 }}
                            extra={
                                <Text type="secondary" style={{ fontSize: 11 }}>
                                    Vendedor: vê todos os leads e exclui só os seus. Gerente: faz tudo, inclusive excluir e configurar.
                                </Text>
                            }
                        >
                            <Select options={ROLE_OPTIONS} />
                        </Form.Item>

                        <Form.Item label="Cargo" name="cargo" style={{ flex: 1 }}>
                            <Input placeholder="Ex: Consultor Solar" />
                        </Form.Item>
                    </Space>

                    <Form.Item label="Meta de faturamento mensal (R$)" name="monthly_goal_value">
                        <InputNumber
                            style={{ width: "100%" }}
                            min={0 as number}
                            step={500}
                            prefix="R$"
                            placeholder="Ex: 50000"
                        />
                    </Form.Item>

                    {!isCreating && (
                        <Form.Item label="Status" name="active" valuePropName="checked">
                            <Switch checkedChildren="Ativo" unCheckedChildren="Inativo" />
                        </Form.Item>
                    )}
                </Form>

                {isCreating && (
                    <Alert
                        type="info"
                        showIcon
                        message="O que acontece ao criar"
                        description="O sistema cria automaticamente o login, vincula ao seu tenant e define as permissões. O novo membro pode acessar o CRM imediatamente com email e senha."
                        style={{ marginTop: 8 }}
                    />
                )}
            </Modal>

            {/* ========== MODAL CONFIRMAR EXCLUSÃO ========== */}
            <Modal
                title="Excluir membro da equipe"
                open={Boolean(deletingEmployee)}
                onCancel={() => setDeletingEmployee(null)}
                onOk={confirmDelete}
                okText="Excluir definitivamente"
                okType="danger"
                okButtonProps={{ loading: isDeleting }}
                cancelText="Cancelar"
                cancelButtonProps={{ disabled: isDeleting }}
                width={460}
            >
                {deletingEmployee && (
                    <div style={{ marginTop: 8 }}>
                        <p>
                            Tem certeza que deseja excluir <strong>{deletingEmployee.full_name}</strong>
                            {deletingEmployee.email ? ` (${deletingEmployee.email})` : ""}?
                        </p>
                        {deletingEmployee.has_login && (
                            <Alert
                                type="warning"
                                showIcon
                                message="Este membro possui login ativo. O acesso ao CRM será revogado permanentemente."
                                style={{ marginTop: 8 }}
                            />
                        )}
                        <p style={{ marginTop: 12, color: "#64748b", fontSize: 13 }}>
                            Esta ação remove o membro da equipe, suas metas e revoga o acesso ao sistema.
                        </p>
                    </div>
                )}
            </Modal>
        </div>
    );
};
