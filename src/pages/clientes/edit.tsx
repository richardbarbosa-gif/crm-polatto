import { useList } from "@refinedev/core";
import { Edit, useForm } from "@refinedev/antd";
import { Alert, Form, Input, InputNumber, Select } from "antd";
import { useEffect, useMemo, useRef } from "react";
import { TemperatureBadge } from "../../components/ui";
import { matchesLeadOwner, useCrmAccess } from "../../hooks/useCrmAccess";
import { formatCpfCnpj } from "../../lib/formatters";
import {
    LEAD_TEMPERATURE_LABELS,
    LEAD_TEMPERATURE_OPTIONS,
    type LeadTemperature,
    resolveAutomaticLeadTemperature,
    resolveEditableLeadTemperature,
    setLeadTemperature,
} from "../../lib/leadTemperature";

type ClienteEditFormValues = {
    nome: string;
    email: string;
    telefone?: string;
    cpf_cnpj?: string;
    endereco_instalacao?: string;
    conta_energia_media?: number;
    responsavel?: string;
    status?: string;
    temperature?: LeadTemperature;
};

export const ClienteEdit = () => {
    const pendingTemperatureRef = useRef<LeadTemperature | undefined>(undefined);
    const { canViewAllLeads, ownerDisplayName, ownerCandidatesNormalized } = useCrmAccess();

    const { formProps, saveButtonProps, form, query } = useForm<any, any, ClienteEditFormValues>(
        {
            onMutationSuccess: (data) => {
                const updatedId = (data as any)?.data?.id ?? (query?.data?.data as any)?.id;
                const temperature = pendingTemperatureRef.current;

                if (updatedId && temperature) {
                    setLeadTemperature(updatedId, temperature);
                }

                if (updatedId && !temperature) {
                    setLeadTemperature(updatedId, undefined);
                }

                pendingTemperatureRef.current = undefined;
            },
        },
    );

    const record = (query?.data?.data as any) ?? null;
    const canEditRecord = canViewAllLeads || matchesLeadOwner(record?.responsavel, ownerCandidatesNormalized);
    const watchedStatus = Form.useWatch("status", form) as string | undefined;
    const automaticTemperature = resolveAutomaticLeadTemperature(watchedStatus ?? record?.status);

    const { query: stagesQuery } = useList({
        resource: "pipeline_stages",
        pagination: { mode: "off" },
        sorters: [{ field: "ordem", order: "asc" }],
    });

    const stagesData = (stagesQuery?.data?.data as any[]) || [];

    const statusOptions = useMemo(() => {
        if (stagesData.length > 0) {
            return stagesData
                .map((stage) => {
                    const nome = stage.nome ?? stage.name;
                    return nome ? { value: nome, label: nome } : null;
                })
                .filter((option): option is { value: string; label: string } => Boolean(option));
        }

        return [
            { value: "Novo Lead", label: "Novo Lead (Chegou agora)" },
            { value: "Em Negociação", label: "Em Negociação" },
            { value: "Visita Agendada", label: "Visita Agendada" },
            { value: "Fechado", label: "Fechado / Ganho" },
            { value: "Perdido", label: "Perdido" },
        ];
    }, [stagesData]);

    useEffect(() => {
        if (!record?.id) {
            return;
        }

        form.setFieldValue("temperature", resolveEditableLeadTemperature(record));
    }, [form, record]);

    useEffect(() => {
        if (automaticTemperature) {
            form.setFieldValue("temperature", undefined);
        }
    }, [automaticTemperature, form]);

    useEffect(() => {
        if (!canViewAllLeads) {
            form.setFieldValue("responsavel", ownerDisplayName);
        }
    }, [canViewAllLeads, form, ownerDisplayName]);

    useEffect(() => {
        const currentDocument = form.getFieldValue("cpf_cnpj");
        if (!currentDocument) {
            return;
        }

        form.setFieldValue("cpf_cnpj", formatCpfCnpj(currentDocument));
    }, [form, record?.cpf_cnpj]);

    const handleCpfCnpjChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        form.setFieldValue("cpf_cnpj", formatCpfCnpj(event.target.value));
    };

    const handleFinish = async (values: ClienteEditFormValues) => {
        const { temperature, status, ...payload } = values;
        const automaticFromStatus = resolveAutomaticLeadTemperature(status ?? record?.status);
        const nextTemperature = automaticFromStatus ? undefined : temperature;

        pendingTemperatureRef.current = nextTemperature;

        if (record?.id) {
            setLeadTemperature(record.id, nextTemperature);
        }

        return formProps.onFinish?.(
            { ...payload, status, responsavel: canViewAllLeads ? values.responsavel : ownerDisplayName } as any,
        );
    };

    if (!canEditRecord && record) {
        return (
            <Edit saveButtonProps={{ ...saveButtonProps, disabled: true }}>
                <Alert
                    type="warning"
                    showIcon
                    message="Acesso restrito"
                    description="Este lead nao esta vinculado ao seu usuario."
                />
            </Edit>
        );
    }

    return (
        <Edit saveButtonProps={saveButtonProps}>
            <Form {...formProps} layout="vertical" onFinish={handleFinish}>
                <Form.Item
                    label="Nome Completo"
                    name="nome"
                    rules={[
                        {
                            required: true,
                            message: "Por favor, insira o nome do cliente.",
                        },
                    ]}
                >
                    <Input />
                </Form.Item>

                <Form.Item
                    label="E-mail"
                    name="email"
                    rules={[
                        {
                            required: true,
                            message: "Por favor, insira o e-mail.",
                        },
                    ]}
                >
                    <Input />
                </Form.Item>

                <Form.Item label="Telefone / WhatsApp" name="telefone">
                    <Input />
                </Form.Item>

                <Form.Item label="CPF ou CNPJ" name="cpf_cnpj">
                    <Input
                        maxLength={18}
                        placeholder="000.000.000-00 ou 00.000.000/0000-00"
                        onChange={handleCpfCnpjChange}
                    />
                </Form.Item>

                <Form.Item label="Endereco de Instalacao" name="endereco_instalacao">
                    <Input />
                </Form.Item>

                <Form.Item label="Media da Conta de Energia (R$)" name="conta_energia_media">
                    <InputNumber
                        style={{ width: "220px" }}
                        formatter={(value) =>
                            `R$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
                        }
                        parser={(value) => value!.replace(/[^\d.-]/g, "")}
                    />
                </Form.Item>

                <Form.Item label="Responsavel" name="responsavel">
                    <Input
                        placeholder="Ex.: Joao / Equipe Comercial"
                        disabled={!canViewAllLeads}
                    />
                </Form.Item>

                <Form.Item label="Status da Negociacao" name="status">
                    <Select options={statusOptions} />
                </Form.Item>

                <Form.Item
                    label="Temperatura"
                    name="temperature"
                    extra={
                        automaticTemperature
                            ? `Automatica pelo status: ${LEAD_TEMPERATURE_LABELS[automaticTemperature]}`
                            : "Manual para leads em aberto."
                    }
                >
                    <Select
                        allowClear
                        placeholder={
                            automaticTemperature
                                ? "Temperatura automatica por status"
                                : "Selecione"
                        }
                        disabled={Boolean(automaticTemperature)}
                        options={LEAD_TEMPERATURE_OPTIONS.map((option) => ({
                            value: option.value,
                            label: <TemperatureBadge value={option.value} />,
                        }))}
                    />
                </Form.Item>
            </Form>
        </Edit>
    );
};
