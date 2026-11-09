import { DeleteOutlined, RestOutlined, UndoOutlined } from "@ant-design/icons";
import { Alert, Popconfirm, Space, Table, Tabs, Tag, Tooltip, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, EmptyState } from "../../components/ui";
import { useTenant } from "../../contexts/tenant";
import { useCrmAccess } from "../../hooks/useCrmAccess";
import { formatCurrencyBRL } from "../../lib/formatters";
import { getSupabaseErrorMessage } from "../../lib/supabaseErrors";
import { supabaseClient } from "../../utility";

const { Title, Text } = Typography;

/**
 * Lixeira: tudo que foi excluído (soft delete) fica aqui até ser restaurado.
 *
 * Regras (garantidas no banco, migration 12):
 * - Gerente restaura qualquer item e pode excluir definitivamente.
 * - Vendedor vê a lixeira da empresa, mas só restaura o que é dele.
 */

type TabelaLixeira = "negocios" | "pessoas" | "organizacoes" | "tarefas" | "orcamentos";

type ItemLixeira = {
    id: string | number;
    created_by?: string | null;
    responsavel?: string | null;
    responsavel_id?: string | null;
    deleted_at?: string | null;
    deleted_by?: string | null;
    [coluna: string]: unknown;
};

type Aba = {
    tabela: TabelaLixeira;
    rotulo: string;
    select: string;
    descrever: (item: ItemLixeira) => { titulo: string; detalhe?: string };
};

const LIMITE = 500;

const texto = (valor: unknown): string => (typeof valor === "string" ? valor.trim() : "");

const ABAS: Aba[] = [
    {
        tabela: "negocios",
        rotulo: "Negócios",
        select: "id,titulo,valor,responsavel,responsavel_id,created_by,deleted_at,deleted_by",
        descrever: (item) => ({
            titulo: texto(item.titulo) || "Negócio sem título",
            detalhe: [texto(item.responsavel), item.valor != null ? formatCurrencyBRL(item.valor) : ""]
                .filter(Boolean)
                .join(" · "),
        }),
    },
    {
        tabela: "pessoas",
        rotulo: "Contatos",
        select: "id,nome,email,telefone,created_by,deleted_at,deleted_by",
        descrever: (item) => ({
            titulo: texto(item.nome) || "Contato sem nome",
            detalhe: [texto(item.email), texto(item.telefone)].filter(Boolean).join(" · "),
        }),
    },
    {
        tabela: "organizacoes",
        rotulo: "Organizações",
        select: "id,razao_social,nome_fantasia,cnpj,created_by,deleted_at,deleted_by",
        descrever: (item) => ({
            titulo: texto(item.nome_fantasia) || texto(item.razao_social) || "Organização sem nome",
            detalhe: texto(item.cnpj),
        }),
    },
    {
        tabela: "tarefas",
        rotulo: "Agendamentos",
        select: "id,titulo,tipo,data_vencimento,responsavel,created_by,deleted_at,deleted_by",
        descrever: (item) => ({
            titulo: texto(item.titulo) || "Agendamento",
            detalhe: [
                texto(item.responsavel),
                item.data_vencimento ? dayjs(String(item.data_vencimento)).format("DD/MM/YYYY HH:mm") : "",
            ]
                .filter(Boolean)
                .join(" · "),
        }),
    },
    {
        // Orçamento: excluir/restaurar é de quem criou ou do gerente (migration 13);
        // por isso o select não traz o responsável, só o autor.
        tabela: "orcamentos",
        rotulo: "Orçamentos",
        select: "id,numero,titulo,total,created_by,deleted_at,deleted_by",
        descrever: (item) => ({
            titulo: [texto(item.numero), texto(item.titulo)].filter(Boolean).join(" · ") || "Orçamento",
            detalhe: item.total != null ? formatCurrencyBRL(item.total) : "",
        }),
    },
];

