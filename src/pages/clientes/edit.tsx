import { Edit, useForm } from "@refinedev/antd";
import { CustomFieldsForm } from "../../components/custom-fields";
import { dadosExtrasParaFormulario } from "../../lib/camposCustomizados";
import { extrairDadosExtras, useCustomFields } from "../../hooks/useCustomFields";
import { useList, type HttpError } from "@refinedev/core";
import { Alert, Col, Form, Input, InputNumber, Row, Select, Spin, message, type InputRef } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { TemperatureBadge } from "../../components/ui";
import { useTenant } from "../../contexts/tenant";
import { useTenantSegmento } from "../../hooks/useTenantSegmento";
import { fetchEmployeesDirectory } from "../../lib/crmEmployees";
import { matchesLeadOwner, useCrmAccess } from "../../hooks/useCrmAccess";
import { formatarDocumento, tipoPessoaDoDocumento, type TipoPessoa, validarTelefone } from "../../lib/documentos";
import { CampoDocumento } from "../../components/campo-documento";
import {
    buildLeadStageOptions,
    buildLeadStages,
    coerceLeadStageIdValue,
    findLeadStageById,
    pipelineDaEtapa,
} from "../../lib/leadStatus";
import {
    LEAD_TEMPERATURE_LABELS,
    LEAD_TEMPERATURE_OPTIONS,
    type LeadTemperature,
    resolveAutomaticLeadTemperature,
    resolveEditableLeadTemperature,
} from "../../lib/leadTemperature";
import { propsMoeda } from "../../lib/moedaInput";
import { buscarEnderecoPorCep, formatarCep } from "../../lib/cep";
import { CampoOrigem } from "../../components/origem/campo-origem";
import { useCanaisOrigem } from "../../hooks/useCanaisOrigem";
import { origemDoLead, origemParaDadosExtras } from "../../lib/origemLead";
import type { ClienteRecord, PipelineRecord, PipelineStageRecord } from "../../types/db";

type ClienteEditFormValues = {
    nome: string;
    email?: string;
    telefone?: string;
    cpf_cnpj?: string;
    cep?: string;
    endereco_instalacao?: string;
    numero?: string;
    complemento?: string;
    conta_energia_media?: number | null;
    valor?: number | null;
    responsavel_id?: string;
    stage_id?: string;
    temperature?: LeadTemperature;
    /** Canal de origem (vai para dados_extras, não é coluna da view) */
    origem_id?: string;
    /** Valores dos campos customizados do tenant (jsonb) */
    dados_extras?: Record<string, unknown>;
};

