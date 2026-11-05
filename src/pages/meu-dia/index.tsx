import {
    CheckOutlined,
    ClockCircleOutlined,
    EnvironmentOutlined,
    PhoneOutlined,
    SunOutlined,
} from "@ant-design/icons";
import { useInvalidate, useList, useUpdate } from "@refinedev/core";
import { Col, Row, Skeleton, Space, Switch, Typography, message } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ListaNegociosSaude } from "../../components/saude/lista-negocios-saude";
import { Button, Card } from "../../components/ui";
import { useCrmAccess } from "../../hooks/useCrmAccess";
import { normalizeText } from "../../lib/formatters";
import { filtrosDoDono, fimDoDia, marcarMeuDiaVisto, separarTarefasDoDia, type TarefaDoDia } from "../../lib/meuDia";
import {
    DIAS_QUENTE_SEM_CONTATO,
    filtrosQuentesSemContato,
    RECURSO_SAUDE,
    rotuloParado,
    rotuloSemContato,
} from "../../lib/saudeNegocio";

const { Title, Text } = Typography;

const iconeDoTipo = (tipo?: string | null) => {
    const valor = normalizeText(tipo);
    if (valor.includes("liga")) return <PhoneOutlined />;
    if (valor.includes("visita")) return <EnvironmentOutlined />;
    return <ClockCircleOutlined />;
};

type LinhaTarefaProps = {
    tarefa: TarefaDoDia;
    atrasada: boolean;
    concluindo: boolean;
    mostrarResponsavel: boolean;
    onConcluir: (tarefa: TarefaDoDia) => void;
    onAbrirLead: (id: string | number) => void;
};

const LinhaTarefa = ({ tarefa, atrasada, concluindo, mostrarResponsavel, onConcluir, onAbrirLead }: LinhaTarefaProps) => {
    const quando = tarefa.data_vencimento ? dayjs(tarefa.data_vencimento) : null;
    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 18px",
                borderBottom: "1px solid var(--crm-border-subtle)",
            }}
        >
            <Button
                shape="circle"
                size="small"
                icon={<CheckOutlined />}
                aria-label={`Concluir ${tarefa.titulo || "atividade"}`}
                loading={concluindo}
                onClick={() => onConcluir(tarefa)}
            />
            <div style={{ minWidth: 0, flex: 1 }}>
                <Text strong style={{ display: "block" }} ellipsis>
                    <span style={{ marginRight: 6, color: atrasada ? "#dc2626" : "var(--crm-ink-500)" }}>
                        {iconeDoTipo(tarefa.tipo)}
                    </span>
                    {tarefa.titulo || "Atividade"}
                </Text>
                <Text style={{ fontSize: 12, color: atrasada ? "#dc2626" : "var(--crm-ink-500)" }}>
                    {quando
                        ? atrasada
                            ? `Atrasada · ${quando.format("DD/MM HH:mm")}`
                            : `Hoje · ${quando.format("HH:mm")}`
                        : ""}
                    {mostrarResponsavel && tarefa.responsavel ? ` · ${tarefa.responsavel}` : ""}
                </Text>
            </div>
            {tarefa.cliente_id ? (
                <Button size="small" type="link" onClick={() => onAbrirLead(tarefa.cliente_id as string | number)}>
                    Abrir lead
                </Button>
            ) : null}
        </div>
    );
};

/**
 * Meu dia: o que o vendedor precisa fazer hoje, num lugar só. Tudo do
 * usuário logado (responsável = ele); o gerente pode ver a equipe.
 */
