export type DbRole = string;

export type UsuarioEmpresa = {
    id: string;
    tenant_id: string | null;
    role: DbRole | null;
    user_id: string | null;
    email: string | null;
    raw: Record<string, unknown>;
};

export type ClienteRecord = {
    id: string | number;
    tenant_id?: string | null;
    nome?: string | null;
    email?: string | null;
    telefone?: string | null;
    responsavel?: string | null;
    conta_energia_media?: number | null;
    created_at?: string | null;
    stage_id?: string | number | null;
    status?: string | null;
    [key: string]: unknown;
};

export type PipelineStageRecord = {
    id: string | number;
    tenant_id?: string | null;
    nome: string;
    cor?: string | null;
    ordem?: number | null;
    [key: string]: unknown;
};

export type OrganizacaoRecord = {
    id: string;
    tenant_id?: string | null;
    razao_social?: string | null;
    nome_fantasia?: string | null;
    cnpj?: string | null;
    site?: string | null;
    setor?: string | null;
    tamanho?: string | null;
    telefone?: string | null;
    email?: string | null;
    endereco?: Record<string, unknown> | null;
    dados_extras?: Record<string, unknown> | null;
    deleted_at?: string | null;
    created_at?: string | null;
    [key: string]: unknown;
};

export type PessoaRecord = {
    id: string;
    tenant_id?: string | null;
    organizacao_id?: string | null;
    nome?: string | null;
    email?: string | null;
    telefone?: string | null;
    ddi?: string | null;
    cpf?: string | null;
    cargo?: string | null;
    dados_extras?: Record<string, unknown> | null;
    anonimizada_em?: string | null;
    deleted_at?: string | null;
    created_at?: string | null;
    [key: string]: unknown;
};

export type NegocioRecord = {
    id: string;
    tenant_id?: string | null;
    organizacao_id?: string | null;
    pessoa_contato_principal_id?: string | null;
    titulo?: string | null;
    valor?: number | null;
    stage_id?: string | number | null;
    pipeline_id?: string | null;
    status?: string | null;
    temperatura?: string | null;
    responsavel?: string | null;
    responsavel_id?: string | null;
    motivo_perda?: string | null;
    motivo_perda_id?: string | null;
    data_prevista_fechamento?: string | null;
    fechado_em?: string | null;
    dados_extras?: Record<string, unknown> | null;
    deleted_at?: string | null;
    created_at?: string | null;
    [key: string]: unknown;
};

export type PipelineRecord = {
    id: string;
    tenant_id?: string | null;
    nome: string;
    ordem?: number | null;
    ativo?: boolean | null;
    [key: string]: unknown;
};

export type CustomFieldRecord = {
    id: string;
    tenant_id?: string | null;
    entidade: "negocio" | "pessoa" | "organizacao";
    chave: string;
    label: string;
    tipo: "texto" | "numero" | "data" | "select" | "boolean";
    opcoes?: unknown[] | null;
    ordem?: number | null;
    obrigatorio?: boolean | null;
    ativo?: boolean | null;
    [key: string]: unknown;
};

export type MotivoPerdaRecord = {
    id: string;
    tenant_id?: string | null;
    nome: string;
    ordem?: number | null;
    ativo?: boolean | null;
    [key: string]: unknown;
};

export type TipoAtividadeRecord = {
    id: string;
    tenant_id?: string | null;
    nome: string;
    icone?: string | null;
    ordem?: number | null;
    ativo?: boolean | null;
    [key: string]: unknown;
};

export type DocumentoLeadRecord = {
    id: string | number;
    tenant_id?: string | null;
    cliente_id: string | number;
    tipo: string;
    nome_arquivo?: string | null;
    caminho_storage?: string | null;
    tamanho_bytes?: number | null;
    versao?: number | null;
    status?: string | null;
    enviado_por?: string | null;
    created_at?: string | null;
    deleted_at?: string | null;
    [key: string]: unknown;
};
