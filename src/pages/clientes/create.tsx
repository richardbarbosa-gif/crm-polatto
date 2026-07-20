import { Create, useForm } from "@refinedev/antd";
import { useGo, useList } from "@refinedev/core";
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
} from "../../lib/leadTemperature";
import { supabaseClient } from "../../utility";

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
    valor?: number;
    responsavel_id?: string; // Alterado para ID
    stage_id: string;
    temperature?: LeadTemperature;
};

const { Text, Title } = Typography;

export const ClienteCreate = () => {
    const go = useGo();
    const { tenantId } = useTenant();
    const { ownerDisplayName } = useCrmAccess();
    const { isEnergiaSolar } = useTenantSegmento();
    
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
        errorNotification: (error: any) => {
            const errorMsg = String(error?.message || "").toLowerCase();
            
            // Intercepta o erro de CPF/CNPJ duplicado
            if (errorMsg.includes("idx_clientes_unique_cpf_cnpj_tenant") || (errorMsg.includes("23505") && errorMsg.includes("cpf_cnpj"))) {
                return {
                    message: "Empresa/Cliente já cadastrado",
                    description: "Este CPF ou CNPJ já existe na sua base de dados.",
                    type: "error",
                };
            }

            // Intercepta o erro de E-mail duplicado
            if (errorMsg.includes("idx_clientes_unique_email_tenant") || (errorMsg.includes("23505") && errorMsg.includes("email"))) {
                return {
                    message: "Atenção: E-mail Duplicado",
                    description: "Este e-mail já está registado noutro lead da sua empresa. Por favor, verifique.",
                    type: "error",
                };
            }
            
            // Intercepta o erro de Telefone duplicado
            if (errorMsg.includes("idx_clientes_unique_telefone_tenant") || (errorMsg.includes("23505") && errorMsg.includes("telefone"))) {
                return {
                    message: "Atenção: Telefone Duplicado",
                    description: "Este número de telefone/WhatsApp já pertence a outro lead do seu funil.",
                    type: "error",
                };
            }

            // Erro genérico
            return {
                message: "Não foi possível guardar o lead",
                description: error?.message || "Verifique os dados e tente novamente.",
                type: "error",
            };
        },
        onMutationSuccess: async (data) => {
            const createdId = (data as any)?.data?.id ?? (data as any)?.id;
            const pendingFiles = pendingFilesRef.current;

            try {
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
                        value: String(emp.id), // Agora guardamos o ID como valor do Select
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
            const normalizedStage: string = coerceLeadStageIdValue(currentStageId, leadStages);
            if (normalizedStage !== currentStageId) {
                form.setFieldValue("stage_id", normalizedStage);
            }
        }
    }, [form, leadStages, stageOptions]);

    useEffect(() => {
        form.setFieldValue("responsavel_id", undefined);
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
        if (!file) return [];
        return [{ uid, name: file.name, status: "done", size: file.size, type: file.type }];
    };

    const handleBeforeUpload = (
        tipo: "proposta" | "conta_luz",
        file: File,
    ): false | typeof Upload.LIST_IGNORE => {
        const isPdf = file.type === "application/pdf" || file.name.toLowerCase().trim().endsWith(".pdf");

        if (!isPdf) {
            message.warning("Somente arquivos PDF sao permitidos.");
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
            const condicoes: string[] = [];
            const telefone = (values.telefone || "").trim();
            const documento = (values.cpf_cnpj || "").trim();
            const email = (values.email || "").trim();

            if (telefone) condicoes.push(`telefone.eq.${telefone}`);
            if (documento) condicoes.push(`cpf_cnpj.eq.${documento}`);
            if (email) condicoes.push(`email.eq.${email}`);
            if (condicoes.length === 0) return true;

            const { data, error } = await supabaseClient
                .from("clientes")
                .select("id,nome,telefone")
                .or(condicoes.join(","))
                .limit(3);

            if (error || !data || data.length === 0) return true;

            return await new Promise<boolean>((resolve) => {
                Modal.confirm({
                    title: "Possível duplicata",
                    content: (
                        <div>
                            <p>Já existe cadastro com o mesmo telefone, documento ou e-mail:</p>
                            <ul style={{ paddingLeft: 18, margin: 0 }}>
                                {data.map((registro: { id: string | number; nome?: string | null; telefone?: string | null }) => (
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
        const prosseguir = await confirmarSeDuplicado(values);
        if (!prosseguir) return;

        const { temperature, responsavel_id, ...payload } = values;
        const nextStageId = coerceLeadStageIdValue(values.stage_id, leadStages);
        const nextStage = findLeadStageById(leadStages, nextStageId);
        const automaticFromStatus = resolveAutomaticLeadTemperature(nextStage?.nome);
        const nextTemperature = automaticFromStatus ? undefined : temperature;

        // Recupera o nome do responsável a partir do ID para preencher a coluna de texto
        const responsavelSelecionado = responsavelOptions.find(opt => opt.value === responsavel_id);
        const responsavelNome = responsavelSelecionado ? responsavelSelecionado.label : ownerDisplayName;

        pendingFilesRef.current = {
            propostaFile,
            contaLuzFile,
            enviadoPor: responsavelNome,
        };

        return formProps.onFinish?.({
            ...payload,
            tenant_id: tenantId || undefined,
            stage_id: nextStageId,
            status: nextStage?.nome || undefined,
            temperatura: nextTemperature || null,
            responsavel: responsavelNome,
            responsavel_id: responsavel_id,
        } as any);
    };

    const finalSaveButtonProps = {
        ...saveButtonProps,
        loading: Boolean(saveButtonProps?.loading) || isUploadingFiles,
        disabled: Boolean(saveButtonProps?.disabled) || isUploadingFiles,
    };

    const selectPais = (
        <Form.Item name="ddi" noStyle initialValue="+55">
            <Select style={{ width: 100 }} onChange={(value) => { setPaisSelecionado(value); form.setFieldValue("telefone", ""); }}>
                <Select.Option value="+55">+55</Select.Option>
                <Select.Option value="+1">+1</Select.Option>
                <Select.Option value="+351">+351</Select.Option>
            </Select>
        </Form.Item>
    );

    return (
        <Create saveButtonProps={finalSaveButtonProps} title="Novo Cliente Solar">
            <Form {...formProps} layout="vertical" onFinish={handleFinish}>
                <Row gutter={20}>
                    <Col xs={24} lg={12}>
                        <Form.Item label="Nome Completo" name="nome" rules={[{ required: true }]}>
                            <Input size="large" />
                        </Form.Item>
                    </Col>
                    <Col xs={24} lg={12}>
                        <Form.Item label="CPF ou CNPJ" name="cpf_cnpj" rules={[{ required: true }]}>
                            <Input size="large" maxLength={18} placeholder="000.000.000-00 ou 00.000.000/0000-00" onChange={handleCpfCnpjChange} />
                        </Form.Item>
                    </Col>
                </Row>

                <Row gutter={20}>
                    <Col xs={24} lg={12}>
                        <Form.Item label="WhatsApp / Telefone" name="telefone" rules={[{ required: true }]}>
                            <Input addonBefore={selectPais} size="large" onChange={handlePhoneChange} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} lg={12}>
                        <Form.Item label="E-mail" name="email">
                            <Input size="large" />
                        </Form.Item>
                    </Col>
                </Row>

                <div style={{ background: "#f8f9fa", padding: "15px", borderRadius: "8px", marginBottom: "20px", border: "1px solid #ddd" }}>
                    <Row gutter={15}>
                        <Col xs={24} lg={5}>
                            <Form.Item label="CEP" name="cep" rules={[{ required: true }]}>
                                <Input onChange={handleCepChange} maxLength={9} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} lg={13}>
                            <Form.Item label="Logradouro" name="endereco_instalacao" rules={[{ required: true }]}>
                                <Input readOnly />
                            </Form.Item>
                        </Col>
                        <Col xs={24} lg={3}>
                            <Form.Item label="Numero" name="numero" rules={[{ required: true }]}>
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

                <Row gutter={20}>
                    <Col xs={24} lg={6}>
                        <Form.Item label="Media da Conta (R$)" name="conta_energia_media" rules={[{ required: true }]}>
                            <InputNumber style={{ width: "100%" }} size="large" formatter={(value) => `R$ ${value}`} parser={(value) => value!.replace("R$ ", "")} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} lg={6}>
                        <Form.Item label="Valor da Venda (R$)" name="valor" tooltip="Qual é o valor financeiro estimado (tamanho do negócio)?">
                            <InputNumber
                                style={{ width: "100%" }}
                                size="large"
                                min={0 as number}
                                formatter={(value) => `R$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}
                                parser={(value) => value ? Number(String(value).replace(/R\$\s?|\./g, '').replace(',', '.')) : 0 as any}
                                placeholder="Ex: 15000"
                            />
                        </Form.Item>
                    </Col>
                    <Col xs={24} lg={6}>
                        <Form.Item label="Responsavel" name="responsavel_id" rules={[{ required: true, message: "Obrigatorio" }]}>
                            <Select
                                showSearch
                                allowClear
                                placeholder="Selecione a equipe"
                                size="large"
                                options={responsavelOptions}
                                filterOption={(input, option) => (option?.label ?? "").toLowerCase().includes(input.toLowerCase())}
                            />
                        </Form.Item>
                    </Col>
                    <Col xs={24} lg={6}>
                        <Form.Item label="Etapa Inicial" name="stage_id" rules={[{ required: true, message: "Selecione a etapa inicial." }]}>
                            <Select size="large" options={stageOptions} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} lg={6}>
                        <Form.Item label="Temperatura" name="temperature" extra={automaticTemperature ? `Automatica: ${LEAD_TEMPERATURE_LABELS[automaticTemperature]}` : "Manual para leads abertos."}>
                            <Select size="large" allowClear placeholder={automaticTemperature ? "Temperatura automatica" : "Selecione"} disabled={Boolean(automaticTemperature)} options={LEAD_TEMPERATURE_OPTIONS.map((option) => ({ value: option.value, label: <TemperatureBadge value={option.value} /> }))} />
                        </Form.Item>
                    </Col>
                </Row>

                <Card size="small" style={{ marginTop: 8, borderRadius: 10, border: "1px solid #e5e7eb", background: "#f8fafc" }}>
                    <Title level={5} style={{ margin: 0 }}>Documentos iniciais do lead</Title>
                    <Text type="secondary">Opcional no cadastro: anexe proposta e/ou conta de luz em PDF.</Text>

                    <Row gutter={20} style={{ marginTop: 12 }}>
                        <Col xs={24} lg={12}>
                            <Form.Item label="Proposta comercial (PDF)">
                                <Upload accept=".pdf,application/pdf" maxCount={1} beforeUpload={(file) => handleBeforeUpload("proposta", file)} fileList={toUploadFileList(propostaFile, "proposta")} onRemove={() => { setPropostaFile(null); return true; }} disabled={isUploadingFiles}>
                                    <Button icon={<UploadOutlined />}>Selecionar proposta</Button>
                                </Upload>
                            </Form.Item>
                        </Col>
                         {isEnergiaSolar && (
        <Col xs={24} lg={12}>
            <Form.Item label="Conta de luz (PDF)">
                <Upload accept=".pdf,application/pdf" maxCount={1} beforeUpload={(file) => handleBeforeUpload("conta_luz", file)} fileList={toUploadFileList(contaLuzFile, "conta_luz")} onRemove={() => { setContaLuzFile(null); return true; }} disabled={isUploadingFiles}>
                    <Button icon={<UploadOutlined />}>Selecionar conta de luz</Button>
                </Upload>
            </Form.Item>
        </Col>
    )}
</Row>

                    {isUploadingFiles ? <Text type="secondary">Enviando documentos para o repositório oficial do lead...</Text> : null}
                </Card>
            </Form>
        </Create>
    );
};