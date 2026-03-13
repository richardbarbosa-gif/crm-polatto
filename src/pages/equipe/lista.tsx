import { useTable, EditButton } from "@refinedev/antd";
import { Table, Typography, Tag, Button, Card, Space, Progress, Tooltip } from "antd";
import { PlusOutlined, TeamOutlined, ClockCircleOutlined, FireOutlined, FallOutlined } from "@ant-design/icons";
import { useEffect, useState, useMemo } from "react";
import { supabaseClient } from "../../utility";

const { Title, Text } = Typography;

export const EquipeList = () => {
    const { tableProps } = useTable({
        resource: "funcionarios",
        syncWithLocation: false,
    });

    const [performance, setPerformance] = useState<Record<string, any>>({});

    // Cálculos de Tempo (Inteligência do Mês)
    const metricasTempo = useMemo(() => {
        const hoje = new Date();
        const ultimoDiaMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
        const totalDias = ultimoDiaMes.getDate();
        const diasCorridos = hoje.getDate();
        const diasRestantes = totalDias - diasCorridos;
        
        return { totalDias, diasCorridos, diasRestantes };
    }, []);

    useEffect(() => {
        const fetchPerformanceAndGoals = async () => {
            const mesAtual = new Date();
            mesAtual.setDate(1); 
            const mesFormatado = mesAtual.toISOString().split('T')[0];

            const { data: perfData } = await supabaseClient
                .from("vw_performance_vendedores")
                .select("*")
                .gte("mes_referencia", mesFormatado);

            const { data: metasData } = await supabaseClient
                .from("metas")
                .select("*")
                .gte("mes_referencia", mesFormatado);

            const map: Record<string, any> = {};
            
            if (perfData) {
                perfData.forEach((row: any) => {
                    map[row.funcionario_id] = { ...map[row.funcionario_id], vendas_valor: row.vendas_valor, vendas_qtd: row.vendas_qtd };
                });
            }
            
            if (metasData) {
                metasData.forEach((row: any) => {
                    map[row.funcionario_id] = { ...map[row.funcionario_id], valor_meta: row.valor_meta, target_wins: row.target_wins };
                });
            }
            
            setPerformance(map);
        };

        fetchPerformanceAndGoals();
    }, []);

    return (
        <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                    <Title level={2} style={{ margin: 0, color: '#1e293b' }}>
                        <TeamOutlined style={{ marginRight: '10px', color: '#4c8bf5' }} />
                        Equipe e Performance
                    </Title>
                    <Text type="secondary" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                        <ClockCircleOutlined /> 
                        Faltam <strong style={{ color: '#1e293b' }}>{metricasTempo.diasRestantes} dias</strong> para o fechamento do mês.
                    </Text>
                </div>
                <Button type="primary" icon={<PlusOutlined />} style={{ backgroundColor: '#4c8bf5', borderRadius: '8px', height: 40 }}>
                    Novo Membro
                </Button>
            </div>

            <Card bordered={false} style={{ borderRadius: "12px", boxShadow: "0 4px 12px rgba(0,0,0,0.03)" }}>
                <Table {...tableProps} rowKey="id" pagination={{ pageSize: 10 }}>
                    <Table.Column 
                        dataIndex="nome" 
                        title="Consultor" 
                        render={(val, record: any) => (
                            <div>
                                <Text strong style={{ fontSize: 15, color: '#0f172a' }}>{val}</Text>
                                <br/>
                                <Text type="secondary" style={{ fontSize: 12 }}>{record.cargo || 'Sem cargo'}</Text>
                            </div>
                        )} 
                    />
                    
                    {/* COLUNA DE PERFORMANCE PROFISSIONAL */}
                    <Table.Column 
                        title="Motor de Metas (Mês Atual)" 
                        render={(_, record: any) => {
                            const perf = performance[record.id] || {};
                            const realizado = Number(perf.vendas_valor) || 0;
                            const meta = Number(perf.valor_meta) || 0;
                            
                            if (meta === 0) {
                                return <Tag color="default" style={{ borderRadius: 6 }}>Meta não configurada</Tag>;
                            }

                            const porcentagem = Math.min(Math.round((realizado / meta) * 100), 100);
                            const bateuMeta = realizado >= meta;
                            const faltaValor = Math.max(meta - realizado, 0);
                            
                            // Cálculo de Ritmo (Pace)
                            const projecaoFinalMes = (realizado / metricasTempo.diasCorridos) * metricasTempo.totalDias;
                            const noRitmo = projecaoFinalMes >= meta;

                            return (
                                <div style={{ minWidth: 260 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 4 }}>
                                        <div>
                                            <Text style={{ fontSize: 16, fontWeight: 700, color: bateuMeta ? '#10b981' : '#0f172a' }}>
                                                {realizado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                            </Text>
                                            <Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>
                                                / {meta.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                            </Text>
                                        </div>
                                        <Text strong style={{ color: bateuMeta ? '#10b981' : '#3b82f6' }}>{porcentagem}%</Text>
                                    </div>
                                    
                                    <Progress 
                                        percent={porcentagem} 
                                        showInfo={false}
                                        size="small" 
                                        status={bateuMeta ? "success" : "active"}
                                        strokeColor={bateuMeta ? "#10b981" : "#3b82f6"}
                                        style={{ marginBottom: 4 }}
                                    />
                                    
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 12 }}>
                                        {bateuMeta ? (
                                            <Tag color="success" bordered={false} icon={<FireOutlined />}>Meta Batida!</Tag>
                                        ) : (
                                            <Space>
                                                <Tooltip title={`Projeção: se continuar assim, vai fechar o mês com ${projecaoFinalMes.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`}>
                                                    <Tag 
                                                        color={noRitmo ? "processing" : "warning"} 
                                                        bordered={false} 
                                                        icon={noRitmo ? <FireOutlined /> : <FallOutlined />}
                                                    >
                                                        {noRitmo ? "No Ritmo" : "Abaixo do Ritmo"}
                                                    </Tag>
                                                </Tooltip>
                                            </Space>
                                        )}
                                        
                                        {!bateuMeta && (
                                            <Text type="secondary" style={{ fontSize: 11 }}>
                                                Falta <strong>{faltaValor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong>
                                            </Text>
                                        )}
                                    </div>
                                </div>
                            );
                        }} 
                    />

                    <Table.Column
                        dataIndex="ativo"
                        title="Status"
                        render={(value) => (
                            <Tag color={value ? "green" : "red"} bordered={false} style={{ borderRadius: 6 }}>
                                {value ? "Ativo" : "Inativo"}
                            </Tag>
                        )}
                    />

                    <Table.Column
                        title=""
                        dataIndex="id"
                        align="right"
                        render={(_, record: any) => (
                            <EditButton hideText size="small" recordItemId={record.id} style={{ borderRadius: 6 }} />
                        )}
                    />
                </Table>
            </Card>
        </div>
    );
};