export const MeuDiaPage = () => {
    const navigate = useNavigate();
    const invalidate = useInvalidate();
    const { isGerente, ownerCandidates, isLoadingAccess, ownerDisplayName } = useCrmAccess();
    const [verEquipe, setVerEquipe] = useState(false);
    const [concluindoId, setConcluindoId] = useState<string | number | null>(null);
    const { mutateAsync: atualizar } = useUpdate();

    useEffect(() => {
        marcarMeuDiaVisto();
    }, []);

    const filtrosDono = useMemo(
        () => filtrosDoDono({ ownerCandidates, verEquipe, isGerente }),
        [ownerCandidates, verEquipe, isGerente],
    );

    // Até o fim de hoje: hoje + atrasadas (não concluídas, fora da lixeira)
    const limite = useMemo(() => fimDoDia().toISOString(), []);
    const { query: tarefasQuery, result: tarefasResult } = useList<TarefaDoDia>({
        resource: "tarefas",
        pagination: { currentPage: 1, pageSize: 100 },
        filters: [
            { field: "concluido", operator: "eq", value: false },
            { field: "deleted_at", operator: "null", value: true },
            { field: "data_vencimento", operator: "lte", value: limite },
            ...filtrosDono,
        ],
        sorters: [{ field: "data_vencimento", order: "asc" }],
        meta: { select: "id,titulo,tipo,data_vencimento,cliente_id,responsavel,concluido" },
        queryOptions: { enabled: !isLoadingAccess },
    });
    const { atrasadas, hoje } = useMemo(
        () => separarTarefasDoDia(tarefasResult.data ?? []),
        [tarefasResult.data],
    );

    const concluir = async (tarefa: TarefaDoDia) => {
        setConcluindoId(tarefa.id);
        try {
            await atualizar({
                resource: "tarefas",
                id: tarefa.id,
                values: { concluido: true },
                successNotification: false,
                errorNotification: false,
            });
            message.success("Atividade concluída.");
            await tarefasQuery.refetch();
            void invalidate({ resource: RECURSO_SAUDE, invalidates: ["list"] });
        } catch {
            message.error("Não foi possível concluir a atividade.");
        } finally {
            setConcluindoId(null);
        }
    };

    const abrirLead = (id: string | number) => navigate(`/clientes/show/${id}`);
    const totalTarefas = atrasadas.length + hoje.length;

    return (
        <div className="crm-page-shell">
            <div className="crm-page-header">
                <div>
                    <Title level={2} className="crm-page-header-title">
                        <SunOutlined style={{ marginRight: 10, color: "#f59e0b" }} />
                        Meu dia
                    </Title>
                    <Text className="crm-page-header-subtitle">
                        {dayjs().format("dddd, DD [de] MMMM")} ·{" "}
                        {verEquipe && isGerente ? "toda a equipe" : `atividades e negócios de ${ownerDisplayName}`}
                    </Text>
                </div>
                {isGerente ? (
                    <Space>
                        <Switch checked={verEquipe} onChange={setVerEquipe} aria-label="Ver da equipe" />
                        <Text>Ver da equipe</Text>
                    </Space>
                ) : null}
            </div>

            <Row gutter={[14, 14]}>
                <Col xs={24} lg={12}>
                    <Card
                        title={
                            <Text strong style={{ fontSize: 15 }}>
                                Atividades de hoje e atrasadas {totalTarefas > 0 ? `(${totalTarefas})` : ""}
                            </Text>
                        }
                        extra={
                            <Button size="small" onClick={() => navigate("/agenda")}>
                                Agenda
                            </Button>
                        }
                        styles={{ body: { padding: 0 } }}
                    >
                        {tarefasQuery.isLoading || isLoadingAccess ? (
                            <div style={{ padding: 18 }}>
                                <Skeleton active paragraph={{ rows: 3 }} title={false} />
                            </div>
                        ) : tarefasQuery.isError ? (
                            <div style={{ padding: 18 }}>
                                <Text type="danger">Não foi possível carregar as atividades.</Text>
                            </div>
                        ) : totalTarefas === 0 ? (
                            <div style={{ padding: 24, textAlign: "center" }}>
                                <Text type="secondary">Nada pendente para hoje. Bom trabalho!</Text>
                            </div>
                        ) : (
                            <div>
                                {[...atrasadas.map((t) => ({ t, atrasada: true })), ...hoje.map((t) => ({ t, atrasada: false }))].map(
                                    ({ t, atrasada }) => (
                                        <LinhaTarefa
                                            key={String(t.id)}
                                            tarefa={t}
                                            atrasada={atrasada}
                                            concluindo={concluindoId === t.id}
                                            mostrarResponsavel={verEquipe && isGerente}
                                            onConcluir={concluir}
                                            onAbrirLead={abrirLead}
                                        />
                                    ),
                                )}
                            </div>
                        )}
                    </Card>
                </Col>
                <Col xs={24} lg={12}>
                    <Space direction="vertical" size={14} style={{ width: "100%" }}>
                        <ListaNegociosSaude
                            titulo={`Quentes sem contato há ${DIAS_QUENTE_SEM_CONTATO}+ dias`}
                            filtros={[...filtrosQuentesSemContato(), ...filtrosDono]}
                            sorters={[{ field: "dias_sem_contato", order: "desc" }, { field: "id", order: "asc" }]}
                            detalhe={(l) => rotuloSemContato(l.dias_sem_contato)}
                            vazio="Nenhum lead quente esperando contato."
                            habilitado={!isLoadingAccess}
                            corDetalhe="#dc2626"
                        />
                        <ListaNegociosSaude
                            titulo="Negócios parados"
                            filtros={[{ field: "parado", operator: "eq", value: true }, ...filtrosDono]}
                            sorters={[{ field: "dias_sem_atividade", order: "desc" }, { field: "id", order: "asc" }]}
                            detalhe={(l) => rotuloParado(l.dias_sem_atividade)}
                            vazio="Nenhum negócio parado. O funil está andando."
                            habilitado={!isLoadingAccess}
                        />
                        <ListaNegociosSaude
                            titulo="Sem próximo passo"
                            filtros={[{ field: "sem_proximo_passo", operator: "eq", value: true }, ...filtrosDono]}
                            sorters={[{ field: "temperatura_ordem", order: "desc" }, { field: "id", order: "asc" }]}
                            detalhe={() => "Agendar atividade"}
                            vazio="Todo negócio aberto tem uma próxima atividade."
                            habilitado={!isLoadingAccess}
                        />
                    </Space>
                </Col>
            </Row>
        </div>
    );
};
