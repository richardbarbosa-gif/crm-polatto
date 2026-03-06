import { Edit, useForm } from "@refinedev/antd";
import { useList } from "@refinedev/core";
import { Alert, Card, Col, Form, Input, InputNumber, Row, Select, Spin, Typography } from "antd";
import { useEffect, useMemo, useRef } from "react";
import { TemperatureBadge } from "../../components/ui";
import { useTenant } from "../../contexts/tenant";
import { matchesLeadOwner, useCrmAccess } from "../../hooks/useCrmAccess";
import { formatCpfCnpj } from "../../lib/formatters";
import {
    buildLeadStageOptions,
    buildLeadStages,
    coerceLeadStageIdValue,
    findLeadStageById,
} from "../../lib/leadStatus";
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
    stage_id?: string;
    temperature?: LeadTemperature;
};

const { Text, Title } = Typography;

export const ClienteEdit = () => {
    const { tenantId } = useTenant();
    const pendingTemperatureRef = useRef<LeadTemperature | undefined>(undefined);
    const { canDeleteRecords, canViewAllLeads, ownerDisplayName, ownerCandidatesNormalized } =
        useCrmAccess();

    const { formProps, saveButtonProps, form, query } = useForm<any, any, ClienteEditFormValues>({
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
    });

    const record = (query?.data?.data as any) ?? null;
    const isRecordLoading = Boolean(query?.isLoading || query?.isFetching);
    const recordError = query?.error as any;
    const canEditRecord = canViewAllLeads || matchesLeadOwner(record?.responsavel, ownerCandidatesNormalized);
    const watchedStageId = Form.useWatch("stage_id", form) as string | undefined;

    const { query: stagesQuery } = useList({
        resource: "pipeline_stages",
        pagination: { mode: "off" },
        sorters: [{ field: "ordem", order: "asc" }],
    });
    const stagesData = (stagesQuery?.data?.data as any[]) || [];
    const leadStages = useMemo(() => buildLeadStages(stagesData), [stagesData]);
    const stageOptions = useMemo(() => buildLeadStageOptions(stagesData), [stagesData]);
    const resolvedStageId = coerceLeadStageIdValue(
        watchedStageId ?? record?.stage_id ?? record?.status,
        leadStages,
    );
    const selectedStage = findLeadStageById(leadStages, resolvedStageId);
    const automaticTemperature = resolveAutomaticLeadTemperature(selectedStage?.nome);

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
        const currentStageId = form.getFieldValue("stage_id") ?? record?.stage_id ?? record?.status;
        if (!currentStageId && stageOptions.length > 0) {
            form.setFieldValue("stage_id", stageOptions[0].value);
            return;
        }

        if (currentStageId) {
            const nextStageId = coerceLeadStageIdValue(currentStageId, leadStages);
            if (String(nextStageId) !== String(currentStageId)) {
                form.setFieldValue("stage_id", nextStageId);
            }
        }
    }, [form, leadStages, record?.stage_id, record?.status, stageOptions]);

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
        const { temperature, stage_id, ...payload } = values;
        const nextStageId = coerceLeadStageIdValue(stage_id ?? record?.stage_id ?? record?.status, leadStages);
        const nextStage = findLeadStageById(leadStages, nextStageId);
        const automaticFromStatus = resolveAutomaticLeadTemperature(nextStage?.nome);
        const nextTemperature = automaticFromStatus ? undefined : temperature;

        pendingTemperatureRef.current = nextTemperature;

        if (record?.id) {
            setLeadTemperature(record.id, nextTemperature);
        }

        return formProps.onFinish?.(
            {
                ...payload,
                tenant_id: tenantId || undefined,
                stage_id: nextStageId,
                status: nextStage?.nome || undefined,
                responsavel: canViewAllLeads ? values.responsavel : ownerDisplayName,
            } as any,
        );
    };

    if (recordError) {
        return (
            <Edit canDelete={canDeleteRecords} saveButtonProps={{ ...saveButtonProps, disabled: true }}>
                <Alert
                    type="error"
                    showIcon
                    message="Falha ao carregar lead"
                    description={String(recordError?.message || "Nao foi possivel abrir o cadastro para edicao.")}
                />
            </Edit>
        );
    }

    if (isRecordLoading && !record) {
        return (
            <Edit canDelete={canDeleteRecords} saveButtonProps={{ ...saveButtonProps, disabled: true }}>
                <div style={{ display: "flex", justifyContent: "center", padding: "24px 0" }}>
                    <Spin tip="Carregando lead..." />
                </div>
            </Edit>
        );
    }

    if (!record && !isRecordLoading) {
        return (
            <Edit canDelete={canDeleteRecords} saveButtonProps={{ ...saveButtonProps, disabled: true }}>
                <Alert
                    type="warning"
                    showIcon
                    message="Lead nao encontrado"
                    description="O registro solicitado nao foi encontrado ou voce nao tem permissao de acesso."
                />
            </Edit>
        );
    }

    if (!canEditRecord && record) {
        return (
            <Edit canDelete={canDeleteRecords} saveButtonProps={{ ...saveButtonProps, disabled: true }}>
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
        <Edit canDelete={canDeleteRecords} saveButtonProps={saveButtonProps}>
            <Form {...formProps} layout="vertical" onFinish={handleFinish} className="crm-form-row-tight">
                <div className="crm-form-section">
                    <Title level={5} className="crm-form-section-title">
                        Dados do cliente
                    </Title>
                    <Text type="secondary" className="crm-form-section-subtitle">
                        Atualize informacoes cadastrais e contatos.
                    </Text>
                    <Row gutter={16}>
                        <Col xs={24} lg={12}>
                            <Form.Item
                                label="Nome completo"
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
                        </Col>
                        <Col xs={24} lg={12}>
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
                        </Col>
                    </Row>

                    <Row gutter={16}>
                        <Col xs={24} lg={8}>
                            <Form.Item label="Telefone / WhatsApp" name="telefone">
                                <Input />
                            </Form.Item>
                        </Col>
                        <Col xs={24} lg={8}>
                            <Form.Item label="CPF ou CNPJ" name="cpf_cnpj">
                                <Input
                                    maxLength={18}
                                    placeholder="000.000.000-00 ou 00.000.000/0000-00"
                                    onChange={handleCpfCnpjChange}
                                />
                            </Form.Item>
                        </Col>
                        <Col xs={24} lg={8}>
                            <Form.Item label="Responsavel" name="responsavel">
                                <Input
                                    placeholder="Ex.: Joao / Equipe Comercial"
                                    disabled={!canViewAllLeads}
                                />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Form.Item label="Endereco de instalacao" name="endereco_instalacao">
                        <Input />
                    </Form.Item>
                </div>

                <Card size="small" className="crm-card">
                    <Title level={5} style={{ margin: 0 }}>
                        Dados do funil
                    </Title>
                    <Text type="secondary" style={{ display: "block", marginBottom: 12, fontSize: 12 }}>
                        Informacoes comerciais usadas para status, receita e prioridade.
                    </Text>
                    <Row gutter={16}>
                        <Col xs={24} lg={8}>
                            <Form.Item label="Media da conta (R$)" name="conta_energia_media">
                                <InputNumber
                                    style={{ width: "100%" }}
                                    formatter={(value) => `R$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
                                    parser={(value) => value!.replace(/[^\d.-]/g, "")}
                                />
                            </Form.Item>
                        </Col>
                        <Col xs={24} lg={8}>
                            <Form.Item
                                label="Etapa do funil"
                                name="stage_id"
                                rules={[{ required: true, message: "Selecione a etapa." }]}
                            >
                                <Select options={stageOptions} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} lg={8}>
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
                        </Col>
                    </Row>
                </Card>
            </Form>
        </Edit>
    );
};
