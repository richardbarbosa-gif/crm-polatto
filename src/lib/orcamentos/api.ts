/**
 * Acesso ao Supabase do módulo de orçamentos. Toda regra de segurança está
 * no banco (migration 13): aqui só se monta a chamada e se traduz o erro.
 */
import { supabaseClient } from "../../utility";
import { addLeadActivity, uploadNewLeadDocument } from "../leadTimeline";
import type { TipoDesconto } from "./calculo";
import type { StatusOrcamento } from "./formato";
import type { LogoPdf } from "./pdf";
import {
    type ClienteDoNegocio,
    type EmpresaIdentidade,
    type Orcamento,
    type OrcamentoCompleto,
    type OrcamentoItem,
    type Produto,
    paraClienteDoNegocio,
    paraIdentidade,
    paraItem,
    paraOrcamento,
    paraProduto,
} from "./tipos";

export const BUCKET_EMPRESA = "empresa-assets";
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

const COLUNAS_ORCAMENTO =
    "id,tenant_id,negocio_id,numero,titulo,status,data_emissao,valido_ate,desconto_tipo,desconto_valor," +
    "subtotal,desconto_total,total,condicoes_pagamento,observacoes,responsavel_id,responsavel_nome," +
    "responsavel_email,responsavel_telefone,created_by,created_at,updated_at,deleted_at";
const COLUNAS_ITEM =
    "id,produto_id,descricao,detalhes,unidade,quantidade,valor_unitario,desconto_tipo,desconto_valor,total,ordem";
const COLUNAS_IDENTIDADE =
    "id,tenant_id,logo_path,nome_fantasia,razao_social,cnpj,endereco,telefone,email,site,cor_primaria," +
    "cor_secundaria,condicoes_pagamento,validade_dias,observacoes_padrao,rodape";

type ErroSupabase = { message?: string; code?: string; details?: string } | null;

// O cliente do Supabase não é tipado neste projeto: a linha entra como dado
// desconhecido e os conversores de tipos.ts dão a forma e os padrões certos.
const umaLinha = (dado: unknown): Record<string, unknown> =>
    dado && typeof dado === "object" ? (dado as Record<string, unknown>) : {};
const variasLinhas = (dado: unknown): Record<string, unknown>[] => (Array.isArray(dado) ? dado.map(umaLinha) : []);

/** Mensagem que o vendedor entende, sem expor detalhe interno do banco. */
export const mensagemDeErro = (erro: unknown, padrao = "Não foi possível concluir a operação."): string => {
    const e = (erro ?? {}) as { message?: string; code?: string };
    switch (e.code) {
        case "42501":
            return e.message && !/row-level security|permission denied/i.test(e.message)
                ? e.message
                : "Você não tem permissão para esta ação.";
        case "23503":
            return "Registro relacionado não encontrado (o negócio ou o produto pode ter sido removido).";
        case "23514":
            return "Algum valor está fora do permitido. Confira os campos e tente de novo.";
        case "55000":
        case "P0002":
            return e.message || padrao;
        case "42P01":
        case "PGRST205":
            return "Módulo de orçamentos ainda não instalado neste ambiente (migration 13 pendente).";
        default:
            return e.message || padrao;
    }
};

const falhar = (erro: ErroSupabase, padrao: string): never => {
    throw Object.assign(new Error(mensagemDeErro(erro, padrao)), { code: erro?.code });
};

// ---------------------------------------------------------------------
// Identidade da empresa
// ---------------------------------------------------------------------

export const buscarIdentidade = async (tenantId: string): Promise<EmpresaIdentidade | null> => {
    const { data, error } = await supabaseClient
        .from("empresa_identidade")
        .select(COLUNAS_IDENTIDADE)
        .eq("tenant_id", tenantId)
        .maybeSingle();
    if (error) falhar(error, "Não foi possível carregar a identidade da empresa.");
    return data ? paraIdentidade(umaLinha(data)) : null;
};

export type ValoresIdentidade = Omit<EmpresaIdentidade, "id" | "tenant_id" | "logo_path">;

