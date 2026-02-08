import React, { useState, useMemo } from "react";
import { useList, useUpdate } from "@refinedev/core";
import { EditButton, ShowButton, CreateButton } from "@refinedev/antd";
import { Typography, Card, Space, Spin, Input, Button, Tooltip, Table, Tag, Statistic, Row, Col, message } from "antd";
import { 
    SearchOutlined, 
    AppstoreOutlined, 
    BarsOutlined,
    PlusOutlined,
    ArrowUpOutlined,
    CheckCircleOutlined,
    DollarCircleOutlined
} from "@ant-design/icons";

const { Text, Title } = Typography;

const ESTAGIOS = ["Novo Lead", "Em Negociação", "Fechado", "Perdido"];

export const BlogPostList = () => {
  const [viewType, setViewType] = useState<"kanban" | "list">("kanban");
  const [searchText, setSearchText] = useState("");
  
  // ESTADO PARA O DRAG AND DROP NATIVO
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);

  // Hooks do Refine (Dados e Atualização)
  const { query } = useList({
    resource: "clientes",
    pagination: { mode: "off" },
  });

  const { mutate } = useUpdate();

  const isLoading = query?.isLoading;
  const rawData = query?.data?.data || [];

  // Filtro Inteligente
  const clientesFiltrados = useMemo(() => {
    return rawData.filter((cliente: any) => {
        if (!searchText) return true;
        const texto = searchText.toLowerCase();
        return (
            cliente.nome?.toLowerCase().includes(texto) ||
            cliente.telefone?.includes(texto) ||
            cliente.status?.toLowerCase().includes(texto)
        );
    });
  }, [rawData, searchText]);

  // Cálculo de KPIs
  const kpis = useMemo(() => {
    const totalLeads = clientesFiltrados.length;
    const totalValor = clientesFiltrados.reduce((acc: number, curr: any) => acc + Number(curr.conta_energia_media || 0), 0);
    const fechados = clientesFiltrados.filter((c: any) => c.status === "Fechado").length;
    const taxaConversao = totalLeads > 0 ? ((fechados / totalLeads) * 100).toFixed(1) : "0";
    return { totalLeads, totalValor, taxaConversao };
  }, [clientesFiltrados]);

  // --- LÓGICA DE DRAG AND DROP (NATIVA) ---
  
  // 1. Quando começa a arrastar
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, id: string) => {
    setDraggedItemId(id);
    e.dataTransfer.effectAllowed = "move";
    // Deixa o elemento meio transparente enquanto arrasta (Visual Opicional)
    e.currentTarget.style.opacity = "0.5";
    e.currentTarget.style.cursor = "grabbing";
  };

  // 2. Quando termina de arrastar (soltou ou cancelou)
  const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
    e.currentTarget.style.opacity = "1";
    e.currentTarget.style.cursor = "grab";
    setDraggedItemId(null);
  };

  // 3. Permitir soltar na coluna (Over)
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); // Necessário para permitir o "Drop"
    e.dataTransfer.dropEffect = "move";
  };

  // 4. A Mágica: Soltou na Coluna
  const handleDrop = (e: React.DragEvent<HTMLDivElement>, novoStatus: string) => {
    e.preventDefault();
    
    if (!draggedItemId) return;

    // Encontra o lead que estava sendo arrastado
    const leadArrastado = rawData.find((c: any) => c.id.toString() === draggedItemId);
    
    // Se soltou na mesma coluna, não faz nada
    if (leadArrastado?.status === novoStatus) return;

    // Atualiza no Supabase
    mutate({
        resource: "clientes",
        id: draggedItemId,
        values: { status: novoStatus },
        successNotification: () => ({
            message: `Movido para ${novoStatus}`,
            description: "Status atualizado com sucesso!",
            type: "success",
        }),
    });
  };

  if (isLoading) return <div style={{ display: "flex", justifyContent: "center", paddingTop: 50 }}><Spin size="large" tip="Carregando CRM..." /></div>;

  // Header Kommo
  const KommoHeader = () => (
    <div style={{ backgroundColor: "#fff", borderBottom: "1px solid #e0e0e0", paddingBottom: "10px" }}>
        <div style={{ padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", height: "60px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
                <Title level={4} style={{ margin: 0, color: "#153046", letterSpacing: "-0.5px" }}>LTD</Title>
                <div style={{ display: "flex", gap: "5px", borderLeft: "1px solid #eee", paddingLeft: "15px" }}>
                    <Tooltip title="Kanban">
                        <Button type="text" icon={<AppstoreOutlined />} style={{ color: viewType === "kanban" ? "#3182ce" : "#a0aec0", background: viewType === "kanban" ? "#ebf8ff" : "transparent" }} onClick={() => setViewType("kanban")} />
                    </Tooltip>
                    <Tooltip title="Lista">
                        <Button type="text" icon={<BarsOutlined />} style={{ color: viewType === "list" ? "#3182ce" : "#a0aec0", background: viewType === "list" ? "#ebf8ff" : "transparent" }} onClick={() => setViewType("list")} />
                    </Tooltip>
                </div>
            </div>
            <Input placeholder="Busca e filtro" prefix={<SearchOutlined style={{ color: "#a0aec0" }} />} value={searchText} onChange={(e) => setSearchText(e.target.value)} style={{ width: "250px", backgroundColor: "#f0f2f5", border: "none", borderRadius: "4px", height: "32px", fontSize: "13px" }} />
            <CreateButton type="primary" icon={<PlusOutlined />} style={{ backgroundColor: "#4c8bf5", fontWeight: 600, borderRadius: "4px", fontSize: "12px", textTransform: "uppercase" }}>Novo Lead</CreateButton>
        </div>
        <div style={{ padding: "0 20px", marginTop: "5px" }}>
            <Row gutter={16}>
                <Col span={8}><Card size="small" bordered={false} style={{ background: "linear-gradient(to right, #f6f8f9, #fff)", borderLeft: "4px solid #4c8bf5" }}><Statistic title="Previsão de Receita" value={kpis.totalValor} precision={2} prefix={<DollarCircleOutlined style={{color: "#4c8bf5"}} />} valueStyle={{ fontSize: "16px", fontWeight: "bold" }} /></Card></Col>
                <Col span={8}><Card size="small" bordered={false} style={{ background: "linear-gradient(to right, #f6f8f9, #fff)", borderLeft: "4px solid #38a169" }}><Statistic title="Conversão" value={kpis.taxaConversao} suffix="%" prefix={<CheckCircleOutlined style={{color: "#38a169"}} />} valueStyle={{ fontSize: "16px", fontWeight: "bold", color: "#38a169" }} /></Card></Col>
                <Col span={8}><Card size="small" bordered={false} style={{ background: "linear-gradient(to right, #f6f8f9, #fff)", borderLeft: "4px solid #ed8936" }}><Statistic title="Leads Ativos" value={kpis.totalLeads} prefix={<ArrowUpOutlined style={{color: "#ed8936"}} />} valueStyle={{ fontSize: "16px", fontWeight: "bold" }} /></Card></Col>
            </Row>
        </div>
    </div>
  );

  const KanbanView = () => (
    <div style={{ display: "flex", overflowX: "auto", height: "calc(100vh - 180px)", backgroundColor: "#fff", padding: "20px", gap: "10px" }}>
      {ESTAGIOS.map((estagio, index) => {
        const clientesDaColuna = clientesFiltrados.filter((c: any) => c.status === estagio);
        
        return (
          <div 
            key={estagio}
            // EVENTOS DE DROP NA COLUNA
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, estagio)}
            style={{ 
                minWidth: "300px", maxWidth: "300px", display: "flex", flexDirection: "column", 
                borderRight: "1px solid #f0f0f0", padding: "0 10px", transition: "background 0.2s" 
            }}
          >
            <div style={{ paddingBottom: "15px", paddingTop: "5px", textAlign: "center" }}>
                <Text strong style={{ textTransform: "uppercase", fontSize: "11px", color: "#6e7c87", display: "block", marginBottom: "4px" }}>{estagio}</Text>
                <div style={{ height: "3px", width: "100%", backgroundColor: index === 2 ? "#82cf6e" : "#eef2f4", marginTop: "5px", borderRadius: "2px" }}></div>
            </div>
            
            <div style={{ flex: 1, overflowY: "auto", minHeight: "200px" }}>
              {clientesDaColuna.map((cliente: any) => (
                <div
                    key={cliente.id}
                    // HABILITA O ARRASTAR NO CARD
                    draggable={true}
                    onDragStart={(e) => handleDragStart(e, cliente.id.toString())}
                    onDragEnd={handleDragEnd}
                    style={{ cursor: "grab" }} // AQUI ESTÁ A MÃOZINHA DO KOMMO
                >
                    <Card 
                      size="small" hoverable
                      style={{ 
                          marginBottom: "10px", border: "1px solid #e6e6e6", borderRadius: "4px", 
                          boxShadow: "0 1px 2px rgba(0,0,0,0.03)", 
                          borderLeft: `3px solid ${estagio === "Fechado" ? "#82cf6e" : "#5d9cec"}`,
                          // Cursor muda quando passa o mouse
                          cursor: "grab", 
                          userSelect: "none"
                      }}
                      bodyStyle={{ padding: "10px" }}
                      actions={[ <EditButton hideText size="small" recordItemId={cliente.id} />, <ShowButton hideText size="small" recordItemId={cliente.id} /> ]}
                    >
                      <div style={{ marginBottom: "5px" }}><Text strong style={{ color: "#192a3e", fontSize: "13px" }}>{cliente.nome}</Text></div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                          {cliente.conta_energia_media > 0 && <Text style={{ fontSize: "12px", color: "#555" }}>{Number(cliente.conta_energia_media).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</Text>}
                          <Text style={{ fontSize: "10px", color: "#a0aec0" }}>{new Date(cliente.created_at).toLocaleDateString('pt-BR')}</Text>
                      </div>
                    </Card>
                </div>
              ))}
              {/* Espaço vazio invisível para facilitar o drop em colunas vazias */}
              <div style={{ height: "50px" }}></div>
            </div>
          </div>
        );
      })}
    </div>
  );

  const ListView = () => (
      <div style={{ padding: "20px", backgroundColor: "#fff", height: "calc(100vh - 180px)" }}>
        <Table 
            dataSource={clientesFiltrados} rowKey="id" size="middle" pagination={{ pageSize: 12, position: ["bottomCenter"] }}
            columns={[
                { title: 'Nome do Lead', dataIndex: 'nome', render: (t) => <b style={{color: "#153046"}}>{t}</b> },
                { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={s === 'Fechado' ? 'green' : 'blue'}>{s}</Tag> },
                { title: 'Valor', dataIndex: 'conta_energia_media', render: (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) },
                { title: 'Telefone', dataIndex: 'telefone' },
                { title: '', render: (_, r: any) => <Space><EditButton hideText size="small" recordItemId={r.id} /></Space> }
            ]}
        />
      </div>
  );

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", backgroundColor: "#fff" }}>
        <KommoHeader />
        <div style={{ flex: 1, backgroundColor: "#fff" }}>{viewType === "kanban" ? <KanbanView /> : <ListView />}</div>
    </div>
  );
};