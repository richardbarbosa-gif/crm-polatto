import { isSupabaseMissingColumn, isSupabaseMissingRelation } from "./supabaseErrors";
import type { DocumentoLeadRecord } from "../types/db";
import { supabaseClient } from "../utility";

export const LEAD_FILES_BUCKET = "lead-files";
export const MAX_PDF_FILE_SIZE_BYTES = 15 * 1024 * 1024;

export type LeadTimelineEntry = {
    id: string;
    type: "nota" | "ligacao" | "status" | "upload" | "outro";
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
    status: "concluido";
};

export type LeadUploadProgressStatus = "enviando" | "processando" | "concluido";

type ActivityInsertInput = {
    leadId: string | number;
    tenantId?: string | null;
    activityType: string;
    title?: string;
    description?: string;
    author?: string;
    fromStatus?: string;
    toStatus?: string;
    fileName?: string;
    filePath?: string;
    fileUrl?: string;
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

const toTimelineType = (
    rawType?: string,
    fromStatus?: string,
    toStatus?: string,
): LeadTimelineEntry["type"] => {
    if (fromStatus || toStatus) {
        return "status";
    }

    const value = (rawType || "").toLowerCase();
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

    if (type === "ligacao") return "Ligacao registrada";
    if (type === "upload") return "Arquivo anexado";
    if (type === "nota") return "Nota registrada";
    return "Atividade registrada";
};

const parseActivityRow = (row: Record<string, unknown>, prefix: string): LeadTimelineEntry => {
    const fromStatus = firstString(row.de_status, row.status_de, row.from_status);
    const toStatus = firstString(row.para_status, row.status_para, row.to_status);
    const rawType = firstString(row.tipo, row.activity_type, row.type, row.evento);
    const type = toTimelineType(rawType, fromStatus, toStatus);
    const rawTitle = firstString(row.titulo, row.title, row.nome);
    const createdAt = firstString(
        row.created_at,
        row.criado_em,
        row.data_atividade,
        row.movido_em,
        row.updated_at,
    );
    const fileName = firstString(row.arquivo_nome, row.file_name, row.nome_arquivo);
    const filePath = firstString(row.arquivo_path, row.storage_path, row.file_path);
    const fileUrl = firstString(row.arquivo_url, row.file_url, row.url, row.public_url, row.signed_url);

    return {
        id: `${prefix}-${String(row.id || createdAt || Math.random().toString(16).slice(2))}`,
        type,
        title: toTimelineTitle(type, fromStatus, toStatus, rawTitle),
        description: firstString(row.descricao, row.notes, row.nota, row.observacao),
        createdAt,
        author: firstString(row.criado_por, row.movido_por, row.author, row.usuario, row.user_email),
        fromStatus,
        toStatus,
        fileName,
        filePath,
        fileUrl,
    };
};

const sortEntriesByDateDesc = (entries: LeadTimelineEntry[]): LeadTimelineEntry[] => {
    return [...entries].sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
    });
};

const selectActivitiesByColumn = async (
    leadId: string | number,
    column: "cliente_id" | "lead_id",
): Promise<{
    rows: Record<string, unknown>[];
    tableMissing: boolean;
    columnMissing: boolean;
}> => {
    const { data, error } = await supabaseClient.from("atividades_lead").select("*").eq(column, leadId);

    if (error) {
        if (isSupabaseMissingRelation(error)) {
            return { rows: [], tableMissing: true, columnMissing: false };
        }
        if (isSupabaseMissingColumn(error)) {
            return { rows: [], tableMissing: false, columnMissing: true };
        }
        throw error;
    }

    return {
        rows: (data || []) as Record<string, unknown>[],
        tableMissing: false,
        columnMissing: false,
    };
};

const fetchActivities = async (leadId: string | number): Promise<LeadTimelineEntry[]> => {
    const byClienteId = await selectActivitiesByColumn(leadId, "cliente_id");
    if (!byClienteId.tableMissing && !byClienteId.columnMissing) {
        return byClienteId.rows.map((row) => parseActivityRow(row, "atividade"));
    }

    if (byClienteId.tableMissing) {
        return [];
    }

    const byLeadId = await selectActivitiesByColumn(leadId, "lead_id");
    if (byLeadId.tableMissing || byLeadId.columnMissing) {
        return [];
    }

    return byLeadId.rows.map((row) => parseActivityRow(row, "atividade"));
};

