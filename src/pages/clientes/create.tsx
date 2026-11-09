import { Create, useForm } from "@refinedev/antd";
import { useGo, useList, type HttpError } from "@refinedev/core";
import { UploadOutlined } from "@ant-design/icons";
import { useTenantSegmento } from "../../hooks/useTenantSegmento";
import {
    Button,
    Card,
    Col,
    Form,
    Input,
    InputNumber,
    Modal,
    Row,
    Select,
    Typography,
    Upload,
    message,
    type UploadFile,
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { TemperatureBadge } from "../../components/ui";
import { useTenant } from "../../contexts/tenant";
import { useCrmAccess } from "../../hooks/useCrmAccess";
import { fetchEmployeesDirectory } from "../../lib/crmEmployees";
import { type TipoPessoa, validarTelefone } from "../../lib/documentos";
import { CampoDocumento } from "../../components/campo-documento";
import { montarFiltroDuplicata } from "../../lib/duplicatas";
import { MAX_PDF_FILE_SIZE_BYTES, uploadNewLeadDocument } from "../../lib/leadTimeline";
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
} from "../../lib/leadTemperature";
import { propsMoeda } from "../../lib/moedaInput";
import { useBuscaCep } from "../../hooks/useBuscaCep";
import type { PipelineRecord, PipelineStageRecord } from "../../types/db";
import { supabaseClient } from "../../utility";
import { CustomFieldsForm } from "../../components/custom-fields";
import { extrairDadosExtras, useCustomFields } from "../../hooks/useCustomFields";
import { CampoOrigem } from "../../components/origem/campo-origem";
import { useCanaisOrigem } from "../../hooks/useCanaisOrigem";
import { origemParaDadosExtras } from "../../lib/origemLead";

type ClienteCreateFormValues = {
    nome: string;
    cpf_cnpj: string;
    telefone: string;
    email?: string;
    ddi?: string;
    cep?: string;
    endereco_instalacao?: string;
    numero?: string;
    complemento?: string;
    conta_energia_media?: number | null;
    valor?: number | null;
    responsavel_id?: string;
    stage_id: string;
    temperature?: LeadTemperature;
    /** Canal de origem (vai para dados_extras, não é coluna da view) */
    origem_id?: string;
    /** Valores dos campos customizados do tenant (jsonb) */
    dados_extras?: Record<string, unknown>;
};

type ClienteDuplicado = { id: string | number; nome?: string | null; telefone?: string | null };

const { Text, Title } = Typography;

/** Mensagem amigável para os erros de unicidade que o banco pode devolver. */
const notificacaoDeErro = (error?: HttpError) => {
    const errorMsg = String(error?.message || "").toLowerCase();

    if (errorMsg.includes("idx_clientes_unique_cpf_cnpj_tenant") || (errorMsg.includes("23505") && errorMsg.includes("cpf_cnpj"))) {
        return {
            message: "Cliente já cadastrado",
            description: "Este CPF ou CNPJ já existe na sua base.",
            type: "error" as const,
        };
    }
    if (errorMsg.includes("idx_clientes_unique_email_tenant") || (errorMsg.includes("23505") && errorMsg.includes("email"))) {
        return {
            message: "E-mail duplicado",
            description: "Este e-mail já está cadastrado em outro lead da sua empresa.",
            type: "error" as const,
        };
    }
    if (errorMsg.includes("idx_clientes_unique_telefone_tenant") || (errorMsg.includes("23505") && errorMsg.includes("telefone"))) {
        return {
            message: "Telefone duplicado",
            description: "Este telefone/WhatsApp já pertence a outro lead do seu funil.",
            type: "error" as const,
        };
    }
    return {
        message: "Não foi possível salvar o lead",
        description: error?.message || "Verifique os dados e tente novamente.",
        type: "error" as const,
    };
};

