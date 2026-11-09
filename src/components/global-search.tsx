import React, { useEffect, useMemo, useState } from "react";
import { Modal, Input, List, Typography, Tag, Space, Skeleton } from "antd";
import { BankOutlined, ContactsOutlined, RightOutlined, SearchOutlined, UserOutlined } from "@ant-design/icons";
import { useList, useGo, type CrudFilter } from "@refinedev/core";
import { useCrmAccess } from "../hooks/useCrmAccess";
import { sanitizarBusca } from "../lib/leadFilters";

const { Text } = Typography;

type LeadEncontrado = {
    id: string | number;
    nome?: string | null;
    telefone?: string | null;
    status?: string | null;
    responsavel?: string | null;
};
type OrganizacaoEncontrada = {
    id: string;
    nome_fantasia?: string | null;
    razao_social?: string | null;
    cnpj?: string | null;
    setor?: string | null;
};
type PessoaEncontrada = {
    id: string;
    nome?: string | null;
    email?: string | null;
    telefone?: string | null;
};

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
    lead: { label: "Negócio", icon: <UserOutlined />, cor: "blue" },
    organizacao: { label: "Organização", icon: <BankOutlined />, cor: "purple" },
    pessoa: { label: "Contato", icon: <ContactsOutlined />, cor: "green" },
};

