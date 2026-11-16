import type { DocumentoLeadRecord } from "../types/db";
import { supabaseClient } from "../utility";

export const LEAD_FILES_BUCKET = "lead-files";
export const MAX_PDF_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB — limite reduzido

export type LeadTimelineEntry = {
    id: string;
    type: "nota" | "ligacao" | "status" | "temperatura" | "automacao" | "upload" | "outro";
    title: string;
    description?: string;
    createdAt?: string;
    author?: string;
    fromStatus?: string;
    toStatus?: string;
    fileName?: string;
    filePath?: string;
    fileUrl?: string;
};

export type LeadStoredFile = {
    id: string;
    nomeArquivo: string;
    caminhoStorage: string;
    tipo: LeadDocumentType | "arquivo";
    tamanhoBytes: number;
    versao: number;
    status: string;
    createdAt?: string;
    enviadoPor?: string;
    /** Login de quem anexou (documentos_lead.created_by, migration 12). */
    criadoPor?: string;
    fileType: "proposta" | "conta_luz" | "arquivo";
    canDelete: boolean;
    url?: string;
};

export type LeadDocumentType = "proposta" | "conta_luz";

export type UploadNewLeadDocumentResult = {
    success: true;
    path: string;
    documentId?: string;
    version: number;
    status: "ativo";
};

export type LeadUploadProgressStatus = "enviando" | "processando" | "concluido";

type ActivityInsertInput = {
    leadId: string | number;
    activityType: string;
    title?: string;
    description?: string;
    fileName?: string;
    filePath?: string;
};

