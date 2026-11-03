import { FileTextOutlined, PlusOutlined } from "@ant-design/icons";
import { useList } from "@refinedev/core";
import { Alert, Skeleton, Typography } from "antd";
import { useMemo, useState } from "react";
import { Button, Card, EmptyState } from "../../components/ui";
import { useTenant } from "../../contexts/tenant";
import { useEhAdminDoTenant } from "../../hooks/useEhAdminDoTenant";
import { ehIdDoModeloNovo } from "../../lib/leadTimeline";
import { formatarDataIso } from "../../lib/orcamentos/formato";
import { enderecoDoLead, paraOrcamento, type ClienteDoNegocio } from "../../lib/orcamentos/tipos";
import { isSupabaseMissingRelation } from "../../lib/supabaseErrors";
import { AcoesOrcamento } from "./acoes-orcamento";
import { EditorOrcamento } from "./editor-orcamento";
import { StatusOrcamentoTag } from "./status-orcamento";
import "./orcamentos.css";

const { Text } = Typography;

export type LeadParaOrcamento = {
    id?: string | number | null;
    nome?: string | null;
    cpf_cnpj?: string | null;
    telefone?: string | null;
    ddi?: string | null;
    email?: string | null;
    valor?: number | string | null;
    endereco_instalacao?: string | null;
    numero?: string | null;
    complemento?: string | null;
    cep?: string | null;
};

type Props = {
    lead: LeadParaOrcamento;
    /** Chamado depois de salvar um PDF no lead (recarrega documentos e timeline). */
    onDocumentoSalvo?: () => void;
};

const reais = (valor: number) => valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const OrcamentosDoLead = ({ lead, onDocumentoSalvo }: Props) => {
    const negocioId = ehIdDoModeloNovo(lead.id) ? String(lead.id) : null;
    const { identityUserId } = useTenant();
    const { ehAdmin } = useEhAdminDoTenant();
    const [editor, setEditor] = useState<{ orcamentoId: string | null } | null>(null);

    const { query } = useList({
        resource: "orcamentos",
        filters: [
            { field: "negocio_id", operator: "eq", value: negocioId },
            { field: "deleted_at", operator: "null", value: true },
        ],
        sorters: [{ field: "created_at", order: "desc" }],
        pagination: { mode: "off" },
        queryOptions: { enabled: Boolean(negocioId) },
    });

    const orcamentos = useMemo(
        () => ((query.data?.data ?? []) as Record<string, unknown>[]).map(paraOrcamento),
        [query.data?.data],
    );

    const valorLead = lead.valor === null || lead.valor === undefined || lead.valor === "" ? null : Number(lead.valor);
    const cliente: ClienteDoNegocio | null = negocioId
        ? {
              id: negocioId,
              nome: lead.nome ?? null,
              cpf_cnpj: lead.cpf_cnpj ?? null,
              telefone: lead.telefone ?? null,
              ddi: lead.ddi ?? null,
              email: lead.email ?? null,
              valor: valorLead !== null && Number.isFinite(valorLead) ? valorLead : null,
              endereco: enderecoDoLead(lead),
          }
        : null;

    const recarregar = () => {
        void query.refetch();
    };

    const titulo = (
        <span>
            <FileTextOutlined style={{ marginRight: 8 }} />
            Orçamentos
        </span>
    );

    if (!negocioId) {
        return (
            <Card title={titulo}>
                <Alert
                    type="info"
                    showIcon
                    message="Orçamentos ficam disponíveis depois da migração deste lead para o modelo novo de negócios."
                />
            </Card>
        );
    }

    const tabelaAusente = isSupabaseMissingRelation(query.error);

    return (
        <Card
            title={titulo}
            extra={
                tabelaAusente ? null : (
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditor({ orcamentoId: null })}>
                        Novo orçamento
                    </Button>
                )
            }
        >
            {tabelaAusente ? (
                <Alert
                    type="warning"
                    showIcon
                    message="Módulo de orçamentos pendente"
                    description="Execute a migration 2026-11-03_13_orcamentos.sql no Supabase para habilitar os orçamentos."
                />
            ) : query.isLoading ? (
                <Skeleton active paragraph={{ rows: 2 }} />
            ) : query.error ? (
                <Alert type="error" showIcon message="Não foi possível carregar os orçamentos." action={<Button onClick={recarregar}>Tentar de novo</Button>} />
            ) : orcamentos.length === 0 ? (
                <EmptyState
                    title="Nenhum orçamento ainda"
                    description="Monte a proposta com itens do catálogo ou livres e gere o PDF com a marca da empresa."
                    actionLabel="Criar o primeiro orçamento"
                    onAction={() => setEditor({ orcamentoId: null })}
                />
            ) : (
                <div className="orc-lista-lead">
                    {orcamentos.map((orcamento) => (
                        <div className="orc-linha" key={orcamento.id}>
                            <div className="orc-linha-info">
                                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                    <span className="orc-linha-numero">Nº {orcamento.numero}</span>
                                    <StatusOrcamentoTag status={orcamento.status} validoAte={orcamento.valido_ate} />
                                </div>
                                {orcamento.titulo ? <Text style={{ display: "block" }}>{orcamento.titulo}</Text> : null}
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                    Emitido em {formatarDataIso(orcamento.data_emissao)} · válido até {formatarDataIso(orcamento.valido_ate)}
                                    {orcamento.responsavel_nome ? ` · ${orcamento.responsavel_nome}` : ""}
                                </Text>
                            </div>
                            <span className="orc-linha-total">{reais(orcamento.total)}</span>
                            <AcoesOrcamento
                                orcamento={orcamento}
                                cliente={cliente}
                                podeExcluir={ehAdmin || orcamento.created_by === identityUserId}
                                onEditar={() => setEditor({ orcamentoId: orcamento.id })}
                                onAlterado={recarregar}
                                onArquivoSalvo={onDocumentoSalvo}
                            />
                        </div>
                    ))}
                </div>
            )}

            {editor ? (
                <EditorOrcamento
                    negocioId={negocioId}
                    orcamentoId={editor.orcamentoId}
                    clienteNome={lead.nome}
                    onFechar={() => setEditor(null)}
                    onSalvo={() => {
                        setEditor(null);
                        recarregar();
                    }}
                />
            ) : null}
        </Card>
    );
};
