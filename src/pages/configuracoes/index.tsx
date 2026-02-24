import { PlusOutlined } from "@ant-design/icons";
import { useList } from "@refinedev/core";
import { Alert, Button, Card, Table, Tabs, Tag, Typography } from "antd";
import { useMemo } from "react";
import { isSupabaseMissingRelation } from "../../lib/supabaseErrors";

const { Title, Text } = Typography;

type FuncionarioTableRow = {
    id: string | number;
    nome: string;
    email?: string;
    cargo?: string;
    ativo: boolean;
};

const pickString = (...values: unknown[]): string | undefined => {
    for (const value of values) {
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
    }
    return undefined;
};

const pickBoolean = (...values: unknown[]): boolean | undefined => {
    for (const value of values) {
        if (typeof value === "boolean") {
            return value;
        }
    }
    return undefined;
};

export const ConfiguracoesPage = () => {
    const funcionariosResult = useList({
        resource: "funcionarios",
        pagination: { mode: "off" },
    }) as any;

    const funcionariosQuery = funcionariosResult.query || funcionariosResult;

    const legacyEmployeesResult = useList({
        resource: "crm_employees",
        pagination: { mode: "off" },
    }) as any;

    const legacyEmployeesQuery = legacyEmployeesResult.query || legacyEmployeesResult;

    const currentGoalsResult = useList({
        resource: "metas",
        pagination: { mode: "off" },
    }) as any;

    const currentGoalsQuery = currentGoalsResult.query || currentGoalsResult;

    const funcionariosMissing = isSupabaseMissingRelation(funcionariosQuery?.error);
    const legacyMissing = isSupabaseMissingRelation(legacyEmployeesQuery?.error);

    const sourceRows = (funcionariosMissing
        ? legacyEmployeesQuery?.data?.data
        : funcionariosQuery?.data?.data) || [];

    const sourceName = funcionariosMissing ? "crm_employees" : "funcionarios";
    const isLoading = Boolean(
        funcionariosQuery?.isLoading || (funcionariosMissing && legacyEmployeesQuery?.isLoading),
    );

    const loadError = useMemo(() => {
        if (!funcionariosMissing) {
            return funcionariosQuery?.error || null;
        }
        if (!legacyMissing) {
            return legacyEmployeesQuery?.error || null;
        }
        return funcionariosQuery?.error || legacyEmployeesQuery?.error || null;
    }, [funcionariosMissing, funcionariosQuery?.error, legacyEmployeesQuery?.error, legacyMissing]);

    const funcionarios = useMemo(() => {
        return (sourceRows as Array<Record<string, unknown>>).map((row, index) => {
            const nome = pickString(row.nome, row.full_name, row.name) || `Sem nome #${index + 1}`;
            const email = pickString(row.email, row.usuario_email);
            const cargo = pickString(row.cargo, row.role, row.perfil);
            const ativo = pickBoolean(row.ativo, row.active, row.is_active) ?? true;
            const rowId = row.id ?? `${sourceName}-${index + 1}`;

            return {
                id: String(rowId),
                nome,
                email,
                cargo,
                ativo,
            } as FuncionarioTableRow;
        });
    }, [sourceName, sourceRows]);

    const totalMetas = (currentGoalsQuery?.data?.data || []).length;

    return (
        <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
            <Title level={2} style={{ marginBottom: "10px" }}>
                Configuracoes do CRM
            </Title>
            <Text type="secondary">
                Fonte atual de funcionarios: <b>{sourceName}</b>
            </Text>

            <Card
                bordered={false}
                style={{ borderRadius: "10px", boxShadow: "0 2px 8px rgba(0,0,0,0.05)", marginTop: 16 }}
            >
                <Tabs
                    defaultActiveKey="2"
                    items={[
                        {
                            key: "1",
                            label: "Meu perfil",
                            children: (
                                <div style={{ padding: "16px 0" }}>
                                    <Title level={4}>Dados do usuario</Title>
                                    <p>Em breve: edicao de nome, foto e senha.</p>
                                </div>
                            ),
                        },
                        {
                            key: "2",
                            label: "Equipe",
                            children: (
                                <div style={{ padding: "16px 0" }}>
                                    <div
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            marginBottom: "16px",
                                            alignItems: "center",
                                        }}
                                    >
                                        <Title level={4} style={{ margin: 0 }}>
                                            Gestao de vendedores
                                        </Title>
                                        <Button
                                            type="primary"
                                            icon={<PlusOutlined />}
                                            style={{ backgroundColor: "#002b5b" }}
                                        >
                                            Novo funcionario
                                        </Button>
                                    </div>

                                    {loadError ? (
                                        <Alert
                                            type="error"
                                            showIcon
                                            message="Nao foi possivel carregar funcionarios"
                                            description={String(loadError?.message || "Erro desconhecido")}
                                            style={{ marginBottom: 12 }}
                                        />
                                    ) : null}

                                    <Table<FuncionarioTableRow>
                                        loading={isLoading}
                                        dataSource={funcionarios}
                                        rowKey="id"
                                        pagination={{ pageSize: 10, showSizeChanger: false }}
                                    >
                                        <Table.Column<FuncionarioTableRow> dataIndex="nome" title="Nome" />
                                        <Table.Column<FuncionarioTableRow>
                                            dataIndex="email"
                                            title="E-mail"
                                            render={(value?: string) => value || "-"}
                                        />
                                        <Table.Column<FuncionarioTableRow>
                                            dataIndex="cargo"
                                            title="Cargo"
                                            render={(value?: string) => value || "-"}
                                        />
                                        <Table.Column<FuncionarioTableRow>
                                            dataIndex="ativo"
                                            title="Status"
                                            render={(value: boolean) => (
                                                <Tag color={value ? "green" : "red"}>
                                                    {value ? "Ativo" : "Inativo"}
                                                </Tag>
                                            )}
                                        />
                                    </Table>
                                </div>
                            ),
                        },
                        {
                            key: "3",
                            label: "Metas",
                            children: (
                                <div style={{ padding: "16px 0" }}>
                                    <Title level={4}>Metas de vendas</Title>
                                    <Text type="secondary">
                                        Registros encontrados em `metas`: {totalMetas}
                                    </Text>
                                    <p style={{ marginTop: 12 }}>
                                        Em breve: definicao de objetivos mensais por vendedor.
                                    </p>
                                </div>
                            ),
                        },
                    ]}
                />
            </Card>
        </div>
    );
};
