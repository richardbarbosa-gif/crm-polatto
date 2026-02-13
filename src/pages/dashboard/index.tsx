import { useList } from "@refinedev/core";
import { Card, Col, Row, Statistic, Typography, Skeleton, Progress, Space } from "antd";
import { 
  DollarCircleOutlined, 
  ShoppingCartOutlined, 
  UsergroupAddOutlined, 
  RiseOutlined,
  CheckCircleOutlined
} from "@ant-design/icons";

const { Title, Text } = Typography;

// PROTEÇÃO DE TIPOS
interface ICliente {
    id: number;
    nome: string;
    status: string;
    conta_energia_media: number | string; 
    created_at: string;
}

export const DashboardPage = () => {
  // --- CORREÇÃO AQUI (O PULO DO GATO) ---
  // Usamos 'any' aqui para o TypeScript aceitar tanto a versão nova quanto a antiga do Refine
  // e extraímos a 'query' se ela existir, ou usamos o resultado direto.
  const listResult = useList<ICliente>({
    resource: "clientes",
    pagination: {
        mode: "off"
    }
  }) as any;

  // Se a versão do Refine retornar { query: ... }, usamos ela. Se não, usamos o resultado direto.
  const { data, isLoading } = listResult.query || listResult;

  const clientes = data?.data || [];

  // --- CÁLCULOS (IGUAIS AO ANTERIOR) ---
  const leadsAtivos = clientes.filter((c: ICliente) => c.status !== 'Perdido');
  const totalLeads = leadsAtivos.length;

  const vendasFechadas = clientes.filter((c: ICliente) => c.status === 'Fechado');
  const qtdVendas = vendasFechadas.length;

  const receitaPipeline = leadsAtivos.reduce((acc: number, curr: ICliente) => {
    const valorLimpo = String(curr.conta_energia_media).replace('R$', '').replace('.', '').replace(',', '.');
    const valorNumerico = parseFloat(valorLimpo) || 0;
    return acc + valorNumerico;
  }, 0);

  const conversao = totalLeads > 0 ? ((qtdVendas / totalLeads) * 100).toFixed(1) : "0.0";

  const porStatus = {
      novo: clientes.filter((c: ICliente) => c.status === 'Novo Lead').length,
      visita: clientes.filter((c: ICliente) => c.status === 'Visita Agendada').length,
      negociacao: clientes.filter((c: ICliente) => c.status === 'Em Negociação').length,
      fechado: qtdVendas
  };

  if (isLoading) return <Skeleton active />;

  return (
    <div style={{ padding: "20px" }}>
      <Title level={2} style={{ marginBottom: 30 }}>Visão Geral - Polatto Solar</Title>
      
      {/* BLOCO DE KPIs */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false} style={{ background: "linear-gradient(135deg, #001529 0%, #003a70 100%)", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
            <Statistic 
              title={<span style={{ color: "#bdc3c7" }}>Pipeline (Mensal)</span>}
              value={receitaPipeline} 
              precision={2} 
              valueStyle={{ color: "#FFD700", fontWeight: "bold", fontSize: "28px" }}
              prefix="R$"
            />
            <Text style={{ color: "#bdc3c7", fontSize: "12px" }}>Soma das contas em negociação</Text>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false}>
            <Statistic 
              title="Leads Ativos" 
              value={totalLeads} 
              prefix={<UsergroupAddOutlined />}
            />
            <Text type="secondary">Oportunidades em aberto</Text>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false}>
             <Statistic 
              title="Taxa de Conversão" 
              value={conversao} 
              precision={1} 
              valueStyle={{ color: Number(conversao) > 20 ? "#3f8600" : "#cf1322" }}
              prefix={<RiseOutlined />}
              suffix="%"
            />
            <Text type="secondary">Eficiência do time</Text>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false}>
            <Statistic 
              title="Vendas Realizadas" 
              value={qtdVendas} 
              prefix={<CheckCircleOutlined />}
            />
            <Text type="secondary">Vendas no mês</Text>
          </Card>
        </Col>
      </Row>

      {/* BLOCO DE FUNIL */}
      <Row gutter={[16, 16]} style={{ marginTop: "24px" }}>
        <Col xs={24} lg={16}>
            <Card title="📊 Saúde do Funil" bordered={false}>
                <div style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
                    <div>
                        <Text strong>🟦 Novos Leads ({porStatus.novo})</Text>
                        <Progress percent={(porStatus.novo / totalLeads) * 100} showInfo={false} strokeColor="#1890ff" />
                    </div>
                    <div>
                        <Text strong>🟨 Visita Agendada ({porStatus.visita})</Text>
                        <Progress percent={(porStatus.visita / totalLeads) * 100} showInfo={false} strokeColor="#faad14" />
                    </div>
                    <div>
                        <Text strong>🟧 Em Negociação ({porStatus.negociacao})</Text>
                        <Progress percent={(porStatus.negociacao / totalLeads) * 100} showInfo={false} strokeColor="#fa541c" />
                    </div>
                    <div>
                        <Text strong>✅ Fechados ({porStatus.fechado})</Text>
                        <Progress percent={100} success={{ percent: (porStatus.fechado / totalLeads) * 100 }} showInfo={false} />
                    </div>
                </div>
            </Card>
        </Col>

        <Col xs={24} lg={8}>
            <Card title="🚀 Destaques" bordered={false}>
               <Space direction="vertical" size="large" style={{ width: "100%" }}>
                    <div style={{ padding: "10px", background: "#f0f5ff", borderRadius: "8px" }}>
                        <Text strong>Meta do Mês</Text>
                        <Text style={{ display: 'block', marginBottom: 5 }}>Faltam {10 - qtdVendas} para a meta.</Text>
                        <Progress percent={(qtdVendas / 10) * 100} size="small" status="active" />
                    </div>
                    <div>
                        <Text type="secondary">Resumo Rápido:</Text>
                        <ul style={{ paddingLeft: 20, marginTop: 5, color: "#555" }}>
                            <li>Você tem <b>{porStatus.visita}</b> visitas para fazer.</li>
                            <li>Existem <b>{porStatus.negociacao}</b> propostas.</li>
                        </ul>
                    </div>
               </Space>
            </Card>
        </Col>
      </Row>
    </div>
  );
};