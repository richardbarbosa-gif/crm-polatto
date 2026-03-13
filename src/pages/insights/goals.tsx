import { FlagOutlined, PlusOutlined, TrophyOutlined, FireOutlined, FallOutlined, CrownOutlined } from "@ant-design/icons";
import {
    DatePicker,
    Form,
    InputNumber,
    Modal,
    Progress,
    Segmented,
    Skeleton,
    Space,
    Table,
    Typography,
    message,
    Divider,
    Tag,
    Tooltip
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, EmptyState, StatCard } from "../../components/ui";
import { formatCurrencyBRL } from "../../lib/formatters";
import { isSupabaseMissingRelation } from "../../lib/supabaseErrors";
import { supabaseClient } from "../../utility";
import { InsightsHeader, IntroCard, MissingSchemaAlert } from "./shared";
import { useTenant } from "../../contexts/tenant";

type GoalViewMode = "valor" | "quantidade";

type EmployeePerformanceRow = {
    employee_id: string;
    employee_name: string;
    role: string;
    targetValue: number;
    targetWins: number;
    actualValue: number;
    actualWins: number;
    valueProgress: number;
    winsProgress: number;
};

export const InsightsGoalsPage = () => {
    const { tenantId } = useTenant();
    const [form] = Form.useForm();
    const [monthRef, setMonthRef] = useState<Dayjs>(dayjs().startOf("month"));
    const [viewMode, setViewMode] = useState<GoalViewMode>("valor");
    
    const [performanceRows, setPerformanceRows] = useState<EmployeePerformanceRow[]>([]);
    const [isLoadingData, setIsLoadingData] = useState<boolean>(true);
    const [schemaMissing, setSchemaMissing] = useState<boolean>(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    
    const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
    const [isSaving, setIsSaving] = useState<boolean>(false);

    // Cálculos de Tempo (Ritmo/Pace)
    const metricasTempo = useMemo(() => {
        const hoje = dayjs();
        const isMesAtual = monthRef.isSame(hoje, 'month');
        const totalDias = monthRef.daysInMonth();
        const diasCorridos = isMesAtual ? hoje.date() : totalDias;
        
        return { totalDias, diasCorridos, isMesAtual };
    }, [monthRef]);

    const loadData = useCallback(async () => {
        setIsLoadingData(true);
        setErrorMessage(null);
        try {
            const monthStart = monthRef.startOf("month").format("YYYY-MM-DD");

            // 1. Busca equipa ativa
            const { data: employeesData, error: empError } = await supabaseClient
                .from("funcionarios")
                .select("id, nome, cargo, ativo")
                .eq("ativo", true)
                .order("nome", { ascending: true });

            if (empError) throw empError;

            // 2. Busca Metas do mês
            const { data: metasData, error: metasError } = await supabaseClient
                .from("metas")
                .select("*")
                .eq("mes_referencia", monthStart);

            if (metasError && !isSupabaseMissingRelation(metasError)) throw metasError;

            // 3. Busca Performance Real (da View SQL que criámos!)
            const { data: perfData, error: perfError } = await supabaseClient
                .from("vw_performance_vendedores")
                .select("*")
                .eq("mes_referencia", monthStart);

            if (perfError && !isSupabaseMissingRelation(perfError)) throw perfError;

            const metasMap = new Map((metasData || []).map(m => [m.funcionario_id, m]));
            const perfMap = new Map((perfData || []).map(p => [p.funcionario_id, p]));

            const rows: EmployeePerformanceRow[] = (employeesData || []).map(emp => {
                const meta = metasMap.get(emp.id);
                const perf = perfMap.get(emp.id);

                const targetValue = Number(meta?.valor_meta || 0);
                const targetWins = Number(meta?.target_wins || 0);
                const actualValue = Number(perf?.vendas_valor || 0);
                const actualWins = Number(perf?.vendas_qtd || 0);

                return {
                    employee_id: emp.id,
                    employee_name: emp.nome || "Sem nome",
                    role: emp.cargo || "Consultor",
                    targetValue,
                    targetWins,
                    actualValue,
                    actualWins,
                    valueProgress: targetValue > 0 ? (actualValue / targetValue) * 100 : 0,
                    winsProgress: targetWins > 0 ? (actualWins / targetWins) * 100 : 0,
                };
            });

            // Ordena o Leaderboard (quem vendeu mais primeiro)
            rows.sort((a, b) => b.actualValue - a.actualValue);

            setPerformanceRows(rows);
            setSchemaMissing(false);
        } catch (error: any) {
            if (isSupabaseMissingRelation(error)) {
                setSchemaMissing(true);
                setPerformanceRows([]);
            } else {
                setErrorMessage(error?.message || "Falha ao carregar o motor de metas.");
            }
        } finally {
            setIsLoadingData(false);
        }
    }, [monthRef]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const summary = useMemo(() => {
        const totalTargetValue = performanceRows.reduce((acc, row) => acc + row.targetValue, 0);
        const totalActualValue = performanceRows.reduce((acc, row) => acc + row.actualValue, 0);
        const totalTargetWins = performanceRows.reduce((acc, row) => acc + row.targetWins, 0);
        const totalActualWins = performanceRows.reduce((acc, row) => acc + row.actualWins, 0);
        
        const valueProgress = totalTargetValue > 0 ? (totalActualValue / totalTargetValue) * 100 : 0;
        const winsProgress = totalTargetWins > 0 ? (totalActualWins / totalTargetWins) * 100 : 0;

        return {
            totalTargetValue, totalActualValue, totalTargetWins, totalActualWins, valueProgress, winsProgress,
        };
    }, [performanceRows]);

    const openBatchModal = () => {
        const formData = performanceRows.map(row => ({
            employee_id: row.employee_id,
            employee_name: row.employee_name,
            target_value: row.targetValue,
            target_wins: row.targetWins,
        }));
        form.setFieldsValue({ goals: formData });
        setIsModalOpen(true);
    };

    const handleSaveBatch = async () => {
        try {
            setIsSaving(true);
            const values = await form.validateFields();
            const monthStart = monthRef.startOf("month").format("YYYY-MM-DD");

            const payload = values.goals.map((g: any) => ({
                tenant_id: tenantId || undefined,
                funcionario_id: g.employee_id,
                mes_referencia: monthStart,
                valor_meta: g.target_value,
                target_wins: g.target_wins
            }));

            const { error } = await supabaseClient
                .from("metas")
                .upsert(payload, { onConflict: "tenant_id,funcionario_id,mes_referencia" });
            
            if (error) throw error;

            message.success(`Metas de ${monthRef.format("MMMM")} salvas com sucesso.`);
            setIsModalOpen(false);
            await loadData();
        } catch (error: any) {
            if (error?.errorFields) return;
            message.error(error?.message || "Não foi possível salvar as metas.");
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoadingData) {
        return <div style={{ padding: 40 }}><Skeleton active paragraph={{ rows: 6 }} /></div>;
    }

    return (
        <div style={{ padding: 20 }}>
            <InsightsHeader
                title="Dashboard de Quota"
                subtitle={`Motor de performance em tempo real. Mês: ${monthRef.format("MM/YYYY")}`}
                extra={
                    <Space wrap>
                        <DatePicker picker="month" value={monthRef} onChange={(val) => setMonthRef(val || dayjs())} allowClear={false} />
                        <Segmented<GoalViewMode> options={[{ label: "Receita (R$)", value: "valor" }, { label: "Volume (Qtd)", value: "quantidade" }]} value={viewMode} onChange={setViewMode} />
                        <Button type="primary" icon={<PlusOutlined />} onClick={openBatchModal}>Definir Metas</Button>
                    </Space>
                }
            />

            <IntroCard
                title="Leaderboard & Pace"
                description="Acompanhe quem está no ritmo para bater a meta e veja o ranking da equipa atualizado a cada negócio fechado."
            />

            {schemaMissing && <MissingSchemaAlert description="Estrutura de metas não encontrada no banco." />}
            {errorMessage && <MissingSchemaAlert title="Erro" description={errorMessage} />}

            {/* KPIs GLOBAIS */}
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginBottom: 20 }}>
                <StatCard
                    title={viewMode === "valor" ? "Quota Global (R$)" : "Meta Global (Qtd)"}
                    value={viewMode === "valor" ? summary.totalTargetValue : summary.totalTargetWins}
                    prefix={<FlagOutlined style={{ color: "#2563eb" }} />}
                    accentColor="#2563eb"
                    subtitle={viewMode === "valor" ? formatCurrencyBRL(summary.totalTargetValue, "R$ 0,00") : `${summary.totalTargetWins} negócios`}
                />
                <StatCard
                    title="Realizado Global"
                    value={viewMode === "valor" ? summary.totalActualValue : summary.totalActualWins}
                    prefix={<TrophyOutlined style={{ color: "#10b981" }} />}
                    accentColor="#10b981"
                    subtitle={viewMode === "valor" ? formatCurrencyBRL(summary.totalActualValue, "R$ 0,00") : `${summary.totalActualWins} negócios`}
                />
                <StatCard
                    title="Atingimento da Empresa"
                    value={Number((viewMode === "valor" ? summary.valueProgress : summary.winsProgress).toFixed(1))}
                    suffix="%"
                    accentColor="#0f766e"
                    valueStyle={{ color: "#115e59" }}
                />
            </div>

            {/* LEADERBOARD */}
            <Card title={`Ranking da Equipa - ${monthRef.format("MMMM/YYYY")}`}>
                {performanceRows.length === 0 ? (
                    <EmptyState title="Sem equipa" description="Cadastre utilizadores para medir performance." />
                ) : (
                    <Table
                        size="middle"
                        rowKey="employee_id"
                        pagination={false}
                        dataSource={performanceRows}
                        columns={[
                            {
                                title: "Posição",
                                width: 80,
                                align: 'center',
                                render: (_, __, index) => (
                                    index === 0 ? <CrownOutlined style={{ color: '#eab308', fontSize: 24 }} /> : 
                                    index === 1 ? <CrownOutlined style={{ color: '#94a3b8', fontSize: 20 }} /> :
                                    index === 2 ? <CrownOutlined style={{ color: '#b45309', fontSize: 20 }} /> :
                                    <Typography.Text type="secondary">{index + 1}º</Typography.Text>
                                ),
                            },
                            {
                                title: "Consultor",
                                render: (_, record) => (
                                    <Space direction="vertical" size={0}>
                                        <Typography.Text strong style={{ fontSize: 15 }}>{record.employee_name}</Typography.Text>
                                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{record.role}</Typography.Text>
                                    </Space>
                                ),
                            },
                            {
                                title: viewMode === "valor" ? "Realizado (R$)" : "Realizado (Qtd)",
                                align: 'right',
                                render: (_, record) => (
                                    <Typography.Text strong style={{ fontSize: 15, color: '#0f172a' }}>
                                        {viewMode === "valor" ? formatCurrencyBRL(record.actualValue, "R$ 0,00") : record.actualWins}
                                    </Typography.Text>
                                ),
                            },
                            {
                                title: viewMode === "valor" ? "Quota (R$)" : "Meta (Qtd)",
                                align: 'right',
                                render: (_, record) => (
                                    <Typography.Text type="secondary">
                                        {viewMode === "valor" ? formatCurrencyBRL(record.targetValue, "R$ 0,00") : record.targetWins}
                                    </Typography.Text>
                                ),
                            },
                            {
                                title: "Performance & Ritmo",
                                width: 300,
                                render: (_, record) => {
                                    const meta = viewMode === "valor" ? record.targetValue : record.targetWins;
                                    const realizado = viewMode === "valor" ? record.actualValue : record.actualWins;
                                    const progresso = viewMode === "valor" ? record.valueProgress : record.winsProgress;
                                    
                                    if (meta === 0) return <Tag>Meta não definida</Tag>;

                                    const bateuMeta = realizado >= meta;
                                    
                                    // Cálculo de Pace
                                    const projecaoFinal = metricasTempo.diasCorridos > 0 
                                        ? (realizado / metricasTempo.diasCorridos) * metricasTempo.totalDias 
                                        : 0;
                                    const noRitmo = projecaoFinal >= meta;

                                    return (
                                        <div style={{ paddingRight: 16 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                                <Typography.Text strong style={{ color: bateuMeta ? '#10b981' : '#3b82f6' }}>
                                                    {progresso.toFixed(1)}%
                                                </Typography.Text>
                                                {metricasTempo.isMesAtual && !bateuMeta && (
                                                    <Tooltip title="Ritmo de vendas projetado para o fim do mês">
                                                        <Tag color={noRitmo ? "processing" : "warning"} bordered={false} style={{ margin: 0 }}>
                                                            {noRitmo ? <FireOutlined /> : <FallOutlined />} {noRitmo ? "No Ritmo" : "Atrasado"}
                                                        </Tag>
                                                    </Tooltip>
                                                )}
                                                {bateuMeta && <Tag color="success" bordered={false} style={{ margin: 0 }}><TrophyOutlined /> Bateu!</Tag>}
                                            </div>
                                            <Progress 
                                                percent={progresso} 
                                                showInfo={false} 
                                                size="small"
                                                status={bateuMeta ? "success" : "active"}
                                                strokeColor={bateuMeta ? "#10b981" : "#3b82f6"}
                                            />
                                        </div>
                                    );
                                },
                            }
                        ]}
                    />
                )}
            </Card>

            {/* MODAL DE DEFINIÇÃO DE METAS EM LOTE */}
           {/* MODAL DE DEFINIÇÃO DE METAS EM LOTE */}
            <Modal
                title={`Definir Quotas: ${monthRef.format("MMMM/YYYY")}`}
                open={isModalOpen}
                width={700}
                onCancel={() => setIsModalOpen(false)}
                onOk={handleSaveBatch}
                okText="Salvar Quotas"
                confirmLoading={isSaving}
                destroyOnClose
            >
                <Form form={form} layout="vertical">
                    <Form.List name="goals">
                        {(fields) => (
                            <div style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: 10 }}>
                                {fields.map((field, index) => (
                                    <div key={field.key}>
                                        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end' }}>
                                            <Form.Item {...field} name={[field.name, 'employee_id']} hidden><InputNumber /></Form.Item>
                                            
                                            <Form.Item label={index === 0 ? "Consultor" : ""} {...field} name={[field.name, 'employee_name']} style={{ flex: 2, marginBottom: 12 }}>
                                                <Typography.Text strong>{form.getFieldValue(['goals', field.name, 'employee_name'])}</Typography.Text>
                                            </Form.Item>
                                            
                                            <Form.Item label={index === 0 ? "Quota de Receita (R$)" : ""} {...field} name={[field.name, 'target_value']} style={{ flex: 1.5, marginBottom: 12 }}>
                                                {/* Correção AQUI: min={0 as number} */}
                                                <InputNumber style={{ width: '100%' }} min={0 as number} formatter={(v) => `R$ ${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.')} parser={(v) => v ? Number(v.replace(/[^0-9.-]+/g, "")) : (0 as any)} />
                                            </Form.Item>
                                            
                                            <Form.Item label={index === 0 ? "Volume (Qtd)" : ""} {...field} name={[field.name, 'target_wins']} style={{ flex: 1, marginBottom: 12 }}>
                                                {/* Correção AQUI: min={0 as number} */}
                                                <InputNumber style={{ width: '100%' }} min={0 as number} />
                                            </Form.Item>
                                        </div>
                                        {index < fields.length - 1 && <Divider style={{ margin: '8px 0' }} />}
                                    </div>
                                ))}
                            </div>
                        )}
                    </Form.List>
                </Form>
            </Modal>
        </div>
    );
};