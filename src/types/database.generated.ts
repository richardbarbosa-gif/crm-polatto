// =====================================================================
// ARQUIVO GERADO — não edite à mão.
// Fonte: schema public de um Postgres com as migrations de database/
// aplicadas. Regerar depois de qualquer migration:
//   PGDATABASE=<banco> node scripts/gerar-tipos-do-banco.mjs
// O CI falha se este arquivo estiver diferente do banco.
// =====================================================================

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
    public: {
        Tables: {
            acessos_dados_pessoais: {
                Row: {
                    acessado_por: string | null;
                    contexto: string | null;
                    criado_em: string;
                    email_acessor: string | null;
                    id: number;
                    pessoa_id: string | null;
                    tenant_id: string | null;
                };
                Insert: {
                    acessado_por?: string | null;
                    contexto?: string | null;
                    criado_em?: string;
                    email_acessor?: string | null;
                    id?: number;
                    pessoa_id?: string | null;
                    tenant_id?: string | null;
                };
                Update: {
                    acessado_por?: string | null;
                    contexto?: string | null;
                    criado_em?: string;
                    email_acessor?: string | null;
                    id?: number;
                    pessoa_id?: string | null;
                    tenant_id?: string | null;
                };
                Relationships: [];
            };
            atividades_lead: {
                Row: {
                    activity_type: string | null;
                    arquivo_nome: string | null;
                    arquivo_path: string | null;
                    arquivo_url: string | null;
                    author: string | null;
                    cliente_id: string | null;
                    created_at: string;
                    created_by: string | null;
                    criado_por: string | null;
                    data_atividade: string | null;
                    de_status: string | null;
                    descricao: string | null;
                    file_name: string | null;
                    file_path: string | null;
                    file_url: string | null;
                    from_status: string | null;
                    funcionario_id: string | null;
                    id: number;
                    lead_id: string | null;
                    metadados: Json;
                    notes: string | null;
                    para_status: string | null;
                    tenant_id: string | null;
                    tipo: string | null;
                    tipo_atividade: string | null;
                    title: string | null;
                    titulo: string | null;
                    to_status: string | null;
                };
                Insert: {
                    activity_type?: string | null;
                    arquivo_nome?: string | null;
                    arquivo_path?: string | null;
                    arquivo_url?: string | null;
                    author?: string | null;
                    cliente_id?: string | null;
                    created_at?: string;
                    created_by?: string | null;
                    criado_por?: string | null;
                    data_atividade?: string | null;
                    de_status?: string | null;
                    descricao?: string | null;
                    file_name?: string | null;
                    file_path?: string | null;
                    file_url?: string | null;
                    from_status?: string | null;
                    funcionario_id?: string | null;
                    id?: number;
                    lead_id?: string | null;
                    metadados?: Json;
                    notes?: string | null;
                    para_status?: string | null;
                    tenant_id?: string | null;
                    tipo?: string | null;
                    tipo_atividade?: string | null;
                    title?: string | null;
                    titulo?: string | null;
                    to_status?: string | null;
                };
                Update: {
                    activity_type?: string | null;
                    arquivo_nome?: string | null;
                    arquivo_path?: string | null;
                    arquivo_url?: string | null;
                    author?: string | null;
                    cliente_id?: string | null;
                    created_at?: string;
                    created_by?: string | null;
                    criado_por?: string | null;
                    data_atividade?: string | null;
                    de_status?: string | null;
                    descricao?: string | null;
                    file_name?: string | null;
                    file_path?: string | null;
                    file_url?: string | null;
                    from_status?: string | null;
                    funcionario_id?: string | null;
                    id?: number;
                    lead_id?: string | null;
                    metadados?: Json;
                    notes?: string | null;
                    para_status?: string | null;
                    tenant_id?: string | null;
                    tipo?: string | null;
                    tipo_atividade?: string | null;
                    title?: string | null;
                    titulo?: string | null;
                    to_status?: string | null;
                };
                Relationships: [];
            };
            audit_log: {
                Row: {
                    criado_em: string;
                    dados_antes: Json | null;
                    dados_depois: Json | null;
                    email_executor: string | null;
                    executado_por: string | null;
                    id: number;
                    operacao: string;
                    registro_id: string | null;
                    tabela: string;
                    tenant_id: string | null;
                };
                Insert: {
                    criado_em?: string;
                    dados_antes?: Json | null;
                    dados_depois?: Json | null;
                    email_executor?: string | null;
                    executado_por?: string | null;
                    id?: number;
                    operacao: string;
                    registro_id?: string | null;
                    tabela: string;
                    tenant_id?: string | null;
                };
                Update: {
                    criado_em?: string;
                    dados_antes?: Json | null;
                    dados_depois?: Json | null;
                    email_executor?: string | null;
                    executado_por?: string | null;
                    id?: number;
                    operacao?: string;
                    registro_id?: string | null;
                    tabela?: string;
                    tenant_id?: string | null;
                };
                Relationships: [];
            };
            automacoes: {
                Row: {
                    ativo: boolean;
                    cond_origem_id: string | null;
                    cond_pipeline_id: string | null;
                    cond_temperatura: string | null;
                    cond_valor_minimo: number | null;
                    created_at: string;
                    created_by: string | null;
                    gatilho: string;
                    gatilho_dias: number | null;
                    gatilho_etapa_id: number | null;
                    gatilho_temperatura: string | null;
                    id: string;
                    modelo_chave: string | null;
                    nome: string;
                    personalizado: boolean;
                    tenant_id: string;
                    updated_at: string;
                };
                Insert: {
                    ativo?: boolean;
                    cond_origem_id?: string | null;
                    cond_pipeline_id?: string | null;
                    cond_temperatura?: string | null;
                    cond_valor_minimo?: number | null;
                    created_at?: string;
                    created_by?: string | null;
                    gatilho: string;
                    gatilho_dias?: number | null;
                    gatilho_etapa_id?: number | null;
                    gatilho_temperatura?: string | null;
                    id?: string;
                    modelo_chave?: string | null;
                    nome: string;
                    personalizado?: boolean;
                    tenant_id?: string;
                    updated_at?: string;
                };
                Update: {
                    ativo?: boolean;
                    cond_origem_id?: string | null;
                    cond_pipeline_id?: string | null;
                    cond_temperatura?: string | null;
                    cond_valor_minimo?: number | null;
                    created_at?: string;
                    created_by?: string | null;
                    gatilho?: string;
                    gatilho_dias?: number | null;
                    gatilho_etapa_id?: number | null;
                    gatilho_temperatura?: string | null;
                    id?: string;
                    modelo_chave?: string | null;
                    nome?: string;
                    personalizado?: boolean;
                    tenant_id?: string;
                    updated_at?: string;
                };
                Relationships: [];
            };
            automacoes_acoes: {
                Row: {
                    atribuicao_modo: string | null;
                    automacao_id: string;
                    created_at: string;
                    id: string;
                    ordem: number;
                    prazo_quantidade: number | null;
                    prazo_unidade: string | null;
                    responsavel_modo: string | null;
                    temperatura: string | null;
                    tenant_id: string;
                    tipo: string;
                    tipo_atividade_id: string | null;
                    titulo: string | null;
                    updated_at: string;
                    usuario_id: string | null;
                };
                Insert: {
                    atribuicao_modo?: string | null;
                    automacao_id: string;
                    created_at?: string;
                    id?: string;
                    ordem?: number;
                    prazo_quantidade?: number | null;
                    prazo_unidade?: string | null;
                    responsavel_modo?: string | null;
                    temperatura?: string | null;
                    tenant_id?: string;
                    tipo: string;
                    tipo_atividade_id?: string | null;
                    titulo?: string | null;
                    updated_at?: string;
                    usuario_id?: string | null;
                };
                Update: {
                    atribuicao_modo?: string | null;
                    automacao_id?: string;
                    created_at?: string;
                    id?: string;
                    ordem?: number;
                    prazo_quantidade?: number | null;
                    prazo_unidade?: string | null;
                    responsavel_modo?: string | null;
                    temperatura?: string | null;
                    tenant_id?: string;
                    tipo?: string;
                    tipo_atividade_id?: string | null;
                    titulo?: string | null;
                    updated_at?: string;
                    usuario_id?: string | null;
                };
                Relationships: [];
            };
            automacoes_execucoes: {
                Row: {
                    automacao_id: string;
                    chave_idempotencia: string;
                    detalhes: Json;
                    evento: string;
                    executado_em: string;
                    id: number;
                    mensagem: string | null;
                    negocio_id: string | null;
                    negocio_nome: string | null;
                    resultado: string;
                    tenant_id: string;
                };
                Insert: {
                    automacao_id: string;
                    chave_idempotencia: string;
                    detalhes?: Json;
                    evento: string;
                    executado_em?: string;
                    id?: number;
                    mensagem?: string | null;
                    negocio_id?: string | null;
                    negocio_nome?: string | null;
                    resultado?: string;
                    tenant_id?: string;
                };
                Update: {
                    automacao_id?: string;
                    chave_idempotencia?: string;
                    detalhes?: Json;
                    evento?: string;
                    executado_em?: string;
                    id?: number;
                    mensagem?: string | null;
                    negocio_id?: string | null;
                    negocio_nome?: string | null;
                    resultado?: string;
                    tenant_id?: string;
                };
                Relationships: [];
            };
            automacoes_rodizio: {
                Row: {
                    atribuicoes: number;
                    automacao_id: string;
                    tenant_id: string;
                    ultima_chave: string | null;
                    ultimo_funcionario_id: string | null;
                    updated_at: string;
                };
                Insert: {
                    atribuicoes?: number;
                    automacao_id: string;
                    tenant_id?: string;
                    ultima_chave?: string | null;
                    ultimo_funcionario_id?: string | null;
                    updated_at?: string;
                };
                Update: {
                    atribuicoes?: number;
                    automacao_id?: string;
                    tenant_id?: string;
                    ultima_chave?: string | null;
                    ultimo_funcionario_id?: string | null;
                    updated_at?: string;
                };
                Relationships: [];
            };
            canais_origem: {
                Row: {
                    ativo: boolean;
                    created_at: string;
                    created_by: string | null;
                    id: string;
                    nome: string;
                    ordem: number;
                    padrao: boolean;
                    tenant_id: string;
                    updated_at: string;
                };
                Insert: {
                    ativo?: boolean;
                    created_at?: string;
                    created_by?: string | null;
                    id?: string;
                    nome: string;
                    ordem?: number;
                    padrao?: boolean;
                    tenant_id?: string;
                    updated_at?: string;
                };
                Update: {
                    ativo?: boolean;
                    created_at?: string;
                    created_by?: string | null;
                    id?: string;
                    nome?: string;
                    ordem?: number;
                    padrao?: boolean;
                    tenant_id?: string;
                    updated_at?: string;
                };
                Relationships: [];
            };
            client_errors: {
                Row: {
                    contexto: Json;
                    criado_em: string;
                    email_usuario: string | null;
                    id: number;
                    mensagem: string;
                    origem: string | null;
                    stack: string | null;
                    tenant_id: string | null;
                    url: string | null;
                    user_agent: string | null;
                    user_id: string | null;
                };
                Insert: {
                    contexto?: Json;
                    criado_em?: string;
                    email_usuario?: string | null;
                    id?: number;
                    mensagem: string;
                    origem?: string | null;
                    stack?: string | null;
                    tenant_id?: string | null;
                    url?: string | null;
                    user_agent?: string | null;
                    user_id?: string | null;
                };
                Update: {
                    contexto?: Json;
                    criado_em?: string;
                    email_usuario?: string | null;
                    id?: number;
                    mensagem?: string;
                    origem?: string | null;
                    stack?: string | null;
                    tenant_id?: string | null;
                    url?: string | null;
                    user_agent?: string | null;
                    user_id?: string | null;
                };
                Relationships: [];
            };
            cliente_status_history: {
                Row: {
                    cliente_id: number | null;
                    de_status: string | null;
                    id: number;
                    movido_em: string;
                    movido_por: string | null;
                    para_status: string | null;
                    tenant_id: string | null;
                };
                Insert: {
                    cliente_id?: number | null;
                    de_status?: string | null;
                    id?: number;
                    movido_em?: string;
                    movido_por?: string | null;
                    para_status?: string | null;
                    tenant_id?: string | null;
                };
                Update: {
                    cliente_id?: number | null;
                    de_status?: string | null;
                    id?: number;
                    movido_em?: string;
                    movido_por?: string | null;
                    para_status?: string | null;
                    tenant_id?: string | null;
                };
                Relationships: [];
            };
            clientes_legado: {
                Row: {
                    cep: string | null;
                    complemento: string | null;
                    conta_energia_media: number | null;
                    cpf_cnpj: string | null;
                    created_at: string | null;
                    data_fechamento: string | null;
                    ddi: string | null;
                    email: string | null;
                    endereco_instalacao: string | null;
                    id: number;
                    motivo_perda: string | null;
                    nome: string | null;
                    numero: string | null;
                    responsavel: string | null;
                    responsavel_id: string | null;
                    stage_id: number | null;
                    status: string | null;
                    telefone: string | null;
                    temperatura: string | null;
                    tenant_id: string | null;
                    valor: number | null;
                };
                Insert: {
                    cep?: string | null;
                    complemento?: string | null;
                    conta_energia_media?: number | null;
                    cpf_cnpj?: string | null;
                    created_at?: string | null;
                    data_fechamento?: string | null;
                    ddi?: string | null;
                    email?: string | null;
                    endereco_instalacao?: string | null;
                    id?: number;
                    motivo_perda?: string | null;
                    nome?: string | null;
                    numero?: string | null;
                    responsavel?: string | null;
                    responsavel_id?: string | null;
                    stage_id?: number | null;
                    status?: string | null;
                    telefone?: string | null;
                    temperatura?: string | null;
                    tenant_id?: string | null;
                    valor?: number | null;
                };
                Update: {
                    cep?: string | null;
                    complemento?: string | null;
                    conta_energia_media?: number | null;
                    cpf_cnpj?: string | null;
                    created_at?: string | null;
                    data_fechamento?: string | null;
                    ddi?: string | null;
                    email?: string | null;
                    endereco_instalacao?: string | null;
                    id?: number;
                    motivo_perda?: string | null;
                    nome?: string | null;
                    numero?: string | null;
                    responsavel?: string | null;
                    responsavel_id?: string | null;
                    stage_id?: number | null;
                    status?: string | null;
                    telefone?: string | null;
                    temperatura?: string | null;
                    tenant_id?: string | null;
                    valor?: number | null;
                };
                Relationships: [];
            };
            consentimentos: {
                Row: {
                    base_legal: string;
                    concedido_em: string;
                    created_at: string;
                    detalhes: Json;
                    id: string;
                    origem: string | null;
                    pessoa_id: string | null;
                    revogado_em: string | null;
                    tenant_id: string | null;
                    tipo: string;
                };
                Insert: {
                    base_legal?: string;
                    concedido_em?: string;
                    created_at?: string;
                    detalhes?: Json;
                    id?: string;
                    origem?: string | null;
                    pessoa_id?: string | null;
                    revogado_em?: string | null;
                    tenant_id?: string | null;
                    tipo?: string;
                };
                Update: {
                    base_legal?: string;
                    concedido_em?: string;
                    created_at?: string;
                    detalhes?: Json;
                    id?: string;
                    origem?: string | null;
                    pessoa_id?: string | null;
                    revogado_em?: string | null;
                    tenant_id?: string | null;
                    tipo?: string;
                };
                Relationships: [];
            };
            crm_seeds_aplicados: {
                Row: {
                    aplicado_em: string;
                    chave: string;
                    tenant_id: string;
                };
                Insert: {
                    aplicado_em?: string;
                    chave: string;
                    tenant_id: string;
                };
                Update: {
                    aplicado_em?: string;
                    chave?: string;
                    tenant_id?: string;
                };
                Relationships: [];
            };
            custom_fields: {
                Row: {
                    ativo: boolean;
                    chave: string;
                    created_at: string;
                    entidade: string;
                    id: string;
                    label: string;
                    obrigatorio: boolean;
                    opcoes: Json;
                    ordem: number;
                    tenant_id: string | null;
                    tipo: string;
                };
                Insert: {
                    ativo?: boolean;
                    chave: string;
                    created_at?: string;
                    entidade: string;
                    id?: string;
                    label: string;
                    obrigatorio?: boolean;
                    opcoes?: Json;
                    ordem?: number;
                    tenant_id?: string | null;
                    tipo?: string;
                };
                Update: {
                    ativo?: boolean;
                    chave?: string;
                    created_at?: string;
                    entidade?: string;
                    id?: string;
                    label?: string;
                    obrigatorio?: boolean;
                    opcoes?: Json;
                    ordem?: number;
                    tenant_id?: string | null;
                    tipo?: string;
                };
                Relationships: [];
            };
            documentos_lead: {
                Row: {
                    caminho_storage: string | null;
                    cliente_id: string | null;
                    created_at: string;
                    created_by: string | null;
                    deleted_at: string | null;
                    deleted_by: string | null;
                    enviado_por: string | null;
                    id: string;
                    nome_arquivo: string | null;
                    status: string | null;
                    tamanho_bytes: number | null;
                    tenant_id: string | null;
                    tipo: string | null;
                    versao: number | null;
                };
                Insert: {
                    caminho_storage?: string | null;
                    cliente_id?: string | null;
                    created_at?: string;
                    created_by?: string | null;
                    deleted_at?: string | null;
                    deleted_by?: string | null;
                    enviado_por?: string | null;
                    id?: string;
                    nome_arquivo?: string | null;
                    status?: string | null;
                    tamanho_bytes?: number | null;
                    tenant_id?: string | null;
                    tipo?: string | null;
                    versao?: number | null;
                };
                Update: {
                    caminho_storage?: string | null;
                    cliente_id?: string | null;
                    created_at?: string;
                    created_by?: string | null;
                    deleted_at?: string | null;
                    deleted_by?: string | null;
                    enviado_por?: string | null;
                    id?: string;
                    nome_arquivo?: string | null;
                    status?: string | null;
                    tamanho_bytes?: number | null;
                    tenant_id?: string | null;
                    tipo?: string | null;
                    versao?: number | null;
                };
                Relationships: [];
            };
            empresa_identidade: {
                Row: {
                    cnpj: string | null;
                    condicoes_pagamento: string | null;
                    cor_primaria: string;
                    cor_secundaria: string;
                    created_at: string;
                    email: string | null;
                    endereco: string | null;
                    id: string;
                    logo_path: string | null;
                    nome_fantasia: string | null;
                    observacoes_padrao: string | null;
                    razao_social: string | null;
                    rodape: string | null;
                    site: string | null;
                    telefone: string | null;
                    tenant_id: string;
                    updated_at: string;
                    validade_dias: number;
                };
                Insert: {
                    cnpj?: string | null;
                    condicoes_pagamento?: string | null;
                    cor_primaria?: string;
                    cor_secundaria?: string;
                    created_at?: string;
                    email?: string | null;
                    endereco?: string | null;
                    id?: string;
                    logo_path?: string | null;
                    nome_fantasia?: string | null;
                    observacoes_padrao?: string | null;
                    razao_social?: string | null;
                    rodape?: string | null;
                    site?: string | null;
                    telefone?: string | null;
                    tenant_id?: string;
                    updated_at?: string;
                    validade_dias?: number;
                };
                Update: {
                    cnpj?: string | null;
                    condicoes_pagamento?: string | null;
                    cor_primaria?: string;
                    cor_secundaria?: string;
                    created_at?: string;
                    email?: string | null;
                    endereco?: string | null;
                    id?: string;
                    logo_path?: string | null;
                    nome_fantasia?: string | null;
                    observacoes_padrao?: string | null;
                    razao_social?: string | null;
                    rodape?: string | null;
                    site?: string | null;
                    telefone?: string | null;
                    tenant_id?: string;
                    updated_at?: string;
                    validade_dias?: number;
                };
                Relationships: [];
            };
            empresas: {
                Row: {
                    created_at: string;
                    id: string;
                    nome: string;
                    segmento: string | null;
                };
                Insert: {
                    created_at?: string;
                    id?: string;
                    nome: string;
                    segmento?: string | null;
                };
                Update: {
                    created_at?: string;
                    id?: string;
                    nome?: string;
                    segmento?: string | null;
                };
                Relationships: [];
            };
            funcionarios: {
                Row: {
                    ativo: boolean | null;
                    cargo: string | null;
                    created_at: string;
                    created_by: string | null;
                    deleted_at: string | null;
                    deleted_by: string | null;
                    email: string;
                    id: string;
                    nome: string;
                    telefone: string | null;
                    tenant_id: string | null;
                    user_id: string | null;
                };
                Insert: {
                    ativo?: boolean | null;
                    cargo?: string | null;
                    created_at?: string;
                    created_by?: string | null;
                    deleted_at?: string | null;
                    deleted_by?: string | null;
                    email: string;
                    id?: string;
                    nome: string;
                    telefone?: string | null;
                    tenant_id?: string | null;
                    user_id?: string | null;
                };
                Update: {
                    ativo?: boolean | null;
                    cargo?: string | null;
                    created_at?: string;
                    created_by?: string | null;
                    deleted_at?: string | null;
                    deleted_by?: string | null;
                    email?: string;
                    id?: string;
                    nome?: string;
                    telefone?: string | null;
                    tenant_id?: string | null;
                    user_id?: string | null;
                };
                Relationships: [];
            };
            metas: {
                Row: {
                    created_at: string;
                    funcionario_id: string | null;
                    id: string;
                    mes_referencia: string;
                    target_wins: number;
                    tenant_id: string | null;
                    valor_meta: number;
                };
                Insert: {
                    created_at?: string;
                    funcionario_id?: string | null;
                    id?: string;
                    mes_referencia?: string;
                    target_wins?: number;
                    tenant_id?: string | null;
                    valor_meta?: number;
                };
                Update: {
                    created_at?: string;
                    funcionario_id?: string | null;
                    id?: string;
                    mes_referencia?: string;
                    target_wins?: number;
                    tenant_id?: string | null;
                    valor_meta?: number;
                };
                Relationships: [];
            };
            modelos_mensagem: {
                Row: {
                    assunto: string | null;
                    ativo: boolean;
                    canal: string;
                    created_at: string;
                    created_by: string | null;
                    id: string;
                    nome: string;
                    ordem: number;
                    padrao: boolean;
                    tenant_id: string;
                    texto: string;
                    updated_at: string;
                };
                Insert: {
                    assunto?: string | null;
                    ativo?: boolean;
                    canal?: string;
                    created_at?: string;
                    created_by?: string | null;
                    id?: string;
                    nome: string;
                    ordem?: number;
                    padrao?: boolean;
                    tenant_id?: string;
                    texto: string;
                    updated_at?: string;
                };
                Update: {
                    assunto?: string | null;
                    ativo?: boolean;
                    canal?: string;
                    created_at?: string;
                    created_by?: string | null;
                    id?: string;
                    nome?: string;
                    ordem?: number;
                    padrao?: boolean;
                    tenant_id?: string;
                    texto?: string;
                    updated_at?: string;
                };
                Relationships: [];
            };
            motivos_perda: {
                Row: {
                    ativo: boolean;
                    created_at: string;
                    id: string;
                    nome: string;
                    ordem: number;
                    tenant_id: string | null;
                };
                Insert: {
                    ativo?: boolean;
                    created_at?: string;
                    id?: string;
                    nome: string;
                    ordem?: number;
                    tenant_id?: string | null;
                };
                Update: {
                    ativo?: boolean;
                    created_at?: string;
                    id?: string;
                    nome?: string;
                    ordem?: number;
                    tenant_id?: string | null;
                };
                Relationships: [];
            };
            negocios: {
                Row: {
                    created_at: string;
                    created_by: string | null;
                    dados_extras: Json;
                    data_prevista_fechamento: string | null;
                    deleted_at: string | null;
                    deleted_by: string | null;
                    fechado_em: string | null;
                    id: string;
                    legado_cliente_id: string | null;
                    motivo_perda: string | null;
                    motivo_perda_id: string | null;
                    organizacao_id: string | null;
                    pessoa_contato_principal_id: string | null;
                    pipeline_id: string | null;
                    responsavel: string | null;
                    responsavel_id: string | null;
                    stage_id: number | null;
                    status: string | null;
                    temperatura: string | null;
                    tenant_id: string | null;
                    titulo: string | null;
                    updated_at: string;
                    valor: number | null;
                };
                Insert: {
                    created_at?: string;
                    created_by?: string | null;
                    dados_extras?: Json;
                    data_prevista_fechamento?: string | null;
                    deleted_at?: string | null;
                    deleted_by?: string | null;
                    fechado_em?: string | null;
                    id?: string;
                    legado_cliente_id?: string | null;
                    motivo_perda?: string | null;
                    motivo_perda_id?: string | null;
                    organizacao_id?: string | null;
                    pessoa_contato_principal_id?: string | null;
                    pipeline_id?: string | null;
                    responsavel?: string | null;
                    responsavel_id?: string | null;
                    stage_id?: number | null;
                    status?: string | null;
                    temperatura?: string | null;
                    tenant_id?: string | null;
                    titulo?: string | null;
                    updated_at?: string;
                    valor?: number | null;
                };
                Update: {
                    created_at?: string;
                    created_by?: string | null;
                    dados_extras?: Json;
                    data_prevista_fechamento?: string | null;
                    deleted_at?: string | null;
                    deleted_by?: string | null;
                    fechado_em?: string | null;
                    id?: string;
                    legado_cliente_id?: string | null;
                    motivo_perda?: string | null;
                    motivo_perda_id?: string | null;
                    organizacao_id?: string | null;
                    pessoa_contato_principal_id?: string | null;
                    pipeline_id?: string | null;
                    responsavel?: string | null;
                    responsavel_id?: string | null;
                    stage_id?: number | null;
                    status?: string | null;
                    temperatura?: string | null;
                    tenant_id?: string | null;
                    titulo?: string | null;
                    updated_at?: string;
                    valor?: number | null;
                };
                Relationships: [];
            };
            negocios_pessoas: {
                Row: {
                    created_at: string;
                    id: string;
                    negocio_id: string;
                    papel: string | null;
                    pessoa_id: string;
                    tenant_id: string | null;
                };
                Insert: {
                    created_at?: string;
                    id?: string;
                    negocio_id: string;
                    papel?: string | null;
                    pessoa_id: string;
                    tenant_id?: string | null;
                };
                Update: {
                    created_at?: string;
                    id?: string;
                    negocio_id?: string;
                    papel?: string | null;
                    pessoa_id?: string;
                    tenant_id?: string | null;
                };
                Relationships: [];
            };
            onboarding_empresa: {
                Row: {
                    created_at: string;
                    dispensado_em: string | null;
                    dispensado_por: string | null;
                    id: string;
                    tenant_id: string;
                    updated_at: string;
                };
                Insert: {
                    created_at?: string;
                    dispensado_em?: string | null;
                    dispensado_por?: string | null;
                    id?: string;
                    tenant_id?: string;
                    updated_at?: string;
                };
                Update: {
                    created_at?: string;
                    dispensado_em?: string | null;
                    dispensado_por?: string | null;
                    id?: string;
                    tenant_id?: string;
                    updated_at?: string;
                };
                Relationships: [];
            };
            orcamento_contadores: {
                Row: {
                    ano: number;
                    atualizado_em: string;
                    tenant_id: string;
                    ultimo: number;
                };
                Insert: {
                    ano: number;
                    atualizado_em?: string;
                    tenant_id: string;
                    ultimo?: number;
                };
                Update: {
                    ano?: number;
                    atualizado_em?: string;
                    tenant_id?: string;
                    ultimo?: number;
                };
                Relationships: [];
            };
            orcamento_itens: {
                Row: {
                    created_at: string;
                    desconto_tipo: string;
                    desconto_valor: number;
                    descricao: string;
                    detalhes: string | null;
                    id: string;
                    orcamento_id: string;
                    ordem: number;
                    produto_id: string | null;
                    quantidade: number;
                    tenant_id: string;
                    total: number;
                    unidade: string;
                    updated_at: string;
                    valor_unitario: number;
                };
                Insert: {
                    created_at?: string;
                    desconto_tipo?: string;
                    desconto_valor?: number;
                    descricao: string;
                    detalhes?: string | null;
                    id?: string;
                    orcamento_id: string;
                    ordem?: number;
                    produto_id?: string | null;
                    quantidade?: number;
                    tenant_id?: string;
                    total?: number;
                    unidade?: string;
                    updated_at?: string;
                    valor_unitario?: number;
                };
                Update: {
                    created_at?: string;
                    desconto_tipo?: string;
                    desconto_valor?: number;
                    descricao?: string;
                    detalhes?: string | null;
                    id?: string;
                    orcamento_id?: string;
                    ordem?: number;
                    produto_id?: string | null;
                    quantidade?: number;
                    tenant_id?: string;
                    total?: number;
                    unidade?: string;
                    updated_at?: string;
                    valor_unitario?: number;
                };
                Relationships: [];
            };
            orcamentos: {
                Row: {
                    condicoes_pagamento: string | null;
                    created_at: string;
                    created_by: string;
                    data_emissao: string;
                    decidido_em: string | null;
                    deleted_at: string | null;
                    deleted_by: string | null;
                    desconto_tipo: string;
                    desconto_total: number;
                    desconto_valor: number;
                    enviado_em: string | null;
                    id: string;
                    negocio_id: string;
                    numero: string;
                    numero_ano: number;
                    numero_original: string | null;
                    numero_seq: number;
                    observacoes: string | null;
                    responsavel_email: string | null;
                    responsavel_id: string | null;
                    responsavel_nome: string | null;
                    responsavel_telefone: string | null;
                    revisao: number;
                    status: string;
                    subtotal: number;
                    tenant_id: string;
                    titulo: string | null;
                    total: number;
                    updated_at: string;
                    updated_by: string | null;
                    valido_ate: string;
                    versao_de: string | null;
                };
                Insert: {
                    condicoes_pagamento?: string | null;
                    created_at?: string;
                    created_by?: string;
                    data_emissao?: string;
                    decidido_em?: string | null;
                    deleted_at?: string | null;
                    deleted_by?: string | null;
                    desconto_tipo?: string;
                    desconto_total?: number;
                    desconto_valor?: number;
                    enviado_em?: string | null;
                    id?: string;
                    negocio_id: string;
                    numero: string;
                    numero_ano: number;
                    numero_original?: string | null;
                    numero_seq: number;
                    observacoes?: string | null;
                    responsavel_email?: string | null;
                    responsavel_id?: string | null;
                    responsavel_nome?: string | null;
                    responsavel_telefone?: string | null;
                    revisao?: number;
                    status?: string;
                    subtotal?: number;
                    tenant_id?: string;
                    titulo?: string | null;
                    total?: number;
                    updated_at?: string;
                    updated_by?: string | null;
                    valido_ate: string;
                    versao_de?: string | null;
                };
                Update: {
                    condicoes_pagamento?: string | null;
                    created_at?: string;
                    created_by?: string;
                    data_emissao?: string;
                    decidido_em?: string | null;
                    deleted_at?: string | null;
                    deleted_by?: string | null;
                    desconto_tipo?: string;
                    desconto_total?: number;
                    desconto_valor?: number;
                    enviado_em?: string | null;
                    id?: string;
                    negocio_id?: string;
                    numero?: string;
                    numero_ano?: number;
                    numero_original?: string | null;
                    numero_seq?: number;
                    observacoes?: string | null;
                    responsavel_email?: string | null;
                    responsavel_id?: string | null;
                    responsavel_nome?: string | null;
                    responsavel_telefone?: string | null;
                    revisao?: number;
                    status?: string;
                    subtotal?: number;
                    tenant_id?: string;
                    titulo?: string | null;
                    total?: number;
                    updated_at?: string;
                    updated_by?: string | null;
                    valido_ate?: string;
                    versao_de?: string | null;
                };
                Relationships: [];
            };
            organizacoes: {
                Row: {
                    cnpj: string | null;
                    created_at: string;
                    created_by: string | null;
                    dados_extras: Json;
                    deleted_at: string | null;
                    deleted_by: string | null;
                    email: string | null;
                    endereco: Json;
                    id: string;
                    nome_fantasia: string | null;
                    razao_social: string | null;
                    setor: string | null;
                    site: string | null;
                    tamanho: string | null;
                    telefone: string | null;
                    tenant_id: string | null;
                    updated_at: string;
                };
                Insert: {
                    cnpj?: string | null;
                    created_at?: string;
                    created_by?: string | null;
                    dados_extras?: Json;
                    deleted_at?: string | null;
                    deleted_by?: string | null;
                    email?: string | null;
                    endereco?: Json;
                    id?: string;
                    nome_fantasia?: string | null;
                    razao_social?: string | null;
                    setor?: string | null;
                    site?: string | null;
                    tamanho?: string | null;
                    telefone?: string | null;
                    tenant_id?: string | null;
                    updated_at?: string;
                };
                Update: {
                    cnpj?: string | null;
                    created_at?: string;
                    created_by?: string | null;
                    dados_extras?: Json;
                    deleted_at?: string | null;
                    deleted_by?: string | null;
                    email?: string | null;
                    endereco?: Json;
                    id?: string;
                    nome_fantasia?: string | null;
                    razao_social?: string | null;
                    setor?: string | null;
                    site?: string | null;
                    tamanho?: string | null;
                    telefone?: string | null;
                    tenant_id?: string | null;
                    updated_at?: string;
                };
                Relationships: [];
            };
            pessoas: {
                Row: {
                    anonimizada_em: string | null;
                    cargo: string | null;
                    cpf: string | null;
                    created_at: string;
                    created_by: string | null;
                    dados_extras: Json;
                    ddi: string | null;
                    deleted_at: string | null;
                    deleted_by: string | null;
                    email: string | null;
                    id: string;
                    nome: string | null;
                    organizacao_id: string | null;
                    telefone: string | null;
                    tenant_id: string | null;
                    updated_at: string;
                };
                Insert: {
                    anonimizada_em?: string | null;
                    cargo?: string | null;
                    cpf?: string | null;
                    created_at?: string;
                    created_by?: string | null;
                    dados_extras?: Json;
                    ddi?: string | null;
                    deleted_at?: string | null;
                    deleted_by?: string | null;
                    email?: string | null;
                    id?: string;
                    nome?: string | null;
                    organizacao_id?: string | null;
                    telefone?: string | null;
                    tenant_id?: string | null;
                    updated_at?: string;
                };
                Update: {
                    anonimizada_em?: string | null;
                    cargo?: string | null;
                    cpf?: string | null;
                    created_at?: string;
                    created_by?: string | null;
                    dados_extras?: Json;
                    ddi?: string | null;
                    deleted_at?: string | null;
                    deleted_by?: string | null;
                    email?: string | null;
                    id?: string;
                    nome?: string | null;
                    organizacao_id?: string | null;
                    telefone?: string | null;
                    tenant_id?: string | null;
                    updated_at?: string;
                };
                Relationships: [];
            };
            pipeline_stages: {
                Row: {
                    cor: string | null;
                    dias_para_parado: number | null;
                    ganho: boolean | null;
                    id: number;
                    nome: string | null;
                    ordem: number | null;
                    perdido: boolean | null;
                    pipeline_id: string | null;
                    probabilidade: number | null;
                    tenant_id: string | null;
                };
                Insert: {
                    cor?: string | null;
                    dias_para_parado?: number | null;
                    ganho?: boolean | null;
                    id?: number;
                    nome?: string | null;
                    ordem?: number | null;
                    perdido?: boolean | null;
                    pipeline_id?: string | null;
                    probabilidade?: number | null;
                    tenant_id?: string | null;
                };
                Update: {
                    cor?: string | null;
                    dias_para_parado?: number | null;
                    ganho?: boolean | null;
                    id?: number;
                    nome?: string | null;
                    ordem?: number | null;
                    perdido?: boolean | null;
                    pipeline_id?: string | null;
                    probabilidade?: number | null;
                    tenant_id?: string | null;
                };
                Relationships: [];
            };
            pipelines: {
                Row: {
                    ativo: boolean;
                    created_at: string;
                    id: string;
                    nome: string;
                    ordem: number;
                    tenant_id: string | null;
                    updated_at: string;
                };
                Insert: {
                    ativo?: boolean;
                    created_at?: string;
                    id?: string;
                    nome: string;
                    ordem?: number;
                    tenant_id?: string | null;
                    updated_at?: string;
                };
                Update: {
                    ativo?: boolean;
                    created_at?: string;
                    id?: string;
                    nome?: string;
                    ordem?: number;
                    tenant_id?: string | null;
                    updated_at?: string;
                };
                Relationships: [];
            };
            planos: {
                Row: {
                    ativo: boolean;
                    created_at: string;
                    id: string;
                    max_leads: number | null;
                    max_storage_mb: number | null;
                    max_usuarios: number | null;
                    nome: string;
                    preco_mensal: number;
                };
                Insert: {
                    ativo?: boolean;
                    created_at?: string;
                    id?: string;
                    max_leads?: number | null;
                    max_storage_mb?: number | null;
                    max_usuarios?: number | null;
                    nome: string;
                    preco_mensal?: number;
                };
                Update: {
                    ativo?: boolean;
                    created_at?: string;
                    id?: string;
                    max_leads?: number | null;
                    max_storage_mb?: number | null;
                    max_usuarios?: number | null;
                    nome?: string;
                    preco_mensal?: number;
                };
                Relationships: [];
            };
            plataforma_config: {
                Row: {
                    cadastro_aberto: boolean;
                    id: boolean;
                    updated_at: string;
                };
                Insert: {
                    cadastro_aberto?: boolean;
                    id?: boolean;
                    updated_at?: string;
                };
                Update: {
                    cadastro_aberto?: boolean;
                    id?: boolean;
                    updated_at?: string;
                };
                Relationships: [];
            };
            politicas_retencao: {
                Row: {
                    ativo: boolean;
                    created_at: string;
                    dias_retencao: number;
                    entidade: string;
                    id: string;
                    tenant_id: string;
                };
                Insert: {
                    ativo?: boolean;
                    created_at?: string;
                    dias_retencao?: number;
                    entidade?: string;
                    id?: string;
                    tenant_id: string;
                };
                Update: {
                    ativo?: boolean;
                    created_at?: string;
                    dias_retencao?: number;
                    entidade?: string;
                    id?: string;
                    tenant_id?: string;
                };
                Relationships: [];
            };
            produtos: {
                Row: {
                    ativo: boolean;
                    created_at: string;
                    created_by: string | null;
                    descricao: string | null;
                    id: string;
                    nome: string;
                    preco_padrao: number;
                    tenant_id: string;
                    unidade: string;
                    updated_at: string;
                };
                Insert: {
                    ativo?: boolean;
                    created_at?: string;
                    created_by?: string | null;
                    descricao?: string | null;
                    id?: string;
                    nome: string;
                    preco_padrao?: number;
                    tenant_id?: string;
                    unidade?: string;
                    updated_at?: string;
                };
                Update: {
                    ativo?: boolean;
                    created_at?: string;
                    created_by?: string | null;
                    descricao?: string | null;
                    id?: string;
                    nome?: string;
                    preco_padrao?: number;
                    tenant_id?: string;
                    unidade?: string;
                    updated_at?: string;
                };
                Relationships: [];
            };
            rate_limit_hits: {
                Row: {
                    ator: string;
                    chave: string;
                    criado_em: string;
                    id: number;
                };
                Insert: {
                    ator: string;
                    chave: string;
                    criado_em?: string;
                    id?: number;
                };
                Update: {
                    ator?: string;
                    chave?: string;
                    criado_em?: string;
                    id?: number;
                };
                Relationships: [];
            };
            system_admins: {
                Row: {
                    created_at: string;
                    email: string;
                    id: string;
                };
                Insert: {
                    created_at?: string;
                    email: string;
                    id?: string;
                };
                Update: {
                    created_at?: string;
                    email?: string;
                    id?: string;
                };
                Relationships: [];
            };
            tarefas: {
                Row: {
                    cliente_id: string | null;
                    concluido: boolean | null;
                    concluido_em: string | null;
                    created_at: string;
                    created_by: string | null;
                    data_vencimento: string | null;
                    deleted_at: string | null;
                    deleted_by: string | null;
                    descricao: string | null;
                    execucao_status: string | null;
                    id: number;
                    responsavel: string | null;
                    tenant_id: string | null;
                    tipo: string | null;
                    titulo: string;
                };
                Insert: {
                    cliente_id?: string | null;
                    concluido?: boolean | null;
                    concluido_em?: string | null;
                    created_at?: string;
                    created_by?: string | null;
                    data_vencimento?: string | null;
                    deleted_at?: string | null;
                    deleted_by?: string | null;
                    descricao?: string | null;
                    execucao_status?: string | null;
                    id?: number;
                    responsavel?: string | null;
                    tenant_id?: string | null;
                    tipo?: string | null;
                    titulo: string;
                };
                Update: {
                    cliente_id?: string | null;
                    concluido?: boolean | null;
                    concluido_em?: string | null;
                    created_at?: string;
                    created_by?: string | null;
                    data_vencimento?: string | null;
                    deleted_at?: string | null;
                    deleted_by?: string | null;
                    descricao?: string | null;
                    execucao_status?: string | null;
                    id?: number;
                    responsavel?: string | null;
                    tenant_id?: string | null;
                    tipo?: string | null;
                    titulo?: string;
                };
                Relationships: [];
            };
            tenant_features: {
                Row: {
                    created_at: string;
                    enabled: boolean;
                    feature_key: string;
                    id: string;
                    tenant_id: string;
                };
                Insert: {
                    created_at?: string;
                    enabled?: boolean;
                    feature_key: string;
                    id?: string;
                    tenant_id: string;
                };
                Update: {
                    created_at?: string;
                    enabled?: boolean;
                    feature_key?: string;
                    id?: string;
                    tenant_id?: string;
                };
                Relationships: [];
            };
            tenant_planos: {
                Row: {
                    ativo_desde: string;
                    created_at: string;
                    id: string;
                    plano_id: string;
                    tenant_id: string;
                };
                Insert: {
                    ativo_desde?: string;
                    created_at?: string;
                    id?: string;
                    plano_id: string;
                    tenant_id: string;
                };
                Update: {
                    ativo_desde?: string;
                    created_at?: string;
                    id?: string;
                    plano_id?: string;
                    tenant_id?: string;
                };
                Relationships: [];
            };
            tipos_atividade: {
                Row: {
                    ativo: boolean;
                    created_at: string;
                    icone: string | null;
                    id: string;
                    nome: string;
                    ordem: number;
                    tenant_id: string | null;
                };
                Insert: {
                    ativo?: boolean;
                    created_at?: string;
                    icone?: string | null;
                    id?: string;
                    nome: string;
                    ordem?: number;
                    tenant_id?: string | null;
                };
                Update: {
                    ativo?: boolean;
                    created_at?: string;
                    icone?: string | null;
                    id?: string;
                    nome?: string;
                    ordem?: number;
                    tenant_id?: string | null;
                };
                Relationships: [];
            };
            utilizadores_empresas: {
                Row: {
                    auth_uid: string | null;
                    created_at: string;
                    empresa_id: string | null;
                    id: string;
                    role: string | null;
                };
                Insert: {
                    auth_uid?: string | null;
                    created_at?: string;
                    empresa_id?: string | null;
                    id?: string;
                    role?: string | null;
                };
                Update: {
                    auth_uid?: string | null;
                    created_at?: string;
                    empresa_id?: string | null;
                    id?: string;
                    role?: string | null;
                };
                Relationships: [];
            };
        };
        Views: {
            clientes: {
                Row: {
                    cep: string | null;
                    complemento: string | null;
                    conta_energia_media: number | null;
                    cpf_cnpj: string | null;
                    created_at: string | null;
                    dados_extras: Json | null;
                    data_fechamento: string | null;
                    data_prevista_fechamento: string | null;
                    ddi: string | null;
                    email: string | null;
                    endereco_instalacao: string | null;
                    fechado_em: string | null;
                    id: string | null;
                    motivo_perda: string | null;
                    nome: string | null;
                    numero: string | null;
                    organizacao_id: string | null;
                    pessoa_contato_principal_id: string | null;
                    pipeline_id: string | null;
                    responsavel: string | null;
                    responsavel_id: string | null;
                    stage_id: number | null;
                    status: string | null;
                    telefone: string | null;
                    temperatura: string | null;
                    tenant_id: string | null;
                    titulo: string | null;
                    updated_at: string | null;
                    valor: number | null;
                };
                Insert: {
                    cep?: string | null;
                    complemento?: string | null;
                    conta_energia_media?: number | null;
                    cpf_cnpj?: string | null;
                    created_at?: string | null;
                    dados_extras?: Json | null;
                    data_fechamento?: string | null;
                    data_prevista_fechamento?: string | null;
                    ddi?: string | null;
                    email?: string | null;
                    endereco_instalacao?: string | null;
                    fechado_em?: string | null;
                    id?: string | null;
                    motivo_perda?: string | null;
                    nome?: string | null;
                    numero?: string | null;
                    organizacao_id?: string | null;
                    pessoa_contato_principal_id?: string | null;
                    pipeline_id?: string | null;
                    responsavel?: string | null;
                    responsavel_id?: string | null;
                    stage_id?: number | null;
                    status?: string | null;
                    telefone?: string | null;
                    temperatura?: string | null;
                    tenant_id?: string | null;
                    titulo?: string | null;
                    updated_at?: string | null;
                    valor?: number | null;
                };
                Update: {
                    cep?: string | null;
                    complemento?: string | null;
                    conta_energia_media?: number | null;
                    cpf_cnpj?: string | null;
                    created_at?: string | null;
                    dados_extras?: Json | null;
                    data_fechamento?: string | null;
                    data_prevista_fechamento?: string | null;
                    ddi?: string | null;
                    email?: string | null;
                    endereco_instalacao?: string | null;
                    fechado_em?: string | null;
                    id?: string | null;
                    motivo_perda?: string | null;
                    nome?: string | null;
                    numero?: string | null;
                    organizacao_id?: string | null;
                    pessoa_contato_principal_id?: string | null;
                    pipeline_id?: string | null;
                    responsavel?: string | null;
                    responsavel_id?: string | null;
                    stage_id?: number | null;
                    status?: string | null;
                    telefone?: string | null;
                    temperatura?: string | null;
                    tenant_id?: string | null;
                    titulo?: string | null;
                    updated_at?: string | null;
                    valor?: number | null;
                };
                Relationships: [];
            };
            vw_automacoes_resumo: {
                Row: {
                    automacao_id: string | null;
                    tenant_id: string | null;
                    total_erros: number | null;
                    total_execucoes: number | null;
                    ultima_execucao_em: string | null;
                    ultimo_erro_em: string | null;
                };
                Relationships: [];
            };
            vw_dashboard_kpis: {
                Row: {
                    pipeline_id: string | null;
                    responsavel: string | null;
                    stage_id: number | null;
                    status: string | null;
                    temperatura: string | null;
                    tenant_id: string | null;
                    total_leads: number | null;
                    valor_ponderado: number | null;
                    valor_total: number | null;
                };
                Relationships: [];
            };
            vw_kanban_kpis: {
                Row: {
                    pipeline_id: string | null;
                    responsavel: string | null;
                    stage_id: number | null;
                    status: string | null;
                    temperatura: string | null;
                    tenant_id: string | null;
                    total_leads: number | null;
                    valor_ponderado: number | null;
                    valor_total: number | null;
                };
                Relationships: [];
            };
            vw_negocios_saude: {
                Row: {
                    aberto: boolean | null;
                    conta_energia_media: number | null;
                    created_at: string | null;
                    created_by: string | null;
                    ddi: string | null;
                    dias_para_parado: number | null;
                    dias_sem_atividade: number | null;
                    dias_sem_contato: number | null;
                    email: string | null;
                    endereco_instalacao: string | null;
                    etapa_nome: string | null;
                    id: string | null;
                    motivo_perda: string | null;
                    nome: string | null;
                    parado: boolean | null;
                    pipeline_id: string | null;
                    proxima_tarefa_atrasada: boolean | null;
                    proxima_tarefa_em: string | null;
                    proxima_tarefa_tipo: string | null;
                    proxima_tarefa_titulo: string | null;
                    responsavel: string | null;
                    responsavel_id: string | null;
                    sem_proximo_passo: boolean | null;
                    stage_id: number | null;
                    status: string | null;
                    telefone: string | null;
                    temperatura: string | null;
                    temperatura_ordem: number | null;
                    tenant_id: string | null;
                    titulo: string | null;
                    ultima_atividade_em: string | null;
                    ultimo_contato_em: string | null;
                    updated_at: string | null;
                    valor: number | null;
                };
                Relationships: [];
            };
            vw_orcamentos_lista: {
                Row: {
                    cliente_nome: string | null;
                    condicoes_pagamento: string | null;
                    created_at: string | null;
                    created_by: string | null;
                    data_emissao: string | null;
                    deleted_at: string | null;
                    desconto_tipo: string | null;
                    desconto_total: number | null;
                    desconto_valor: number | null;
                    id: string | null;
                    negocio_id: string | null;
                    numero: string | null;
                    numero_original: string | null;
                    observacoes: string | null;
                    responsavel_email: string | null;
                    responsavel_id: string | null;
                    responsavel_nome: string | null;
                    responsavel_telefone: string | null;
                    revisao: number | null;
                    status: string | null;
                    subtotal: number | null;
                    tenant_id: string | null;
                    titulo: string | null;
                    total: number | null;
                    updated_at: string | null;
                    valido_ate: string | null;
                    versao_de: string | null;
                };
                Relationships: [];
            };
            vw_orcamentos_resumo: {
                Row: {
                    abertos: number | null;
                    aceitos: number | null;
                    decididos: number | null;
                    responsaveis: string[] | null;
                    tem_sem_responsavel: boolean | null;
                    tenant_id: string | null;
                    valor_aberto: number | null;
                    valor_aceito: number | null;
                };
                Relationships: [];
            };
            vw_performance_vendedores: {
                Row: {
                    funcionario_id: string | null;
                    mes_referencia: string | null;
                    tenant_id: string | null;
                    vendas_qtd: number | null;
                    vendas_valor: number | null;
                };
                Relationships: [];
            };
            vw_vendas_por_origem: {
                Row: {
                    mes_cadastro: string | null;
                    origem: string | null;
                    responsavel: string | null;
                    stage_id: number | null;
                    status: string | null;
                    tenant_id: string | null;
                    total_leads: number | null;
                    valor_total: number | null;
                };
                Relationships: [];
            };
        };
        Functions: {
            alterar_papel_membro: { Args: { p_user_id: string; p_papel: string }; Returns: Json };
            atualizar_meu_perfil: { Args: { p_nome: string; p_telefone?: string | null }; Returns: Json };
            check_feature: { Args: { p_feature_key: string; p_tenant_id?: string | null }; Returns: boolean };
            current_tenant_id: { Args: Record<PropertyKey, never>; Returns: string };
            definir_meta_mensal: { Args: { p_funcionario_id: string; p_mes: string; p_valor: number; p_ganhos?: number | null }; Returns: undefined };
            eh_admin_do_tenant: { Args: { p_tenant_id?: string | null }; Returns: boolean };
            equipe_concluir_criacao: { Args: { p_user_id: string; p_nome: string; p_cargo?: string | null; p_role?: string | null }; Returns: Json };
            equipe_preparar_criacao: { Args: { p_email: string; p_nome: string }; Returns: Json };
            equipe_remover_membro: { Args: { p_user_id: string }; Returns: Json };
            excluir_etapa: { Args: { p_stage_id: number; p_destino_id?: number | null }; Returns: number };
            get_tenant_segmento: { Args: { p_tenant_id: string }; Returns: string };
            identidade_cnpj_valido: { Args: { p_cnpj: string }; Returns: boolean };
            importar_leads: { Args: { p_linhas: Json }; Returns: Json };
            is_system_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
            lgpd_apagar_dados_titular: { Args: { p_pessoa_id: string }; Returns: { resultado: string; storage_paths_para_excluir: string[] }[] };
            lgpd_exportar_dados_titular: { Args: { p_pessoa_id: string }; Returns: Json };
            log_acesso_titular: { Args: { p_pessoa_id: string; p_contexto?: string | null }; Returns: undefined };
            membro_do_tenant: { Args: { p_tenant_id: string }; Returns: boolean };
            nome_do_usuario_atual: { Args: Record<PropertyKey, never>; Returns: string };
            normalizar_papel: { Args: { p_papel: string }; Returns: string };
            nova_versao_orcamento: { Args: { p_orcamento_id: string }; Returns: string };
            provisionar_tenant: { Args: { p_nome_empresa: string; p_segmento?: string | null }; Returns: string };
            registrar_documento_lead: { Args: { p_cliente_id: string; p_tipo: string; p_nome_arquivo: string; p_caminho_storage: string; p_tamanho_bytes: number }; Returns: Json };
            registrar_erro_cliente: { Args: { p_mensagem: string; p_stack?: string | null; p_url?: string | null; p_user_agent?: string | null; p_origem?: string | null; p_contexto?: Json | null }; Returns: undefined };
            requisicao_api_publica: { Args: Record<PropertyKey, never>; Returns: boolean };
            restaurar_registro: { Args: { p_tabela: string; p_id: string }; Returns: boolean };
            rotulo_temperatura: { Args: { p_valor: string }; Returns: string };
            salvar_automacao: { Args: { p_automacao: Json; p_acoes: Json }; Returns: string };
            salvar_membro_equipe: { Args: { p_funcionario_id: string; p_nome: string; p_email?: string | null; p_cargo?: string | null; p_ativo?: boolean | null; p_papel?: string | null; p_meta_mensal?: number | null }; Returns: undefined };
            salvar_metas_mes: { Args: { p_mes: string; p_metas: Json }; Returns: number };
            salvar_orcamento: { Args: { p_orcamento: Json; p_itens: Json }; Returns: string };
            status_primeiro_acesso: { Args: Record<PropertyKey, never>; Returns: Json };
            tem_coluna: { Args: { p_tabela: string; p_coluna: string }; Returns: boolean };
            tenant_filter: { Args: { p_tenant_id: string }; Returns: boolean };
            tenant_solicitado: { Args: Record<PropertyKey, never>; Returns: string };
            to_numeric_seguro: { Args: { p_valor: string }; Returns: number };
            uso_do_tenant: { Args: { p_tenant_id: string }; Returns: { recurso: string; usado: number; limite: number }[] };
        };
        Enums: {
            [_ in never]: never;
        };
        CompositeTypes: {
            [_ in never]: never;
        };
    };
};

type Publico = Database["public"];

/** Linha lida de uma tabela ou view. */
export type Linha<T extends keyof (Publico["Tables"] & Publico["Views"])> = (Publico["Tables"] &
    Publico["Views"])[T]["Row"];
/** Payload de inserção em uma tabela. */
export type Insercao<T extends keyof Publico["Tables"]> = Publico["Tables"][T]["Insert"];
/** Payload de alteração em uma tabela. */
export type Alteracao<T extends keyof Publico["Tables"]> = Publico["Tables"][T]["Update"];
