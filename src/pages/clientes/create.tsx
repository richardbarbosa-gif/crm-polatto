import { Create, useForm } from "@refinedev/antd";
import { useList } from "@refinedev/core";
import { Col, Form, Input, InputNumber, Row, Select, message } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { TemperatureBadge } from "../../components/ui";
import { fetchEmployeesDirectory } from "../../lib/crmEmployees";
import { formatCpfCnpj } from "../../lib/formatters";
import { buildLeadStatusOptions, coerceLeadStatusValue } from "../../lib/leadStatus";
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
    status: string;
    temperature?: LeadTemperature;
};

export const ClienteCreate = () => {
    const pendingTemperatureRef = useRef<LeadTemperature | undefined>(undefined);

    const [listaResponsaveis, setListaResponsaveis] = useState<{ label: string; value: string }[]>(
        [],
    );
    const [paisSelecionado, setPaisSelecionado] = useState("+55");
    const numeroInputRef = useRef<any>(null);

    const { formProps, saveButtonProps, form } = useForm<any, any, ClienteCreateFormValues>({
        onMutationSuccess: (data) => {
            const createdId = (data as any)?.data?.id;
            const pendingTemperature = pendingTemperatureRef.current;

            if (createdId && pendingTemperature) {
                setLeadTemperature(createdId, pendingTemperature);
            }
            if (createdId) {
                markLeadAsRecentlyCreated(createdId);
            }

            pendingTemperatureRef.current = undefined;
        },
    });

    const { query: stagesQuery } = useList({
        resource: "pipeline_stages",
        pagination: { mode: "off" },
        sorters: [{ field: "ordem", order: "asc" }],
    });

    const stagesData = (stagesQuery?.data?.data as any[]) || [];
    const statusOptions = useMemo(() => buildLeadStatusOptions(stagesData), [stagesData]);
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

    const statusValue = Form.useWatch("status", form) as string | undefined;
    const automaticTemperature = resolveAutomaticLeadTemperature(statusValue);

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
        const currentStatus = form.getFieldValue("status");
        if (!currentStatus && statusOptions.length > 0) {
            form.setFieldValue("status", statusOptions[0].value);
            return;
        }

        if (currentStatus) {
            const normalizedStatus = coerceLeadStatusValue(currentStatus, statusOptions);
            if (normalizedStatus !== currentStatus) {
                form.setFieldValue("status", normalizedStatus);
            }
        }
    }, [form, statusOptions]);

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

    const handleFinish = async (values: ClienteCreateFormValues) => {
        const { temperature, ...payload } = values;
        const status = coerceLeadStatusValue(values.status, statusOptions);
        const automaticFromStatus = resolveAutomaticLeadTemperature(status);
        const nextTemperature = automaticFromStatus ? undefined : temperature;

        pendingTemperatureRef.current = nextTemperature;

        return formProps.onFinish?.({ ...payload, status, responsavel: values.responsavel } as any);
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
        <Create saveButtonProps={saveButtonProps} title="Novo Cliente Solar">
            <Form {...formProps} layout="vertical" onFinish={handleFinish}>
                <Row gutter={20}>
                    <Col xs={24} lg={12}>
                        <Form.Item label="Nome Completo" name="nome" rules={[{ required: true }]}>
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

                <div
                    style={{
                        background: "#f8f9fa",
                        padding: "15px",
                        borderRadius: "8px",
                        marginBottom: "20px",
                        border: "1px solid #ddd",
                    }}
                >
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
                            <Form.Item label="Compl." name="complemento">
                                <Input />
                            </Form.Item>
                        </Col>
                    </Row>
                </div>

                <Row gutter={20}>
                    <Col xs={24} lg={6}>
                        <Form.Item
                            label="Media da Conta (R$)"
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
                            label="Status Inicial"
                            name="status"
                            rules={[{ required: true, message: "Selecione o status inicial." }]}
                        >
                            <Select size="large" options={statusOptions} />
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
            </Form>
        </Create>
    );
};
