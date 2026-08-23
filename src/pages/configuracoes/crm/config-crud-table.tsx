import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { useCreate, useDelete, useList, useUpdate } from "@refinedev/core";
import { Alert, Form, type FormInstance, Modal, Popconfirm, Skeleton, Space, Table, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { type ReactNode, useMemo, useState } from "react";
import { Button, EmptyState } from "../../../components/ui";
import { useTenant } from "../../../contexts/tenant";
import { isSupabaseMissingRelation } from "../../../lib/supabaseErrors";

export type ConfigRecord = { id: string | number; [key: string]: unknown };

type ConfigCrudTableProps<T extends ConfigRecord> = {
    resource: string;
    titulo: string;
    descricaoVazio: string;
    canManage: boolean;
    columns: ColumnsType<T>;
    renderFormItems: (editando: T | null) => ReactNode;
    toFormValues: (record: T) => Record<string, unknown>;
    fromFormValues?: (values: Record<string, unknown>, editando: T | null) => Record<string, unknown>;
    sorters?: { field: string; order: "asc" | "desc" }[];
    form: FormInstance;
};

/**
 * Tabela CRUD genérica das configurações do CRM (motivos de perda, tipos de
 * atividade etc). Resiliente a tabela ausente no banco (migration pendente).
 */
export function ConfigCrudTable<T extends ConfigRecord>({
    resource,
    titulo,
    descricaoVazio,
    canManage,
    columns,
    renderFormItems,
    toFormValues,
    fromFormValues,
    sorters,
    form,
}: ConfigCrudTableProps<T>) {
    const { tenantId } = useTenant();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editando, setEditando] = useState<T | null>(null);

    const { query } = useList<T>({
        resource,
        pagination: { mode: "off" },
        sorters: sorters || [{ field: "ordem", order: "asc" }],
    });

    const { mutateAsync: createRecord } = useCreate();
    const { mutateAsync: updateRecord } = useUpdate();
    const { mutateAsync: deleteRecord } = useDelete();

    const registros = useMemo(
        () => ((query?.data?.data as T[]) || []).filter(Boolean),
        [query?.data?.data],
    );
    const tabelaAusente = isSupabaseMissingRelation(query?.error);

    const abrirCriacao = () => {
        setEditando(null);
        form.resetFields();
        setIsModalOpen(true);
    };

    const abrirEdicao = (record: T) => {
        setEditando(record);
        form.resetFields();
        form.setFieldsValue(toFormValues(record));
        setIsModalOpen(true);
    };

    const salvar = async () => {
        const values = (await form.validateFields()) as Record<string, unknown>;
        const payload = {
            ...(fromFormValues ? fromFormValues(values, editando) : values),
            tenant_id: tenantId || undefined,
        };
        try {
            if (editando) {
                await updateRecord({ resource, id: editando.id, values: payload });
                message.success(`${titulo}: registro atualizado.`);
            } else {
                await createRecord({ resource, values: payload });
                message.success(`${titulo}: registro criado.`);
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

    const excluir = async (record: T) => {
        try {
            await deleteRecord({ resource, id: record.id });
            message.success(`${titulo}: registro removido.`);
            await query?.refetch?.();
        } catch {
            message.error("Não foi possível remover o registro.");
        }
    };

    if (query?.isLoading) {
        return <Skeleton active />;
    }

    return (
        <div>
            {tabelaAusente ? (
                <Alert
                    type="warning"
                    showIcon
                    message="Estrutura do banco pendente"
                    description={`A tabela ${resource} ainda não existe neste ambiente. Execute as migrations em database/migrations/ no Supabase.`}
                    style={{ marginBottom: 16 }}
                />
            ) : null}

            {!canManage ? (
                <Alert
                    type="info"
                    showIcon
                    message="Somente administradores podem alterar configurações do CRM."
                    style={{ marginBottom: 16 }}
                />
            ) : (
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
                    <Button type="primary" icon={<PlusOutlined />} onClick={abrirCriacao}>
                        Adicionar
                    </Button>
                </div>
            )}

            {registros.length === 0 && !tabelaAusente ? (
                <EmptyState title={`Nenhum registro em ${titulo}`} description={descricaoVazio} />
            ) : (
                <Table<T>
                    rowKey="id"
                    dataSource={registros}
                    pagination={false}
                    size="middle"
                    columns={[
                        ...columns,
                        ...(canManage
                            ? ([
                                  {
                                      title: "Ações",
                                      key: "acoes",
                                      width: 110,
                                      render: (_: unknown, record: T) => (
                                          <Space>
                                              <Button
                                                  size="small"
                                                  type="text"
                                                  icon={<EditOutlined />}
                                                  onClick={() => abrirEdicao(record)}
                                              />
                                              <Popconfirm
                                                  title="Remover registro?"
                                                  okText="Remover"
                                                  cancelText="Cancelar"
                                                  onConfirm={() => excluir(record)}
                                              >
                                                  <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                                              </Popconfirm>
                                          </Space>
                                      ),
                                  },
                              ] as ColumnsType<T>)
                            : []),
                    ]}
                />
            )}

            <Modal
                title={editando ? `Editar — ${titulo}` : `Adicionar — ${titulo}`}
                open={isModalOpen}
                onOk={salvar}
                onCancel={() => setIsModalOpen(false)}
                okText="Salvar"
                cancelText="Cancelar"
                destroyOnHidden
            >
                <Form form={form} layout="vertical">
                    {renderFormItems(editando)}
                </Form>
            </Modal>
        </div>
    );
}
