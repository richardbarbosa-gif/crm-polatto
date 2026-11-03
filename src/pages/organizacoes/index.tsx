import { BankOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { useCreate, useList, useUpdate } from "@refinedev/core";
import {
    Alert,
    Form,
    Input,
    Modal,
    Popconfirm,
    Select,
    Skeleton,
    Space,
    Table,
    Tag,
    Typography,
    message,
} from "antd";
import { useMemo, useRef, useState } from "react";
import { Button, Card, EmptyState } from "../../components/ui";
import { useTenant } from "../../contexts/tenant";
import { useCrmAccess } from "../../hooks/useCrmAccess";
import { formatCpfCnpj, formatDateBR, normalizeText } from "../../lib/formatters";
import { regraCpfCnpj } from "../../lib/documentos";
import { montarFiltroDuplicata } from "../../lib/duplicatas";
import { getSupabaseErrorMessage, isSupabaseMissingRelation } from "../../lib/supabaseErrors";
import { supabaseClient } from "../../utility";
import type { OrganizacaoRecord } from "../../types/db";
import { CustomFieldsForm } from "../../components/custom-fields";
import { dadosExtrasParaFormulario } from "../../lib/camposCustomizados";
import { extrairDadosExtras, useCustomFields } from "../../hooks/useCustomFields";

const { Title, Text } = Typography;

type OrganizacaoFormValues = {
    razao_social: string;
    nome_fantasia?: string;
    cnpj?: string;
    site?: string;
    setor?: string;
    tamanho?: string;
    telefone?: string;
    email?: string;
    /** Valores dos campos customizados do tenant (jsonb) */
    dados_extras?: Record<string, NonNullable<unknown>>;
};

const TAMANHO_OPTIONS = [
    { value: "MEI", label: "MEI" },
    { value: "Pequena", label: "Pequena" },
    { value: "Média", label: "Média" },
    { value: "Grande", label: "Grande" },
];

export const OrganizacoesPage = () => {
    const { tenantId } = useTenant();
    const { podeExcluir } = useCrmAccess();
    const { campos: camposCustomizados } = useCustomFields("organizacao");

    const [busca, setBusca] = useState("");
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editando, setEditando] = useState<OrganizacaoRecord | null>(null);
    const [form] = Form.useForm<OrganizacaoFormValues>();

    const { query } = useList<OrganizacaoRecord>({
        resource: "organizacoes",
        pagination: { mode: "off" },
        filters: [{ field: "deleted_at", operator: "null", value: true }],
        sorters: [{ field: "created_at", order: "desc" }],
    });

    const { mutateAsync: createOrganizacao } = useCreate();
    const { mutateAsync: updateOrganizacao } = useUpdate();
    const [isSaving, setIsSaving] = useState(false);
    const salvandoRef = useRef(false);

    const organizacoes = useMemo(
        () => ((query?.data?.data as OrganizacaoRecord[]) || []).filter(Boolean),
        [query?.data?.data],
    );

    const listaFiltrada = useMemo(() => {
        const termo = normalizeText(busca);
        if (!termo) return organizacoes;
        return organizacoes.filter((org) =>
            [org.nome_fantasia, org.razao_social, org.cnpj, org.setor]
                .some((campo) => normalizeText(campo ? String(campo) : "").includes(termo)),
        );
    }, [busca, organizacoes]);

    const tabelaAusente = isSupabaseMissingRelation(query?.error);

    const abrirCriacao = () => {
        setEditando(null);
        form.resetFields();
        setIsModalOpen(true);
    };

    const abrirEdicao = (org: OrganizacaoRecord) => {
        setEditando(org);
        form.setFieldsValue({
            razao_social: org.razao_social || "",
            nome_fantasia: org.nome_fantasia || undefined,
            cnpj: org.cnpj ? formatCpfCnpj(org.cnpj) : undefined,
            site: org.site || undefined,
            setor: org.setor || undefined,
            tamanho: org.tamanho || undefined,
            telefone: org.telefone || undefined,
            email: org.email || undefined,
            dados_extras: dadosExtrasParaFormulario(
                org.dados_extras as Record<string, unknown> | undefined,
                camposCustomizados,
            ),
        });
        setIsModalOpen(true);
    };

    /** Avisa (sem bloquear) quando o CNPJ já está cadastrado. */
    const confirmarSeDuplicada = async (values: OrganizacaoFormValues): Promise<boolean> => {
        const filtro = montarFiltroDuplicata({ documento: values.cnpj }, { documento: "cnpj" });
        if (!filtro) return true;
        let consulta = supabaseClient
            .from("organizacoes")
            .select("id,nome_fantasia,razao_social")
            .is("deleted_at", null)
            .or(filtro)
            .limit(3);
        if (editando) consulta = consulta.neq("id", editando.id);
        const { data, error } = await consulta;
        if (error || !data?.length) return true;
        const nomes = (data as Array<{ nome_fantasia?: string | null; razao_social?: string | null }>)
            .map((o) => o.nome_fantasia || o.razao_social || "Sem nome")
            .join(", ");
        return new Promise<boolean>((resolve) => {
            Modal.confirm({
                title: "CNPJ já cadastrado",
                content: `Este CNPJ já pertence a: ${nomes}. Salvar mesmo assim?`,
                okText: "Salvar mesmo assim",
                cancelText: "Cancelar",
                onOk: () => resolve(true),
                onCancel: () => resolve(false),
            });
        });
    };

    const salvar = async () => {
        if (salvandoRef.current) return;
        const values = await form.validateFields();
        salvandoRef.current = true;
        setIsSaving(true);
        try {
            if (!(await confirmarSeDuplicada(values))) return;

            const dadosExtras = extrairDadosExtras(
                values as Record<string, unknown>,
                camposCustomizados,
                editando ? "editar" : "criar",
            );
            const { dados_extras: _ignorado, ...limpo } = values as Record<string, unknown>;
            void _ignorado;
            const dadosExtrasFinais = editando
                ? { ...((editando.dados_extras as Record<string, unknown> | null) ?? {}), ...dadosExtras }
                : dadosExtras;
            const payload = {
                ...limpo,
                ...(Object.keys(dadosExtrasFinais).length ? { dados_extras: dadosExtrasFinais } : {}),
                tenant_id: tenantId || undefined,
            };

            if (editando) {
                await updateOrganizacao({ resource: "organizacoes", id: editando.id, values: payload, successNotification: false });
                message.success("Organização atualizada.");
            } else {
                await createOrganizacao({ resource: "organizacoes", values: payload, successNotification: false });
                message.success("Organização criada.");
            }
            setIsModalOpen(false);
            await query?.refetch?.();
        } catch (error: unknown) {
            const detalhe =
                typeof error === "object" && error && "message" in error
                    ? String((error as { message?: unknown }).message)
                    : "Erro desconhecido";
            message.error(`Não foi possível salvar: ${detalhe}`);
        } finally {
            salvandoRef.current = false;
            setIsSaving(false);
        }
    };

    // Exclusão LÓGICA (deleted_at), como a lista já espera. O delete físico
    // desvinculava a empresa de todos os negócios e contatos dela (FK
    // on delete set null) sem possibilidade de desfazer.
    const excluir = async (org: OrganizacaoRecord) => {
        try {
            await updateOrganizacao({
                resource: "organizacoes",
                id: org.id,
                values: { deleted_at: new Date().toISOString() },
                successNotification: false,
            });
            message.success("Organização removida.");
            await query?.refetch?.();
        } catch (error) {
            // Mostra o motivo do banco (ex.: "Você só pode excluir ou restaurar registros seus.")
            message.error(getSupabaseErrorMessage(error) || "Não foi possível remover a organização.");
        }
    };

    if (query?.isLoading) {
        return (
            <div className="crm-page-shell">
                <Skeleton active />
            </div>
        );
    }

    return (
        <div className="crm-page-shell">
            <div className="crm-page-header">
                <div>
                    <Title level={2} className="crm-page-header-title">
                        <BankOutlined style={{ marginRight: 10, color: "#64748b" }} />
                        Organizações
                    </Title>
                    <Text className="crm-page-header-subtitle">
                        Empresas clientes (Pessoa Jurídica) — quem assina contrato e emite NF.
                    </Text>
                </div>
                <Button type="primary" icon={<PlusOutlined />} onClick={abrirCriacao}>
                    Nova organização
                </Button>
            </div>

            {tabelaAusente ? (
                <Alert
                    type="warning"
                    showIcon
                    message="Estrutura do banco pendente"
                    description="A tabela organizacoes ainda não existe neste ambiente. Execute as migrations em database/migrations/ no Supabase."
                    style={{ marginBottom: 16 }}
                />
            ) : null}

            <Card bordered={false} className="crm-card">
                <Input.Search
                    placeholder="Buscar por nome, razão social, CNPJ ou setor"
                    allowClear
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    style={{ maxWidth: 420, marginBottom: 16 }}
                />

                {listaFiltrada.length === 0 && !tabelaAusente ? (
                    <EmptyState
                        title="Nenhuma organização cadastrada"
                        description="Cadastre a primeira empresa cliente para vincular contatos e negócios."
                    />
                ) : (
                    <Table<OrganizacaoRecord>
                        rowKey="id"
                        dataSource={listaFiltrada}
                        pagination={{ pageSize: 12, showSizeChanger: false }}
                        columns={[
                            {
                                title: "Nome fantasia",
                                dataIndex: "nome_fantasia",
                                render: (value: string | null, org) => (
                                    <Text strong>{value || org.razao_social || "—"}</Text>
                                ),
                            },
                            {
                                title: "Razão social",
                                dataIndex: "razao_social",
                                responsive: ["md"],
                                render: (value: string | null) => value || "—",
                            },
                            {
                                title: "CNPJ",
                                dataIndex: "cnpj",
                                render: (value: string | null) => (value ? formatCpfCnpj(value) : "—"),
                            },
                            {
                                title: "Setor",
                                dataIndex: "setor",
                                responsive: ["lg"],
                                render: (value: string | null) => (value ? <Tag>{value}</Tag> : "—"),
                            },
                            {
                                title: "Telefone",
                                dataIndex: "telefone",
                                responsive: ["lg"],
                                render: (value: string | null) => value || "—",
                            },
                            {
                                title: "Criada em",
                                dataIndex: "created_at",
                                responsive: ["md"],
                                render: (value: string | null) => formatDateBR(value),
                            },
                            {
                                title: "Ações",
                                key: "acoes",
                                width: 110,
                                render: (_, org) => (
                                    <Space>
                                        <Button
                                            size="small"
                                            type="text"
                                            icon={<EditOutlined />}
                                            onClick={() => abrirEdicao(org)}
                                        />
                                        {podeExcluir(org) ? (
                                            <Popconfirm
                                                title="Remover organização?"
                                                description="Os negócios e contatos vinculados não são apagados."
                                                okText="Remover"
                                                cancelText="Cancelar"
                                                onConfirm={() => excluir(org)}
                                            >
                                                <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                                            </Popconfirm>
                                        ) : null}
                                    </Space>
                                ),
                            },
                        ]}
                    />
                )}
            </Card>

            <Modal
                title={editando ? "Editar organização" : "Nova organização"}
                open={isModalOpen}
                onOk={salvar}
                onCancel={() => setIsModalOpen(false)}
                okText="Salvar"
                cancelText="Cancelar"
                confirmLoading={isSaving}
                destroyOnHidden
            >
                <Form form={form} layout="vertical">
                    <Form.Item
                        label="Razão social"
                        name="razao_social"
                        rules={[{ required: true, message: "Informe a razão social." }]}
                    >
                        <Input placeholder="Ex.: Polatto Energia Solar LTDA" />
                    </Form.Item>
                    <Form.Item label="Nome fantasia" name="nome_fantasia">
                        <Input placeholder="Ex.: Polatto Solar" />
                    </Form.Item>
                    <Form.Item label="CNPJ" name="cnpj" rules={[regraCpfCnpj("cnpj")]}>
                        <Input
                            placeholder="00.000.000/0000-00"
                            onChange={(e) => form.setFieldValue("cnpj", formatCpfCnpj(e.target.value))}
                        />
                    </Form.Item>
                    <Form.Item label="Site" name="site">
                        <Input placeholder="https://" />
                    </Form.Item>
                    <Form.Item label="Setor" name="setor">
                        <Input placeholder="Ex.: Energia, Software, Consultoria" />
                    </Form.Item>
                    <Form.Item label="Tamanho" name="tamanho">
                        <Select options={TAMANHO_OPTIONS} allowClear placeholder="Porte da empresa" />
                    </Form.Item>
                    <Form.Item label="Telefone" name="telefone">
                        <Input placeholder="(00) 00000-0000" />
                    </Form.Item>
                    <Form.Item
                        label="E-mail"
                        name="email"
                        rules={[{ type: "email", message: "E-mail inválido." }]}
                    >
                        <Input placeholder="contato@empresa.com.br" />
                    </Form.Item>
                    <CustomFieldsForm campos={camposCustomizados} />
                </Form>
            </Modal>
        </div>
    );
};
