/**
 * Tipos do módulo de orçamentos (espelho da migration 13) e conversores do
 * que chega do Supabase. O cliente do Supabase não é tipado neste projeto:
 * tudo que vem da API passa por aqui e sai com tipo e valor coerentes
 * (numeric chega como string, colunas novas podem faltar etc.).
 */
import type { TipoDesconto } from "./calculo";
import { ehStatusOrcamento, type StatusOrcamento } from "./formato";

export interface EmpresaIdentidade {
    id: string;
    tenant_id: string;
    logo_path: string | null;
    nome_fantasia: string | null;
    razao_social: string | null;
    cnpj: string | null;
    endereco: string | null;
    telefone: string | null;
    email: string | null;
    site: string | null;
    cor_primaria: string;
    cor_secundaria: string;
    condicoes_pagamento: string | null;
    validade_dias: number;
    observacoes_padrao: string | null;
    rodape: string | null;
}

export interface Produto {
    id: string;
    nome: string;
    descricao: string | null;
    unidade: string;
    preco_padrao: number;
    ativo: boolean;
}

export interface OrcamentoItem {
    id?: string;
    produto_id: string | null;
    descricao: string;
    detalhes: string | null;
    unidade: string;
    quantidade: number;
    valor_unitario: number;
    desconto_tipo: TipoDesconto;
    desconto_valor: number;
    total?: number;
}

export interface Orcamento {
    id: string;
    tenant_id: string;
    negocio_id: string;
    numero: string;
    titulo: string | null;
    status: StatusOrcamento;
    data_emissao: string;
    valido_ate: string;
    desconto_tipo: TipoDesconto;
    desconto_valor: number;
    subtotal: number;
    desconto_total: number;
    total: number;
    condicoes_pagamento: string | null;
    observacoes: string | null;
    responsavel_id: string | null;
    responsavel_nome: string | null;
    responsavel_email: string | null;
    responsavel_telefone: string | null;
    created_by: string;
    created_at: string;
    updated_at: string | null;
    deleted_at: string | null;
}

export interface OrcamentoCompleto extends Orcamento {
    itens: OrcamentoItem[];
}

/** Dados do cliente/negócio para o PDF (vêm da view clientes). */
export interface ClienteDoNegocio {
    id: string;
    nome: string | null;
    cpf_cnpj: string | null;
    telefone: string | null;
    ddi: string | null;
    email: string | null;
    valor: number | null;
    endereco: string | null;
}

type Linha = Record<string, unknown>;

const texto = (valor: unknown): string | null => {
    if (valor === null || valor === undefined) return null;
    const s = String(valor);
    return s.trim() ? s : null;
};

const numero = (valor: unknown, padrao = 0): number => {
    const n = typeof valor === "number" ? valor : Number(valor);
    return Number.isFinite(n) ? n : padrao;
};

const tipoDesconto = (valor: unknown): TipoDesconto => (valor === "percentual" ? "percentual" : "valor");

export const paraIdentidade = (linha: Linha): EmpresaIdentidade => ({
    id: String(linha.id ?? ""),
    tenant_id: String(linha.tenant_id ?? ""),
    logo_path: texto(linha.logo_path),
    nome_fantasia: texto(linha.nome_fantasia),
    razao_social: texto(linha.razao_social),
    cnpj: texto(linha.cnpj),
    endereco: texto(linha.endereco),
    telefone: texto(linha.telefone),
    email: texto(linha.email),
    site: texto(linha.site),
    cor_primaria: texto(linha.cor_primaria) ?? "#0F4C81",
    cor_secundaria: texto(linha.cor_secundaria) ?? "#F2A900",
    condicoes_pagamento: texto(linha.condicoes_pagamento),
    validade_dias: numero(linha.validade_dias, 15),
    observacoes_padrao: texto(linha.observacoes_padrao),
    rodape: texto(linha.rodape),
});

export const paraProduto = (linha: Linha): Produto => ({
    id: String(linha.id ?? ""),
    nome: String(linha.nome ?? ""),
    descricao: texto(linha.descricao),
    unidade: texto(linha.unidade) ?? "un",
    preco_padrao: numero(linha.preco_padrao),
    ativo: linha.ativo !== false,
});

export const paraItem = (linha: Linha): OrcamentoItem => ({
    id: texto(linha.id) ?? undefined,
    produto_id: texto(linha.produto_id),
    descricao: String(linha.descricao ?? ""),
    detalhes: texto(linha.detalhes),
    unidade: texto(linha.unidade) ?? "un",
    quantidade: numero(linha.quantidade, 1),
    valor_unitario: numero(linha.valor_unitario),
    desconto_tipo: tipoDesconto(linha.desconto_tipo),
    desconto_valor: numero(linha.desconto_valor),
    total: numero(linha.total),
});

export const paraOrcamento = (linha: Linha): Orcamento => ({
    id: String(linha.id ?? ""),
    tenant_id: String(linha.tenant_id ?? ""),
    negocio_id: String(linha.negocio_id ?? ""),
    numero: String(linha.numero ?? ""),
    titulo: texto(linha.titulo),
    status: ehStatusOrcamento(linha.status) ? linha.status : "rascunho",
    data_emissao: String(linha.data_emissao ?? ""),
    valido_ate: String(linha.valido_ate ?? ""),
    desconto_tipo: tipoDesconto(linha.desconto_tipo),
    desconto_valor: numero(linha.desconto_valor),
    subtotal: numero(linha.subtotal),
    desconto_total: numero(linha.desconto_total),
    total: numero(linha.total),
    condicoes_pagamento: texto(linha.condicoes_pagamento),
    observacoes: texto(linha.observacoes),
    responsavel_id: texto(linha.responsavel_id),
    responsavel_nome: texto(linha.responsavel_nome),
    responsavel_email: texto(linha.responsavel_email),
    responsavel_telefone: texto(linha.responsavel_telefone),
    created_by: String(linha.created_by ?? ""),
    created_at: String(linha.created_at ?? ""),
    updated_at: texto(linha.updated_at),
    deleted_at: texto(linha.deleted_at),
});

/** Endereço em uma linha a partir dos campos do lead. */
export const enderecoDoLead = (lead: {
    endereco_instalacao?: string | null;
    numero?: string | null;
    complemento?: string | null;
    cep?: string | null;
}): string | null => {
    const rua = [texto(lead.endereco_instalacao), texto(lead.numero)].filter(Boolean).join(", ");
    const partes = [rua, texto(lead.complemento), lead.cep ? `CEP ${lead.cep}` : null].filter(Boolean);
    return partes.length ? partes.join(" — ") : null;
};

export const paraClienteDoNegocio = (linha: Linha): ClienteDoNegocio => ({
    id: String(linha.id ?? ""),
    nome: texto(linha.nome) ?? texto(linha.titulo),
    cpf_cnpj: texto(linha.cpf_cnpj),
    telefone: texto(linha.telefone),
    ddi: texto(linha.ddi),
    email: texto(linha.email),
    valor: linha.valor === null || linha.valor === undefined ? null : numero(linha.valor),
    endereco: enderecoDoLead({
        endereco_instalacao: texto(linha.endereco_instalacao),
        numero: texto(linha.numero),
        complemento: texto(linha.complemento),
        cep: texto(linha.cep),
    }),
});