export const LixeiraPage = () => {
    const { tenantId } = useTenant();
    const { podeExcluir, isGerente } = useCrmAccess();
    const [abaAtiva, setAbaAtiva] = useState<TabelaLixeira>("negocios");
    const [itens, setItens] = useState<ItemLixeira[]>([]);
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [emAcao, setEmAcao] = useState<string | number | null>(null);
    const [nomes, setNomes] = useState<Map<string, string>>(new Map());

    const aba = useMemo(() => ABAS.find((a) => a.tabela === abaAtiva) ?? ABAS[0], [abaAtiva]);

    const carregar = useCallback(async () => {
        setCarregando(true);
        setErro(null);
        try {
            const { data, error } = await supabaseClient
                .from(aba.tabela)
                .select(aba.select)
                .not("deleted_at", "is", null)
                .order("deleted_at", { ascending: false })
                .limit(LIMITE);
            if (error) throw error;
            setItens((data ?? []) as unknown as ItemLixeira[]);
        } catch (error) {
            setItens([]);
            setErro(getSupabaseErrorMessage(error) || "Não foi possível carregar a lixeira.");
        } finally {
            setCarregando(false);
        }
    }, [aba]);

    // Nome de quem excluiu (deleted_by é o id do login)
    useEffect(() => {
        let ativo = true;
        void supabaseClient
            .from("funcionarios")
            .select("id,user_id,nome")
            .then(({ data }) => {
                if (!ativo || !data) return;
                const mapa = new Map<string, string>();
                (data as Array<{ id: string; user_id?: string | null; nome?: string | null }>).forEach((f) => {
                    const nome = f.nome || "";
                    mapa.set(String(f.id), nome);
                    if (f.user_id) mapa.set(String(f.user_id), nome);
                });
                setNomes(mapa);
            });
        return () => {
            ativo = false;
        };
    }, [tenantId]);

    useEffect(() => {
        void carregar();
    }, [carregar, tenantId]);

    const restaurar = async (item: ItemLixeira) => {
        setEmAcao(item.id);
        try {
            const { data, error } = await supabaseClient.rpc("restaurar_registro", {
                p_tabela: aba.tabela,
                p_id: String(item.id),
            });
            if (error) throw error;
            if (data === false) {
                message.warning("Este item já não estava na lixeira.");
            } else {
                message.success("Restaurado.");
            }
            await carregar();
        } catch (error) {
            message.error(getSupabaseErrorMessage(error) || "Não foi possível restaurar.");
        } finally {
            setEmAcao(null);
        }
    };

    const excluirDefinitivamente = async (item: ItemLixeira) => {
        setEmAcao(item.id);
        try {
            const { error } = await supabaseClient.from(aba.tabela).delete().eq("id", item.id);
            if (error) throw error;
            message.success("Excluído definitivamente.");
            await carregar();
        } catch (error) {
            const motivo = getSupabaseErrorMessage(error);
            message.error(
                /foreign key|violates|referenc/i.test(motivo)
                    ? "Não dá para excluir definitivamente: há registros ligados a este item. Restaure-o ou remova os vínculos antes."
                    : motivo || "Não foi possível excluir definitivamente.",
            );
        } finally {
            setEmAcao(null);
        }
    };

    const colunas: ColumnsType<ItemLixeira> = [
        {
            title: "Item",
            key: "item",
            render: (_, item) => {
                const { titulo, detalhe } = aba.descrever(item);
                return (
                    <div>
                        <Text strong>{titulo}</Text>
                        {detalhe ? (
                            <div>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                    {detalhe}
                                </Text>
                            </div>
                        ) : null}
                    </div>
                );
            },
        },
        {
            title: "Excluído em",
            className: "crm-nowrap",
            dataIndex: "deleted_at",
            width: 170,
            render: (valor: string | null) => (valor ? dayjs(valor).format("DD/MM/YYYY HH:mm") : "--"),
        },
        {
            title: "Por",
            dataIndex: "deleted_by",
            width: 180,
            responsive: ["md"],
            render: (valor: string | null) =>
                valor ? nomes.get(String(valor)) || <Tag>Usuário removido</Tag> : <Text type="secondary">--</Text>,
        },
        {
            title: "",
            key: "acoes",
            width: 230,
            align: "right",
            render: (_, item) => {
                const podeRestaurar = podeExcluir(item);
                return (
                    <Space wrap>
                        <Tooltip title={podeRestaurar ? "" : "Só o gerente ou o dono do registro restaura."}>
                            <Button
                                size="small"
                                icon={<UndoOutlined />}
                                onClick={() => void restaurar(item)}
                                disabled={!podeRestaurar || emAcao !== null}
                                loading={emAcao === item.id}
                            >
                                Restaurar
                            </Button>
                        </Tooltip>
                        {isGerente ? (
                            <Popconfirm
                                title="Excluir definitivamente?"
                                description="Não dá para desfazer."
                                okText="Excluir de vez"
                                okButtonProps={{ danger: true }}
                                cancelText="Cancelar"
                                onConfirm={() => void excluirDefinitivamente(item)}
                            >
                                <Button size="small" danger icon={<DeleteOutlined />} disabled={emAcao !== null}>
                                    Apagar
                                </Button>
                            </Popconfirm>
                        ) : null}
                    </Space>
                );
            },
        },
    ];

    return (
        <div className="crm-page-shell">
            <div className="crm-page-header">
                <div>
                    <Title level={2} className="crm-page-header-title">
                        <RestOutlined style={{ marginRight: 10, color: "#64748b" }} />
                        Lixeira
                    </Title>
                    <Text className="crm-page-header-subtitle">
                        O que foi excluído fica aqui e pode ser restaurado.{" "}
                        {isGerente
                            ? "Como gerente, você restaura qualquer item e pode apagar de vez."
                            : "Você restaura os itens que são seus."}
                    </Text>
                </div>
            </div>

            <Card bordered={false} className="crm-card">
                <Tabs
                    activeKey={abaAtiva}
                    onChange={(chave) => setAbaAtiva(chave as TabelaLixeira)}
                    items={ABAS.map((a) => ({ key: a.tabela, label: a.rotulo }))}
                />
                {erro ? <Alert type="error" showIcon message={erro} style={{ marginBottom: 12 }} /> : null}
                <Table<ItemLixeira>
                    rowKey={(item) => String(item.id)}
                    columns={colunas}
                    dataSource={itens}
                    loading={carregando}
                    pagination={{ pageSize: 20, hideOnSinglePage: true }}
                    scroll={{ x: 640 }}
                    locale={{
                        emptyText: (
                            <EmptyState
                                title="Lixeira vazia"
                                description={`Nenhum item de ${aba.rotulo.toLowerCase()} foi excluído.`}
                            />
                        ),
                    }}
                />
                {itens.length >= LIMITE ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                        Mostrando os {LIMITE} itens excluídos mais recentes.
                    </Text>
                ) : null}
            </Card>
        </div>
    );
};
