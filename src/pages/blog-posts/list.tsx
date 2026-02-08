import React, { useState, useMemo } from "react";
import { useCreate, useGetIdentity, useList, useUpdate } from "@refinedev/core";
import { EditButton, ShowButton, CreateButton } from "@refinedev/antd";
import { Typography, Card, Space, Spin, Input, Button, Tooltip, Table, Tag, Statistic, Row, Col, message, Select } from "antd";
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

type Stage = {
  id?: string | number;
  nome: string;
  cor?: string;
  ordem?: number;
};

const DEFAULT_STAGES: Stage[] = [
  { id: "novo", nome: "Novo Lead", cor: "#5d9cec", ordem: 1 },
  { id: "negociacao", nome: "Em Negociação", cor: "#3182ce", ordem: 2 },
  { id: "visita", nome: "Visita Agendada", cor: "#ed8936", ordem: 3 },
  { id: "fechado", nome: "Fechado", cor: "#82cf6e", ordem: 4 },
  { id: "perdido", nome: "Perdido", cor: "#f56565", ordem: 5 },
];

const formatarDinheiro = (valor: any) => {
  if (!valor) return "R$ 0,00";
  return Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

const getStatusAccent = (status?: string) => {
  const s = (status ?? "").toLowerCase();
  if (s.includes("fechado")) return "#82cf6e";
  if (s.includes("perdido")) return "#f56565";
  if (s.includes("visita")) return "#ed8936";
  if (s.includes("negocia")) return "#3182ce";
  return "#5d9cec";
};

const getStatusTagColor = (status?: string) => {
  const s = (status ?? "").toLowerCase();
  if (s.includes("fechado")) return "green";
  if (s.includes("perdido")) return "red";
  if (s.includes("visita")) return "orange";
  if (s.includes("negocia")) return "gold";
  return "blue";
};


export const BlogPostList = () => {
  const [viewType, setViewType] = useState<"kanban" | "list">("kanban");
  const [searchText, setSearchText] = useState("");
  const [responsavelFiltro, setResponsavelFiltro] = useState<string | undefined>(undefined);
  
  // ESTADO PARA O DRAG AND DROP NATIVO
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [activeDropColumn, setActiveDropColumn] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Hooks do Refine (Dados e Atualização)
  const { query: clientesQuery } = useList({
    resource: "clientes",
    pagination: { mode: "off" },
  });

  const { query: stagesQuery } = useList({
    resource: "pipeline_stages",
    pagination: { mode: "off" },
    sorters: [{ field: "ordem", order: "asc" }],
  });

  const { mutateAsync: updateLead } = useUpdate();
  const { mutate: createHistory } = useCreate();
  const { data: user } = useGetIdentity();

  const isLoading = clientesQuery?.isLoading;
  const rawData = clientesQuery?.data?.data || [];

  const stages = useMemo(() => {
    const data = (stagesQuery?.data?.data as any[]) || [];
    const normalized = data
      .map((stage) => ({
        id: stage.id,
        nome: stage.nome ?? stage.name ?? "",
        cor: stage.cor ?? stage.color,
        ordem: stage.ordem ?? stage.order ?? stage.sort_order,
      }))
      .filter((stage) => stage.nome)
      .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
    return normalized.length > 0 ? normalized : DEFAULT_STAGES;
  }, [stagesQuery?.data?.data]);

  const stageNames = useMemo(() => stages.map((stage) => stage.nome), [stages]);

  const stagesVisiveis = useMemo(() => {
    const possuiDesconhecidos = rawData.some((cliente: any) =>
      cliente.status && !stageNames.includes(cliente.status)
    );
    if (!possuiDesconhecidos) return stages;
    return [...stages, { id: "outros", nome: "Outros", cor: "#94a3b8" }];
  }, [rawData, stageNames, stages]);


  const responsaveisDisponiveis = useMemo(() => {
    const valores = new Set<string>();
    rawData.forEach((cliente: any) => {
      if (cliente.responsavel) {
        valores.add(cliente.responsavel);
      }
    });
    return Array.from(valores).sort((a, b) => a.localeCompare(b));
  }, [rawData]);

  // Filtro Inteligente
  const clientesFiltrados = useMemo(() => {
    return rawData.filter((cliente: any) => {
        if (responsavelFiltro && cliente.responsavel !== responsavelFiltro) return false;
        if (!searchText) return true;
        const texto = searchText.toLowerCase();
        return (
            cliente.nome?.toLowerCase().includes(texto) ||
            cliente.telefone?.includes(texto) ||
            cliente.status?.toLowerCase().includes(texto)
        );
    });
  }, [rawData, searchText, responsavelFiltro]);

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
    setIsDragging(true);
    setActiveDropColumn(null);
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
    setIsDragging(false);
    setActiveDropColumn(null);
  };

  // 3. Permitir soltar na coluna (Over)
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, status: string) => {
    e.preventDefault(); // Necessario para permitir o "Drop"
    e.dataTransfer.dropEffect = "move";
    if (activeDropColumn !== status) {
      setActiveDropColumn(status);
    }
  };

  // 4. A Mágica: Soltou na Coluna
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>, novoStatus: string) => {
    e.preventDefault();
    setActiveDropColumn(null);
    setIsDragging(false);

    if (!draggedItemId) return;

    // Encontra o lead que estava sendo arrastado
    const leadArrastado = rawData.find((c: any) => c.id.toString() === draggedItemId);

    if (!leadArrastado) {
      message.warning("Lead nao encontrado.");
      return;
    }

    // Se soltou na mesma coluna, nao faz nada
    if (leadArrastado?.status === novoStatus) return;

    try {
      // Atualiza no Supabase
      await updateLead({
        resource: "clientes",
        id: draggedItemId,
        values: { status: novoStatus },
        successNotification: () => ({
          message: `Movido para ${novoStatus}`,
          description: "Status atualizado com sucesso!",
          type: "success",
        }),
        errorNotification: () => ({
          message: "Nao foi possivel atualizar o status",
          description: "Tente novamente.",
          type: "error",
        }),
      });

      // Auditoria simples (nao bloqueia o fluxo se falhar)
      createHistory({
        resource: "cliente_status_history",
        values: {
          cliente_id: leadArrastado.id,
          de_status: leadArrastado.status,
          para_status: novoStatus,
          movido_em: new Date().toISOString(),
          movido_por: user?.name || user?.email || null,
        },
        successNotification: false,
        errorNotification: false,
      });
    } catch (err) {
      // Notificacao de erro ja exibida pelo Refine
    }
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
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Input placeholder="Busca e filtro" prefix={<SearchOutlined style={{ color: "#a0aec0" }} />} value={searchText} onChange={(e) => setSearchText(e.target.value)} style={{ width: "230px", backgroundColor: "#f0f2f5", border: "none", borderRadius: "4px", height: "32px", fontSize: "13px" }} />
                <Select
                    placeholder="Respons?vel"
                    allowClear
                    value={responsavelFiltro}
                    onChange={(value) => setResponsavelFiltro(value)}
                    options={responsaveisDisponiveis.map((responsavel) => ({ value: responsavel, label: responsavel }))}
                    style={{ width: "180px" }}
                    disabled={responsaveisDisponiveis.length === 0}
                />
            </div>
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
      {stagesVisiveis.map((estagio) => {
        const clientesDaColuna = clientesFiltrados.filter((c: any) => (
          estagio.nome === "Outros"
            ? c.status && !stageNames.includes(c.status)
            : c.status === estagio.nome
        ));
        const totalColuna = clientesDaColuna.reduce((acc: number, curr: any) => acc + Number(curr.conta_energia_media || 0), 0);
        const isDroppable = estagio.nome !== "Outros";
        const isDropActive = isDroppable && isDragging && activeDropColumn === estagio.nome;
        const accentColor = estagio.cor || getStatusAccent(estagio.nome);
        
        return (
          <div 
            key={estagio.nome}
            // EVENTOS DE DROP NA COLUNA
            onDragOver={isDroppable ? (e) => handleDragOver(e, estagio.nome) : undefined}
            onDrop={isDroppable ? (e) => handleDrop(e, estagio.nome) : undefined}
            style={{ 
                minWidth: "300px", maxWidth: "300px", display: "flex", flexDirection: "column", 
                borderRight: "1px solid #f0f0f0", padding: "0 10px", transition: "background 0.2s", 
                backgroundColor: isDropActive ? "#f0f7ff" : "transparent", 
                boxShadow: isDropActive ? "inset 0 0 0 1px #91caff" : "none", 
                borderRadius: "6px" 
            }}
          >
            <div style={{ paddingBottom: "15px", paddingTop: "5px", textAlign: "center" }}>
                <Text strong style={{ textTransform: "uppercase", fontSize: "11px", color: "#6e7c87", display: "block", marginBottom: "4px" }}>{estagio.nome}</Text>
                <Text style={{ fontSize: "10px", color: "#98a2b3" }}>{clientesDaColuna.length} leads</Text>
                <Text style={{ fontSize: "10px", color: "#667085" }}>{formatarDinheiro(totalColuna)}</Text>
                <div style={{ height: "3px", width: "100%", backgroundColor: accentColor, marginTop: "6px", borderRadius: "2px" }}></div>
            </div>
            
            <div style={{ flex: 1, overflowY: "auto", minHeight: "200px" }}>
              {clientesDaColuna.length === 0 ? (
                <div style={{ border: "1px dashed #e2e8f0", borderRadius: "6px", padding: "12px", textAlign: "center", color: "#98a2b3", fontSize: "12px", marginTop: "6px" }}>
                  {isDropActive ? "Solte aqui" : "Sem leads"}
                </div>
              ) : (
                clientesDaColuna.map((cliente: any) => (
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
                          borderLeft: `3px solid ${accentColor}`,
                          // Cursor muda quando passa o mouse
                          cursor: "grab", 
                          userSelect: "none"
                      }}
                      bodyStyle={{ padding: "10px" }}
                      actions={[ <EditButton hideText size="small" recordItemId={cliente.id} />, <ShowButton hideText size="small" recordItemId={cliente.id} /> ]}
                    >
                      <div style={{ marginBottom: "5px" }}><Text strong style={{ color: "#192a3e", fontSize: "13px" }}>{cliente.nome}</Text></div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                          {cliente.conta_energia_media > 0 && <Text style={{ fontSize: "12px", color: "#555" }}>{formatarDinheiro(cliente.conta_energia_media)}</Text>}
                          {cliente.responsavel && <Text style={{ fontSize: "10px", color: "#667085" }}>Resp: {cliente.responsavel}</Text>}
                          <Text style={{ fontSize: "10px", color: "#a0aec0" }}>{new Date(cliente.created_at).toLocaleDateString('pt-BR')}</Text>
                      </div>
                    </Card>
                </div>
                ))
              )}
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
                { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={getStatusTagColor(s)}>{s}</Tag> },
                { title: 'Respons?vel', dataIndex: 'responsavel', render: (v) => v || '-' },
                { title: 'Valor', dataIndex: 'conta_energia_media', render: (v) => formatarDinheiro(v) },
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