export const salvarIdentidade = async (
    tenantId: string,
    atual: EmpresaIdentidade | null,
    valores: Partial<ValoresIdentidade> & { logo_path?: string | null },
): Promise<EmpresaIdentidade> => {
    const consulta = atual
        ? supabaseClient.from("empresa_identidade").update(valores).eq("id", atual.id).eq("tenant_id", tenantId)
        : supabaseClient.from("empresa_identidade").insert({ ...valores, tenant_id: tenantId });
    const { data, error } = await consulta.select(COLUNAS_IDENTIDADE).maybeSingle();
    if (error) falhar(error, "Não foi possível salvar a identidade da empresa.");
    if (!data) throw new Error("Você não tem permissão para alterar a identidade da empresa.");
    return paraIdentidade(umaLinha(data));
};

/** Tipo real da imagem pelos primeiros bytes (não confia na extensão nem no MIME do navegador). */
export const detectarTipoImagem = async (arquivo: Blob): Promise<"png" | "jpg" | "webp" | null> => {
    const bytes = new Uint8Array(await arquivo.slice(0, 12).arrayBuffer());
    const ascii = (inicio: number, fim: number) => String.fromCharCode(...bytes.slice(inicio, fim));
    if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
    if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
    return null;
};

const MIME_LOGO = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" } as const;

export const validarArquivoLogo = async (arquivo: File): Promise<"png" | "jpg" | "webp"> => {
    if (arquivo.size > LOGO_MAX_BYTES) throw new Error("O logo precisa ter no máximo 2 MB.");
    const tipo = await detectarTipoImagem(arquivo);
    if (!tipo) throw new Error("Envie o logo em PNG, JPEG ou WEBP. SVG não é aceito.");
    return tipo;
};

export const enviarLogo = async (
    tenantId: string,
    atual: EmpresaIdentidade | null,
    arquivo: File,
): Promise<EmpresaIdentidade> => {
    const tipo = await validarArquivoLogo(arquivo);
    const caminho = `${tenantId}/logo-${Date.now()}.${tipo}`;
    const { error: erroUpload } = await supabaseClient.storage
        .from(BUCKET_EMPRESA)
        .upload(caminho, arquivo, { contentType: MIME_LOGO[tipo], upsert: false, cacheControl: "3600" });
    if (erroUpload) throw new Error(`Não foi possível enviar o logo: ${erroUpload.message}`);

    try {
        const salvo = await salvarIdentidade(tenantId, atual, { logo_path: caminho });
        if (atual?.logo_path && atual.logo_path !== caminho) {
            await supabaseClient.storage.from(BUCKET_EMPRESA).remove([atual.logo_path]);
        }
        return salvo;
    } catch (erro) {
        await supabaseClient.storage.from(BUCKET_EMPRESA).remove([caminho]);
        throw erro;
    }
};

export const removerLogo = async (tenantId: string, atual: EmpresaIdentidade): Promise<EmpresaIdentidade> => {
    const salvo = await salvarIdentidade(tenantId, atual, { logo_path: null });
    if (atual.logo_path) await supabaseClient.storage.from(BUCKET_EMPRESA).remove([atual.logo_path]);
    return salvo;
};

export const urlAssinadaLogo = async (caminho: string, segundos = 300): Promise<string | null> => {
    const { data, error } = await supabaseClient.storage.from(BUCKET_EMPRESA).createSignedUrl(caminho, segundos);
    return error ? null : (data?.signedUrl ?? null);
};

const decodificarImagem = async (blob: Blob): Promise<{ origem: CanvasImageSource; largura: number; altura: number }> => {
    if (typeof createImageBitmap === "function") {
        const bitmap = await createImageBitmap(blob);
        return { origem: bitmap, largura: bitmap.width, altura: bitmap.height };
    }
    const url = URL.createObjectURL(blob);
    try {
        const imagem = new Image();
        imagem.src = url;
        await imagem.decode();
        return { origem: imagem, largura: imagem.naturalWidth, altura: imagem.naturalHeight };
    } finally {
        URL.revokeObjectURL(url);
    }
};

/**
 * Logo para o PDF: URL assinada → bytes → confere o tipo real → redesenha
 * num canvas (no máximo 900 px de largura) e devolve PNG em data URL.
 * Qualquer falha devolve null: o PDF sai sem logo e a tela avisa.
 */
