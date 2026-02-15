import { CalendarOutlined, EnvironmentOutlined, GoogleOutlined, PhoneOutlined, UserOutlined } from "@ant-design/icons";
import { DateField, Show } from "@refinedev/antd";
import { useShow } from "@refinedev/core";
import { Button, Card, Divider, Skeleton, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { TaskFormModal } from "../../components/modal/agenda";

const { Title, Text } = Typography;

export const BlogPostShow = () => {
    const showResult = useShow() as any;
    const { data, isLoading } = showResult.query || showResult;
    const record = data?.data;
    const [isModalOpen, setIsModalOpen] = useState(false);

    const abrirNoMapa = () => {
        const endereco = `${record?.endereco_instalacao || ""}, ${record?.numero || ""} - ${record?.cep || ""}`;
        const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(endereco)}`;
        window.open(url, "_blank");
    };

    if (isLoading) {
        return (
            <Show isLoading={true}>
                <Skeleton active />
            </Show>
        );
    }

    return (
        <Show isLoading={isLoading} title="Detalhes do Cliente">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <Tag color="blue" style={{ fontSize: 16, padding: "5px 15px" }}>
                    {record?.status || "Novo Lead"}
                </Tag>
                <Button
                    type="primary"
                    icon={<CalendarOutlined />}
                    onClick={() => setIsModalOpen(true)}
                    size="large"
                    style={{ backgroundColor: "#25D366", borderColor: "#25D366", fontWeight: "bold" }}
                >
                    Agendar Visita
                </Button>
            </div>

            <Card bordered={false} style={{ borderRadius: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <div>
                        <Title level={3} style={{ margin: 0 }}>
                            {record?.nome}
                        </Title>
                        <Space style={{ marginTop: 5 }}>
                            <Text type="secondary" style={{ fontSize: 16 }}>
                                <PhoneOutlined /> {record?.ddi} {record?.telefone}
                            </Text>
                            {record?.responsavel && (
                                <Tag icon={<UserOutlined />} color="purple">
                                    {record.responsavel}
                                </Tag>
                            )}
                        </Space>
                    </div>
                    <div style={{ textAlign: "right" }}>
                        <Text type="secondary">Conta Media</Text>
                        <div style={{ fontSize: 28, fontWeight: "bold", color: "#389e0d" }}>
                            {Number(record?.conta_energia_media || 0).toLocaleString("pt-BR", {
                                style: "currency",
                                currency: "BRL",
                            })}
                        </div>
                    </div>
                </div>

                <Divider />

                <div style={{ background: "#f5f5f5", padding: 20, borderRadius: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                            <Title level={5} style={{ margin: 0 }}>
                                <EnvironmentOutlined /> Local da Instalacao
                            </Title>
                            <Text style={{ fontSize: 16 }}>
                                {record?.endereco_instalacao}, {record?.numero} {record?.complemento ? `- ${record.complemento}` : ""}
                            </Text>
                            <br />
                            <Text type="secondary">CEP: {record?.cep}</Text>
                        </div>
                        <Button type="primary" ghost icon={<GoogleOutlined />} onClick={abrirNoMapa}>
                            Ver no Mapa
                        </Button>
                    </div>
                </div>

                <Divider />
                <Space split={<Divider type="vertical" />}>
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
                </Space>
            </Card>

            {record?.id && (
                <TaskFormModal
                    open={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    contextData={{
                        clienteId: record.id,
                        clienteNome: record.nome || "Cliente",
                        clienteEndereco: record.endereco_instalacao || "",
                    }}
                />
            )}
        </Show>
    );
};
