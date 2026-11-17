import { useRef, useState } from "react";
import { useInvalidate } from "@refinedev/core";
import { Button, Modal, message } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import Papa from "papaparse";

import { useCrmAccess } from "../hooks/useCrmAccess";
import {
    emLotesDe,
    mapearLinha,
    separarDuplicadasNaPlanilha,
    type ErroDeLinha,
    type LinhaImportada,
} from "../lib/csvImport";
import { variantesDocumento, variantesTelefone } from "../lib/documentos";
import { supabaseClient } from "../utility";

type Etapa = { id: string | number; nome?: string | null; pipeline_id?: string | null };

/** O banco aceita até 500 por chamada (importar_leads); lote menor = progresso mais fino. */
const LOTE_IMPORTACAO = 200;

const normalizar = (v: unknown) => String(v ?? "").trim().toLowerCase();

type RespostaImportacao = {
    importadas?: number;
    ja_existiam?: number;
    erros?: Array<{ linha?: number; motivo?: string }>;
};

export const ImportLeadsButton = () => {
    const { tenantId, ownerDisplayName } = useCrmAccess();
    const invalidate = useInvalidate();
    const [isImporting, setIsImporting] = useState(false);
    const inputRef = useRef<HTMLInputElement | null>(null);

    const importar = async (brutas: Record<string, unknown>[]) => {
        message.loading({ content: "Analisando planilha e checando duplicatas...", key: "import-status", duration: 0 });

        // Etapas do funil para converter o texto do status em stage_id. Sem
        // isso o lead importado nasce sem etapa e cai na coluna "Outros".
        const { data: etapasData, error: erroEtapas } = await supabaseClient
            .from("pipeline_stages")
            .select("id,nome,ordem,pipeline_id")
            .order("ordem", { ascending: true });
        if (erroEtapas) throw new Error(`Não foi possível ler as etapas do funil: ${erroEtapas.message}`);
        const etapas = (etapasData ?? []) as Etapa[];
        let funilAtivo: string | null = null;
        try {
            funilAtivo = window.localStorage.getItem(`crm_pipeline_${tenantId || "default"}`);
        } catch {
            funilAtivo = null;
        }
        const etapasDoFunil = funilAtivo ? etapas.filter((e) => e.pipeline_id === funilAtivo) : [];
        const etapaPorNome = new Map(
            [...etapasDoFunil, ...etapas].filter((e) => e.nome).reverse().map((e) => [normalizar(e.nome), e]),
        );
        const etapaPadrao = etapasDoFunil[0] ?? etapas[0];

        // 1. Validação linha a linha (linha 1 é o cabeçalho)
        const erros: ErroDeLinha[] = [];
        const validas: LinhaImportada[] = [];
        brutas.forEach((bruta, indice) => {
            const resultado = mapearLinha(bruta, indice + 2);
            if (resultado.ok) validas.push(resultado.dados);
            else erros.push(resultado.erro);
        });

        // 2. Repetidas dentro da própria planilha
        const { unicas, repetidas } = separarDuplicadasNaPlanilha(validas);

        // 3. Duplicatas contra o CRM e inserção acontecem NO BANCO (importar_leads):
        //    uma importação por empresa de cada vez, linha a linha. Conferir aqui
        //    e inserir depois deixava duas importações simultâneas duplicarem tudo.
        const paraImportar = (linha: LinhaImportada) => {
            const etapa = (linha.status && etapaPorNome.get(normalizar(linha.status))) || etapaPadrao;
            return {
                linha: linha.linha,
                // Só tem efeito para o administrador da plataforma operando em
                // outra empresa; para os demais o banco usa a empresa do login.
                tenant_id: tenantId || undefined,
                nome: linha.nome,
                email: linha.email,
                telefone: linha.telefone,
                cpf_cnpj: linha.cpf_cnpj,
                telefones: variantesTelefone(linha.telefone),
                documentos: variantesDocumento(linha.cpf_cnpj),
                responsavel: linha.responsavel || ownerDisplayName,
                conta_energia_media: linha.conta_energia_media,
                valor: linha.valor,
                status: etapa?.nome || linha.status || "Novo Lead",
                stage_id: etapa?.id ?? null,
                pipeline_id: etapa?.pipeline_id ?? null,
                temperatura: linha.temperatura,
            };
        };

        let importadas = 0;
        let jaCadastradas = 0;
        for (const lote of emLotesDe(unicas, LOTE_IMPORTACAO)) {
            const { data, error } = await supabaseClient.rpc("importar_leads", { p_linhas: lote.map(paraImportar) });
            if (error) {
                // O lote inteiro foi recusado (rede, permissão, limite do plano):
                // nenhuma linha dele entrou. Aponta todas, com o motivo real.
                lote.forEach((linha) => erros.push({ linha: linha.linha, motivo: error.message }));
                continue;
            }
            const resposta = (data ?? {}) as RespostaImportacao;
            importadas += resposta.importadas ?? 0;
            jaCadastradas += resposta.ja_existiam ?? 0;
            (resposta.erros ?? []).forEach((erro) =>
                erros.push({ linha: erro.linha ?? 0, motivo: erro.motivo || "Erro ao importar a linha." }),
            );
        }

        message.destroy("import-status");
        erros.sort((a, b) => a.linha - b.linha);
        const resumo = (
            <div style={{ marginTop: 12 }}>
                <ul style={{ background: "var(--crm-surface-2, #f1f5f9)", padding: "12px 12px 12px 28px", borderRadius: 8 }}>
                    <li style={{ color: "#059669", fontWeight: 600 }}>{importadas} leads importados.</li>
                    <li style={{ marginTop: 4 }}>{jaCadastradas} ignorados (já existiam no CRM).</li>
                    <li style={{ marginTop: 4 }}>{repetidas.length} ignorados (repetidos na própria planilha).</li>
                    <li style={{ color: erros.length ? "#dc2626" : undefined, marginTop: 4 }}>
                        {erros.length} com erro.
                    </li>
                </ul>
                {erros.length ? (
                    <div style={{ maxHeight: 180, overflowY: "auto", fontSize: 12.5 }}>
                        {erros.slice(0, 50).map((erro) => (
                            <div key={`${erro.linha}-${erro.motivo}`}>
                                Linha {erro.linha}: {erro.motivo}
                            </div>
                        ))}
                        {erros.length > 50 ? <div>… e mais {erros.length - 50} linhas com erro.</div> : null}
                    </div>
                ) : null}
            </div>
        );

        (erros.length && !importadas ? Modal.error : erros.length ? Modal.warning : Modal.success)({
            title: importadas ? "Importação concluída" : "Nenhum lead importado",
            content: resumo,
            okText: "Entendi",
            width: 520,
        });

        if (importadas) {
            // "resourceAll": as colunas do Kanban são consultas infinitas e não
            // entram em "list" — os leads importados só apareciam ao recarregar.
            ["clientes", "vw_kanban_kpis", "vw_negocios_saude"].forEach((resource) => {
                void invalidate({ resource, invalidates: ["resourceAll"] });
            });
        }
    };

    const processFile = (file: File) => {
        setIsImporting(true);

        // PapaParse detecta o separador (vírgula ou ponto e vírgula do Excel BR).
        Papa.parse<Record<string, unknown>>(file, {
            header: true,
            skipEmptyLines: "greedy",
            complete: async (results) => {
                try {
                    if (results.data.length === 0) {
                        message.warning("A planilha está vazia.");
                        return;
                    }
                    await importar(results.data);
                } catch (error: unknown) {
                    message.destroy("import-status");
                    Modal.error({
                        title: "Erro na importação",
                        content: error instanceof Error ? error.message : "Ocorreu um erro ao salvar os dados no banco.",
                    });
                } finally {
                    setIsImporting(false);
                    // Permite reenviar a mesma planilha depois de corrigida.
                    if (inputRef.current) inputRef.current.value = "";
                }
            },
            error: () => {
                message.error("Erro ao ler o arquivo CSV. Verifique o formato.");
                setIsImporting(false);
            },
        });
    };

    return (
        <>
            <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                style={{ display: "none" }}
                aria-label="Arquivo CSV de leads"
                onChange={(e) => {
                    const arquivo = e.target.files?.[0];
                    if (arquivo) processFile(arquivo);
                }}
            />

            <Button
                icon={<UploadOutlined />}
                loading={isImporting}
                onClick={() => inputRef.current?.click()}
                // Mesma altura e peso dos vizinhos na barra do funil (Novo Lead, Colunas).
                style={{ borderRadius: 8, height: 32, fontSize: 12.5 }}
                title="Colunas aceitas: nome, telefone, e-mail, CPF/CNPJ, responsável, valor, conta de luz, status/etapa, temperatura"
            >
                Importar CSV
            </Button>
        </>
    );
};
