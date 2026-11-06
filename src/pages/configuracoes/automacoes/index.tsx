import { DeleteOutlined, EditOutlined, HistoryOutlined, PlusOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { useDelete, useUpdate } from "@refinedev/core";
import { Alert, Button, Popconfirm, Skeleton, Switch, Tag, Tooltip, Typography, message } from "antd";
import { useState } from "react";
import { EmptyState } from "../../../components/ui";
import { useCrmAccess } from "../../../hooks/useCrmAccess";
import {
    descreverAutomacao,
    GATILHOS_AGENDADOS,
    mensagemErroAutomacao,
    novaRegra,
    pendenciasParaAtivar,
    type RegraAutomacao,
} from "../../../lib/automacoes";
import { getSupabaseErrorMessage, isSupabaseMissingRelation } from "../../../lib/supabaseErrors";
import { useDadosAutomacoes, type RegraListada } from "./dados";
import { EditorAutomacao } from "./editor";
import { HistoricoAutomacao } from "./historico";

const { Text } = Typography;

type Edicao = { regra: RegraAutomacao; chave: number } | null;

export const AutomacoesConfig = () => {
    const { isGerente } = useCrmAccess();
    const { regras, contexto, opcoes, carregando, erro, recarregar } = useDadosAutomacoes();
    const [edicao, setEdicao] = useState<Edicao>(null);
    const [historico, setHistorico] = useState<{ id: string; nome: string } | null>(null);
    const [alternando, setAlternando] = useState<string | null>(null);
    const { mutateAsync: atualizar } = useUpdate();
    const { mutateAsync: excluir } = useDelete();

    const abrirEditor = (regra: RegraAutomacao) => setEdicao({ regra, chave: Date.now() });

    const alternar = async (item: RegraListada, ativo: boolean) => {
        if (!item.regra.id || alternando) return;
        setAlternando(item.regra.id);
        try {
            await atualizar({
                resource: "automacoes",
                id: item.regra.id,
                values: { ativo },
                successNotification: false,
                errorNotification: false,
            });
            message.success(ativo ? "Automação ativada." : "Automação desativada.");
        } catch (e) {
            message.error(mensagemErroAutomacao(getSupabaseErrorMessage(e)));
        } finally {
            setAlternando(null);
            recarregar();
        }
    };

    const remover = async (id: string) => {
        try {
            await excluir({ resource: "automacoes", id, successNotification: false, errorNotification: false });
            message.success("Automação excluída.");
        } catch (e) {
            message.error(getSupabaseErrorMessage(e));
        } finally {
            recarregar();
        }
    };

    if (isSupabaseMissingRelation(erro)) {
        return <Alert type="info" showIcon message="Automações ainda não disponíveis: aplique a migration 17 no banco." />;
    }
    if (erro) {
        return <Alert type="error" showIcon message="Não foi possível carregar as automações." description={getSupabaseErrorMessage(erro)} />;
    }
    if (carregando) return <Skeleton active />;

    return (
        <div className="crm-automacoes">
            {!isGerente ? (
                <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="Somente o gerente cria, edita ou liga automações. Você vê as regras e o histórico."
                />
            ) : (
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => abrirEditor(novaRegra())}>
                        Nova automação
                    </Button>
                </div>
            )}

            {regras.length === 0 ? (
                <EmptyState
                    icon={<ThunderboltOutlined />}
                    title="Nenhuma automação"
                    description="Crie regras do tipo “quando o negócio entrar em Proposta Enviada, criar tarefa de ligar em 2 dias”."
                    actionLabel={isGerente ? "Nova automação" : undefined}
                    onAction={isGerente ? () => abrirEditor(novaRegra()) : undefined}
                />
            ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
                    {regras.map((item) => {
                        const { regra, resumo } = item;
                        const pendencias = pendenciasParaAtivar(regra);
                        const podeLigar = regra.ativo || pendencias.length === 0;
                        const id = regra.id ?? "";
                        return (
                            <li
                                key={id}
                                style={{
                                    border: "1px solid var(--crm-border, #e7edf5)",
                                    borderRadius: 12,
                                    padding: 12,
                                    background: "var(--crm-surface-1, #fff)",
                                    minWidth: 0,
                                }}
                            >
                                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                                    <Tooltip title={!podeLigar ? pendencias.join(" ") : undefined}>
                                        <Switch
                                            checked={regra.ativo}
                                            disabled={!isGerente || !podeLigar}
                                            loading={alternando === id}
                                            aria-label={regra.ativo ? `Desativar ${regra.nome}` : `Ativar ${regra.nome}`}
                                            onChange={(ativo) => void alternar(item, ativo)}
                                            style={{ marginTop: 2, flex: "0 0 auto" }}
                                        />
                                    </Tooltip>
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                                            <Text strong style={{ overflowWrap: "anywhere" }}>
                                                {regra.nome}
                                            </Text>
                                            {item.modeloChave ? <Tag style={{ marginInlineEnd: 0 }}>Modelo pronto</Tag> : null}
                                            {GATILHOS_AGENDADOS.includes(regra.gatilho) ? (
                                                <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                                                    De hora em hora
                                                </Tag>
                                            ) : null}
                                        </div>
                                        <Text
                                            type="secondary"
                                            style={{ display: "block", fontSize: 13, marginTop: 2, overflowWrap: "anywhere" }}
                                        >
                                            {descreverAutomacao(regra, contexto)}
                                        </Text>
                                        {!regra.ativo && pendencias.length > 0 ? (
                                            <Text type="warning" style={{ display: "block", fontSize: 12, marginTop: 4 }}>
                                                {pendencias.join(" ")} Edite antes de ativar.
                                            </Text>
                                        ) : null}
                                        <div
                                            style={{
                                                display: "flex",
                                                flexWrap: "wrap",
                                                gap: 8,
                                                alignItems: "center",
                                                marginTop: 8,
                                            }}
                                        >
                                            <Text style={{ fontSize: 12 }}>
                                                {resumo.totalExecucoes} {resumo.totalExecucoes === 1 ? "execução" : "execuções"}
                                            </Text>
                                            <Text type={resumo.totalErros > 0 ? "danger" : "secondary"} style={{ fontSize: 12 }}>
                                                {resumo.totalErros} {resumo.totalErros === 1 ? "erro" : "erros"}
                                            </Text>
                                            <span style={{ flex: 1 }} />
                                            <Button
                                                size="small"
                                                icon={<HistoryOutlined />}
                                                onClick={() => setHistorico({ id, nome: regra.nome })}
                                            >
                                                Histórico
                                            </Button>
                                            {isGerente ? (
                                                <>
                                                    <Button size="small" icon={<EditOutlined />} onClick={() => abrirEditor(regra)}>
                                                        Editar
                                                    </Button>
                                                    <Popconfirm
                                                        title="Excluir esta automação?"
                                                        description="O histórico dela também é apagado."
                                                        okText="Excluir"
                                                        cancelText="Cancelar"
                                                        okButtonProps={{ danger: true }}
                                                        onConfirm={() => remover(id)}
                                                    >
                                                        <Button size="small" danger icon={<DeleteOutlined />} aria-label={`Excluir ${regra.nome}`} />
                                                    </Popconfirm>
                                                </>
                                            ) : null}
                                        </div>
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            {edicao && isGerente ? (
                <EditorAutomacao
                    key={edicao.chave}
                    inicial={edicao.regra}
                    contexto={contexto}
                    opcoes={opcoes}
                    onClose={() => setEdicao(null)}
                    onSalvo={() => {
                        setEdicao(null);
                        recarregar();
                    }}
                />
            ) : null}
            <HistoricoAutomacao automacaoId={historico?.id ?? null} nome={historico?.nome ?? ""} onClose={() => setHistorico(null)} />
        </div>
    );
};
