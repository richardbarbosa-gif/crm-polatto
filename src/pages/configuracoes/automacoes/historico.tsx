import { useList } from "@refinedev/core";
import { Alert, Button, Drawer, Empty, List, Skeleton, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useNavigate } from "react-router";

const { Text } = Typography;

type Execucao = {
    id: number | string;
    negocio_id?: string | null;
    negocio_nome?: string | null;
    evento?: string | null;
    resultado?: string | null;
    mensagem?: string | null;
    detalhes?: unknown;
    executado_em?: string | null;
};

const ROTULO_EVENTO: Record<string, string> = {
    negocio_criado: "Negócio criado",
    etapa_entrou: "Entrou na etapa",
    negocio_ganho: "Ganho",
    negocio_perdido: "Perdido",
    temperatura_mudou: "Temperatura",
    negocio_parado: "Parado",
    proposta_sem_resposta: "Proposta sem resposta",
};

/** Resumo legível do que cada ação fez (detalhes gravados pelo motor). */
const resumirDetalhes = (detalhes: unknown): string[] => {
    if (!Array.isArray(detalhes)) return [];
    return detalhes.flatMap((item): string[] => {
        if (!item || typeof item !== "object") return [];
        const d = item as Record<string, unknown>;
        const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
        switch (d.acao) {
            case "criar_tarefa":
                return [`Tarefa «${s(d.titulo) ?? "?"}»${s(d.responsavel) ? ` para ${s(d.responsavel)}` : ""}`];
            case "mudar_temperatura":
                return [d.sem_mudanca ? "Temperatura já estava certa" : `Temperatura: ${s(d.para) ?? "?"}`];
            case "atribuir_responsavel":
                return [`Atribuído a ${s(d.responsavel) ?? "?"}${d.modo === "rodizio" ? " (rodízio)" : ""}`];
            case "notificar_gerente":
                return [
                    `Aviso para ${Array.isArray(d.gerentes) ? d.gerentes.filter((g) => typeof g === "string").join(", ") : "o gerente"}`,
                ];
            default:
                return [];
        }
    });
};

type Props = {
    automacaoId: string | null;
    nome: string;
    onClose: () => void;
};

export const HistoricoAutomacao = ({ automacaoId, nome, onClose }: Props) => {
    const navigate = useNavigate();
    const { query } = useList<Execucao>({
        resource: "automacoes_execucoes",
        filters: [{ field: "automacao_id", operator: "eq", value: automacaoId }],
        sorters: [{ field: "executado_em", order: "desc" }],
        pagination: { currentPage: 1, pageSize: 50 },
        queryOptions: { enabled: Boolean(automacaoId) },
    });
    const execucoes = (query.data?.data ?? []).filter(Boolean);

    return (
        <Drawer
            open={Boolean(automacaoId)}
            onClose={onClose}
            title={`Histórico: ${nome}`}
            width={560}
            styles={{ wrapper: { maxWidth: "100vw" }, body: { paddingTop: 8 } }}
            destroyOnHidden
        >
            {query.isLoading ? (
                <Skeleton active />
            ) : query.error ? (
                <Alert type="error" showIcon message="Não foi possível carregar o histórico." />
            ) : execucoes.length === 0 ? (
                <Empty description="Esta automação ainda não rodou." />
            ) : (
                <>
                    <Text type="secondary" style={{ display: "block", marginBottom: 8, fontSize: 12 }}>
                        Últimas {execucoes.length} execuções.
                    </Text>
                    <List
                        dataSource={execucoes}
                        rowKey={(e) => String(e.id)}
                        renderItem={(e) => {
                            const ok = e.resultado === "ok";
                            const detalhes = resumirDetalhes(e.detalhes);
                            return (
                                <List.Item style={{ display: "block", padding: "10px 0" }}>
                                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                                        <Tag color={ok ? "green" : e.resultado === "erro" ? "red" : "default"} style={{ marginInlineEnd: 0 }}>
                                            {ok ? "OK" : e.resultado === "erro" ? "Erro" : "Executando"}
                                        </Tag>
                                        <Text type="secondary" style={{ fontSize: 12 }}>
                                            {e.executado_em ? dayjs(e.executado_em).format("DD/MM/YYYY HH:mm") : ""}
                                            {e.evento && ROTULO_EVENTO[e.evento] ? ` · ${ROTULO_EVENTO[e.evento]}` : ""}
                                        </Text>
                                    </div>
                                    <div style={{ marginTop: 4, minWidth: 0 }}>
                                        {e.negocio_id ? (
                                            <Button
                                                type="link"
                                                style={{ padding: 0, height: "auto", whiteSpace: "normal", textAlign: "left" }}
                                                onClick={() => navigate(`/clientes/show/${e.negocio_id}`)}
                                            >
                                                {e.negocio_nome || "Abrir negócio"}
                                            </Button>
                                        ) : (
                                            <Text>{e.negocio_nome || "Negócio excluído"}</Text>
                                        )}
                                    </div>
                                    {detalhes.length > 0 ? (
                                        <Text style={{ display: "block", fontSize: 13, overflowWrap: "anywhere" }}>{detalhes.join(" · ")}</Text>
                                    ) : null}
                                    {e.mensagem ? (
                                        <Text type="danger" style={{ display: "block", fontSize: 13, overflowWrap: "anywhere" }}>
                                            {e.mensagem}
                                        </Text>
                                    ) : null}
                                </List.Item>
                            );
                        }}
                    />
                </>
            )}
        </Drawer>
    );
};
