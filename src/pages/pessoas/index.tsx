import {
    ContactsOutlined,
    DeleteOutlined,
    DownloadOutlined,
    EditOutlined,
    MoreOutlined,
    PlusOutlined,
    SafetyOutlined,
} from "@ant-design/icons";
import { useCreate, useDelete, useList, useUpdate } from "@refinedev/core";
import {
    Alert,
    Dropdown,
    Form,
    Input,
    Modal,
    Select,
    Skeleton,
    Space,
    Table,
    Tag,
    Typography,
    message,
} from "antd";
import { useMemo, useState } from "react";
import { Button, Card, EmptyState } from "../../components/ui";
import { useTenant } from "../../contexts/tenant";
import { useCrmAccess } from "../../hooks/useCrmAccess";
import { formatCpfCnpj, formatDateBR, normalizeText } from "../../lib/formatters";
import { isSupabaseMissingRelation } from "../../lib/supabaseErrors";
import type { OrganizacaoRecord, PessoaRecord } from "../../types/db";
import { supabaseClient } from "../../utility";
import { CustomFieldsForm, dadosExtrasParaFormulario } from "../../components/custom-fields";
import { extrairDadosExtras, useCustomFields } from "../../hooks/useCustomFields";

const { Title, Text } = Typography;

type PessoaFormValues = {
    nome: string;
    email?: string;
    ddi?: string;
    telefone?: string;
    cpf?: string;
    cargo?: string;
    organizacao_id?: string;
    /** Valores dos campos customizados do tenant (jsonb) */
    dados_extras?: Record<string, NonNullable<unknown>>;
};

const DDI_OPTIONS = [
    { value: "+55", label: "+55" },
    { value: "+1", label: "+1" },
    { value: "+351", label: "+351" },
];

