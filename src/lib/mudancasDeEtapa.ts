import { supabaseClient } from "../utility";
import type { InsightStatusHistoryRecord } from "./insights";

type LinhaDeEtapa = {
    id: number | string;
    cliente_id: string | null;
    de_status: string | null;
    para_status: string | null;
    criado_por: string | null;
    created_at: string | null;
};

/**
 * Últimas mudanças de etapa da empresa, da mais recente para a mais antiga.
 *
 * Fonte: atividades_lead (tipo "status"), gravada pelo trigger do banco a
 * cada movimentação, com o id do negócio. A tabela cliente_status_history
 * guarda o id da tabela ANTIGA de clientes (bigint): para negócio criado no
 * modelo atual ele fica nulo, e os relatórios mostravam a movimentação sem
 * dizer de qual lead era.
 */
export const fetchMudancasDeEtapa = async (limite: number): Promise<InsightStatusHistoryRecord[]> => {
    const { data, error } = await supabaseClient
        .from("atividades_lead")
        .select("id,cliente_id,de_status,para_status,criado_por,created_at")
        .eq("tipo", "status")
        .order("created_at", { ascending: false })
        .limit(limite);
    if (error) throw error;

    return ((data ?? []) as LinhaDeEtapa[]).map((linha) => ({
        id: linha.id,
        cliente_id: linha.cliente_id,
        de_status: linha.de_status,
        para_status: linha.para_status,
        movido_em: linha.created_at,
        movido_por: linha.criado_por,
    }));
};
