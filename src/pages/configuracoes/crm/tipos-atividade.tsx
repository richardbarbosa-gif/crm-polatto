import {
    CheckSquareOutlined,
    ClockCircleOutlined,
    EnvironmentOutlined,
    MailOutlined,
    PhoneOutlined,
    TeamOutlined,
} from "@ant-design/icons";
import { Form, Input, InputNumber, Select, Switch, Tag } from "antd";
import type { ReactNode } from "react";
import { useCrmAccess } from "../../../hooks/useCrmAccess";
import type { TipoAtividadeRecord } from "../../../types/db";
import { ConfigCrudTable } from "./config-crud-table";

const ICONES: Record<string, ReactNode> = {
    phone: <PhoneOutlined />,
    team: <TeamOutlined />,
    mail: <MailOutlined />,
    "check-square": <CheckSquareOutlined />,
    environment: <EnvironmentOutlined />,
    "clock-circle": <ClockCircleOutlined />,
};

const ICONE_OPTIONS = [
    { value: "phone", label: "Telefone (ligação)" },
    { value: "team", label: "Pessoas (reunião)" },
    { value: "mail", label: "Envelope (e-mail)" },
    { value: "check-square", label: "Check (tarefa)" },
    { value: "environment", label: "Pino (visita)" },
    { value: "clock-circle", label: "Relógio (follow-up)" },
];

export const TiposAtividadeConfig = () => {
    const { canDeleteRecords } = useCrmAccess();
    const [form] = Form.useForm();

    return (
        <ConfigCrudTable<TipoAtividadeRecord>
            resource="tipos_atividade"
            titulo="Tipos de atividade"
            descricaoVazio="Cadastre os tipos de atividade que o time usa na agenda. Ex.: Ligação, Reunião, Demo, Follow-up."
            canManage={canDeleteRecords}
            form={form}
            columns={[
                {
                    title: "Tipo",
                    dataIndex: "nome",
                    render: (nome: string, record) => (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            {record.icone ? ICONES[record.icone] : null}
                            {nome}
                        </span>
                    ),
                },
                { title: "Ordem", dataIndex: "ordem", width: 90 },
                {
                    title: "Status",
                    dataIndex: "ativo",
                    width: 110,
                    render: (ativo: boolean | null) =>
                        ativo === false ? <Tag>Inativo</Tag> : <Tag color="green">Ativo</Tag>,
                },
            ]}
            toFormValues={(record) => ({
                nome: record.nome,
                icone: record.icone || undefined,
                ordem: record.ordem ?? 1,
                ativo: record.ativo !== false,
            })}
            renderFormItems={() => (
                <>
                    <Form.Item
                        label="Nome"
                        name="nome"
                        rules={[{ required: true, message: "Informe o nome do tipo." }]}
                    >
                        <Input placeholder="Ex.: Demo, Follow-up, Visita técnica" />
                    </Form.Item>
                    <Form.Item label="Ícone" name="icone">
                        <Select options={ICONE_OPTIONS} allowClear placeholder="Escolha um ícone" />
                    </Form.Item>
                    <Form.Item label="Ordem" name="ordem" initialValue={1}>
                        <InputNumber min={1} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item label="Ativo" name="ativo" valuePropName="checked" initialValue={true}>
                        <Switch />
                    </Form.Item>
                </>
            )}
        />
    );
};