const asString = (value: unknown): string | undefined => {
    if (typeof value !== "string") {
        return undefined;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
};

const firstString = (...values: unknown[]): string | undefined => {
    for (const value of values) {
        const parsed = asString(value);
        if (parsed) {
            return parsed;
        }
    }

    return undefined;
};

export const toTimelineType = (
    rawType?: string,
    fromStatus?: string,
    toStatus?: string,
): LeadTimelineEntry["type"] => {
    if (fromStatus || toStatus) {
        return "status";
    }

    const value = (rawType || "").toLowerCase();
    // Mudança de temperatura (trigger da migration 15: "Morno → Quente, por Fulano")
    if (value.includes("temperatura")) return "temperatura";
    // Ação de automação (migration 17: "Automação «nome» criou a tarefa «X»")
    if (value.includes("automa")) return "automacao";
    if (value.includes("liga")) return "ligacao";
    if (value.includes("status")) return "status";
    if (value.includes("upload") || value.includes("arquivo") || value.includes("pdf")) return "upload";
    if (value.includes("nota") || value.includes("obs")) return "nota";
    return "outro";
};

const toTimelineTitle = (
    type: LeadTimelineEntry["type"],
    fromStatus?: string,
    toStatus?: string,
    rawTitle?: string,
): string => {
    if (rawTitle) {
        return rawTitle;
    }

    if (type === "status") {
        if (fromStatus && toStatus) {
            return `Status alterado: ${fromStatus} -> ${toStatus}`;
        }
        if (toStatus) {
            return `Status alterado para ${toStatus}`;
        }
        return "Status alterado";
    }

    if (type === "ligacao") return "Ligação registrada";
    if (type === "upload") return "Arquivo anexado";
    if (type === "nota") return "Nota registrada";
    return "Atividade registrada";
};

// Colunas reais de atividades_lead (migration 00). A tabela guarda cada
// campo em português e em inglês — herança de versões antigas: as linhas
// gravadas pelos triggers preenchem as duas, as gravadas daqui só as em
// português. A leitura aceita qualquer uma.
const COLUNAS_ATIVIDADE =
    "id,tipo,activity_type,titulo,title,descricao,notes,criado_por,author," +
    "de_status,from_status,para_status,to_status,arquivo_nome,file_name,arquivo_path,file_path,created_at";

const parseActivityRow = (row: Record<string, unknown>): LeadTimelineEntry => {
    const fromStatus = firstString(row.de_status, row.from_status);
    const toStatus = firstString(row.para_status, row.to_status);
    const type = toTimelineType(firstString(row.tipo, row.activity_type), fromStatus, toStatus);

    return {
        id: `atividade-${String(row.id)}`,
        type,
        title: toTimelineTitle(type, fromStatus, toStatus, firstString(row.titulo, row.title)),
        description: firstString(row.descricao, row.notes),
        createdAt: firstString(row.created_at),
        author: firstString(row.criado_por, row.author),
        fromStatus,
        toStatus,
        fileName: firstString(row.arquivo_nome, row.file_name),
        filePath: firstString(row.arquivo_path, row.file_path),
    };
};

const VALIDADE_LINK_SEGUNDOS = 60 * 60;
/** As atividades mais recentes do lead; um lead muito antigo não trava a tela ao abrir. */
const LIMITE_DA_TIMELINE = 500;

/**
 * O link do arquivo é assinado na hora de exibir. Antes a URL assinada era
 * gravada no banco junto com a atividade — e ela vence: no dia seguinte o
 * "Abrir arquivo" da timeline dava erro. Sem link (arquivo removido ou
 * falha ao assinar) a entrada continua aparecendo, com o caminho.
 */
const assinarArquivos = async (entries: LeadTimelineEntry[]): Promise<LeadTimelineEntry[]> => {
    const caminhos = [...new Set(entries.map((entry) => entry.filePath).filter((c): c is string => Boolean(c)))];
    if (caminhos.length === 0) return entries;

    const { data, error } = await supabaseClient.storage
        .from(LEAD_FILES_BUCKET)
        .createSignedUrls(caminhos, VALIDADE_LINK_SEGUNDOS);
    if (error || !data) return entries;

    const urlPorCaminho = new Map<string, string>();
    data.forEach((item) => {
        if (item.path && item.signedUrl && !item.error) urlPorCaminho.set(item.path, item.signedUrl);
    });
    return entries.map((entry) =>
        entry.filePath ? { ...entry, fileUrl: urlPorCaminho.get(entry.filePath) } : entry,
    );
};

/**
 * Timeline do lead, da mais recente para a mais antiga. As mudanças de
 * etapa e de temperatura chegam pela própria atividades_lead (triggers do
 * banco); não há segunda fonte para juntar.
 */
export const fetchLeadTimeline = async (leadId: string | number): Promise<LeadTimelineEntry[]> => {
    const { data, error } = await supabaseClient
        .from("atividades_lead")
        .select(COLUNAS_ATIVIDADE)
        .eq("cliente_id", String(leadId))
        .order("created_at", { ascending: false })
        .limit(LIMITE_DA_TIMELINE);
    if (error) throw error;

    // "as unknown": com a lista de colunas montada por concatenação o
    // supabase-js não infere o tipo da linha.
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    return assinarArquivos(rows.map(parseActivityRow));
};

/**
 * Registra uma atividade manual (nota, ligação, envio de arquivo).
 * Data, autor e empresa são carimbados pelo banco (migrations 18 e 19) —
 * por isso não são enviados. Lança o erro do banco se a gravação falhar.
 */
export const addLeadActivity = async (input: ActivityInsertInput): Promise<void> => {
    const { error } = await supabaseClient.from("atividades_lead").insert({
        cliente_id: String(input.leadId),
        tipo: input.activityType,
        titulo: input.title || input.activityType,
        descricao: input.description || "",
        ...(input.fileName ? { arquivo_nome: input.fileName } : {}),
        ...(input.filePath ? { arquivo_path: input.filePath } : {}),
    });
    if (error) throw error;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Depois da virada (clientes vira view sobre negocios) o id do lead é UUID;
 * antes, era o bigint da tabela antiga.
 */
export const ehIdDoModeloNovo = (id: unknown): boolean =>
    typeof id === "string" && UUID_RE.test(id);

const sanitizeFileName = (fileName: string): string => {
    return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
};

const sanitizeStorageBaseName = (fileName: string): string => {
    const withoutExtension = fileName.replace(/\.[^/.]+$/, "");
    const sanitized = sanitizeFileName(withoutExtension)
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");

    return sanitized || "documento";
};

const inferFileType = (fileName: string): LeadStoredFile["fileType"] => {
    const value = fileName.toLowerCase();
    if (value.includes("proposta")) return "proposta";
    if (value.includes("conta")) return "conta_luz";
    return "arquivo";
};

export const uploadLeadPdf = async (params: {
    leadId: string | number;
    file: File;
    kind: "proposta" | "conta_luz";
    tenantId?: string | null;
    author?: string;
    onStatusChange?: (status: LeadUploadProgressStatus) => void;
}): Promise<LeadStoredFile> => {
    const result = await uploadNewLeadDocument(
        params.leadId,
        params.file,
        params.kind,
        params.tenantId,
        params.onStatusChange,
    );
    const path = result.path;

    const signedResult = await supabaseClient.storage
        .from(LEAD_FILES_BUCKET)
        .createSignedUrl(path, 60 * 60 * 24);

    const url = signedResult.data?.signedUrl;

    await addLeadActivity({
        leadId: params.leadId,
        activityType: `upload_${params.kind}`,
        title: `Upload de ${params.kind === "proposta" ? "proposta" : "conta de luz"}`,
        description: `Arquivo enviado: ${params.file.name}`,
        fileName: params.file.name,
        filePath: path,
    });

    return {
        id: String(result.documentId || path),
        nomeArquivo: params.file.name,
        caminhoStorage: path,
        tipo: params.kind,
        tamanhoBytes: params.file.size,
        versao: result.version,
        status: result.status,
        createdAt: new Date().toISOString(),
        enviadoPor: params.author,
        fileType: params.kind,
        canDelete: true,
        url,
    };
};

/**
 * Todo PDF começa com "%PDF-". Extensão e tipo MIME vêm do navegador e são
 * triviais de trocar: sem isto um executável renomeado para .pdf iria para o
 * bucket (que confia no content-type declarado no upload).
 */
export const temAssinaturaPdf = async (file: Blob): Promise<boolean> => {
    const inicio = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    return String.fromCharCode(...inicio) === "%PDF-";
};

export const uploadNewLeadDocument = async (
    clienteId: string | number,
    file: File,
    tipo: LeadDocumentType,
    tenantId?: string | null,
    onStatusChange?: (status: LeadUploadProgressStatus) => void,
): Promise<UploadNewLeadDocumentResult> => {
    const isPdf =
        file.type === "application/pdf" || file.name.toLowerCase().trim().endsWith(".pdf");
    if (!isPdf || !(await temAssinaturaPdf(file))) {
        throw new Error("Apenas arquivos PDF são permitidos para documentos do lead.");
    }

    if (file.size > MAX_PDF_FILE_SIZE_BYTES) {
        throw new Error(
            `Arquivo acima do limite permitido (${Math.floor(MAX_PDF_FILE_SIZE_BYTES / (1024 * 1024))}MB).`,
        );
    }

    const timestamp = Date.now();
    const sanitizedBaseName = sanitizeStorageBaseName(file.name);
    const storageFileName = `${timestamp}_${sanitizedBaseName}.pdf`;
    // Segurança: a policy do Storage exige path {tenant_id}/... — sem tenant
    // resolvido o upload seria rejeitado pelo banco de qualquer forma.
    const resolvedTenantId = (tenantId || "").toString().trim();
    if (!resolvedTenantId) {
        throw new Error(
            "Tenant não identificado para o upload. Recarregue a página e tente novamente.",
        );
    }
    const path = `${resolvedTenantId}/${String(clienteId)}/${storageFileName}`;

    onStatusChange?.("enviando");
    const { error: uploadError } = await supabaseClient.storage
        .from(LEAD_FILES_BUCKET)
        .upload(path, file, {
            cacheControl: "3600",
            upsert: false,
            contentType: "application/pdf",
        });

    if (uploadError) {
        throw new Error(`Falha ao enviar o arquivo para o Storage: ${uploadError.message}`);
    }

    onStatusChange?.("processando");
    // Versão, substituição das anteriores e registro acontecem no banco, numa
    // transação (registrar_documento_lead). Se ele recusar, o arquivo recém-
    // enviado é removido e o documento ativo anterior continua valendo.
    const { data: registro, error: documentError } = await supabaseClient.rpc("registrar_documento_lead", {
        p_cliente_id: String(clienteId),
        p_tipo: tipo,
        p_nome_arquivo: file.name,
        p_caminho_storage: path,
        p_tamanho_bytes: file.size,
    });

    if (documentError) {
        await supabaseClient.storage.from(LEAD_FILES_BUCKET).remove([path]);
        throw new Error(`Não foi possível registrar o documento: ${documentError.message}`);
    }
    const registrado = (registro ?? {}) as { id?: string; versao?: number };

    onStatusChange?.("concluido");

    return {
        success: true,
        path,
        documentId: registrado.id ? String(registrado.id) : undefined,
        version: typeof registrado.versao === "number" ? registrado.versao : 1,
        status: "ativo",
    };
};

export const listLeadFiles = async (leadId: string | number): Promise<LeadStoredFile[]> => {
    const { data, error } = await supabaseClient
        .from("documentos_lead")
        .select("*")
        .eq("cliente_id", String(leadId))
        .order("created_at", { ascending: false });

    if (error) throw error;

    const rows = (data || []) as DocumentoLeadRecord[];
    const visibleRows = rows.filter((row) => {
        const status = String(row.status || "ativo").toLowerCase();
        return status !== "excluido";
    });

    const files = await Promise.all(
        visibleRows.map(async (item) => {
            const nomeArquivo = String(item.nome_arquivo || "documento.pdf");
            const fullPath = String(item.caminho_storage || "");
            const fileType = (item.tipo as LeadDocumentType) || inferFileType(nomeArquivo);
            const size = typeof item.tamanho_bytes === "number" ? item.tamanho_bytes : 0;
            const versao = typeof item.versao === "number" ? item.versao : 1;
            const status = String(item.status || "ativo");

            if (!fullPath) {
                return {
                    id: String(item.id),
                    nomeArquivo,
                    caminhoStorage: "",
                    tipo: fileType,
                    tamanhoBytes: size,
                    versao,
                    status,
                    createdAt: item.created_at || undefined,
                    enviadoPor: item.enviado_por || undefined,
                    criadoPor: item.created_by || undefined,
                    fileType,
                    canDelete: true,
                    url: undefined,
                } as LeadStoredFile;
            }

            const signedResult = await supabaseClient.storage
                .from(LEAD_FILES_BUCKET)
                .createSignedUrl(fullPath, 60 * 60 * 12);

            return {
                id: String(item.id),
                nomeArquivo,
                caminhoStorage: fullPath,
                tipo: fileType,
                tamanhoBytes: size,
                versao,
                status,
                createdAt: item.created_at || undefined,
                enviadoPor: item.enviado_por || undefined,
                criadoPor: item.created_by || undefined,
                fileType,
                canDelete: true,
                url: signedResult.data?.signedUrl,
            } as LeadStoredFile;
        }),
    );

    return files;
};

export const softDeleteLeadDocument = async (params: {
    documentId: string | number;
    storagePath?: string | null;
    tenantId?: string | null;
}): Promise<void> => {
    const { documentId, storagePath, tenantId } = params;

    const updateQuery = supabaseClient
        .from("documentos_lead")
        .update({ status: "excluido", deleted_at: new Date().toISOString() })
        .eq("id", String(documentId));

    const { error } = tenantId ? await updateQuery.eq("tenant_id", tenantId) : await updateQuery;

    if (error) {
        throw new Error(`Falha ao excluir documento: ${error.message}`);
    }

    if (storagePath) {
        await supabaseClient.storage.from(LEAD_FILES_BUCKET).remove([storagePath]);
    }
};