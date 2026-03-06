import { Create, useForm } from "@refinedev/antd";
import { useGo, useList } from "@refinedev/core";
import { UploadOutlined } from "@ant-design/icons";
import {
    Button,
    Card,
    Col,
    Form,
    Input,
    InputNumber,
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
import { formatCpfCnpj } from "../../lib/formatters";
import { MAX_PDF_FILE_SIZE_BYTES, uploadNewLeadDocument } from "../../lib/leadTimeline";
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
    setLeadTemperature,
} from "../../lib/leadTemperature";
import { markLeadAsRecentlyCreated } from "../../lib/leadVisibility";

type ClienteCreateFormValues = {
    nome: string;
    cpf_cnpj: string;
    telefone: string;
    email?: string;
    ddi?: string;
    cep: string;
    endereco_instalacao: string;
    numero: string;
    complemento?: string;
    conta_energia_media: number;
    responsavel?: string;
    stage_id: string;
    temperature?: LeadTemperature;
};

const { Text, Title } = Typography;

export const ClienteCreate = () => {
    const go = useGo();
    const { tenantId } = useTenant();
    const { ownerDisplayName } = useCrmAccess();
    const pendingTemperatureRef = useRef<LeadTemperature | undefined>(undefined);
    const pendingFilesRef = useRef<{
        propostaFile: File | null;
        contaLuzFile: File | null;
        enviadoPor?: string;
    }>({
        propostaFile: null,
        contaLuzFile: null,
        enviadoPor: undefined,
    });

    const [listaResponsaveis, setListaResponsaveis] = useState<{ label: string; value: string }[]>(
        [],
    );
    const [paisSelecionado, setPaisSelecionado] = useState("+55");
    const numeroInputRef = useRef<any>(null);
    const [propostaFile, setPropostaFile] = useState<File | null>(null);
    const [contaLuzFile, setContaLuzFile] = useState<File | null>(null);
    const [isUploadingFiles, setIsUploadingFiles] = useState(false);

    const { formProps, saveButtonProps, form } = useForm<any, any, ClienteCreateFormValues>({
        redirect: false,
        successNotification: false,
        onMutationSuccess: async (data) => {
            const createdId = (data as any)?.data?.id ?? (data as any)?.id;
            const pendingTemperature = pendingTemperatureRef.current;
            const pendingFiles = pendingFilesRef.current;

            try {
                if (createdId && pendingTemperature) {
                    setLeadTemperature(createdId, pendingTemperature);
                }

                if (createdId) {
                    markLeadAsRecentlyCreated(createdId);
                }

                const uploadJobs: Promise<unknown>[] = [];
                const hasPendingFiles = Boolean(
                    pendingFiles.propostaFile || pendingFiles.contaLuzFile,
                );

                if (!createdId && hasPendingFiles) {
                    throw new Error(
                        "Lead criado sem retorno de ID. Nao foi possivel anexar os documentos automaticamente.",
                    );
                }

                if (createdId && pendingFiles.propostaFile) {
                    uploadJobs.push(
                        uploadNewLeadDocument(
                            createdId,
                            pendingFiles.propostaFile,
                            "proposta",
                            tenantId,
                            pendingFiles.enviadoPor,
                        ),
                    );
                }

                if (createdId && pendingFiles.contaLuzFile) {
                    uploadJobs.push(
                        uploadNewLeadDocument(
                            createdId,
                            pendingFiles.contaLuzFile,
                            "conta_luz",
                            tenantId,
                            pendingFiles.enviadoPor,
                        ),
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

                go({
                    to: "/clientes",
                    type: "replace",
                });
            } catch (error) {
                const errorMessage =
                    typeof error === "object" && error && "message" in error
                        ? String((error as { message?: unknown }).message || "Falha no upload.")
                        : "Falha no upload.";

                message.error(
                    `Lead criado, mas houve falha no envio dos documentos: ${errorMessage}`,
                );
            } finally {
                setIsUploadingFiles(false);
                pendingTemperatureRef.current = undefined;
                pendingFilesRef.current = {
                    propostaFile: null,
                    contaLuzFile: null,
                    enviadoPor: undefined,
                };
                setPropostaFile(null);
                setContaLuzFile(null);
            }
        },
    });

    const { query: stagesQuery } = useList({
        resource: "pipeline_stages",
        pagination: { mode: "off" },
        sorters: [{ field: "ordem", order: "asc" }],
    });

    const stagesData = (stagesQuery?.data?.data as any[]) || [];
    const leadStages = useMemo(() => buildLeadStages(stagesData), [stagesData]);
    const stageOptions = useMemo(() => buildLeadStageOptions(stagesData), [stagesData]);
    const responsavelOptions = useMemo(() => {
        const map = new Map<string, { label: string; value: string }>();

        listaResponsaveis.forEach((option) => {
            const key = option.value.trim().toLowerCase();
            if (!key) {
                return;
            }
            map.set(key, option);
        });
        return Array.from(map.values());
    }, [listaResponsaveis]);

    const stageValue = Form.useWatch("stage_id", form) as string | undefined;
    const selectedStage = findLeadStageById(leadStages, stageValue);
    const automaticTemperature = resolveAutomaticLeadTemperature(selectedStage?.nome);

    useEffect(() => {
        const carregarEquipe = async () => {
            try {
                const { employees } = await fetchEmployeesDirectory();
                const opcoes = employees
                    .filter((emp) => emp.ativo && emp.nome && !emp.nome.includes("@"))
                    .map((emp) => ({
                        label: emp.nome,
                        value: emp.nome,
                    }));
                setListaResponsaveis(opcoes);
            } catch {
                setListaResponsaveis([]);
            }
        };

        carregarEquipe();
    }, []);

    useEffect(() => {
        const currentStageId = form.getFieldValue("stage_id");
        if (!currentStageId && stageOptions.length > 0) {
            form.setFieldValue("stage_id", stageOptions[0].value);
            return;
        }

        if (currentStageId) {
            const normalizedStage = coerceLeadStageIdValue(currentStageId, leadStages);
            if (normalizedStage !== currentStageId) {
                form.setFieldValue("stage_id", normalizedStage);
            }
        }
    }, [form, leadStages, stageOptions]);

    useEffect(() => {
        // Novo lead sempre inicia sem responsavel pre-selecionado.
        form.setFieldValue("responsavel", undefined);
    }, [form]);

    useEffect(() => {
        if (automaticTemperature) {
            form.setFieldValue("temperature", undefined);
        }
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
        const valorFormatado = formatarTelefone(event.target.value, paisSelecionado);
        form.setFieldValue("telefone", valorFormatado);
    };

    const handleCpfCnpjChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        form.setFieldValue("cpf_cnpj", formatCpfCnpj(event.target.value));
    };

    const handleCepChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const cepRaw = event.target.value.replace(/\D/g, "");
        form.setFieldValue("cep", cepRaw.replace(/^(\d{5})(\d)/, "$1-$2"));

        if (cepRaw.length !== 8) {
            return;
        }

        try {
            const response = await fetch(`https://viacep.com.br/ws/${cepRaw}/json/`);
            const data = await response.json();

            if (!data.erro) {
                form.setFieldValue(
                    "endereco_instalacao",
                    `${data.logradouro}, ${data.bairro}, ${data.localidade} - ${data.uf}`,
                );
                message.success("Endereco encontrado.");
                setTimeout(() => numeroInputRef.current?.focus(), 100);
            }
        } catch {
            message.warning("Nao foi possivel buscar o CEP automaticamente.");
        }
    };

    const toUploadFileList = (file: File | null, uid: string): UploadFile[] => {
        if (!file) {
            return [];
        }

        return [
            {
                uid,
                name: file.name,
                status: "done",
                size: file.size,
                type: file.type,
            },
        ];
    };

    const handleBeforeUpload = (
        tipo: "proposta" | "conta_luz",
        file: File,
    ): false | typeof Upload.LIST_IGNORE => {
        const isPdf =
            file.type === "application/pdf" || file.name.toLowerCase().trim().endsWith(".pdf");

        if (!isPdf) {
            message.warning("Somente arquivos PDF sao permitidos.");
            return Upload.LIST_IGNORE;
        }

        if (file.size > MAX_PDF_FILE_SIZE_BYTES) {
            message.warning(
                `Arquivo acima do limite (${Math.floor(MAX_PDF_FILE_SIZE_BYTES / (1024 * 1024))}MB).`,
            );
            return Upload.LIST_IGNORE;
        }

        if (tipo === "proposta") {
            setPropostaFile(file);
        } else {
            setContaLuzFile(file);
        }

        return false;
    };

    const handleFinish = async (values: ClienteCreateFormValues) => {
        const { temperature, ...payload } = values;
        const nextStageId = coerceLeadStageIdValue(values.stage_id, leadStages);
        const nextStage = findLeadStageById(leadStages, nextStageId);
        const automaticFromStatus = resolveAutomaticLeadTemperature(nextStage?.nome);
        const nextTemperature = automaticFromStatus ? undefined : temperature;

        pendingTemperatureRef.current = nextTemperature;
        pendingFilesRef.current = {
            propostaFile,
            contaLuzFile,
            enviadoPor: values.responsavel || ownerDisplayName,
        };

        return formProps.onFinish?.({
            ...payload,
            tenant_id: tenantId || undefined,
            stage_id: nextStageId,
            status: nextStage?.nome || undefined,
            responsavel: values.responsavel,
        } as any);
    };

    const finalSaveButtonProps = {
        ...saveButtonProps,
        loading: Boolean(saveButtonProps?.loading) || isUploadingFiles,
        disabled: Boolean(saveButtonProps?.disabled) || isUploadingFiles,
    };

    const selectPais = (
        <Form.Item name="ddi" noStyle initialValue="+55">
            <Select
                style={{ width: 100 }}
                onChange={(value) => {
                    setPaisSelecionado(value);
                    form.setFieldValue("telefone", "");
                }}
            >
                <Select.Option value="+55">+55</Select.Option>
                <Select.Option value="+1">+1</Select.Option>
                <Select.Option value="+351">+351</Select.Option>
            </Select>
        </Form.Item>
    );

    return (
        <Create saveButtonProps={finalSaveButtonProps} title="Novo Cliente Solar">
            <Form {...formProps} layout="vertical" onFinish={handleFinish} className="crm-form-row-tight">
                <div className="crm-form-section">
                    <Title level={5} className="crm-form-section-title">
                        Dados do cliente
                    </Title>
                    <Text type="secondary" className="crm-form-section-subtitle">
                        Informacoes de identificacao e contato principal.
                    </Text>
                    <Row gutter={20}>
                        <Col xs={24} lg={12}>
                            <Form.Item label="Nome completo" name="nome" rules={[{ required: true }]}>
                                <Input size="large" />
                            </Form.Item>
                        </Col>
                        <Col xs={24} lg={12}>
                            <Form.Item label="CPF ou CNPJ" name="cpf_cnpj" rules={[{ required: true }]}>
                                <Input
                                    size="large"
                                    maxLength={18}
                                    placeholder="000.000.000-00 ou 00.000.000/0000-00"
                                    onChange={handleCpfCnpjChange}
                                />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Row gutter={20}>
                        <Col xs={24} lg={12}>
                            <Form.Item
                                label="WhatsApp / Telefone"
                                name="telefone"
                                rules={[{ required: true }]}
                            >
                                <Input
                                    addonBefore={selectPais}
                                    size="large"
                                    onChange={handlePhoneChange}
                                />
                            </Form.Item>
                        </Col>
                        <Col xs={24} lg={12}>
                            <Form.Item label="E-mail" name="email">
                                <Input size="large" />
                            </Form.Item>
                        </Col>
                    </Row>
                </div>

                <div className="crm-form-section">
                    <Title level={5} className="crm-form-section-title">
                        Endereco de instalacao
                    </Title>
                    <Text type="secondary" className="crm-form-section-subtitle">
                        Informe o CEP para preenchimento assistido do logradouro.
                    </Text>
                    <Row gutter={15}>
                        <Col xs={24} lg={5}>
                            <Form.Item label="CEP" name="cep" rules={[{ required: true }]}>
                                <Input onChange={handleCepChange} maxLength={9} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} lg={13}>
                            <Form.Item
                                label="Logradouro"
                                name="endereco_instalacao"
                                rules={[{ required: true }]}
                            >
                                <Input readOnly />
                            </Form.Item>
                        </Col>
                        <Col xs={24} lg={3}>
                            <Form.Item label="Numero" name="numero" rules={[{ required: true }]}>
                                <Input ref={numeroInputRef} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} lg={3}>
                            <Form.Item label="Complemento" name="complemento">
                                <Input />
                            </Form.Item>
                        </Col>
                    </Row>
                </div>

                <div className="crm-form-section">
                    <Title level={5} className="crm-form-section-title">
                        Dados comerciais
                    </Title>
                    <Text type="secondary" className="crm-form-section-subtitle">
                        Defina valor estimado, responsavel e etapa inicial do funil.
                    </Text>
                    <Row gutter={20}>
                        <Col xs={24} lg={6}>
                            <Form.Item
                                label="Media da conta (R$)"
                                name="conta_energia_media"
                                rules={[{ required: true }]}
                            >
                                <InputNumber
                                    style={{ width: "100%" }}
                                    size="large"
                                    formatter={(value) => `R$ ${value}`}
                                    parser={(value) => value!.replace("R$ ", "")}
                                />
                            </Form.Item>
                        </Col>
                        <Col xs={24} lg={6}>
                            <Form.Item
                                label="Responsavel"
                                name="responsavel"
                                rules={[{ required: true, message: "Obrigatorio" }]}
                            >
                                <Select
                                    showSearch
                                    allowClear
                                    placeholder="Selecione a equipe"
                                    size="large"
                                    options={responsavelOptions}
                                    filterOption={(input, option) =>
                                        (option?.label ?? "").toLowerCase().includes(input.toLowerCase())
                                    }
                                />
                            </Form.Item>
                        </Col>
                        <Col xs={24} lg={6}>
                            <Form.Item
                                label="Etapa inicial"
                                name="stage_id"
                                rules={[{ required: true, message: "Selecione a etapa inicial." }]}
                            >
                                <Select size="large" options={stageOptions} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} lg={6}>
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
                                    size="large"
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
                </div>

                <Card
                    size="small"
                    className="crm-card"
                    style={{ marginTop: 8 }}
                >
                    <Title level={5} style={{ margin: 0 }}>
                        Documentos iniciais do lead
                    </Title>
                    <Text type="secondary">
                        Opcional no cadastro: anexe proposta e/ou conta de luz em PDF.
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
                    </Row>

                    {isUploadingFiles ? (
                        <Text type="secondary">
                            Enviando documentos para o repositório oficial do lead...
                        </Text>
                    ) : null}
                </Card>
            </Form>
        </Create>
    );
};