const fetchStatusHistory = async (leadId: string | number): Promise<LeadTimelineEntry[]> => {
    const { data, error } = await supabaseClient
        .from("cliente_status_history")
        .select("*")
        .eq("cliente_id", leadId);

    if (error) {
        if (isSupabaseMissingRelation(error)) {
            return [];
        }
        throw error;
    }

    const rows = (data || []) as Record<string, unknown>[];
    return rows.map((row) => parseActivityRow(row, "status-history"));
};

export const fetchLeadTimeline = async (leadId: string | number): Promise<LeadTimelineEntry[]> => {
    const [activities, statusHistory] = await Promise.all([
        fetchActivities(leadId),
        fetchStatusHistory(leadId),
    ]);

    return sortEntriesByDateDesc([...activities, ...statusHistory]);
};

const compactPayload = (payload: Record<string, unknown>): Record<string, unknown> => {
    return Object.entries(payload).reduce<Record<string, unknown>>((acc, [key, value]) => {
        if (value !== undefined) {
            acc[key] = value;
        }
        return acc;
    }, {});
};

export const addLeadActivity = async (input: ActivityInsertInput): Promise<boolean> => {
    const now = new Date().toISOString();
    const baseDescription = input.description || "";
    const baseTitle = input.title || input.activityType;

    const payloads: Array<Record<string, unknown>> = [
        {
            tenant_id: input.tenantId || undefined,
            cliente_id: input.leadId,
            tipo: input.activityType,
            titulo: baseTitle,
            descricao: baseDescription,
            criado_por: input.author,
            de_status: input.fromStatus,
            para_status: input.toStatus,
            arquivo_nome: input.fileName,
            arquivo_path: input.filePath,
            arquivo_url: input.fileUrl,
            created_at: now,
        },
        {
            tenant_id: input.tenantId || undefined,
            cliente_id: input.leadId,
            tipo: input.activityType,
            titulo: baseTitle,
            descricao: baseDescription,
            data_atividade: now,
        },
        {
            tenant_id: input.tenantId || undefined,
            lead_id: input.leadId,
            tipo: input.activityType,
            titulo: baseTitle,
            descricao: baseDescription,
            created_at: now,
        },
        {
            tenant_id: input.tenantId || undefined,
            lead_id: input.leadId,
            activity_type: input.activityType,
            title: baseTitle,
            notes: baseDescription,
            author: input.author,
            from_status: input.fromStatus,
            to_status: input.toStatus,
            file_name: input.fileName,
            file_path: input.filePath,
            file_url: input.fileUrl,
            created_at: now,
        },
    ];

    for (const rawPayload of payloads) {
        const payload = compactPayload(rawPayload);
        const { error } = await supabaseClient.from("atividades_lead").insert(payload);

        if (!error) {
            return true;
        }

        if (isSupabaseMissingRelation(error)) {
            return false;
        }

        if (isSupabaseMissingColumn(error)) {
            continue;
        }

        throw error;
    }

    return false;
};

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
        params.author,
        params.onStatusChange,
    );
    const path = result.path;

    const signedResult = await supabaseClient.storage
        .from(LEAD_FILES_BUCKET)
        .createSignedUrl(path, 60 * 60 * 24);

    const url = signedResult.data?.signedUrl;

    await addLeadActivity({
        leadId: params.leadId,
        tenantId: params.tenantId,
        activityType: `upload_${params.kind}`,
        title: `Upload de ${params.kind === "proposta" ? "proposta" : "conta de luz"}`,
        description: `Arquivo enviado: ${params.file.name}`,
        author: params.author,
        fileName: params.file.name,
        filePath: path,
        fileUrl: url,
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

export const uploadNewLeadDocument = async (
    clienteId: string | number,
    file: File,
    tipo: LeadDocumentType,
    tenantId?: string | null,
    enviadoPor?: string,
    onStatusChange?: (status: LeadUploadProgressStatus) => void,
): Promise<UploadNewLeadDocumentResult> => {
    const isPdf =
        file.type === "application/pdf" || file.name.toLowerCase().trim().endsWith(".pdf");
    if (!isPdf) {
        throw new Error("Apenas arquivos PDF sao permitidos para documentos do lead.");
    }

    if (file.size > MAX_PDF_FILE_SIZE_BYTES) {
        throw new Error(
            `Arquivo acima do limite permitido (${Math.floor(MAX_PDF_FILE_SIZE_BYTES / (1024 * 1024))}MB).`,
        );
    }

    const timestamp = Date.now();
    const sanitizedBaseName = sanitizeStorageBaseName(file.name);
    const storageFileName = `${timestamp}_${sanitizedBaseName}.pdf`;
    const resolvedTenantId = (tenantId || "global").toString();
    const path = `${resolvedTenantId}/${String(clienteId)}/${storageFileName}`;

    const { data: existingDocs, error: existingDocsError } = await supabaseClient
        .from("documentos_lead")
        .select("id,versao,status")
        .eq("cliente_id", clienteId)
        .eq("tipo", tipo);

    if (existingDocsError && !isSupabaseMissingColumn(existingDocsError)) {
        throw new Error(
            `Falha ao validar versao de documentos existentes: ${existingDocsError.message}`,
        );
    }

    const existingRows = (existingDocs || []) as Array<{
        id?: string | number | null;
        versao?: number | null;
        status?: string | null;
    }>;
    const latestVersion = existingRows.reduce((max, row) => {
        const current = typeof row.versao === "number" ? row.versao : 0;
        return Math.max(max, current);
    }, 0);
    const nextVersion = latestVersion > 0 ? latestVersion + 1 : 1;

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
    const previousDocumentIds = existingRows
        .filter((row) => {
            const status = (row.status || "").toLowerCase();
            return status !== "excluido" && status !== "substituido";
        })
        .map((row) => row.id)
        .filter((value): value is string | number => value !== null && value !== undefined);

    if (previousDocumentIds.length > 0) {
        const { error: previousUpdateError } = await supabaseClient
            .from("documentos_lead")
            .update({ status: "substituido" })
            .in("id", previousDocumentIds);

        if (previousUpdateError && !isSupabaseMissingColumn(previousUpdateError)) {
            await supabaseClient.storage.from(LEAD_FILES_BUCKET).remove([path]);
            throw new Error(
                `Arquivo enviado, mas falhou ao versionar documento anterior: ${previousUpdateError.message}`,
            );
        }
    }

    const payload = {
        tenant_id: tenantId || undefined,
        cliente_id: clienteId,
        tipo,
        nome_arquivo: file.name,
        caminho_storage: path,
        tamanho_bytes: file.size,
        versao: nextVersion,
        status: "concluido",
        enviado_por: enviadoPor || null,
    };

    const { data: insertedData, error: documentError } = await supabaseClient
        .from("documentos_lead")
        .insert(payload)
        .select("id")
        .limit(1)
        .maybeSingle();

    if (documentError) {
        await supabaseClient.storage.from(LEAD_FILES_BUCKET).remove([path]);
        throw new Error(
            `Arquivo enviado, mas falhou ao registrar em documentos_lead: ${documentError.message}`,
        );
    }

    onStatusChange?.("concluido");

    return {
        success: true,
        path,
        documentId: insertedData?.id ? String(insertedData.id) : undefined,
        version: nextVersion,
        status: "concluido",
    };
};

export const listLeadFiles = async (leadId: string | number): Promise<LeadStoredFile[]> => {
    const { data, error } = await supabaseClient
        .from("documentos_lead")
        .select("*")
        .eq("cliente_id", leadId)
        .order("created_at", { ascending: false });

    if (error) {
        if (isSupabaseMissingRelation(error)) {
            return [];
        }
        throw error;
    }

    const rows = (data || []) as DocumentoLeadRecord[];
    const visibleRows = rows.filter((row) => {
        const status = String(row.status || "concluido").toLowerCase();
        return status !== "excluido";
    });

    const files = await Promise.all(
        visibleRows.map(async (item) => {
            const nomeArquivo = String(item.nome_arquivo || "documento.pdf");
            const fullPath = String(item.caminho_storage || "");
            const fileType = (item.tipo as LeadDocumentType) || inferFileType(nomeArquivo);
            const size = typeof item.tamanho_bytes === "number" ? item.tamanho_bytes : 0;
            const versao = typeof item.versao === "number" ? item.versao : 1;
            const status = String(item.status || "concluido");

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
        .eq("id", documentId);

    const { error } = tenantId ? await updateQuery.eq("tenant_id", tenantId) : await updateQuery;

    if (error) {
        throw new Error(`Falha ao excluir documento: ${error.message}`);
    }

    if (storagePath) {
        await supabaseClient.storage.from(LEAD_FILES_BUCKET).remove([storagePath]);
    }
};