export const carregarLogoParaPdf = async (caminho: string | null | undefined): Promise<LogoPdf | null> => {
    if (!caminho) return null;
    try {
        const url = await urlAssinadaLogo(caminho, 120);
        if (!url) return null;
        const resposta = await fetch(url, { cache: "no-store" });
        if (!resposta.ok) return null;
        const blob = await resposta.blob();
        if (blob.size > LOGO_MAX_BYTES || !(await detectarTipoImagem(blob))) return null;

        const { origem, largura, altura } = await decodificarImagem(blob);
        if (!largura || !altura) return null;
        const escala = Math.min(1, 900 / largura);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(largura * escala));
        canvas.height = Math.max(1, Math.round(altura * escala));
        const contexto = canvas.getContext("2d");
        if (!contexto) return null;
        contexto.drawImage(origem, 0, 0, canvas.width, canvas.height);
        return { dataUrl: canvas.toDataURL("image/png"), largura: canvas.width, altura: canvas.height };
    } catch {
        return null;
    }
};

// ---------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------

export const listarProdutosAtivos = async (): Promise<Produto[]> => {
    const { data, error } = await supabaseClient
        .from("produtos")
        .select("id,nome,descricao,unidade,preco_padrao,ativo")
        .eq("ativo", true)
        .order("nome", { ascending: true })
        .limit(1000);
    if (error) falhar(error, "Não foi possível carregar o catálogo.");
    return variasLinhas(data).map(paraProduto);
};

// ---------------------------------------------------------------------
// Orçamentos
// ---------------------------------------------------------------------

export const listarOrcamentosDoNegocio = async (negocioId: string): Promise<Orcamento[]> => {
    const { data, error } = await supabaseClient
        .from("orcamentos")
        .select(COLUNAS_ORCAMENTO)
        .eq("negocio_id", negocioId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
    if (error) falhar(error, "Não foi possível carregar os orçamentos.");
    return variasLinhas(data).map(paraOrcamento);
};

export const buscarOrcamentoCompleto = async (id: string): Promise<OrcamentoCompleto> => {
    const [orcamento, itens] = await Promise.all([
        supabaseClient.from("orcamentos").select(COLUNAS_ORCAMENTO).eq("id", id).maybeSingle(),
        supabaseClient.from("orcamento_itens").select(COLUNAS_ITEM).eq("orcamento_id", id).order("ordem", { ascending: true }),
    ]);
    if (orcamento.error) falhar(orcamento.error, "Não foi possível carregar o orçamento.");
    if (itens.error) falhar(itens.error, "Não foi possível carregar os itens do orçamento.");
    if (!orcamento.data) throw new Error("Orçamento não encontrado.");
    return {
        ...paraOrcamento(umaLinha(orcamento.data)),
        itens: variasLinhas(itens.data).map(paraItem),
    };
};

export interface DadosOrcamento {
    id?: string;
    negocio_id: string;
    titulo: string | null;
    status?: StatusOrcamento;
    data_emissao: string;
    valido_ate: string;
    desconto_tipo: TipoDesconto;
    desconto_valor: number;
    condicoes_pagamento: string | null;
    observacoes: string | null;
    responsavel_nome: string | null;
    responsavel_email: string | null;
    responsavel_telefone: string | null;
}

/** Cabeçalho + itens numa transação só (RPC salvar_orcamento, SECURITY INVOKER). */
export const salvarOrcamento = async (dados: DadosOrcamento, itens: OrcamentoItem[]): Promise<string> => {
    const { data, error } = await supabaseClient.rpc("salvar_orcamento", {
        p_orcamento: dados,
        p_itens: itens.map((item) => ({
            id: item.id ?? null,
            produto_id: item.produto_id,
            descricao: item.descricao,
            detalhes: item.detalhes,
            unidade: item.unidade,
            quantidade: item.quantidade,
            valor_unitario: item.valor_unitario,
            desconto_tipo: item.desconto_tipo,
            desconto_valor: item.desconto_valor,
        })),
    });
    if (error) falhar(error, "Não foi possível salvar o orçamento.");
    if (typeof data !== "string") throw new Error("O banco não confirmou o orçamento salvo.");
    return data;
};

/**
 * Nova proposta (número novo, rascunho, emitida hoje) com os mesmos itens.
 * Validade vazia: o banco aplica a validade padrão da empresa.
 */
export const duplicarOrcamento = async (
    origem: OrcamentoCompleto,
    hoje: string,
    validoAte = "",
): Promise<string> =>
    salvarOrcamento(
        {
            negocio_id: origem.negocio_id,
            titulo: origem.titulo,
            status: "rascunho",
            data_emissao: hoje,
            valido_ate: validoAte,
            desconto_tipo: origem.desconto_tipo,
            desconto_valor: origem.desconto_valor,
            condicoes_pagamento: origem.condicoes_pagamento,
            observacoes: origem.observacoes,
            responsavel_nome: origem.responsavel_nome,
            responsavel_email: origem.responsavel_email,
            responsavel_telefone: origem.responsavel_telefone,
        },
        origem.itens.map((item) => ({ ...item, id: undefined })),
    );

export const alterarStatus = async (id: string, status: StatusOrcamento): Promise<Orcamento> => {
    const { data, error } = await supabaseClient
        .from("orcamentos")
        .update({ status })
        .eq("id", id)
        .select(COLUNAS_ORCAMENTO)
        .maybeSingle();
    if (error) falhar(error, "Não foi possível mudar o status.");
    if (!data) throw new Error("Orçamento não encontrado.");
    return paraOrcamento(umaLinha(data));
};

/** Soft delete. O banco só aceita do criador ou de gerente/admin. */
export const excluirOrcamento = async (id: string): Promise<void> => {
    const { data, error } = await supabaseClient
        .from("orcamentos")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id)
        .select("id")
        .maybeSingle();
    if (error) falhar(error, "Não foi possível excluir o orçamento.");
    if (!data) throw new Error("Orçamento não encontrado.");
};