export const GlobalSearch = ({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) => {
    const [searchTerm, setSearchTerm] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [ativo, setAtivo] = useState(0);
    const go = useGo();

    // Nova busca: o destaque volta para o primeiro resultado
    useEffect(() => {
        setAtivo(0);
    }, [debouncedSearch]);

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

    // Aspas e barra invertida quebravam o filtro .or() do PostgREST.
    const termo = sanitizarBusca(debouncedSearch);
    const buscaAtiva = termo.length > 1;
    const { canViewAllLeads, ownerCandidates } = useCrmAccess();

    // Mesma visão do Kanban: vendedor sem acesso total só encontra os próprios leads.
    const filtrosDeLeads = useMemo<CrudFilter[]>(() => {
        if (!buscaAtiva) return [];
        const filtros: CrudFilter[] = [
            {
                operator: "or",
                value: [
                    { field: "nome", operator: "contains", value: termo },
                    { field: "telefone", operator: "contains", value: termo },
                ],
            },
        ];
        if (!canViewAllLeads && ownerCandidates.length > 0) {
            filtros.push({ field: "responsavel", operator: "in", value: ownerCandidates });
        }
        return filtros;
    }, [buscaAtiva, canViewAllLeads, ownerCandidates, termo]);

    // Busca em paralelo nos três recursos (multi-tenancy garantido pela RLS)
    const { query: leadsQuery } = useList<LeadEncontrado>({
        resource: "clientes",
        pagination: { pageSize: 5 },
        filters: filtrosDeLeads,
        meta: { select: "id,nome,telefone,status,responsavel" },
        queryOptions: { enabled: buscaAtiva },
    });

    const { query: organizacoesQuery } = useList<OrganizacaoEncontrada>({
        resource: "organizacoes",
        pagination: { pageSize: 4 },
        filters: buscaAtiva
            ? [
                  {
                      operator: "or",
                      value: [
                          { field: "nome_fantasia", operator: "contains", value: termo },
                          { field: "razao_social", operator: "contains", value: termo },
                      ],
                  },
                  { field: "deleted_at", operator: "null", value: true },
              ]
            : [],
        queryOptions: { enabled: buscaAtiva, retry: false },
    });

    const { query: pessoasQuery } = useList<PessoaEncontrada>({
        resource: "pessoas",
        pagination: { pageSize: 4 },
        filters: buscaAtiva
            ? [
                  {
                      operator: "or",
                      value: [
                          { field: "nome", operator: "contains", value: termo },
                          { field: "email", operator: "contains", value: termo },
                          { field: "telefone", operator: "contains", value: termo },
                      ],
                  },
                  { field: "deleted_at", operator: "null", value: true },
              ]
            : [],
        queryOptions: { enabled: buscaAtiva, retry: false },
    });

    const isLoading = Boolean(
        leadsQuery?.isLoading || organizacoesQuery?.isLoading || pessoasQuery?.isLoading,
    );

    const results: SearchResult[] = [
        ...(leadsQuery?.data?.data ?? []).map((item) => ({
            id: item.id,
            tipo: "lead" as const,
            titulo: item.nome || "Sem nome",
            subtitulo: item.telefone || "Sem telefone",
            status: item.status ?? undefined,
            responsavel: item.responsavel ?? undefined,
            destino: `/clientes/show/${item.id}`,
        })),
        ...(organizacoesQuery?.data?.data ?? []).map((item) => ({
            id: item.id,
            tipo: "organizacao" as const,
            titulo: item.nome_fantasia || item.razao_social || "Sem nome",
            subtitulo: item.cnpj || item.setor || undefined,
            destino: "/organizacoes",
        })),
        ...(pessoasQuery?.data?.data ?? []).map((item) => ({
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

    // Navegação por teclado (↑ ↓ Enter), como em toda busca Ctrl+K.
    // Enter só age quando os resultados já são do texto digitado: antes do
    // debounce terminar, abriria um resultado da busca anterior.
    const resultadosAtuais = searchTerm === debouncedSearch && !isLoading;
    const indiceAtivo = results.length ? Math.min(ativo, results.length - 1) : -1;
    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (!results.length) return;
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setAtivo((atual) => (atual + 1) % results.length);
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setAtivo((atual) => (atual - 1 + results.length) % results.length);
        } else if (event.key === "Enter" && resultadosAtuais && indiceAtivo >= 0) {
            event.preventDefault();
            handleSelect(results[indiceAtivo]);
        }
    };

    return (
        <Modal
            open={open}
            onCancel={() => setOpen(false)}
            footer={null}
            closable={false}
            width={580}
            className="crm-busca"
            styles={{
                body: { padding: 0 },
                content: { padding: 0, overflow: "hidden", borderRadius: 12 },
            }}
        >
            {/* Cabeçalho da Busca */}
            <div className="crm-busca__topo">
                <SearchOutlined className="crm-busca__icone" />
                <Input
                    autoFocus
                    aria-label="Buscar no CRM"
                    aria-controls="crm-busca-resultados"
                    placeholder="Buscar negócios, organizações e contatos..."
                    variant="borderless"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyDown={handleKeyDown}
                    style={{ fontSize: 18, padding: 0, boxShadow: "none" }}
                />
                <kbd className="crm-busca__tecla">ESC</kbd>
            </div>

            {/* Corpo de Resultados */}
            <div className="crm-busca__corpo">
                {!buscaAtiva ? (
                    <div className="crm-busca__vazio">
                        <Text type="secondary">Digite ao menos 2 letras para buscar em negócios, organizações e contatos.</Text>
                    </div>
                ) : isLoading ? (
                    <div style={{ padding: 20 }}><Skeleton active paragraph={{ rows: 2 }} title={false} /></div>
                ) : results.length === 0 ? (
                    <div className="crm-busca__vazio">
                        <Text type="secondary">Nenhum resultado para "{debouncedSearch}"</Text>
                    </div>
                ) : (
                    <div id="crm-busca-resultados" role="listbox" aria-label="Resultados da busca">
                        <List
                            dataSource={results}
                            renderItem={(item: SearchResult, indice: number) => (
                                <List.Item
                                    role="option"
                                    aria-selected={indice === indiceAtivo}
                                    className={`crm-busca__item${indice === indiceAtivo ? " crm-busca__item--ativo" : ""}`}
                                    onMouseEnter={() => setAtivo(indice)}
                                    onClick={() => handleSelect(item)}
                                >
                                    <List.Item.Meta
                                        avatar={<div className="crm-busca__avatar">{TIPO_META[item.tipo].icon}</div>}
                                        title={
                                            <Space size={8}>
                                                <Text strong className="crm-busca__titulo">{item.titulo}</Text>
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
                                    <RightOutlined className="crm-busca__seta" />
                                </List.Item>
                            )}
                        />
                    </div>
                )}
            </div>
        </Modal>
    );
};
