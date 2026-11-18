import type { CrudFilter } from "@refinedev/core";
import { useEffect, useMemo, useState } from "react";
import { filtroBuscaSemAcento } from "../lib/buscaSemAcento";

const ATRASO_MS = 300;

/**
 * Vírgula e parênteses são a sintaxe do filtro "or" do PostgREST: dentro do
 * termo quebrariam a consulta. Não fazem parte de nome, e-mail ou telefone.
 */
export const limparTermoDeBusca = (texto: string): string => texto.replace(/[,()]/g, " ").trim();

/**
 * Busca digitada → filtro "contém" (ILIKE) aplicado pelo banco, ignorando
 * acentos, na coluna calculada `busca_sem_acento` da fonte (os campos de
 * cada uma estão em src/lib/buscaSemAcento.ts). Espera o usuário parar de
 * digitar para não disparar uma consulta por tecla. Devolve também o termo
 * já aplicado, para a tela voltar à primeira página quando ele muda.
 */
export const useBuscaNoServidor = (busca: string) => {
    const [termo, setTermo] = useState("");

    useEffect(() => {
        const timer = window.setTimeout(() => setTermo(limparTermoDeBusca(busca)), ATRASO_MS);
        return () => window.clearTimeout(timer);
    }, [busca]);

    const filtros = useMemo<CrudFilter[]>(() => (termo ? [filtroBuscaSemAcento(termo)] : []), [termo]);

    return { termo, filtros };
};