export const ClienteCreate = () => {
    const go = useGo();
    const { tenantId } = useTenant();
    const { ownerDisplayName, employee } = useCrmAccess();
    const { isEnergiaSolar } = useTenantSegmento();
    const { campos: camposCustomizados } = useCustomFields("negocio");
    const { canais: canaisOrigem } = useCanaisOrigem();

    const pendingFilesRef = useRef<{
        propostaFile: File | null;
        contaLuzFile: File | null;
        enviadoPor?: string;
    }>({
        propostaFile: null,
        contaLuzFile: null,
        enviadoPor: undefined,
    });

    const [listaResponsaveis, setListaResponsaveis] = useState<{ label: string; value: string }[]>([]);
    const [paisSelecionado, setPaisSelecionado] = useState("+55");
    const [tipoPessoa, setTipoPessoa] = useState<TipoPessoa>("pf");
    const [propostaFile, setPropostaFile] = useState<File | null>(null);
    const [contaLuzFile, setContaLuzFile] = useState<File | null>(null);
    const [isUploadingFiles, setIsUploadingFiles] = useState(false);
    // Entre o clique em salvar e o início da gravação há a checagem de
    // duplicata (rede + confirmação). Sem esta trava, o segundo clique
    // disparava outro cadastro: lead em dobro.
    const [isPreparando, setIsPreparando] = useState(false);
    const preparandoRef = useRef(false);

    const { formProps, saveButtonProps, form } = useForm<Record<string, unknown>, HttpError, Record<string, unknown>>({
        redirect: false,
        successNotification: false,
        errorNotification: (error) => notificacaoDeErro(error),
        onMutationSuccess: async (data) => {
            const createdId = (data as { data?: { id?: string | number } })?.data?.id;
            const pendingFiles = pendingFilesRef.current;

            try {
                const uploadJobs: Promise<unknown>[] = [];
                const hasPendingFiles = Boolean(pendingFiles.propostaFile || pendingFiles.contaLuzFile);

                if (!createdId && hasPendingFiles) {
                    throw new Error(
                        "Lead criado sem retorno de ID. Não foi possível anexar os documentos automaticamente.",
                    );
                }

                if (createdId && pendingFiles.propostaFile) {
                    uploadJobs.push(
                        uploadNewLeadDocument(createdId, pendingFiles.propostaFile, "proposta", tenantId, pendingFiles.enviadoPor),
                    );
                }

                if (createdId && pendingFiles.contaLuzFile) {
                    uploadJobs.push(
                        uploadNewLeadDocument(createdId, pendingFiles.contaLuzFile, "conta_luz", tenantId, pendingFiles.enviadoPor),
                    );
                }

                if (uploadJobs.length > 0) {
                    setIsUploadingFiles(true);
                    await Promise.all(uploadJobs);
                }

                message.success(
                    uploadJobs.length > 0
                        ? "Lead criado e documentos anexados com sucesso."
                        : "Lead criado com sucesso.",
                );

                go({ to: "/clientes", type: "replace" });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : "Falha no upload.";
                message.error(`Lead criado, mas houve falha no envio dos documentos: ${errorMessage}`);
            } finally {
                setIsUploadingFiles(false);
                pendingFilesRef.current = { propostaFile: null, contaLuzFile: null, enviadoPor: undefined };
                setPropostaFile(null);
                setContaLuzFile(null);
            }
        },
    });
    const { numeroInputRef, handleCepChange } = useBuscaCep(form);

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

    // Etapa inicial padrão: a primeira do funil que o usuário está usando no
    // Kanban (o board guarda a escolha por empresa).
    const etapaPadrao = useMemo(() => {
        let funilAtivo: string | null = null;
        try {
            funilAtivo = window.localStorage.getItem(`crm_pipeline_${tenantId || "default"}`);
        } catch {
            funilAtivo = null;
        }
        const doFunil = funilAtivo ? leadStages.find((s) => s.pipeline_id === funilAtivo) : undefined;
        return doFunil?.id ?? stageOptions[0]?.value;
    }, [leadStages, stageOptions, tenantId]);

    const responsavelOptions = useMemo(() => {
        const map = new Map<string, { label: string; value: string }>();
        listaResponsaveis.forEach((option) => {
            const key = option.value.trim().toLowerCase();
            if (key) map.set(key, option);
        });
        return Array.from(map.values());
    }, [listaResponsaveis]);

    const stageValue = Form.useWatch("stage_id", form) as string | undefined;
    const selectedStage = findLeadStageById(leadStages, stageValue);
    const automaticTemperature = resolveAutomaticLeadTemperature(selectedStage?.nome);

    useEffect(() => {
        let ativo = true;
        fetchEmployeesDirectory()
            .then(({ employees }) => {
                if (!ativo) return;
                setListaResponsaveis(
                    employees
                        .filter((emp) => emp.ativo && emp.nome && !emp.nome.includes("@"))
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

    // Responsável padrão: o próprio usuário, quando ele é da equipe.
    useEffect(() => {
        if (!employee?.id || form.getFieldValue("responsavel_id")) return;
        if (listaResponsaveis.some((opt) => opt.value === String(employee.id))) {
            form.setFieldValue("responsavel_id", String(employee.id));
        }
    }, [employee?.id, form, listaResponsaveis]);

    useEffect(() => {
        const currentStageId = form.getFieldValue("stage_id") as string | undefined;
        if (!currentStageId && etapaPadrao) {
            form.setFieldValue("stage_id", etapaPadrao);
            return;
        }
        if (currentStageId) {
            const normalizedStage = coerceLeadStageIdValue(currentStageId, leadStages);
            if (normalizedStage !== currentStageId) form.setFieldValue("stage_id", normalizedStage);
        }
    }, [etapaPadrao, form, leadStages]);

    useEffect(() => {
        if (automaticTemperature) form.setFieldValue("temperature", undefined);
    }, [automaticTemperature, form]);

    const formatarTelefone = (valor: string, pais: string) => {
        let sanitized = valor.replace(/\D/g, "");
        if (pais === "+55") {
            sanitized = sanitized.replace(/^(\d{2})(\d)/g, "($1) $2");
            sanitized = sanitized.replace(/(\d)(\d{4})$/, "$1-$2");
            return sanitized.substring(0, 15);
        }
        if (pais === "+1") {
            sanitized = sanitized.replace(/^(\d{3})(\d)/g, "($1) $2");
            sanitized = sanitized.replace(/(\d)(\d{4})$/, "$1-$2");
            return sanitized.substring(0, 14);
        }
        return sanitized;
    };

    const handlePhoneChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        form.setFieldValue("telefone", formatarTelefone(event.target.value, paisSelecionado));
    };


    const toUploadFileList = (file: File | null, uid: string): UploadFile[] => {
        if (!file) return [];
        return [{ uid, name: file.name, status: "done", size: file.size, type: file.type }];
    };

    const handleBeforeUpload = (tipo: "proposta" | "conta_luz", file: File): false | typeof Upload.LIST_IGNORE => {
        const isPdf = file.type === "application/pdf" || file.name.toLowerCase().trim().endsWith(".pdf");

        if (!isPdf) {
            message.warning("Somente arquivos PDF são permitidos.");
            return Upload.LIST_IGNORE;
        }
        if (file.size > MAX_PDF_FILE_SIZE_BYTES) {
            message.warning(`Arquivo acima do limite (${Math.floor(MAX_PDF_FILE_SIZE_BYTES / (1024 * 1024))}MB).`);
            return Upload.LIST_IGNORE;
        }

        if (tipo === "proposta") setPropostaFile(file);
        else setContaLuzFile(file);
        return false;
    };

    // Detecção de duplicatas: avisa (sem bloquear) quando telefone, CPF/CNPJ
    // ou e-mail já existem na base do tenant.
    const confirmarSeDuplicado = async (values: ClienteCreateFormValues): Promise<boolean> => {
        try {
            const filtro = montarFiltroDuplicata({
                telefone: values.telefone,
                documento: values.cpf_cnpj,
                email: values.email,
            });
            if (!filtro) return true;

            const { data, error } = await supabaseClient
                .from("clientes")
                .select("id,nome,telefone")
                .or(filtro)
                .limit(3);

            if (error || !data || data.length === 0) return true;

            return await new Promise<boolean>((resolve) => {
                Modal.confirm({
                    title: "Possível duplicata",
                    content: (
                        <div>
                            <p>Já existe cadastro com o mesmo telefone, documento ou e-mail:</p>
                            <ul style={{ paddingLeft: 18, margin: 0 }}>
                                {(data as ClienteDuplicado[]).map((registro) => (
                                    <li key={String(registro.id)}>
                                        <strong>{registro.nome || "Sem nome"}</strong>
                                        {registro.telefone ? ` — ${registro.telefone}` : ""}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ),
                    okText: "Criar mesmo assim",
                    cancelText: "Cancelar",
                    onOk: () => resolve(true),
                    onCancel: () => resolve(false),
                });
            });
        } catch {
            // Falha na verificação nunca bloqueia o cadastro
            return true;
        }
    };

    const handleFinish = async (values: ClienteCreateFormValues) => {
        if (preparandoRef.current) return;
        preparandoRef.current = true;
        setIsPreparando(true);
        try {
            const prosseguir = await confirmarSeDuplicado(values);
            if (!prosseguir) return;

            const { temperature, responsavel_id, origem_id, ...payload } = values;
            const nextStageId = coerceLeadStageIdValue(values.stage_id, leadStages);
            const nextStage = findLeadStageById(leadStages, nextStageId);
            const automaticFromStatus = resolveAutomaticLeadTemperature(nextStage?.nome);
            const nextTemperature = automaticFromStatus ? undefined : temperature;

            // O nome do responsável vai também na coluna de texto (filtros e relatórios)
            const responsavelSelecionado = responsavelOptions.find((opt) => opt.value === responsavel_id);
            const responsavelNome = responsavelSelecionado ? responsavelSelecionado.label : ownerDisplayName;

            pendingFilesRef.current = { propostaFile, contaLuzFile, enviadoPor: responsavelNome };

            // Carimba o funil da etapa escolhida: sem pipeline_id o lead nasce
            // fora de qualquer funil.
            const pipelineDaStage = pipelineDaEtapa(leadStages, nextStageId);

            // Campos customizados do tenant viajam em dados_extras (jsonb).
            const dadosExtras = {
                ...extrairDadosExtras(values as Record<string, unknown>, camposCustomizados),
                ...origemParaDadosExtras(origem_id, canaisOrigem, "criar"),
            };
            const { dados_extras: _descartado, ...payloadLimpo } = payload;
            void _descartado;

            await formProps.onFinish?.({
                ...payloadLimpo,
                valor: values.valor ?? null,
                conta_energia_media: values.conta_energia_media ?? null,
                ...(Object.keys(dadosExtras).length ? { dados_extras: dadosExtras } : {}),
                tenant_id: tenantId || undefined,
                stage_id: nextStageId,
                ...(pipelineDaStage ? { pipeline_id: pipelineDaStage } : {}),
                status: nextStage?.nome || undefined,
                temperatura: nextTemperature || null,
                responsavel: responsavelNome,
                responsavel_id: responsavel_id,
            });
        } finally {
            preparandoRef.current = false;
            setIsPreparando(false);
        }
    };

    const ocupado = Boolean(saveButtonProps?.loading) || isUploadingFiles || isPreparando;
    const finalSaveButtonProps = {
        ...saveButtonProps,
        loading: ocupado,
        disabled: Boolean(saveButtonProps?.disabled) || ocupado,
    };

    const selectPais = (
        <Form.Item name="ddi" noStyle initialValue="+55">
            <Select
                style={{ width: 100 }}
                aria-label="Código do país"
                onChange={(value: string) => {
                    setPaisSelecionado(value);
                    form.setFieldValue("telefone", "");
                }}
                options={[
                    { value: "+55", label: "+55" },
                    { value: "+1", label: "+1" },
                    { value: "+351", label: "+351" },
                ]}
            />
        </Form.Item>
    );

    return (
        <Create saveButtonProps={finalSaveButtonProps} title="Novo lead">
            <Form {...formProps} layout="vertical" onFinish={(valores) => handleFinish(valores as ClienteCreateFormValues)}>
                <CampoDocumento form={form} tipo={tipoPessoa} onTipoChange={setTipoPessoa} />

                <Row gutter={20}>
                    <Col xs={24}>
                        <Form.Item
                            label={tipoPessoa === "pf" ? "Nome completo" : "Razão social / nome da empresa"}
                            name="nome"
                            rules={[{ required: true, whitespace: true, message: "Informe o nome." }]}
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
                                { required: true, message: "Informe o telefone." },
                                {
                                    validator: async (_, valor?: string) => {
                                        if (valor && !validarTelefone(valor, paisSelecionado)) {
                                            throw new Error("Telefone incompleto. Inclua o DDD.");
                                        }
                                    },
                                },
                            ]}
                        >
                            <Input addonBefore={selectPais} size="large" onChange={handlePhoneChange} inputMode="tel" autoComplete="tel" />
                        </Form.Item>
                    </Col>
                    <Col xs={24} lg={12}>
                        <Form.Item label="E-mail" name="email" rules={[{ type: "email", message: "E-mail inválido." }]}>
                            <Input size="large" type="email" autoComplete="email" />
                        </Form.Item>
                    </Col>
                </Row>

                {/* Endereço e conta de luz são do modelo de energia solar: para
                    outros segmentos eram obrigatórios e travavam o cadastro. */}
                {isEnergiaSolar ? (
                    <div className="crm-form-section crm-form-endereco">
                        <Row gutter={15}>
                            <Col xs={24} lg={5}>
                                <Form.Item label="CEP" name="cep" rules={[{ required: true, message: "Informe o CEP." }]}>
                                    <Input onChange={handleCepChange} maxLength={9} inputMode="numeric" />
                                </Form.Item>
                            </Col>
                            <Col xs={24} lg={13}>
                                {/* Editável: se o ViaCEP não encontrar o CEP (ou estiver fora
                                    do ar), o campo somente leitura e obrigatório travava o cadastro. */}
                                <Form.Item label="Endereço" name="endereco_instalacao" rules={[{ required: true, message: "Informe o endereço." }]}>
                                    <Input placeholder="Preenchido pelo CEP — pode ajustar" />
                                </Form.Item>
                            </Col>
                            <Col xs={24} lg={3}>
                                <Form.Item label="Número" name="numero" rules={[{ required: true, message: "Informe o número." }]}>
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
                            <Form.Item
                                label="Média da conta de luz"
                                name="conta_energia_media"
                                rules={[{ required: true, message: "Informe a média da conta." }]}
                            >
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
                        <Form.Item label="Responsável" name="responsavel_id" rules={[{ required: true, message: "Selecione o responsável." }]}>
                            <Select
                                showSearch
                                allowClear
                                placeholder="Selecione da equipe"
                                size="large"
                                options={responsavelOptions}
                                optionFilterProp="label"
                            />
                        </Form.Item>
                    </Col>
                    <Col xs={24} lg={6}>
                        <Form.Item label="Etapa inicial" name="stage_id" rules={[{ required: true, message: "Selecione a etapa inicial." }]}>
                            <Select size="large" options={stageOptions} showSearch optionFilterProp="label" />
                        </Form.Item>
                    </Col>
                    {canaisOrigem.length > 0 ? (
                        <Col xs={24} lg={6}>
                            <CampoOrigem canais={canaisOrigem} />
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

                <Card size="small" style={{ marginTop: 8, borderRadius: 10 }}>
                    {camposCustomizados.length > 0 ? (
                        <div className="crm-form-section" style={{ marginBottom: 16 }}>
                            <Row gutter={20}>
                                <Col xs={24} lg={12}>
                                    <CustomFieldsForm campos={camposCustomizados} />
                                </Col>
                            </Row>
                        </div>
                    ) : null}

                    <Title level={5} style={{ margin: 0 }}>Documentos iniciais do lead</Title>
                    <Text type="secondary">
                        Opcional no cadastro: anexe {isEnergiaSolar ? "proposta e/ou conta de luz" : "a proposta"} em PDF.
                    </Text>

                    <Row gutter={20} style={{ marginTop: 12 }}>
                        <Col xs={24} lg={12}>
                            <Form.Item label="Proposta comercial (PDF)">
                                <Upload
                                    accept=".pdf,application/pdf"
                                    maxCount={1}
                                    beforeUpload={(file) => handleBeforeUpload("proposta", file)}
                                    fileList={toUploadFileList(propostaFile, "proposta")}
                                    onRemove={() => {
                                        setPropostaFile(null);
                                        return true;
                                    }}
                                    disabled={isUploadingFiles}
                                >
                                    <Button icon={<UploadOutlined />}>Selecionar proposta</Button>
                                </Upload>
                            </Form.Item>
                        </Col>
                        {isEnergiaSolar && (
                            <Col xs={24} lg={12}>
                                <Form.Item label="Conta de luz (PDF)">
                                    <Upload
                                        accept=".pdf,application/pdf"
                                        maxCount={1}
                                        beforeUpload={(file) => handleBeforeUpload("conta_luz", file)}
                                        fileList={toUploadFileList(contaLuzFile, "conta_luz")}
                                        onRemove={() => {
                                            setContaLuzFile(null);
                                            return true;
                                        }}
                                        disabled={isUploadingFiles}
                                    >
                                        <Button icon={<UploadOutlined />}>Selecionar conta de luz</Button>
                                    </Upload>
                                </Form.Item>
                            </Col>
                        )}
                    </Row>

                    {isUploadingFiles ? <Text type="secondary">Enviando documentos para o repositório do lead...</Text> : null}
                </Card>
            </Form>
        </Create>
    );
};
