import { useEffect, useMemo, useState } from "react";
import { supabaseClient } from "../utility";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAMANHO_LOTE = 100;

/**
 * Separa os ids por tipo. Antes da virada o id de `clientes` é bigint;
 * depois, UUID. Misturar os dois num `in (...)` faz o Postgres rejeitar a
 * consulta inteira ("invalid input syntax for type uuid").
 */
export const agruparIdsPorTipo = (ids: Array<string | number | null | undefined>) => {
    const numericos = new Set<string>();
    const uuids = new Set<string>();
    ids.forEach((id) => {
        if (id === null || id === undefined) return;
        const texto = String(id).trim();
        if (/^\d+$/.test(texto)) numericos.add(texto);
        else if (UUID_RE.test(texto)) uuids.add(texto);
    });
    return { numericos: Array.from(numericos), uuids: Array.from(uuids) };
};

export const emLotes = <T,>(itens: T[], tamanho = TAMANHO_LOTE): T[][] => {
    const lotes: T[][] = [];
    for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
    return lotes;
};

/**
 * Nome de cada cliente referenciado (tarefas, histórico), buscando SÓ os
 * ids necessários. As telas de agenda e relatórios carregavam a base de
 * leads inteira só para traduzir id em nome — pesado e, acima de 1000
 * leads, cortado pelo Supabase ("Cliente #123" no lugar do nome).
 */
export const buscarNomesDeClientes = async (
    ids: Array<string | number | null | undefined>,
): Promise<Map<string, string>> => {
    const { numericos, uuids } = agruparIdsPorTipo(ids);
    const nomes = new Map<string, string>();

    const consultas = [...emLotes(numericos), ...emLotes(uuids)].map(async (lote) => {
        const { data, error } = await supabaseClient.from("clientes").select("id,nome").in("id", lote);
        // Um grupo do tipo errado (ex.: ids antigos depois da virada) só não
        // encontra nada — não pode derrubar os demais.
        if (error || !data) return;
        (data as Array<{ id: string | number; nome?: string | null }>).forEach((linha) => {
            const nome = linha.nome?.trim();
            if (nome) nomes.set(String(linha.id), nome);
        });
    });

    await Promise.all(consultas);
    return nomes;
};

/** Hook: nomes dos clientes referenciados, recarregado quando os ids mudam. */
export const useNomesDeClientes = (ids: Array<string | number | null | undefined>) => {
    const chave = useMemo(() => {
        const { numericos, uuids } = agruparIdsPorTipo(ids);
        return [...numericos, ...uuids].sort().join(",");
    }, [ids]);
    const [nomes, setNomes] = useState<Map<string, string>>(new Map());

    useEffect(() => {
        if (!chave) {
            setNomes(new Map());
            return;
        }
        let ativo = true;
        void buscarNomesDeClientes(chave.split(",")).then((mapa) => {
            if (ativo) setNomes(mapa);
        });
        return () => {
            ativo = false;
        };
    }, [chave]);

    return nomes;
};
