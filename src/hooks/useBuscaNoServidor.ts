import type { CrudFilter } from "@refinedev/core";
import { useEffect, useMemo, useState } from "react";

const ATRASO_MS = 300;

/**
 * Vírgula e parênteses são a sintaxe do filtro "or" do PostgREST: dentro do
 * termo quebrariam a consulta. Não fazem parte de nome, e-mail ou telefone.
 */
export const limparTermoDeBusca = (texto: string): string => texto.replace(/[,()]/g, " ").trim();

/**
 * Busca digitada → filtro "contém" (ILIKE) em várias colunas, aplicado pelo
 * banco. Espera o usuário parar de digitar para não disparar uma consulta
 * por tecla. Devolve também o termo já aplicado, para a tela voltar à
 * primeira página quando ele muda.
 */
export const useBuscaNoServidor = (busca: string, colunas: string[]) => {
    const [termo, setTermo] = useState("");

    useEffect(() => {
        const timer = window.setTimeout(() => setTermo(limparTermoDeBusca(busca)), ATRASO_MS);
        return () => window.clearTimeout(timer);
    }, [busca]);

    const chaveColunas = colunas.join(",");
    const filtros = useMemo<CrudFilter[]>(() => {
        if (!termo) return [];
        return [
            {
                operator: "or",
                value: chaveColunas.split(",").map((field) => ({ field, operator: "contains" as const, value: termo })),
            },
        ];
    }, [termo, chaveColunas]);

    return { termo, filtros };
};
