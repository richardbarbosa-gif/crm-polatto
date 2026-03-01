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