export const atualizarValorNegocio = async (negocioId: string, valor: number): Promise<void> => {
    const { data, error } = await supabaseClient
        .from("negocios")
        .update({ valor })
        .eq("id", negocioId)
        .select("id")
        .maybeSingle();
    if (error) falhar(error, "Não foi possível atualizar o valor do negócio.");
    if (!data) throw new Error("Negócio não encontrado ou sem permissão para alterá-lo.");
};

export const buscarClientesDosNegocios = async (ids: string[]): Promise<Map<string, ClienteDoNegocio>> => {
    const unicos = [...new Set(ids.filter(Boolean))];
    const mapa = new Map<string, ClienteDoNegocio>();
    // Lotes de 100 para não estourar o tamanho da URL do PostgREST.
    for (let i = 0; i < unicos.length; i += 100) {
        const { data, error } = await supabaseClient
            .from("clientes")
            .select("id,nome,titulo,cpf_cnpj,telefone,ddi,email,valor,endereco_instalacao,numero,complemento,cep")
            .in("id", unicos.slice(i, i + 100));
        if (error) falhar(error, "Não foi possível carregar os clientes dos orçamentos.");
        for (const linha of variasLinhas(data)) {
            const cliente = paraClienteDoNegocio(linha);
            mapa.set(cliente.id, cliente);
        }
    }
    return mapa;
};

/**
 * Salva o PDF nos documentos do lead (bucket lead-files, caminho do tenant,
 * só PDF, registro em documentos_lead) e registra na timeline.
 */
export const salvarPdfNoLead = async (params: {
    negocioId: string;
    tenantId: string;
    blob: Blob;
    nomeArquivo: string;
    numero: string;
    total: string;
    autor?: string;
}): Promise<void> => {
    const arquivo = new File([params.blob], params.nomeArquivo, { type: "application/pdf" });
    const resultado = await uploadNewLeadDocument(params.negocioId, arquivo, "proposta", params.tenantId, params.autor);
    await addLeadActivity({
        leadId: params.negocioId,
        tenantId: params.tenantId,
        activityType: "upload_proposta",
        title: `Proposta ${params.numero} salva no lead`,
        description: `${params.nomeArquivo} (total ${params.total})`,
        author: params.autor,
        fileName: params.nomeArquivo,
        filePath: resultado.path,
    });
};

/** Dispara o download de um Blob sem abrir nova aba. */
export const baixarArquivo = (blob: Blob, nome: string): void => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = nome;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
};
