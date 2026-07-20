import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { useCreate, useDelete, useList, useUpdate } from "@refinedev/core";
import {
    Alert,
    Form,
    Input,
    InputNumber,
    Modal,
    Popconfirm,
    Skeleton,
    Space,
    Switch,
    Table,
    Tag,
    Typography,
    message,
} from "antd";
import { useMemo, useState } from "react";
import { Button, EmptyState } from "../../../components/ui";
import { useTenant } from "../../../contexts/tenant";
import { useCrmAccess } from "../../../hooks/useCrmAccess";
import { isSupabaseMissingRelation } from "../../../lib/supabaseErrors";
import type { PipelineRecord, PipelineStageRecord } from "../../../types/db";

const { Text } = Typography;

type StageRow = PipelineStageRecord & {
    pipeline_id?: string | null;
    probabilidade?: number | null;
    ganho?: boolean | null;
    perdido?: boolean | null;
};

type PipelineFormValues = { nome: string; ordem: number; ativo: boolean };
type StageFormValues = {
    nome: string;
    cor?: string;
    ordem: number;
    probabilidade: number;
    ganho: boolean;
    perdido: boolean;
};

export const PipelinesConfig = () => {
    const { tenantId } = useTenant();
    const { canDeleteRecords } = useCrmAccess();

    const [pipelineModal, setPipelineModal] = useState<{ open: boolean; editando: PipelineRecord | null }>({
        open: false,
        editando: null,
    });
    const [stageModal, setStageModal] = useState<{
        open: boolean;
        pipelineId: string | null;
        editando: StageRow | null;
    }>({ open: false, pipelineId: null, editando: null });

    const [pipelineForm] = Form.useForm<PipelineFormValues>();
    const [stageForm] = Form.useForm<StageFormValues>();

    const { query: pipelinesQuery } = useList<PipelineRecord>({
        resource: "pipelines",
        pagination: { mode: "off" },
        sorters: [{ field: "ordem", order: "asc" }],
    });

    const { query: stagesQuery } = useList<StageRow>({
        resource: "pipeline_stages",
        pagination: { mode: "off" },
        sorters: [{ field: "ordem", order: "asc" }],
    });

    const { mutateAsync: createRecord } = useCreate();
    const { mutateAsync: updateRecord } = useUpdate();
    const { mutateAsync: deleteRecord } = useDelete();

    const pipelines = useMemo(
        () => ((pipelinesQuery?.data?.data as PipelineRecord[]) || []).filter(Boolean),
        [pipelinesQuery?.data?.data],
    );
    const stages = useMemo(
        () => ((stagesQuery?.data?.data as StageRow[]) || []).filter(Boolean),
        [stagesQuery?.data?.data],
    );

    const tabelaPipelinesAusente = isSupabaseMissingRelation(pipelinesQuery?.error);

    const stagesDoPipeline = (pipelineId: string) =>
        stages.filter(
            (stage) => String(stage.pipeline_id ?? "") === pipelineId || stage.pipeline_id == null,
        );

    const salvarPipeline = async () => {
        const values = await pipelineForm.validateFields();
        try {
            if (pipelineModal.editando) {
                await updateRecord({
                    resource: "pipelines",
                    id: pipelineModal.editando.id,
                    values,
                });
                message.success("Funil atualizado.");
            } else {
                await createRecord({
                    resource: "pipelines",
                    values: { ...values, tenant_id: tenantId || undefined },
                });
                message.success("Funil criado.");
            }
            setPipelineModal({ open: false, editando: null });
            await pipelinesQuery?.refetch?.();
        } catch (error: unknown) {
            const detalhe =
                typeof error === "object" && error && "message" in error
                    ? String((error as { message?: unknown }).message)
                    : "Erro desconhecido";
            message.error(`Não foi possível salvar o funil: ${detalhe}`);
        }
    };

    const salvarStage = async () => {
        const values = await stageForm.validateFields();
        const payload = {
            ...values,
            pipeline_id: stageModal.pipelineId || undefined,
            tenant_id: tenantId || undefined,
        };
        try {
            if (stageModal.editando) {
                await updateRecord({
                    resource: "pipeline_stages",
                    id: stageModal.editando.id,
                    values: payload,
                });
                message.success("Etapa atualizada.");
            } else {
                await createRecord({ resource: "pipeline_stages", values: payload });
                message.success("Etapa criada.");
            }
            setStageModal({ open: false, pipelineId: null, editando: null });
            await stagesQuery?.refetch?.();
        } catch (error: unknown) {
            const detalhe =
                typeof error === "object" && error && "message" in error
                    ? String((error as { message?: unknown }).message)
                    : "Erro desconhecido";
            message.error(`Não foi possível salvar a etapa: ${detalhe}`);
        }
    };

    const excluirPipeline = async (pipeline: PipelineRecord) => {
        try {
            await deleteRecord({ resource: "pipelines", id: pipeline.id });
            message.success("Funil removido.");
            await pipelinesQuery?.refetch?.();
        } catch {
            message.error("Não foi possível remover o funil.");
        }
    };

    const excluirStage = async (stage: StageRow) => {
        try {
            await deleteRecord({ resource: "pipeline_stages", id: stage.id });
            message.success("Etapa removida.");
            await stagesQuery?.refetch?.();
        } catch {
            message.error("Não foi possível remover a etapa (verifique se há negócios nela).");
        }
    };

    if (pipelinesQuery?.isLoading || stagesQuery?.isLoading) {
        return <Skeleton active />;
    }

    return (
        <div>
            {tabelaPipelinesAusente ? (
                <Alert
                    type="warning"
                    showIcon
                    message="Estrutura do banco pendente"
                    description="A tabela pipelines ainda não existe neste ambiente. Execute as migrations em database/migrations/ no Supabase."
                    style={{ marginBottom: 16 }}
                />
            ) : null}

            {!canDeleteRecords ? (
                <Alert
                    type="info"
                    showIcon
                    message="Somente administradores podem alterar funis e etapas."
                    style={{ marginBottom: 16 }}
                />
            ) : (
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={() => {
                            pipelineForm.resetFields();
                            setPipelineModal({ open: true, editando: null });
                        }}
                    >
                        Novo funil
                    </Button>
                </div>
            )}

            {pipelines.length === 0 && !tabelaPipelinesAusente ? (
                <EmptyState
                    title="Nenhum funil configurado"
                    description="Crie o primeiro funil (ex.: Vendas) e vincule as etapas do seu processo comercial."
                />
            ) : (
                <Table<PipelineRecord>
                    rowKey="id"
                    dataSource={pipelines}
                    pagination={false}
                    columns={[
                        {
                            title: "Funil",
                            dataIndex: "nome",
                            render: (nome: string, pipeline) => (
                                <Space>
                                    <Text strong>{nome}</Text>
                                    {pipeline.ativo === false ? <Tag>Inativo</Tag> : null}
                                </Space>
                            ),
                        },
                        { title: "Ordem", dataIndex: "ordem", width: 90 },
                        {
                            title: "Etapas",
                            key: "etapas",
                            render: (_, pipeline) => stagesDoPipeline(String(pipeline.id)).length,
                            width: 90,
                        },
                        ...(canDeleteRecords
                            ? [
                                  {
                                      title: "Ações",
                                      key: "acoes",
                                      width: 110,
                                      render: (_: unknown, pipeline: PipelineRecord) => (
                                          <Space>
                                              <Button
                                                  size="small"
                                                  type="text"
                                                  icon={<EditOutlined />}
                                                  onClick={() => {
                                                      pipelineForm.setFieldsValue({
                                                          nome: pipeline.nome,
                                                          ordem: pipeline.ordem ?? 1,
                                                          ativo: pipeline.ativo !== false,
                                                      });
                                                      setPipelineModal({ open: true, editando: pipeline });
                                                  }}
                                              />
                                              <Popconfirm
                                                  title="Remover funil?"
                                                  description="As etapas vinculadas ficam órfãs (não são apagadas)."
                                                  okText="Remover"
                                                  cancelText="Cancelar"
                                                  onConfirm={() => excluirPipeline(pipeline)}
                                              >
                                                  <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                                              </Popconfirm>
                                          </Space>
                                      ),
                                  },
                              ]
                            : []),
                    ]}
                    expandable={{
                        expandedRowRender: (pipeline) => (
                            <div style={{ padding: "4px 0" }}>
                                {canDeleteRecords ? (
                                    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                                        <Button
                                            size="small"
                                            icon={<PlusOutlined />}
                                            onClick={() => {
                                                stageForm.resetFields();
                                                setStageModal({
                                                    open: true,
                                                    pipelineId: String(pipeline.id),
                                                    editando: null,
                                                });
                                            }}
                                        >
                                            Nova etapa
                                        </Button>
                                    </div>
                                ) : null}
                                <Table<StageRow>
                                    rowKey="id"
                                    size="small"
                                    pagination={false}
                                    dataSource={stagesDoPipeline(String(pipeline.id))}
                                    columns={[
                                        {
                                            title: "Etapa",
                                            dataIndex: "nome",
                                            render: (nome: string, stage) => (
                                                <Space>
                                                    <span
                                                        style={{
                                                            display: "inline-block",
                                                            width: 10,
                                                            height: 10,
                                                            borderRadius: "50%",
                                                            background: stage.cor || "#94a3b8",
                                                        }}
                                                    />
                                                    {nome}
                                                    {stage.ganho ? <Tag color="green">Ganho</Tag> : null}
                                                    {stage.perdido ? <Tag color="red">Perda</Tag> : null}
                                                    {stage.pipeline_id == null ? (
                                                        <Tag color="orange">Sem funil (legado)</Tag>
                                                    ) : null}
                                                </Space>
                                            ),
                                        },
                                        { title: "Ordem", dataIndex: "ordem", width: 80 },
                                        {
                                            title: "Probabilidade",
                                            dataIndex: "probabilidade",
                                            width: 120,
                                            render: (probabilidade: number | null) =>
                                                probabilidade != null ? `${probabilidade}%` : "—",
                                        },
                                        ...(canDeleteRecords
                                            ? [
                                                  {
                                                      title: "Ações",
                                                      key: "acoes",
                                                      width: 110,
                                                      render: (_: unknown, stage: StageRow) => (
                                                          <Space>
                                                              <Button
                                                                  size="small"
                                                                  type="text"
                                                                  icon={<EditOutlined />}
                                                                  onClick={() => {
                                                                      stageForm.setFieldsValue({
                                                                          nome: stage.nome,
                                                                          cor: stage.cor || undefined,
                                                                          ordem: stage.ordem ?? 1,
                                                                          probabilidade: stage.probabilidade ?? 0,
                                                                          ganho: Boolean(stage.ganho),
                                                                          perdido: Boolean(stage.perdido),
                                                                      });
                                                                      setStageModal({
                                                                          open: true,
                                                                          pipelineId: String(pipeline.id),
                                                                          editando: stage,
                                                                      });
                                                                  }}
                                                              />
                                                              <Popconfirm
                                                                  title="Remover etapa?"
                                                                  okText="Remover"
                                                                  cancelText="Cancelar"
                                                                  onConfirm={() => excluirStage(stage)}
                                                              >
                                                                  <Button
                                                                      size="small"
                                                                      type="text"
                                                                      danger
                                                                      icon={<DeleteOutlined />}
                                                                  />
                                                              </Popconfirm>
                                                          </Space>
                                                      ),
                                                  },
                                              ]
                                            : []),
                                    ]}
                                />
                            </div>
                        ),
                    }}
                />
            )}

            <Modal
                title={pipelineModal.editando ? "Editar funil" : "Novo funil"}
                open={pipelineModal.open}
                onOk={salvarPipeline}
                onCancel={() => setPipelineModal({ open: false, editando: null })}
                okText="Salvar"
                cancelText="Cancelar"
                destroyOnHidden
            >
                <Form form={pipelineForm} layout="vertical">
                    <Form.Item
                        label="Nome do funil"
                        name="nome"
                        rules={[{ required: true, message: "Informe o nome do funil." }]}
                    >
                        <Input placeholder="Ex.: Vendas, Pós-venda, Renovação" />
                    </Form.Item>
                    <Form.Item label="Ordem" name="ordem" initialValue={1}>
                        <InputNumber min={1} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item label="Ativo" name="ativo" valuePropName="checked" initialValue={true}>
                        <Switch />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                title={stageModal.editando ? "Editar etapa" : "Nova etapa"}
                open={stageModal.open}
                onOk={salvarStage}
                onCancel={() => setStageModal({ open: false, pipelineId: null, editando: null })}
                okText="Salvar"
                cancelText="Cancelar"
                destroyOnHidden
            >
                <Form form={stageForm} layout="vertical">
                    <Form.Item
                        label="Nome da etapa"
                        name="nome"
                        rules={[{ required: true, message: "Informe o nome da etapa." }]}
                    >
                        <Input placeholder="Ex.: Proposta enviada" />
                    </Form.Item>
                    <Form.Item label="Cor (hex)" name="cor">
                        <Input placeholder="#5d9cec" maxLength={7} />
                    </Form.Item>
                    <Form.Item label="Ordem" name="ordem" initialValue={1}>
                        <InputNumber min={1} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item
                        label="Probabilidade de fechamento (%)"
                        name="probabilidade"
                        initialValue={0}
                        tooltip="Usada no forecast: valor do negócio × probabilidade da etapa."
                    >
                        <InputNumber min={0} max={100} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item label="Etapa de ganho" name="ganho" valuePropName="checked" initialValue={false}>
                        <Switch />
                    </Form.Item>
                    <Form.Item label="Etapa de perda" name="perdido" valuePropName="checked" initialValue={false}>
                        <Switch />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
};
