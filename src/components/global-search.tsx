import React, { useEffect, useState } from "react";
import { Modal, Input, List, Typography, Tag, Space, Skeleton } from "antd";
import { SearchOutlined, UserOutlined, RightOutlined } from "@ant-design/icons";
import { useList, useGo } from "@refinedev/core";

const { Text } = Typography;

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

    // Busca os clientes no Supabase automaticamente (já com o filtro Multi-tenancy invisível!)
   // Busca os clientes no Supabase automaticamente (já com o filtro Multi-tenancy invisível!)
    const listResult = useList({
        resource: "clientes",
        pagination: { pageSize: 5 }, // Mostra apenas os 5 resultados mais relevantes
        filters: debouncedSearch ? [
            {
                field: "nome",
                operator: "contains",
                value: debouncedSearch,
            }
        ] : [],
        queryOptions: {
            enabled: debouncedSearch.length > 1, // Só busca se tiver mais de 1 letra
        }
    });

    // Extrai o data e o isLoading de dentro do query (compatível com sua versão do Refine)
    const query = listResult.query || listResult;
    const data = query?.data;
    const isLoading = query?.isLoading;
   

    const results = data?.data || [];

    // Redireciona direto para o lead ao clicar no resultado
    const handleSelect = (id: string | number) => {
        setOpen(false);
        go({
            to: `/clientes/show/${id}`,
            type: "push",
        });
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
                    placeholder="Buscar cliente por nome..."
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
                        <Text type="secondary">Digite algo para buscar contatos rápidos...</Text>
                    </div>
                ) : isLoading ? (
                    <div style={{ padding: '20px' }}><Skeleton active paragraph={{ rows: 2 }} title={false} /></div>
                ) : results.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '30px 20px', color: '#94a3b8' }}>
                        <Text type="secondary">Nenhum cliente encontrado para "{debouncedSearch}"</Text>
                    </div>
                ) : (
                    <List
                        dataSource={results}
                        renderItem={(item: any) => (
                            <List.Item
                                style={{ padding: '12px 20px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                onClick={() => handleSelect(item.id)}
                            >
                                <List.Item.Meta
                                    avatar={
                                        <div style={{ width: 40, height: 40, borderRadius: '50%', backgroundColor: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <UserOutlined style={{ color: '#64748b', fontSize: 18 }} />
                                        </div>
                                    }
                                    title={<Text strong style={{ fontSize: 15, color: '#1e293b' }}>{item.nome}</Text>}
                                    description={
                                        <Space size={8} style={{ marginTop: 4 }}>
                                            <Text type="secondary" style={{ fontSize: 13 }}>{item.telefone || 'Sem telefone'}</Text>
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