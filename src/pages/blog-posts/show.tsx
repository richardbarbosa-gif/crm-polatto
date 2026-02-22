import {
    CalendarOutlined,
    EnvironmentOutlined,
    GoogleOutlined,
    PhoneOutlined,
    UserOutlined,
} from "@ant-design/icons";
import { DateField, Show } from "@refinedev/antd";
import { useShow } from "@refinedev/core";
import { Divider, Select, Skeleton, Space, Typography } from "antd";
import { useEffect, useState } from "react";
import {
    Badge,
    Button,
    Card,
    TemperatureBadge,
} from "../../components/ui";
import { formatCurrencyBRL } from "../../lib/formatters";
import {
    LEAD_TEMPERATURE_LABELS,
    LEAD_TEMPERATURE_OPTIONS,
    type LeadTemperature,
    type LeadTemperatureTag,
    isAutomaticLeadTemperature,
    resolveAutomaticLeadTemperature,
    resolveLeadTemperature,
    setLeadTemperature,
} from "../../lib/leadTemperature";
import { TaskFormModal } from "../../components/modal/agenda";

const { Title, Text } = Typography;

const getStatusTone = (status?: string) => {
    const value = (status ?? "").toLowerCase();
    if (value.includes("fechado")) return "success" as const;
    if (value.includes("perdido")) return "danger" as const;
    if (value.includes("visita")) return "warning" as const;
    return "info" as const;
};

export const BlogPostShow = () => {
    const showResult = useShow() as any;
    const { data, isLoading } = showResult.query || showResult;
    const record = data?.data;
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [temperatureTag, setTemperatureTag] = useState<LeadTemperatureTag | undefined>(undefined);
    const automaticTemperature = resolveAutomaticLeadTemperature(record?.status);
    const isAutomaticTemperature = isAutomaticLeadTemperature(temperatureTag);

    useEffect(() => {
        setTemperatureTag(resolveLeadTemperature(record));
    }, [record]);

    const handleTemperatureChange = (value?: LeadTemperature) => {
        if (automaticTemperature) {
            return;
        }

        setTemperatureTag(value);
        if (record?.id) {
            setLeadTemperature(record.id, value);
        }
    };

    const abrirNoMapa = () => {
        const endereco = `${record?.endereco_instalacao || ""}, ${record?.numero || ""} - ${
            record?.cep || ""
        }`;
        const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(endereco)}`;
        window.open(url, "_blank", "noopener,noreferrer");
    };

    if (isLoading) {
        return (
            <Show isLoading>
                <Skeleton active />
            </Show>
        );
    }

    return (
        <Show isLoading={isLoading} title="Detalhes do Cliente">
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 16,
                    gap: 10,
                    flexWrap: "wrap",
                }}
            >
                <Space wrap>
                    <Badge tone={getStatusTone(record?.status)}>
                        {record?.status || "Novo Lead"}
                    </Badge>
                    <TemperatureBadge value={temperatureTag} />
                    <Select
                        size="small"
                        style={{ width: 180 }}
                        allowClear
                        placeholder={
                            automaticTemperature
                                ? `Automatica: ${LEAD_TEMPERATURE_LABELS[automaticTemperature]}`
                                : "Editar temperatura"
                        }
                        value={isAutomaticTemperature ? undefined : temperatureTag}
                        onChange={handleTemperatureChange}
                        disabled={Boolean(automaticTemperature)}
                        options={LEAD_TEMPERATURE_OPTIONS.map((option) => ({
                            value: option.value,
                            label: option.label,
                        }))}
                    />
                    {automaticTemperature ? (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                            Temperatura automatica pelo status.
                        </Text>
                    ) : null}
                </Space>

                <Button
                    type="primary"
                    icon={<CalendarOutlined />}
                    onClick={() => setIsModalOpen(true)}
                    size="large"
                    style={{
                        backgroundColor: "#25D366",
                        borderColor: "#25D366",
                        fontWeight: 700,
                    }}
                >
                    Agendar Visita
                </Button>
            </div>

            <Card style={{ borderRadius: 10 }}>
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 16,
                        flexWrap: "wrap",
                    }}
                >
                    <div>
                        <Title level={3} style={{ margin: 0 }}>
                            {record?.nome}
                        </Title>
                        <Space wrap style={{ marginTop: 6 }}>
                            <Text type="secondary" style={{ fontSize: 15 }}>
                                <PhoneOutlined /> {record?.ddi} {record?.telefone}
                            </Text>
                            {record?.responsavel ? (
                                <Badge tone="info">
                                    <UserOutlined /> {record.responsavel}
                                </Badge>
                            ) : null}
                        </Space>
                    </div>

                    <div style={{ textAlign: "right" }}>
                        <Text type="secondary">Conta Media</Text>
                        <div style={{ fontSize: 28, fontWeight: 700, color: "#389e0d" }}>
                            {formatCurrencyBRL(record?.conta_energia_media, "R$ 0,00")}
                        </div>
                    </div>
                </div>

                <Divider />

                <div
                    style={{
                        background: "#f5f7fa",
                        padding: 20,
                        borderRadius: 10,
                        border: "1px solid #e7edf5",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 12,
                            flexWrap: "wrap",
                        }}
                    >
                        <div>
                            <Title level={5} style={{ margin: 0 }}>
                                <EnvironmentOutlined /> Local da Instalacao
                            </Title>
                            <Text style={{ fontSize: 15 }}>
                                {record?.endereco_instalacao}, {record?.numero}{" "}
                                {record?.complemento ? `- ${record.complemento}` : ""}
                            </Text>
                            <br />
                            <Text type="secondary">CEP: {record?.cep}</Text>
                        </div>
                        <Button
                            type="default"
                            icon={<GoogleOutlined />}
                            onClick={abrirNoMapa}
                        >
                            Ver no Mapa
                        </Button>
                    </div>
                </div>

                <Divider />

                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                        gap: 14,
                    }}
                >
                    <div>
                        <Text type="secondary">E-mail</Text>
                        <br />
                        <Text strong>{record?.email || "-"}</Text>
                    </div>
                    <div>
                        <Text type="secondary">CPF/CNPJ</Text>
                        <br />
                        <Text strong>{record?.cpf_cnpj || "-"}</Text>
                    </div>
                    <div>
                        <Text type="secondary">Cadastro</Text>
                        <br />
                        <DateField value={record?.created_at} format="DD/MM/YYYY" />
                    </div>
                </div>
            </Card>

            {record?.id ? (
                <TaskFormModal
                    open={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    contextData={{
                        clienteId: record.id,
                        clienteNome: record.nome || "Cliente",
                        clienteEndereco: record.endereco_instalacao || "",
                    }}
                />
            ) : null}
        </Show>
    );
};
