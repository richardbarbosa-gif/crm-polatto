import React, { useEffect, useState } from "react";
import { Modal, Input, List, Typography, Tag, Space, Skeleton } from "antd";
import { BankOutlined, ContactsOutlined, RightOutlined, SearchOutlined, UserOutlined } from "@ant-design/icons";
import { useList, useGo } from "@refinedev/core";

const { Text } = Typography;

type SearchResult = {
    id: string | number;
    tipo: "lead" | "organizacao" | "pessoa";
    titulo: string;
    subtitulo?: string;
    status?: string;
    responsavel?: string;
    destino: string;
};

const TIPO_META: Record<SearchResult["tipo"], { label: string; icon: React.ReactNode; cor: string }> = {
    lead: { label: "Negócio", icon: <UserOutlined style={{ color: "#64748b", fontSize: 18 }} />, cor: "blue" },
    organizacao: { label: "Organização", icon: <BankOutlined style={{ color: "#64748b", fontSize: 18 }} />, cor: "purple" },
    pessoa: { label: "Contato", icon: <ContactsOutlined style={{ color: "#64748b", fontSize: 18 }} />, cor: "green" },
};

export const GlobalSearch = ({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) => {
    const [searchTerm, setSearchTerm] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const go = useGo();

    // Aguarda o usuário parar de digitar por 500ms para poupar o banco de dados
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(searchTerm), 500);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    // O "Ouvinte" mágico do atalho Ctrl+K / Cmd+K
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "k") {
                e.preventDefault();
                setOpen(true);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [setOpen]);

    // Limpa a pesquisa sempre que fechar a janela
    useEffect(() => {
        if (!open) {
            setSearchTerm("");
            setDebouncedSearch("");
        }
    }, [open]);

    const buscaAtiva = debouncedSearch.length > 1;

    // Busca em paralelo nos três recursos (multi-tenancy garantido pela RLS)
    const leadsResult = useList({
        resource: "clientes",
        pagination: { pageSize: 5 },
        filters: buscaAtiva
            ? [
                  {
                      operator: "or",
                      value: [
                          { field: "nome", operator: "contains", value: debouncedSearch },
                          { field: "telefone", operator: "contains", value: debouncedSearch },
                      ],
                  },
              ]
            : [],
        queryOptions: { enabled: buscaAtiva },
    }) as any;

    const organizacoesResult = useList({
        resource: "organizacoes",
        pagination: { pageSize: 4 },
        filters: buscaAtiva
            ? [
                  {
                      operator: "or",
                      value: [
                          { field: "nome_fantasia", operator: "contains", value: debouncedSearch },
                          { field: "razao_social", operator: "contains", value: debouncedSearch },
                      ],
                  },
              ]
            : [],
        queryOptions: { enabled: buscaAtiva, retry: false },
    }) as any;

    const pessoasResult = useList({
        resource: "pessoas",
        pagination: { pageSize: 4 },
        filters: buscaAtiva
            ? [
                  {
                      operator: "or",
                      value: [
                          { field: "nome", operator: "contains", value: debouncedSearch },
                          { field: "email", operator: "contains", value: debouncedSearch },
                          { field: "telefone", operator: "contains", value: debouncedSearch },
                      ],
                  },
              ]
            : [],
        queryOptions: { enabled: buscaAtiva, retry: false },
    }) as any;

    const leadsQuery = leadsResult.query || leadsResult;
    const organizacoesQuery = organizacoesResult.query || organizacoesResult;
    const pessoasQuery = pessoasResult.query || pessoasResult;

    const isLoading = Boolean(leadsQuery?.isLoading);

    const results: SearchResult[] = [
        ...((leadsQuery?.data?.data || []) as any[]).map((item) => ({
            id: item.id,
            tipo: "lead" as const,
            titulo: item.nome || "Sem nome",
            subtitulo: item.telefone || "Sem telefone",
            status: item.status,
            responsavel: item.responsavel,
            destino: `/clientes/show/${item.id}`,
        })),
        ...((organizacoesQuery?.data?.data || []) as any[]).map((item) => ({
            id: item.id,
            tipo: "organizacao" as const,
            titulo: item.nome_fantasia || item.razao_social || "Sem nome",
            subtitulo: item.cnpj || item.setor || undefined,
            destino: "/organizacoes",
        })),
        ...((pessoasQuery?.data?.data || []) as any[]).map((item) => ({
            id: item.id,
            tipo: "pessoa" as const,
            titulo: item.nome || "Sem nome",
            subtitulo: item.email || item.telefone || undefined,
            destino: "/pessoas",
        })),
    ];

    const handleSelect = (result: SearchResult) => {
        setOpen(false);
        go({ to: result.destino, type: "push" });
    };

    return (
        <Modal
            open={open}
            onCancel={() => setOpen(false)}
            footer={null}
            closable={false}
            width={580}
            styles={{
                body: { padding: 0 },
                content: { padding: 0, overflow: 'hidden', borderRadius: 12, boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)' }
            }}
        >
            {/* Cabeçalho da Busca */}
            <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #f0f0f0' }}>
                <SearchOutlined style={{ fontSize: 22, color: '#94a3b8', marginRight: 12 }} />
                <Input
                    autoFocus
                    placeholder="Buscar negócios, organizações e contatos..."
                    variant="borderless"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{ fontSize: 18, padding: 0, boxShadow: 'none' }}
                />
                <div style={{ fontSize: 11, color: '#94a3b8', backgroundColor: '#f1f5f9', padding: '4px 8px', borderRadius: 6, fontWeight: 600 }}>
                    ESC
                </div>
            </div>

            {/* Corpo de Resultados */}
            <div style={{ padding: '8px 0', minHeight: 120, backgroundColor: '#f8fafc' }}>
                {!debouncedSearch ? (
                    <div style={{ textAlign: 'center', padding: '30px 20px', color: '#94a3b8' }}>
                        <Text type="secondary">Digite algo para buscar em negócios, organizações e contatos...</Text>
                    </div>
                ) : isLoading ? (
                    <div style={{ padding: '20px' }}><Skeleton active paragraph={{ rows: 2 }} title={false} /></div>
                ) : results.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '30px 20px', color: '#94a3b8' }}>
                        <Text type="secondary">Nenhum resultado para "{debouncedSearch}"</Text>
                    </div>
                ) : (
                    <List
                        dataSource={results}
                        renderItem={(item: SearchResult) => (
                            <List.Item
                                style={{ padding: '12px 20px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                onClick={() => handleSelect(item)}
                            >
                                <List.Item.Meta
                                    avatar={
                                        <div style={{ width: 40, height: 40, borderRadius: '50%', backgroundColor: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            {TIPO_META[item.tipo].icon}
                                        </div>
                                    }
                                    title={
                                        <Space size={8}>
                                            <Text strong style={{ fontSize: 15, color: '#1e293b' }}>{item.titulo}</Text>
                                            <Tag color={TIPO_META[item.tipo].cor} bordered={false} style={{ fontSize: 11 }}>
                                                {TIPO_META[item.tipo].label}
                                            </Tag>
                                        </Space>
                                    }
                                    description={
                                        <Space size={8} style={{ marginTop: 4 }}>
                                            {item.subtitulo ? (
                                                <Text type="secondary" style={{ fontSize: 13 }}>{item.subtitulo}</Text>
                                            ) : null}
                                            {item.status && <Tag color="blue" bordered={false}>{item.status}</Tag>}
                                            {item.responsavel && <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>Resp: {item.responsavel}</Text>}
                                        </Space>
                                    }
                                />
                                <RightOutlined style={{ color: '#cbd5e1' }} />
                            </List.Item>
                        )}
                    />
                )}
            </div>
        </Modal>
    );
};