const baixarJson = (nomeArquivo: string, conteudo: unknown) => {
    const blob = new Blob([JSON.stringify(conteudo, null, 2)], {
        type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = nomeArquivo;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

export const PessoasPage = () => {
    const { tenantId } = useTenant();
    const { canDeleteRecords } = useCrmAccess();
    const { campos: camposCustomizados } = useCustomFields("pessoa");

    const [busca, setBusca] = useState("");
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editando, setEditando] = useState<PessoaRecord | null>(null);
    const [form] = Form.useForm<PessoaFormValues>();

    const { query } = useList<PessoaRecord>({
        resource: "pessoas",
        pagination: { mode: "off" },
        filters: [{ field: "deleted_at", operator: "null", value: true }],
        sorters: [{ field: "created_at", order: "desc" }],
    });

    const { query: organizacoesQuery } = useList<OrganizacaoRecord>({
        resource: "organizacoes",
        pagination: { mode: "off" },
        filters: [{ field: "deleted_at", operator: "null", value: true }],
    });

    const { mutateAsync: createPessoa } = useCreate();
    const { mutateAsync: updatePessoa } = useUpdate();
    const { mutateAsync: deletePessoa } = useDelete();

    const pessoas = useMemo(
        () => ((query?.data?.data as PessoaRecord[]) || []).filter(Boolean),
        [query?.data?.data],
    );

    const organizacoesPorId = useMemo(() => {
        const mapa = new Map<string, OrganizacaoRecord>();
        ((organizacoesQuery?.data?.data as OrganizacaoRecord[]) || []).forEach((org) => {
            if (org?.id) mapa.set(String(org.id), org);
        });
        return mapa;
    }, [organizacoesQuery?.data?.data]);

    const organizacaoOptions = useMemo(
        () =>
            Array.from(organizacoesPorId.values()).map((org) => ({
                value: String(org.id),
                label: org.nome_fantasia || org.razao_social || "Sem nome",
            })),
        [organizacoesPorId],
    );

    const listaFiltrada = useMemo(() => {
        const termo = normalizeText(busca);
        if (!termo) return pessoas;
        return pessoas.filter((pessoa) =>
            [pessoa.nome, pessoa.email, pessoa.telefone, pessoa.cargo]
                .some((campo) => normalizeText(campo ? String(campo) : "").includes(termo)),
        );
    }, [busca, pessoas]);

    const tabelaAusente = isSupabaseMissingRelation(query?.error);

    const abrirCriacao = () => {
        setEditando(null);
        form.resetFields();
        form.setFieldValue("ddi", "+55");
        setIsModalOpen(true);
    };

    const abrirEdicao = (pessoa: PessoaRecord) => {
        setEditando(pessoa);
        form.setFieldsValue({
            nome: pessoa.nome || "",
            email: pessoa.email || undefined,
            ddi: pessoa.ddi || "+55",
            telefone: pessoa.telefone || undefined,
            cpf: pessoa.cpf ? formatCpfCnpj(pessoa.cpf) : undefined,
            cargo: pessoa.cargo || undefined,
            organizacao_id: pessoa.organizacao_id || undefined,
            dados_extras: dadosExtrasParaFormulario(
                pessoa.dados_extras as Record<string, unknown> | undefined,
                camposCustomizados,
            ),
        });
        setIsModalOpen(true);
        // LGPD: registra o acesso ao dado pessoal (fire-and-forget)
        void supabaseClient
            .rpc("log_acesso_titular", { p_pessoa_id: pessoa.id, p_contexto: "edicao_pessoa" })
            .then(undefined, () => undefined);
    };

    const salvar = async () => {
        const values = await form.validateFields();
        const dadosExtras = extrairDadosExtras(values as Record<string, unknown>, camposCustomizados);
        const { dados_extras: _ignorado, ...limpo } = values as Record<string, unknown>;
        const payload = {
            ...limpo,
            ...(Object.keys(dadosExtras).length ? { dados_extras: dadosExtras } : {}),
            organizacao_id: values.organizacao_id || null,
            tenant_id: tenantId || undefined,
        };
        try {
            if (editando) {
                await updatePessoa({ resource: "pessoas", id: editando.id, values: payload });
                message.success("Contato atualizado.");
            } else {
                await createPessoa({ resource: "pessoas", values: payload });
                message.success("Contato criado.");
            }
            setIsModalOpen(false);
            await query?.refetch?.();
        } catch (error: unknown) {
            const detalhe =
                typeof error === "object" && error && "message" in error
                    ? String((error as { message?: unknown }).message)
                    : "Erro desconhecido";
            message.error(`Não foi possível salvar: ${detalhe}`);
        }
    };

    const exportarLgpd = async (pessoa: PessoaRecord) => {
        const { data, error } = await supabaseClient.rpc("lgpd_exportar_dados_titular", {
            p_pessoa_id: pessoa.id,
        });
        if (error) {
            message.error(`Falha na exportação: ${error.message}`);
            return;
        }
        baixarJson(`dados-titular-${pessoa.id}.json`, data);
        message.success("Dados do titular exportados (portabilidade LGPD).");
    };

    const anonimizarLgpd = (pessoa: PessoaRecord) => {
        Modal.confirm({
            title: "Anonimizar titular (LGPD)?",
            content: (
                <div>
                    <p>
                        Nome, e-mail, telefone, CPF e cargo de <strong>{pessoa.nome || "este contato"}</strong>{" "}
                        serão removidos permanentemente. O histórico de negócios é mantido sem identificação.
                    </p>
                    <p style={{ color: "#b42318" }}>Esta ação é irreversível.</p>
                </div>
            ),
            okText: "Anonimizar",
            okButtonProps: { danger: true },
            cancelText: "Cancelar",
            onOk: async () => {
                const { error } = await supabaseClient.rpc("lgpd_apagar_dados_titular", {
                    p_pessoa_id: pessoa.id,
                });
                if (error) {
                    message.error(`Falha na anonimização: ${error.message}`);
                    return;
                }
                message.success("Titular anonimizado conforme LGPD.");
                await query?.refetch?.();
            },
        });
    };

    const excluir = async (pessoa: PessoaRecord) => {
        try {
            await deletePessoa({ resource: "pessoas", id: pessoa.id });
            message.success("Contato removido.");
            await query?.refetch?.();
        } catch {
            message.error("Não foi possível remover o contato.");
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
                        <ContactsOutlined style={{ marginRight: 10, color: "#64748b" }} />
                        Contatos
                    </Title>
                    <Text className="crm-page-header-subtitle">
                        Pessoas com quem o time fala — vinculadas às organizações e aos negócios.
                    </Text>
                </div>
                <Button type="primary" icon={<PlusOutlined />} onClick={abrirCriacao}>
                    Novo contato
                </Button>
            </div>

            {tabelaAusente ? (
                <Alert
                    type="warning"
                    showIcon
                    message="Estrutura do banco pendente"
                    description="A tabela pessoas ainda não existe neste ambiente. Execute as migrations em database/migrations/ no Supabase."
                    style={{ marginBottom: 16 }}
                />
            ) : null}

            <Card bordered={false} className="crm-card">
                <Input.Search
                    placeholder="Buscar por nome, e-mail, telefone ou cargo"
                    allowClear
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    style={{ maxWidth: 420, marginBottom: 16 }}
                />

                {listaFiltrada.length === 0 && !tabelaAusente ? (
                    <EmptyState
                        title="Nenhum contato cadastrado"
                        description="Cadastre pessoas e vincule às organizações para montar o relacionamento B2B."
                    />
                ) : (
                    <Table<PessoaRecord>
                        rowKey="id"
                        dataSource={listaFiltrada}
                        pagination={{ pageSize: 12, showSizeChanger: false }}
                        columns={[
                            {
                                title: "Nome",
                                dataIndex: "nome",
                                render: (value: string | null, pessoa) => (
                                    <Space>
                                        <Text strong>{value || "—"}</Text>
                                        {pessoa.anonimizada_em ? (
                                            <Tag icon={<SafetyOutlined />} color="default">
                                                Anonimizada (LGPD)
                                            </Tag>
                                        ) : null}
                                    </Space>
                                ),
                            },
                            {
                                title: "E-mail",
                                dataIndex: "email",
                                responsive: ["md"],
                                render: (value: string | null) => value || "—",
                            },
                            {
                                title: "Telefone",
                                dataIndex: "telefone",
                                render: (value: string | null, pessoa) =>
                                    value ? `${pessoa.ddi || "+55"} ${value}` : "—",
                            },
                            {
                                title: "Cargo",
                                dataIndex: "cargo",
                                responsive: ["lg"],
                                render: (value: string | null) => value || "—",
                            },
                            {
                                title: "Organização",
                                dataIndex: "organizacao_id",
                                responsive: ["md"],
                                render: (value: string | null) => {
                                    if (!value) return "—";
                                    const org = organizacoesPorId.get(String(value));
                                    return org ? org.nome_fantasia || org.razao_social || "—" : "—";
                                },
                            },
                            {
                                title: "Criado em",
                                dataIndex: "created_at",
                                responsive: ["lg"],
                                render: (value: string | null) => formatDateBR(value),
                            },
                            {
                                title: "Ações",
                                key: "acoes",
                                width: 100,
                                render: (_, pessoa) => (
                                    <Dropdown
                                        trigger={["click"]}
                                        menu={{
                                            items: [
                                                {
                                                    key: "editar",
                                                    icon: <EditOutlined />,
                                                    label: "Editar",
                                                    onClick: () => abrirEdicao(pessoa),
                                                },
                                                {
                                                    key: "exportar",
                                                    icon: <DownloadOutlined />,
                                                    label: "Exportar dados (LGPD)",
                                                    onClick: () => void exportarLgpd(pessoa),
                                                },
                                                ...(canDeleteRecords
                                                    ? [
                                                          {
                                                              key: "anonimizar",
                                                              icon: <SafetyOutlined />,
                                                              label: "Anonimizar titular (LGPD)",
                                                              onClick: () => anonimizarLgpd(pessoa),
                                                          },
                                                          {
                                                              key: "excluir",
                                                              icon: <DeleteOutlined />,
                                                              danger: true,
                                                              label: "Remover",
                                                              onClick: () => void excluir(pessoa),
                                                          },
                                                      ]
                                                    : []),
                                            ],
                                        }}
                                    >
                                        <Button size="small" type="text" icon={<MoreOutlined />} />
                                    </Dropdown>
                                ),
                            },
                        ]}
                    />
                )}
            </Card>

            <Modal
                title={editando ? "Editar contato" : "Novo contato"}
                open={isModalOpen}
                onOk={salvar}
                onCancel={() => setIsModalOpen(false)}
                okText="Salvar"
                cancelText="Cancelar"
                destroyOnHidden
            >
                <Form form={form} layout="vertical">
                    <Form.Item
                        label="Nome"
                        name="nome"
                        rules={[{ required: true, message: "Informe o nome do contato." }]}
                    >
                        <Input placeholder="Nome completo" />
                    </Form.Item>
                    <Form.Item
                        label="E-mail"
                        name="email"
                        rules={[{ type: "email", message: "E-mail inválido." }]}
                    >
                        <Input placeholder="email@exemplo.com" />
                    </Form.Item>
                    <Form.Item label="Telefone">
                        <Space.Compact style={{ width: "100%" }}>
                            <Form.Item name="ddi" noStyle initialValue="+55">
                                <Select options={DDI_OPTIONS} style={{ width: 90 }} />
                            </Form.Item>
                            <Form.Item name="telefone" noStyle>
                                <Input placeholder="(00) 00000-0000" />
                            </Form.Item>
                        </Space.Compact>
                    </Form.Item>
                    <Form.Item label="CPF" name="cpf">
                        <Input
                            placeholder="000.000.000-00"
                            onChange={(e) => form.setFieldValue("cpf", formatCpfCnpj(e.target.value))}
                        />
                    </Form.Item>
                    <Form.Item label="Cargo" name="cargo">
                        <Input placeholder="Ex.: Diretor, Comprador, Engenheiro" />
                    </Form.Item>
                    <CustomFieldsForm campos={camposCustomizados} />
                    <Form.Item label="Organização" name="organizacao_id">
                        <Select
                            options={organizacaoOptions}
                            allowClear
                            showSearch
                            optionFilterProp="label"
                            placeholder="Vincular a uma empresa (opcional)"
                        />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
};
