import { Edit, useForm } from "@refinedev/antd";
import { useList } from "@refinedev/core";
import { Alert, Form, Input, InputNumber, Select, Spin } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { TemperatureBadge } from "../../components/ui";
import { useTenant } from "../../contexts/tenant";
import { fetchEmployeesDirectory } from "../../lib/crmEmployees";
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
    responsavel_id?: string; // Alterado para suportar o Select
    stage_id?: string;
    temperature?: LeadTemperature;
};

export const ClienteEdit = () => {
    const { tenantId } = useTenant();
    const pendingTemperatureRef = useRef<LeadTemperature | undefined>(undefined);
    const { canDeleteRecords, canViewAllLeads, ownerDisplayName, ownerCandidatesNormalized } = useCrmAccess();
    const [listaResponsaveis, setListaResponsaveis] = useState<{ label: string; value: string }[]>([]);

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
        const carregarEquipe = async () => {
            try {
                const { employees } = await fetchEmployeesDirectory();
                const opcoes = employees
                    .filter((emp) => emp.nome && !emp.nome.includes("@"))
                    .map((emp) => ({
                        label: emp.nome,
                        value: String(emp.id),
                    }));
                setListaResponsaveis(opcoes);
            } catch {
                setListaResponsaveis([]);
            }
        };

        carregarEquipe();
    }, []);

    useEffect(() => {
        if (!record?.id) return;

        form.setFieldValue("temperature", resolveEditableLeadTemperature(record));

        // Magia para preencher o Select corretamente mesmo se o lead for antigo (sem ID ainda)
        if (record.responsavel_id) {
            form.setFieldValue("responsavel_id", String(record.responsavel_id));
        } else if (record.responsavel && listaResponsaveis.length > 0) {
            const match = listaResponsaveis.find(opt => opt.label.toLowerCase() === record.responsavel.toLowerCase());
            if (match) {
                form.setFieldValue("responsavel_id", match.value);
            }
        }
    }, [form, record, listaResponsaveis]);

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
        const currentDocument = form.getFieldValue("cpf_cnpj");
        if (!currentDocument) return;
        form.setFieldValue("cpf_cnpj", formatCpfCnpj(currentDocument));
    }, [form, record?.cpf_cnpj]);

    const handleCpfCnpjChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        form.setFieldValue("cpf_cnpj", formatCpfCnpj(event.target.value));
    };

    const handleFinish = async (values: ClienteEditFormValues) => {
        const { temperature, stage_id, responsavel_id, ...payload } = values;
        const nextStageId = coerceLeadStageIdValue(stage_id ?? record?.stage_id ?? record?.status, leadStages);
        const nextStage = findLeadStageById(leadStages, nextStageId);
        const automaticFromStatus = resolveAutomaticLeadTemperature(nextStage?.nome);
        const nextTemperature = automaticFromStatus ? undefined : temperature;

        // Recupera o nome correto baseado no ID selecionado
        const responsavelSelecionado = listaResponsaveis.find(opt => opt.value === responsavel_id);
        const responsavelNome = responsavelSelecionado ? responsavelSelecionado.label : (record?.responsavel || ownerDisplayName);

        pendingTemperatureRef.current = nextTemperature;

        if (record?.id) {
            setLeadTemperature(record.id, nextTemperature);
        }

        return formProps.onFinish?.({
            ...payload,
            tenant_id: tenantId || undefined,
            stage_id: nextStageId,
            status: nextStage?.nome || undefined,
            responsavel: canViewAllLeads ? responsavelNome : record?.responsavel, // Salva o nome
            responsavel_id: canViewAllLeads ? responsavel_id : record?.responsavel_id, // Salva o UUID
        } as any);
    };

    if (recordError) {
        return (
            <Edit canDelete={canDeleteRecords} saveButtonProps={{ ...saveButtonProps, disabled: true }}>
                <Alert type="error" showIcon message="Falha ao carregar lead" description={String(recordError?.message || "Nao foi possivel abrir o cadastro para edicao.")} />
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
                <Alert type="warning" showIcon message="Lead nao encontrado" description="O registro solicitado nao foi encontrado ou voce nao tem permissao de acesso." />
            </Edit>
        );
    }

    if (!canEditRecord && record) {
        return (
            <Edit canDelete={canDeleteRecords} saveButtonProps={{ ...saveButtonProps, disabled: true }}>
                <Alert type="warning" showIcon message="Acesso restrito" description="Este lead nao esta vinculado ao seu usuario." />
            </Edit>
        );
    }

    return (
        <Edit canDelete={canDeleteRecords} saveButtonProps={saveButtonProps}>
            <Form {...formProps} layout="vertical" onFinish={handleFinish}>
                <Form.Item label="Nome Completo" name="nome" rules={[{ required: true, message: "Por favor, insira o nome do cliente." }]}>
                    <Input />
                </Form.Item>

                <Form.Item label="E-mail" name="email" rules={[{ required: true, message: "Por favor, insira o e-mail." }]}>
                    <Input />
                </Form.Item>

                <Form.Item label="Telefone / WhatsApp" name="telefone">
                    <Input />
                </Form.Item>

                <Form.Item label="CPF ou CNPJ" name="cpf_cnpj">
                    <Input maxLength={18} placeholder="000.000.000-00 ou 00.000.000/0000-00" onChange={handleCpfCnpjChange} />
                </Form.Item>

                <Form.Item label="Endereco de Instalacao" name="endereco_instalacao">
                    <Input />
                </Form.Item>

                <Form.Item label="Media da Conta de Energia (R$)" name="conta_energia_media">
                    <InputNumber style={{ width: "220px" }} formatter={(value) => `R$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")} parser={(value) => value!.replace(/[^\d.-]/g, "")} />
                </Form.Item>

                <Form.Item label="Responsavel" name="responsavel_id">
                    <Select
                        showSearch
                        allowClear
                        placeholder="Selecione a equipe"
                        options={listaResponsaveis}
                        disabled={!canViewAllLeads}
                        filterOption={(input, option) => (option?.label ?? "").toLowerCase().includes(input.toLowerCase())}
                    />
                </Form.Item>

                <Form.Item label="Etapa do Funil" name="stage_id" rules={[{ required: true, message: "Selecione a etapa." }]}>
                    <Select options={stageOptions} />
                </Form.Item>

                <Form.Item label="Temperatura" name="temperature" extra={automaticTemperature ? `Automatica: ${LEAD_TEMPERATURE_LABELS[automaticTemperature]}` : "Manual para leads em aberto."}>
                    <Select allowClear placeholder={automaticTemperature ? "Temperatura automatica" : "Selecione"} disabled={Boolean(automaticTemperature)} options={LEAD_TEMPERATURE_OPTIONS.map((option) => ({ value: option.value, label: <TemperatureBadge value={option.value} /> }))} />
                </Form.Item>
            </Form>
        </Edit>
    );
};