import { useRef, useState } from "react";
import { useInvalidate } from "@refinedev/core";
import { Button, Modal, message } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import Papa from "papaparse";

import { useCrmAccess } from "../hooks/useCrmAccess";
import {
    chavesDeIdentidade,
    emLotesDe,
    mapearLinha,
    separarDuplicadasNaPlanilha,
    type ErroDeLinha,
    type LinhaImportada,
} from "../lib/csvImport";
import { variantesDocumento, variantesTelefone } from "../lib/documentos";
import { supabaseClient } from "../utility";

type Etapa = { id: string | number; nome?: string | null; pipeline_id?: string | null };

/** Lotes pequenos: a lista de valores vai na URL (GET) e há limite de tamanho. */
const LOTE_CONSULTA = 80;
const LOTE_INSERCAO = 50;

const normalizar = (v: unknown) => String(v ?? "").trim().toLowerCase();

/**
 * Já cadastrados (telefone, e-mail ou documento), em lotes. Antes as três
 * consultas iam com TODOS os valores da planilha numa única URL; acima de
 * algumas centenas de linhas a requisição falhava, o erro era ignorado e a
 * deduplicação era desligada em silêncio.
 */
const buscarChavesExistentes = async (linhas: LinhaImportada[]): Promise<Set<string>> => {
    const existentes = new Set<string>();
    const telefones = Array.from(new Set(linhas.flatMap((l) => variantesTelefone(l.telefone))));
    const emails = Array.from(new Set(linhas.map((l) => l.email?.trim()).filter((e): e is string => Boolean(e))));
    const documentos = Array.from(new Set(linhas.flatMap((l) => variantesDocumento(l.cpf_cnpj))));

    const consultar = async (coluna: "telefone" | "email" | "cpf_cnpj", valores: string[]) => {
        for (const lote of emLotesDe(valores, LOTE_CONSULTA)) {
            const { data, error } = await supabaseClient.from("clientes").select("telefone,email,cpf_cnpj").in(coluna, lote);
            if (error) throw new Error(`Falha ao verificar duplicatas (${coluna}): ${error.message}`);
            ((data ?? []) as Array<{ telefone?: string | null; email?: string | null; cpf_cnpj?: string | null }>).forEach((r) =>
                chavesDeIdentidade({ telefone: r.telefone ?? "", email: r.email ?? null, cpf_cnpj: r.cpf_cnpj ?? null }).forEach(
                    (chave) => existentes.add(chave),
                ),
            );
        }
    };

    await consultar("telefone", telefones);
    await consultar("email", emails);
    await consultar("cpf_cnpj", documentos);
    return existentes;
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
        const { data: etapasData } = await supabaseClient
            .from("pipeline_stages")
            .select("id,nome,ordem,pipeline_id")
            .order("ordem", { ascending: true });
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

        // 3. Já cadastradas no CRM
        const existentes = await buscarChavesExistentes(unicas);
        const novas = unicas.filter((l) => !chavesDeIdentidade(l).some((chave) => existentes.has(chave)));
        const jaCadastradas = unicas.length - novas.length;

        // 4. Inserção em lotes; se um lote falha, tenta linha a linha para
        //    importar as boas e apontar exatamente quais falharam.
        const paraInserir = (linha: LinhaImportada) => {
            const etapa = (linha.status && etapaPorNome.get(normalizar(linha.status))) || etapaPadrao;
            return {
                tenant_id: tenantId || undefined,
                nome: linha.nome,
                email: linha.email,
                telefone: linha.telefone,
                cpf_cnpj: linha.cpf_cnpj,
                responsavel: linha.responsavel || ownerDisplayName,
                conta_energia_media: linha.conta_energia_media,
                valor: linha.valor,
                status: etapa?.nome || linha.status || "Novo Lead",
                stage_id: etapa?.id ?? null,
                ...(etapa?.pipeline_id ? { pipeline_id: etapa.pipeline_id } : {}),
                temperatura: linha.temperatura,
            };
        };

        let importadas = 0;
        for (const lote of emLotesDe(novas, LOTE_INSERCAO)) {
            const { error } = await supabaseClient.from("clientes").insert(lote.map(paraInserir));
            if (!error) {
                importadas += lote.length;
                continue;
            }
            for (const linha of lote) {
                const { error: erroLinha } = await supabaseClient.from("clientes").insert(paraInserir(linha));
                if (erroLinha) erros.push({ linha: linha.linha, motivo: erroLinha.message });
                else importadas += 1;
            }
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
            void invalidate({ resource: "clientes", invalidates: ["list"] });
            void invalidate({ resource: "vw_kanban_kpis", invalidates: ["list"] });
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
                style={{ borderRadius: 8, height: 40, fontWeight: 600 }}
                title="Colunas aceitas: nome, telefone, e-mail, CPF/CNPJ, responsável, valor, conta de luz, status/etapa, temperatura"
            >
                Importar CSV
            </Button>
        </>
    );
};