export const ClienteEdit = () => {
    const { tenantId } = useTenant();
    const { podeExcluir, canViewAllLeads, ownerDisplayName, ownerCandidatesNormalized } = useCrmAccess();
    const { isEnergiaSolar } = useTenantSegmento();
    const [listaResponsaveis, setListaResponsaveis] = useState<{ label: string; value: string }[]>([]);

    const { formProps, saveButtonProps, form, query } = useForm<ClienteRecord, HttpError, Record<string, unknown>>({});
    const { campos: camposCustomizados } = useCustomFields("negocio");
    const { canais: canaisOrigem } = useCanaisOrigem();

    const record = query?.data?.data ?? null;
    const isRecordLoading = Boolean(query?.isLoading || query?.isFetching);
    const recordError = query?.error;
    const canEditRecord = canViewAllLeads || matchesLeadOwner(record?.responsavel, ownerCandidatesNormalized);
    const watchedStageId = Form.useWatch("stage_id", form) as string | undefined;

    const { query: stagesQuery } = useList<PipelineStageRecord>({
        resource: "pipeline_stages",
        pagination: { mode: "off" },
        sorters: [{ field: "ordem", order: "asc" }],
    });
    const { query: pipelinesQuery } = useList<PipelineRecord>({
        resource: "pipelines",
        pagination: { mode: "off" },
        sorters: [{ field: "ordem", order: "asc" }],
        queryOptions: { retry: false },
    });
    const stagesData = stagesQuery?.data?.data;
    const pipelinesData = pipelinesQuery?.data?.data;
    const leadStages = useMemo(() => buildLeadStages(stagesData), [stagesData]);
    const stageOptions = useMemo(
        () => buildLeadStageOptions(stagesData, pipelinesData),
        [stagesData, pipelinesData],
    );
    const resolvedStageId = coerceLeadStageIdValue(
        watchedStageId ?? (record?.stage_id as string | number | null | undefined) ?? record?.status,
        leadStages,
    );
    const selectedStage = findLeadStageById(leadStages, resolvedStageId);
    const automaticTemperature = resolveAutomaticLeadTemperature(selectedStage?.nome);

    useEffect(() => {
        let ativo = true;
        fetchEmployeesDirectory()
            .then(({ employees }) => {
                if (!ativo) return;
                setListaResponsaveis(
                    employees
                        .filter((emp) => emp.nome && !emp.nome.includes("@"))
                        .map((emp) => ({ label: emp.nome, value: String(emp.id) })),
                );
            })
            .catch(() => {
                if (ativo) setListaResponsaveis([]);
            });
        return () => {
            ativo = false;
        };
    }, []);

    useEffect(() => {
        if (!record?.id) return;

        form.setFieldValue("temperature", resolveEditableLeadTemperature(record));

        // Leads antigos só têm o nome do responsável (sem id): casa pelo nome.
        if (record.responsavel_id) {
            form.setFieldValue("responsavel_id", String(record.responsavel_id));
        } else if (typeof record.responsavel === "string" && listaResponsaveis.length > 0) {
            const nome = record.responsavel.toLowerCase();
            const match = listaResponsaveis.find((opt) => opt.label.toLowerCase() === nome);
            if (match) form.setFieldValue("responsavel_id", match.value);
        }
    }, [form, record, listaResponsaveis]);

    useEffect(() => {
        if (automaticTemperature) form.setFieldValue("temperature", undefined);
    }, [automaticTemperature, form]);

    useEffect(() => {
        const currentStageId =
            (form.getFieldValue("stage_id") as string | undefined) ??
            (record?.stage_id as string | number | null | undefined) ??
            record?.status;
        if (!currentStageId && stageOptions.length > 0) {
            form.setFieldValue("stage_id", stageOptions[0].value);
            return;
        }

        if (currentStageId) {
            const nextStageId = coerceLeadStageIdValue(currentStageId, leadStages);
            if (String(nextStageId) !== String(currentStageId)) form.setFieldValue("stage_id", nextStageId);
        }
    }, [form, leadStages, record?.stage_id, record?.status, stageOptions]);

    // Tipo de cliente inferido do documento salvo (14 dígitos = empresa).
    const [tipoPessoa, setTipoPessoa] = useState<TipoPessoa>("pf");
    useEffect(() => {
        const tipo = tipoPessoaDoDocumento(typeof record?.cpf_cnpj === "string" ? record.cpf_cnpj : null);
        setTipoPessoa(tipo);
        const currentDocument = form.getFieldValue("cpf_cnpj") as string | undefined;
        if (!currentDocument) return;
        form.setFieldValue("cpf_cnpj", formatarDocumento(currentDocument, tipo));
    }, [form, record?.cpf_cnpj]);

    // Carrega os valores já gravados dos campos customizados no formulário.
    // Sem isto o campo abriria vazio e salvar apagaria o que estava lá.
    useEffect(() => {
        if (!camposCustomizados.length) return;
        const valores = dadosExtrasParaFormulario(
            record?.dados_extras as Record<string, unknown> | undefined,
            camposCustomizados,
        );
        if (Object.keys(valores).length) form.setFieldValue("dados_extras", valores);
    }, [form, camposCustomizados, record?.dados_extras]);

    // Origem gravada no lead (pode ser de um canal já desativado)
    const origemAtual = useMemo(
        () => origemDoLead(record?.dados_extras as Record<string, unknown> | undefined),
        [record?.dados_extras],
    );
    useEffect(() => {
        if (origemAtual.id) form.setFieldValue("origem_id", origemAtual.id);
    }, [form, origemAtual.id]);
    const canaisComAtual = useMemo(
        () =>
            origemAtual.id && !canaisOrigem.some((c) => c.id === origemAtual.id)
                ? [...canaisOrigem, { id: origemAtual.id, nome: origemAtual.nome ?? "Canal removido" }]
                : canaisOrigem,
        [canaisOrigem, origemAtual.id, origemAtual.nome],
    );

    const handleFinish = async (values: ClienteEditFormValues) => {
        const { temperature, stage_id, responsavel_id, origem_id, ...payload } = values;
        const nextStageId = coerceLeadStageIdValue(
            stage_id ?? (record?.stage_id as string | number | null | undefined) ?? record?.status,
            leadStages,
        );
        const nextStage = findLeadStageById(leadStages, nextStageId);
        const automaticFromStatus = resolveAutomaticLeadTemperature(nextStage?.nome);
        const nextTemperature = automaticFromStatus ? undefined : temperature;
        // Trocar a etapa por uma de outro funil leva o negócio para aquele funil.
        const pipelineDaStage = pipelineDaEtapa(leadStages, nextStageId);

        const responsavelSelecionado = listaResponsaveis.find((opt) => opt.value === responsavel_id);
        const responsavelNome = responsavelSelecionado
            ? responsavelSelecionado.label
            : (record?.responsavel as string | null | undefined) || ownerDisplayName;

        // Campos customizados do tenant → dados_extras (jsonb). Em modo de
        // edição, campo esvaziado vai como null para ser apagado no banco.
        const dadosExtras = {
            ...extrairDadosExtras(values as Record<string, unknown>, camposCustomizados, "editar"),
            // Só mexe na origem se o campo existe na tela (canais carregados)
            ...(canaisComAtual.length > 0 ? origemParaDadosExtras(origem_id, canaisComAtual, "editar") : {}),
        };
        const { dados_extras: _descartado, ...payloadLimpo } = payload;
        void _descartado;

        return formProps.onFinish?.({
            ...payloadLimpo,
            ...(Object.keys(dadosExtras).length ? { dados_extras: dadosExtras } : {}),
            tenant_id: tenantId || undefined,
            stage_id: nextStageId,
            ...(pipelineDaStage ? { pipeline_id: pipelineDaStage } : {}),
            status: nextStage?.nome || undefined,
            temperatura: nextTemperature || null,
            responsavel: canViewAllLeads ? responsavelNome : record?.responsavel,
            responsavel_id: canViewAllLeads ? responsavel_id : record?.responsavel_id,
        });
    };

    const numeroInputRef = useRef<InputRef>(null);
    const handleCepChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const cep = formatarCep(event.target.value);
        form.setFieldValue("cep", cep);
        if (cep.replace(/\D/g, "").length !== 8) return;

        const resultado = await buscarEnderecoPorCep(cep);
        if (resultado.status === "ok") {
            form.setFieldValue("endereco_instalacao", resultado.endereco);
            message.success("Endereço encontrado.");
            setTimeout(() => numeroInputRef.current?.focus(), 100);
        } else if (resultado.status === "nao_encontrado") {
            message.warning("CEP não encontrado. Preencha o endereço manualmente.");
        } else {
            message.warning("Não foi possível buscar o CEP. Preencha o endereço manualmente.");
        }
    };

    if (recordError) {
        return (
            <Edit title="Editar lead" canDelete={Boolean(record) && podeExcluir(record)} saveButtonProps={{ ...saveButtonProps, disabled: true }}>
                <Alert type="error" showIcon message="Falha ao carregar o lead" description={recordError.message || "Não foi possível abrir o cadastro para edição."} />
            </Edit>
        );
    }

    if (isRecordLoading && !record) {
        return (
            <Edit title="Editar lead" canDelete={Boolean(record) && podeExcluir(record)} saveButtonProps={{ ...saveButtonProps, disabled: true }}>
                <div style={{ display: "flex", justifyContent: "center", padding: "24px 0" }}>
                    <Spin tip="Carregando lead..." />
                </div>
            </Edit>
        );
    }

    if (!record && !isRecordLoading) {
        return (
            <Edit title="Editar lead" canDelete={Boolean(record) && podeExcluir(record)} saveButtonProps={{ ...saveButtonProps, disabled: true }}>
                <Alert type="warning" showIcon message="Lead não encontrado" description="O registro não existe, foi excluído ou você não tem permissão de acesso." />
            </Edit>
        );
    }

    if (!canEditRecord && record) {
        return (
            <Edit title="Editar lead" canDelete={Boolean(record) && podeExcluir(record)} saveButtonProps={{ ...saveButtonProps, disabled: true }}>
                <Alert type="warning" showIcon message="Acesso restrito" description="Este lead não está vinculado ao seu usuário." />
            </Edit>
        );
    }

    const ddi = typeof record?.ddi === "string" && record.ddi ? record.ddi : "+55";

    return (
        <Edit title="Editar lead" canDelete={Boolean(record) && podeExcluir(record)} saveButtonProps={saveButtonProps}>
            {/* Mesmo grid do "Novo lead": antes o editar era uma coluna única, com
                campos menores e outra ordem — parecia outro sistema. */}
            <Form {...formProps} layout="vertical" onFinish={(valores) => handleFinish(valores as ClienteEditFormValues)}>
                <CampoDocumento form={form} tipo={tipoPessoa} onTipoChange={setTipoPessoa} />

                <Row gutter={20}>
                    <Col xs={24}>
                        <Form.Item
                            label={tipoPessoa === "pf" ? "Nome completo" : "Razão social / nome da empresa"}
                            name="nome"
                            rules={[{ required: true, whitespace: true, message: "Informe o nome do cliente." }]}
                        >
                            <Input size="large" autoComplete={tipoPessoa === "pf" ? "name" : "organization"} />
                        </Form.Item>
                    </Col>
                </Row>

                <Row gutter={20}>
                    <Col xs={24} lg={12}>
                        <Form.Item
                            label="WhatsApp / Telefone"
                            name="telefone"
                            rules={[
                                {
                                    validator: async (_, valor?: string) => {
                                        if (valor && !validarTelefone(valor, ddi)) {
                                            throw new Error("Telefone incompleto. Inclua o DDD.");
                                        }
                                    },
                                },
                            ]}
                        >
                            <Input size="large" inputMode="tel" autoComplete="tel" />
                        </Form.Item>
                    </Col>
                    <Col xs={24} lg={12}>
                        {/* Não obrigatório: o cadastro não pede e-mail. Exigir aqui travava a
                            edição de todo lead criado sem ele — inclusive os importados. */}
                        <Form.Item label="E-mail" name="email" rules={[{ type: "email", message: "E-mail inválido." }]}>
                            <Input size="large" type="email" autoComplete="email" />
                        </Form.Item>
                    </Col>
                </Row>

                {/* Endereço sem obrigatoriedade na edição: leads antigos e importados
                    não têm CEP/número e não podem ficar travados por isso. */}
                {isEnergiaSolar ? (
                    <div className="crm-form-section crm-form-endereco">
                        <Row gutter={15}>
                            <Col xs={24} lg={5}>
                                <Form.Item label="CEP" name="cep">
                                    <Input onChange={handleCepChange} maxLength={9} inputMode="numeric" />
                                </Form.Item>
                            </Col>
                            <Col xs={24} lg={13}>
                                <Form.Item label="Endereço" name="endereco_instalacao">
                                    <Input placeholder="Preenchido pelo CEP — pode ajustar" />
                                </Form.Item>
                            </Col>
                            <Col xs={24} lg={3}>
                                <Form.Item label="Número" name="numero">
                                    <Input ref={numeroInputRef} />
                                </Form.Item>
                            </Col>
                            <Col xs={24} lg={3}>
                                <Form.Item label="Compl." name="complemento">
                                    <Input />
                                </Form.Item>
                            </Col>
                        </Row>
                    </div>
                ) : null}

                <Row gutter={20}>
                    {isEnergiaSolar ? (
                        <Col xs={24} lg={6}>
                            <Form.Item label="Média da conta de luz" name="conta_energia_media">
                                <InputNumber {...propsMoeda} size="large" />
                            </Form.Item>
                        </Col>
                    ) : null}
                    <Col xs={24} lg={6}>
                        <Form.Item label="Valor da venda" name="valor" tooltip="Valor estimado do negócio (tamanho da venda).">
                            <InputNumber {...propsMoeda} size="large" placeholder="Ex.: 15.000,00" />
                        </Form.Item>
                    </Col>
                    <Col xs={24} lg={6}>
                        <Form.Item label="Responsável" name="responsavel_id">
                            <Select
                                size="large"
                                showSearch
                                allowClear
                                placeholder="Selecione da equipe"
                                options={listaResponsaveis}
                                disabled={!canViewAllLeads}
                                optionFilterProp="label"
                            />
                        </Form.Item>
                    </Col>
                    <Col xs={24} lg={6}>
                        <Form.Item label="Etapa do funil" name="stage_id" rules={[{ required: true, message: "Selecione a etapa." }]}>
                            <Select size="large" options={stageOptions} showSearch optionFilterProp="label" />
                        </Form.Item>
                    </Col>
                    {canaisOrigem.length > 0 || origemAtual.id ? (
                        <Col xs={24} lg={6}>
                            <CampoOrigem canais={canaisOrigem} origemAtual={origemAtual} />
                        </Col>
                    ) : null}
                    <Col xs={24} lg={6}>
                        <Form.Item
                            label="Temperatura"
                            name="temperature"
                            extra={automaticTemperature ? `Automática: ${LEAD_TEMPERATURE_LABELS[automaticTemperature]}` : "Manual para leads em aberto."}
                        >
                            <Select
                                size="large"
                                allowClear
                                placeholder={automaticTemperature ? "Temperatura automática" : "Selecione"}
                                disabled={Boolean(automaticTemperature)}
                                options={LEAD_TEMPERATURE_OPTIONS.map((option) => ({ value: option.value, label: <TemperatureBadge value={option.value} /> }))}
                            />
                        </Form.Item>
                    </Col>
                </Row>
                {camposCustomizados.length > 0 ? <CustomFieldsForm campos={camposCustomizados} /> : null}
            </Form>
        </Edit>
    );
};
