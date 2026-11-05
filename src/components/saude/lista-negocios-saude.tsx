import { useList, type CrudFilter, type CrudSort } from "@refinedev/core";
import { Skeleton, Typography } from "antd";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { formatCurrencyBRL } from "../../lib/formatters";
import { valorDoLead } from "../../lib/pipelineMetrics";
import { RECURSO_SAUDE, type SaudeDoNegocio } from "../../lib/saudeNegocio";
import { Card } from "../ui";

const { Text } = Typography;

export type LinhaSaude = SaudeDoNegocio & {
    id: string | number;
    nome?: string | null;
    responsavel?: string | null;
    valor?: number | string | null;
    conta_energia_media?: number | string | null;
    etapa_nome?: string | null;
};

const COLUNAS =
    "id,nome,responsavel,valor,conta_energia_media,etapa_nome,temperatura,dias_sem_atividade,dias_sem_contato," +
    "dias_para_parado,parado,sem_proximo_passo,proxima_tarefa_em,proxima_tarefa_titulo";

type Props = {
    titulo: ReactNode;
    filtros: CrudFilter[];
    sorters: CrudSort[];
    /** Texto curto à direita do nome (ex.: "Parado há 9 dias"). */
    detalhe: (linha: LinhaSaude) => string;
    vazio: string;
    limite?: number;
    habilitado?: boolean;
    extra?: ReactNode;
    corDetalhe?: string;
};

/**
 * Lista curta de negócios vinda da vw_negocios_saude (migration 15), com
 * clique para abrir o lead. Usada no Dashboard e no Meu dia. Sem a view
 * no ambiente (migration pendente), o card simplesmente não aparece.
 */
export const ListaNegociosSaude = ({
    titulo,
    filtros,
    sorters,
    detalhe,
    vazio,
    limite = 6,
    habilitado = true,
    extra,
    corDetalhe = "#b45309",
}: Props) => {
    const navigate = useNavigate();
    const { query, result } = useList<LinhaSaude>({
        resource: RECURSO_SAUDE,
        pagination: { currentPage: 1, pageSize: limite },
        filters: filtros,
        sorters,
        meta: { select: COLUNAS },
        queryOptions: { enabled: habilitado, retry: false },
    });

    if (query.isError) return null;

    const linhas = result.data ?? [];
    const total = result.total ?? linhas.length;

    return (
        <Card
            title={
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Text strong style={{ fontSize: 15 }}>
                        {titulo}
                    </Text>
                    {total > 0 ? (
                        <span
                            style={{
                                fontSize: 11,
                                fontWeight: 700,
                                color: corDetalhe,
                                background: "rgba(245,158,11,0.10)",
                                borderRadius: 999,
                                padding: "1px 8px",
                            }}
                        >
                            {total}
                        </span>
                    ) : null}
                </span>
            }
            extra={extra}
            styles={{ body: { padding: "8px 0" } }}
        >
            {query.isLoading ? (
                <div style={{ padding: "8px 22px" }}>
                    <Skeleton active paragraph={{ rows: 2 }} title={false} />
                </div>
            ) : linhas.length === 0 ? (
                <div style={{ padding: "18px 22px", textAlign: "center" }}>
                    <Text type="secondary">{vazio}</Text>
                </div>
            ) : (
                <div>
                    {linhas.map((linha, indice) => (
                        <button
                            type="button"
                            key={String(linha.id)}
                            className="crm-dashboard-recent-lead"
                            onClick={() => navigate(`/clientes/show/${linha.id}`)}
                            style={{
                                display: "flex",
                                width: "100%",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 12,
                                padding: "10px 22px",
                                border: "none",
                                background: "transparent",
                                textAlign: "left",
                                borderBottom: indice < linhas.length - 1 ? "1px solid var(--crm-border-subtle)" : "none",
                                cursor: "pointer",
                            }}
                        >
                            <div style={{ minWidth: 0 }}>
                                <Text strong style={{ fontSize: 13.5, display: "block" }} ellipsis>
                                    {linha.nome || "Sem nome"}
                                </Text>
                                <Text type="secondary" style={{ fontSize: 11.5 }} ellipsis>
                                    {[linha.responsavel || "Sem responsável", linha.etapa_nome].filter(Boolean).join(" · ")}
                                </Text>
                            </div>
                            <div style={{ textAlign: "right", flexShrink: 0 }}>
                                <Text style={{ fontSize: 12, fontWeight: 600, color: corDetalhe, display: "block" }}>
                                    {detalhe(linha)}
                                </Text>
                                <Text type="secondary" style={{ fontSize: 11.5 }}>
                                    {formatCurrencyBRL(valorDoLead(linha), "-")}
                                </Text>
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </Card>
    );
};
