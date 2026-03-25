import {
    CalendarOutlined,
    ClockCircleOutlined,
    EnvironmentOutlined,
    FilePdfOutlined,
    GoogleOutlined,
    LinkOutlined,
    PhoneOutlined,
    PlusOutlined,
    UploadOutlined,
    UserOutlined,
} from "@ant-design/icons";
import { DateField } from "@refinedev/antd";
import { useList } from "@refinedev/core";
import { Alert, Divider, Empty, Input, List, Select, Skeleton, Space, Timeline, Typography, message } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, TemperatureBadge } from "../../components/ui";
import { useTenant } from "../../contexts/tenant";
import { formatCurrencyBRL, formatDateBR } from "../../lib/formatters";
import { buildLeadStages, findLeadStageById } from "../../lib/leadStatus";
import { useTenantSegmento } from "../../hooks/useTenantSegmento";
import {
    LEAD_TEMPERATURE_LABELS,
    LEAD_TEMPERATURE_OPTIONS,
    type LeadTemperature,
    type LeadTemperatureTag,
    isAutomaticLeadTemperature,
    resolveAutomaticLeadTemperature,
    resolveLeadTemperature,
    updateLeadTemperature,
} from "../../lib/leadTemperature";
import {
    MAX_PDF_FILE_SIZE_BYTES,
    type LeadStoredFile,
    type LeadTimelineEntry,
    addLeadActivity,
    fetchLeadTimeline,
    listLeadFiles,
    softDeleteLeadDocument,
    uploadLeadPdf,
} from "../../lib/leadTimeline";
import { canDelete } from "../../lib/permissions";

const { Title, Text } = Typography;

type LeadRecord = {
    id?: string | number | null;
    nome?: string | null;
    ddi?: string | null;
    telefone?: string | null;
    responsavel?: string | null;
    conta_energia_media?: number | string | null;
    endereco_instalacao?: string | null;
    numero?: string | null;
    complemento?: string | null;
    cep?: string | null;
    email?: string | null;
    cpf_cnpj?: string | null;
    created_at?: string | null;
    stage_id?: string | number | null;
    status?: string | null;
};

type LeadDetailsProps = {
    record?: LeadRecord | null;
    isLoading?: boolean;
    currentUserLabel?: string;
    onScheduleVisit?: (context: {
        clienteId: string | number;
        clienteNome?: string;
        clienteEndereco?: string;
    }) => void;
};

const getStatusTone = (status?: string | null) => {
    const value = (status || "").toLowerCase();
    if (value.includes("fechado")) return "success" as const;
    if (value.includes("perdido")) return "danger" as const;
    if (value.includes("visita")) return "warning" as const;
    return "info" as const;
};

const getTimelineColor = (entry: LeadTimelineEntry): string => {
    if (entry.type === "status") return "#2563eb";
    if (entry.type === "ligacao") return "#16a34a";
    if (entry.type === "upload") return "#f59e0b";
    if (entry.type === "nota") return "#475569";
    return "#64748b";
};

const getTimelineTypeLabel = (entry: LeadTimelineEntry): string => {
    if (entry.type === "status") return "Status";
    if (entry.type === "ligacao") return "Ligacao";
    if (entry.type === "upload") return "Upload";
    if (entry.type === "nota") return "Nota";
    return "Atividade";
};

export const LeadDetails = ({
    record,
    isLoading = false,
    currentUserLabel,
    onScheduleVisit,
}: LeadDetailsProps) => {
    const { isSystemAdmin, role, tenantId } = useTenant();
    const [temperatureTag, setTemperatureTag] = useState<LeadTemperatureTag | undefined>(undefined);
    const [timeline, setTimeline] = useState<LeadTimelineEntry[]>([]);
    const [isLoadingTimeline, setIsLoadingTimeline] = useState(false);
    const [files, setFiles] = useState<LeadStoredFile[]>([]);
    const [isLoadingFiles, setIsLoadingFiles] = useState(false);
    const [activityType, setActivityType] = useState<"nota" | "ligacao">("nota");
    const [activityText, setActivityText] = useState("");
    const [isSavingActivity, setIsSavingActivity] = useState(false);
    const [uploadingKind, setUploadingKind] = useState<"proposta" | "conta_luz" | null>(null);
    const [uploadStatusByKind, setUploadStatusByKind] = useState<
        Partial<Record<"proposta" | "conta_luz", "enviando" | "processando" | "concluido">>
    >({});
    const propostaInputRef = useRef<HTMLInputElement | null>(null);
    const contaInputRef = useRef<HTMLInputElement | null>(null);

    const { query: stagesQuery } = useList({
        resource: "pipeline_stages",
        pagination: { mode: "off" },
        sorters: [{ field: "ordem", order: "asc" }],
    });
    const stagesData = (stagesQuery?.data?.data as any[]) || [];
    const leadStages = useMemo(() => buildLeadStages(stagesData), [stagesData]);
    const currentStage = findLeadStageById(leadStages, record?.stage_id);
    const stageDisplayName = currentStage?.nome || record?.status || "Sem etapa";

    const automaticTemperature = resolveAutomaticLeadTemperature(stageDisplayName);
    const isAutomaticTemperature = isAutomaticLeadTemperature(temperatureTag);
    const canDeleteDocuments = canDelete(role, isSystemAdmin);
    const { isEnergiaSolar } = useTenantSegmento();

    useEffect(() => {
        setTemperatureTag(resolveLeadTemperature(record));
    }, [record]);

    const loadTimeline = useCallback(async () => {
        if (!record?.id) {
            setTimeline([]);
            return;
        }

        setIsLoadingTimeline(true);
        try {
            const entries = await fetchLeadTimeline(record.id);
            setTimeline(entries);
        } catch (error: any) {
            setTimeline([]);
            message.error(error?.message || "Nao foi possivel carregar o historico do lead.");
        } finally {
            setIsLoadingTimeline(false);
        }
    }, [record?.id]);

    const loadFiles = useCallback(async () => {
        if (!record?.id) {
            setFiles([]);
            return;
        }

        setIsLoadingFiles(true);
        try {
            const storedFiles = await listLeadFiles(record.id);
            setFiles(
                storedFiles.map((file) => ({
                    ...file,
                    canDelete: canDeleteDocuments,
                })),
            );
        } catch (error: any) {
            setFiles([]);
            message.warning(error?.message || "Nao foi possivel listar arquivos anexados.");
        } finally {
            setIsLoadingFiles(false);
        }
    }, [canDeleteDocuments, record?.id]);

    useEffect(() => {
        loadTimeline();
        loadFiles();
    }, [loadFiles, loadTimeline]);

    const timelineItems = useMemo(() => {
        return timeline.map((entry) => ({
            color: getTimelineColor(entry),
            children: (
                <div>
                    <Space size={8} wrap>
                        <Text strong>{entry.title}</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                            {getTimelineTypeLabel(entry)}
                        </Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                            {entry.createdAt ? formatDateBR(entry.createdAt, "-") : "-"}
                        </Text>
                    </Space>
                    {entry.description ? (
                        <Typography.Paragraph style={{ margin: "6px 0 0 0" }}>
                            {entry.description}
                        </Typography.Paragraph>
                    ) : null}
                    {entry.fileUrl ? (
                        <a href={entry.fileUrl} target="_blank" rel="noreferrer">
                            <LinkOutlined /> Abrir arquivo
                        </a>
                    ) : entry.filePath ? (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                            Arquivo: {entry.filePath}
                        </Text>
                    ) : null}
                    {entry.author ? (
                        <Text type="secondary" style={{ display: "block", fontSize: 12 }}>
                            Por: {entry.author}
                        </Text>
                    ) : null}
                </div>
            ),
        }));
    }, [timeline]);

    const handleTemperatureChange = async (value?: LeadTemperature) => {
        if (automaticTemperature) {
            return;
        }

        setTemperatureTag(value);
        if (record?.id) {
            try {
                await updateLeadTemperature(record.id, value);
            } catch {
                message.error("Falha ao salvar temperatura do lead.");
            }
        }
    };

    const handleAddActivity = async () => {
        if (!record?.id) {
            return;
        }

        if (!activityText.trim()) {
            message.warning("Descreva a atividade antes de salvar.");
            return;
        }

        setIsSavingActivity(true);
        try {
            const persisted = await addLeadActivity({
                leadId: record.id,
                tenantId,
                activityType: activityType,
                title: activityType === "ligacao" ? "Ligacao com lead" : "Nota manual",
                description: activityText.trim(),
                author: currentUserLabel,
            });

            if (!persisted) {
                message.warning(
                    "Atividade salva apenas localmente: tabela atividades_lead nao encontrada.",
                );
            } else {
                message.success("Atividade registrada no historico.");
            }

            setActivityText("");
            await loadTimeline();
        } catch (error: any) {
            message.error(error?.message || "Nao foi possivel salvar a atividade.");
        } finally {
            setIsSavingActivity(false);
        }
    };

    const handleOpenMap = () => {
        const endereco = `${record?.endereco_instalacao || ""}, ${record?.numero || ""} - ${
            record?.cep || ""
        }`;
        const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(endereco)}`;
        window.open(url, "_blank", "noopener,noreferrer");
    };

    const handleFileSelect = async (
        event: React.ChangeEvent<HTMLInputElement>,
        kind: "proposta" | "conta_luz",
    ) => {
        const file = event.target.files?.[0];
        event.currentTarget.value = "";

        if (!file || !record?.id) {
            return;
        }

        const isPdf =
            file.type === "application/pdf" || file.name.toLowerCase().trim().endsWith(".pdf");
        if (!isPdf) {
            message.warning("Envie apenas arquivos PDF.");
            return;
        }

        if (file.size > MAX_PDF_FILE_SIZE_BYTES) {
            message.warning(
                `Arquivo acima do limite (${Math.floor(MAX_PDF_FILE_SIZE_BYTES / (1024 * 1024))}MB).`,
            );
            return;
        }

        setUploadingKind(kind);
        setUploadStatusByKind((previous) => ({
            ...previous,
            [kind]: "enviando",
        }));
        try {
            await uploadLeadPdf({
                leadId: record.id,
                file,
                kind,
                tenantId,
                author: currentUserLabel,
                onStatusChange: (status) => {
                    setUploadStatusByKind((previous) => ({
                        ...previous,
                        [kind]: status,
                    }));
                },
            });
            message.success("Arquivo enviado com sucesso.");
            await Promise.all([loadFiles(), loadTimeline()]);
        } catch (error: any) {
            message.error(
                error?.message ||
                    "Falha no upload. Verifique se o bucket `lead-files` existe no Supabase Storage.",
            );
        } finally {
            setUploadingKind(null);
            setTimeout(() => {
                setUploadStatusByKind((previous) => {
                    const next = { ...previous };
                    delete next[kind];
                    return next;
                });
            }, 1200);
        }
    };

    const handleDeleteFile = async (file: LeadStoredFile) => {
        if (!canDeleteDocuments) {
            message.warning("Apenas admin pode excluir documentos.");
            return;
        }

        try {
            await softDeleteLeadDocument({
                documentId: file.id,
                storagePath: file.caminhoStorage,
                tenantId,
            });
            message.success("Documento excluido com sucesso.");
            await Promise.all([loadFiles(), loadTimeline()]);
        } catch (error: any) {
            message.error(error?.message || "Nao foi possivel excluir o documento.");
        }
    };

    if (isLoading) {
        return <Skeleton active />;
    }

    if (!record) {
        return <Alert type="info" message="Nenhum lead selecionado." showIcon />;
    }

    const hasLeadId = record.id !== undefined && record.id !== null;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                }}
            >
                <Space wrap>
                    <Badge tone={getStatusTone(stageDisplayName)}>{stageDisplayName}</Badge>
                    <TemperatureBadge value={temperatureTag} />
                    <Select
                        size="small"
                        style={{ width: 200 }}
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

                {onScheduleVisit ? (
                    <Button
                        type="primary"
                        icon={<CalendarOutlined />}
                        disabled={!hasLeadId}
                        onClick={() => {
                            if (!hasLeadId) {
                                return;
                            }

                            onScheduleVisit({
                                clienteId: record.id as string | number,
                                clienteNome: record.nome || "Cliente",
                                clienteEndereco: record.endereco_instalacao || "",
                            });
                        }}
                        size="large"
                        style={{
                            backgroundColor: "#16a34a",
                            borderColor: "#16a34a",
                            fontWeight: 700,
                        }}
                    >
                        Agendar visita
                    </Button>
                ) : null}
            </div>

            <Card>
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
                            {record.nome}
                        </Title>
                        <Space wrap style={{ marginTop: 6 }}>
                            <Text type="secondary" style={{ fontSize: 15 }}>
                                <PhoneOutlined /> {record.ddi} {record.telefone}
                            </Text>
                            {record.responsavel ? (
                                <Badge tone="info">
                                    <UserOutlined /> {record.responsavel}
                                </Badge>
                            ) : null}
                        </Space>
                    </div>

                    <div style={{ textAlign: "right" }}>
                        <Text type="secondary">Conta media</Text>
                        <div style={{ fontSize: 28, fontWeight: 700, color: "#15803d" }}>
                            {formatCurrencyBRL(record.conta_energia_media, "R$ 0,00")}
                        </div>
                    </div>
                </div>

                <Divider />

                <div
                    style={{
                        background: "#f5f7fa",
                        padding: 16,
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
                                <EnvironmentOutlined /> Local da instalacao
                            </Title>
                            <Text style={{ fontSize: 15 }}>
                                {record.endereco_instalacao}, {record.numero}{" "}
                                {record.complemento ? `- ${record.complemento}` : ""}
                            </Text>
                            <br />
                            <Text type="secondary">CEP: {record.cep || "-"}</Text>
                        </div>
                        <Button type="default" icon={<GoogleOutlined />} onClick={handleOpenMap}>
                            Ver no mapa
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
                        <Text strong>{record.email || "-"}</Text>
                    </div>
                    <div>
                        <Text type="secondary">CPF/CNPJ</Text>
                        <br />
                        <Text strong>{record.cpf_cnpj || "-"}</Text>
                    </div>
                    <div>
                        <Text type="secondary">Cadastro</Text>
                        <br />
                        <DateField value={record.created_at} format="DD/MM/YYYY" />
                    </div>
                </div>
            </Card>

            <Card title={isEnergiaSolar ? "Arquivos do lead (PDF)" : "Documentos do lead (PDF)"}>
                <input
                    ref={propostaInputRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    style={{ display: "none" }}
                    onChange={(event) => handleFileSelect(event, "proposta")}
                />
                <input
                    ref={contaInputRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    style={{ display: "none" }}
                    onChange={(event) => handleFileSelect(event, "conta_luz")}
                />

                <Space wrap style={{ marginBottom: 12 }}>
                    <Button
                        icon={<UploadOutlined />}
                        loading={uploadingKind === "proposta"}
                        onClick={() => propostaInputRef.current?.click()}
                    >
                        Upload proposta
                    </Button>
                   {isEnergiaSolar && (
    <Button
        icon={<UploadOutlined />}
        loading={uploadingKind === "conta_luz"}
        onClick={() => contaInputRef.current?.click()}
    >
        Upload conta de luz
    </Button>
)}
                </Space>
                {uploadStatusByKind.proposta ? (
                    <Text type="secondary" style={{ display: "block" }}>
                        Proposta: {uploadStatusByKind.proposta}...
                    </Text>
                ) : null}
                {uploadStatusByKind.conta_luz ? (
                    <Text type="secondary" style={{ display: "block" }}>
                        Conta de luz: {uploadStatusByKind.conta_luz}...
                    </Text>
                ) : null}

                {isLoadingFiles ? (
                    <Skeleton active paragraph={{ rows: 2 }} />
                ) : files.length === 0 ? (
                    <Text type="secondary">Nenhum arquivo anexado.</Text>
                ) : (
                    <List
                        size="small"
                        dataSource={files}
                        rowKey={(item) => item.id}
                        renderItem={(item) => (
                            <List.Item
                                actions={
                                    item.url
                                        ? [
                                              <a
                                                  key={`open-${item.id}`}
                                                  href={item.url}
                                                  target="_blank"
                                                  rel="noreferrer"
                                              >
                                                  Abrir
                                              </a>,
                                              ...(item.canDelete
                                                  ? [
                                                        <Button
                                                            key={`delete-${item.id}`}
                                                            type="link"
                                                            danger
                                                            size="small"
                                                            onClick={() => handleDeleteFile(item)}
                                                        >
                                                            Excluir
                                                        </Button>,
                                                    ]
                                                  : []),
                                          ]
                                        : item.canDelete
                                          ? [
                                                <Button
                                                    key={`delete-${item.id}`}
                                                    type="link"
                                                    danger
                                                    size="small"
                                                    onClick={() => handleDeleteFile(item)}
                                                >
                                                    Excluir
                                                </Button>,
                                            ]
                                          : []
                                }
                            >
                                <List.Item.Meta
                                    avatar={<FilePdfOutlined style={{ color: "#dc2626" }} />}
                                    title={`${item.nomeArquivo} (v${item.versao})`}
                                    description={
                                        <Space direction="vertical" size={0}>
                                            <Text type="secondary">
                                                Tipo: {item.tipo} | Status: {item.status}
                                            </Text>
                                            <Text type="secondary">
                                                Tamanho: {Math.max(1, Math.round(item.tamanhoBytes / 1024))} KB
                                            </Text>
                                            <Text type="secondary">
                                                Enviado por: {item.enviadoPor || "-"} | Em:{" "}
                                                {item.createdAt ? formatDateBR(item.createdAt, "-") : "-"}
                                            </Text>
                                            <Text type="secondary">
                                                Storage: {item.caminhoStorage || "-"}
                                            </Text>
                                        </Space>
                                    }
                                />
                            </List.Item>
                        )}
                    />
                )}
            </Card>

            <Card title="Timeline / historico">
                <div style={{ marginBottom: 12 }}>
                    <Space.Compact block>
                        <Select
                            style={{ width: 160 }}
                            value={activityType}
                            onChange={(value) => setActivityType(value)}
                            options={[
                                { value: "nota", label: "Nota" },
                                { value: "ligacao", label: "Ligacao" },
                            ]}
                        />
                        <Input.TextArea
                            autoSize={{ minRows: 1, maxRows: 3 }}
                            value={activityText}
                            onChange={(event) => setActivityText(event.target.value)}
                            placeholder="Registrar contato, retorno ou observacao do lead"
                        />
                    </Space.Compact>
                    <div style={{ marginTop: 8 }}>
                        <Button
                            type="primary"
                            icon={<PlusOutlined />}
                            loading={isSavingActivity}
                            onClick={handleAddActivity}
                        >
                            Registrar no historico
                        </Button>
                    </div>
                </div>

                {isLoadingTimeline ? (
                    <Skeleton active />
                ) : timelineItems.length === 0 ? (
                    <Empty description="Sem historico registrado para este lead." />
                ) : (
                    <Timeline items={timelineItems} />
                )}
                <Text type="secondary" style={{ fontSize: 12 }}>
                    <ClockCircleOutlined /> Atualizado em tempo real conforme mudancas de status e atividades.
                </Text>
            </Card>
        </div>
    );
};
