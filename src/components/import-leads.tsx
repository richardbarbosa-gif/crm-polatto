import React, { useState } from "react";
import { useInvalidate } from "@refinedev/core";
import { Button, Modal, message } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import Papa from "papaparse";

import { useCrmAccess } from "../hooks/useCrmAccess";
import { supabaseClient } from "../utility"; // Importamos o cliente do Supabase diretamente

export const ImportLeadsButton = () => {
    const { tenantId, ownerDisplayName } = useCrmAccess();
    const invalidate = useInvalidate();
    const [isImporting, setIsImporting] = useState(false);

    const processFile = (file: File) => {
        setIsImporting(true);
        
        // PapaParse lê o CSV e transforma as colunas em um Array de Objetos JSON
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                try {
                    const rows = results.data as any[];
                    if (rows.length === 0) {
                        message.warning("A planilha está vazia.");
                        setIsImporting(false);
                        return;
                    }

                    message.loading({ content: "Analisando planilha e checando duplicatas...", key: "import-status" });

                    // Etapas do funil, para converter o texto do status em
                    // stage_id. Sem isso o lead importado nasce sem etapa e não
                    // aparece em nenhuma coluna do Kanban (que filtram por
                    // stage_id) — cai apenas na coluna "Outros".
                    const { data: etapas } = await supabaseClient
                        .from("pipeline_stages")
                        .select("id,nome,ordem,pipeline_id")
                        .order("ordem", { ascending: true });

                    const listaEtapas = (etapas || []) as Array<{
                        id: string | number;
                        nome?: string | null;
                        pipeline_id?: string | null;
                    }>;

                    const normalizar = (v: unknown) =>
                        String(v ?? "").trim().toLowerCase();

                    const etapaPorNome = new Map(
                        listaEtapas
                            .filter((e) => e.nome)
                            .map((e) => [normalizar(e.nome), e]),
                    );
                    const etapaPadrao = listaEtapas[0];

                    const resolverEtapa = (statusTexto: string) =>
                        etapaPorNome.get(normalizar(statusTexto)) || etapaPadrao;

                    // 1. Mapear e higienizar os dados do CSV
                    const mappedLeads = rows.map((item) => {
                        const statusTexto =
                            item.Status || item.status || item.Etapa || "Novo Lead";
                        const etapa = resolverEtapa(statusTexto);
                        return {
                        tenant_id: tenantId || undefined,
                        nome: item.Nome || item.nome || item.Name || "Lead Sem Nome",
                        email: (item.Email || item.email || "").trim() || null,
                        telefone: String(item.Telefone || item.telefone || item.Phone || "").trim(),
                        cpf_cnpj: (item.cpf_cnpj || item.cpf || item.cnpj || item.CPF || item.CNPJ || "").trim() || null,
                        responsavel: item.Responsavel || item.responsavel || item.Responsável || ownerDisplayName,
                        conta_energia_media: Number(item.conta_energia_media || item.Conta_Energia || 0) || 0,
                        valor: Number(item.valor || item.Valor || 0) || 0,
                        // Usa o nome da etapa encontrada para o status ficar
                        // consistente com o funil, não com o texto da planilha
                        status: etapa?.nome || statusTexto,
                        stage_id: etapa?.id ?? null,
                        ...(etapa?.pipeline_id ? { pipeline_id: etapa.pipeline_id } : {}),
                        temperatura: item.Temperatura || item.temperatura || null,
                        };
                    });

                    // 2. Extrair valores válidos para a "Malha Fina" tripla
                    const telefonesParaChecar = mappedLeads
                        .map(l => l.telefone)
                        .filter(tel => tel.length > 0);

                    const emailsParaChecar = mappedLeads
                        .map(l => l.email)
                        .filter((e): e is string => typeof e === "string" && e.length > 0);

                    const cpfsParaChecar = mappedLeads
                        .map(l => l.cpf_cnpj)
                        .filter((c): c is string => typeof c === "string" && c.length > 0);

                    // 3. Buscar no Supabase QUAIS já existem (3 consultas em paralelo)
                    const telefonesExistentes = new Set<string>();
                    const emailsExistentes = new Set<string>();
                    const cpfsExistentes = new Set<string>();

                    const buscas: PromiseLike<void>[] = [];

                    if (telefonesParaChecar.length > 0) {
                        buscas.push(
                            supabaseClient
                                .from("clientes")
                                .select("telefone")
                                .in("telefone", telefonesParaChecar)
                                .not("telefone", "is", null)
                                .then(({ data, error }) => {
                                    if (!error && data) data.forEach((l: any) => telefonesExistentes.add(l.telefone));
                                }),
                        );
                    }

                    if (emailsParaChecar.length > 0) {
                        buscas.push(
                            supabaseClient
                                .from("clientes")
                                .select("email")
                                .in("email", emailsParaChecar)
                                .not("email", "is", null)
                                .then(({ data, error }) => {
                                    if (!error && data) data.forEach((l: any) => emailsExistentes.add(l.email));
                                }),
                        );
                    }

                    if (cpfsParaChecar.length > 0) {
                        buscas.push(
                            supabaseClient
                                .from("clientes")
                                .select("cpf_cnpj")
                                .in("cpf_cnpj", cpfsParaChecar)
                                .not("cpf_cnpj", "is", null)
                                .then(({ data, error }) => {
                                    if (!error && data) data.forEach((l: any) => cpfsExistentes.add(l.cpf_cnpj));
                                }),
                        );
                    }

                    await Promise.all(buscas);

                    // 4. Separar quem entra e quem é barrado (checagem tripla)
                    const leadsParaInserir: typeof mappedLeads = [];
                    let ignoradosCount = 0;

                    for (const lead of mappedLeads) {
                        const telefoneJaExiste = lead.telefone && telefonesExistentes.has(lead.telefone);
                        const emailJaExiste = lead.email && emailsExistentes.has(lead.email);
                        const cpfJaExiste = lead.cpf_cnpj && cpfsExistentes.has(lead.cpf_cnpj);

                        if (telefoneJaExiste || emailJaExiste || cpfJaExiste) {
                            ignoradosCount++;
                            continue;
                        }
                        leadsParaInserir.push(lead);
                    }

                    // 5. Inserir apenas os novos em lote (Batch Insert)
                    if (leadsParaInserir.length > 0) {
                        const { error: insertError } = await supabaseClient
                            .from("clientes")
                            .insert(leadsParaInserir);

                        if (insertError) throw insertError;
                    }

                    // 6. Notificação amigável e transparente pro usuário
                    message.destroy("import-status");
                    Modal.success({
                        title: "Importação Concluída!",
                        content: (
                            <div style={{ marginTop: 16 }}>
                                <p>Sua planilha foi processada com sucesso. Aqui está o resumo:</p>
                                <ul style={{ background: "#f1f5f9", padding: "12px 12px 12px 28px", borderRadius: 8 }}>
                                    <li style={{ color: "#10b981", fontWeight: 600 }}>
                                        {leadsParaInserir.length} leads novos importados.
                                    </li>
                                    <li style={{ color: "#ef4444", fontWeight: 600, marginTop: 4 }}>
                                        {ignoradosCount} leads ignorados (já existiam).
                                    </li>
                                </ul>
                            </div>
                        ),
                        okText: "Entendi",
                    });

                    // 7. Força a tela de lista a atualizar com os novos dados
                    invalidate({
                        resource: "clientes",
                        invalidates: ["list"],
                    });

                } catch (error: any) {
                    console.error("Erro na importação:", error);
                    message.destroy("import-status");
                    Modal.error({
                        title: "Erro na importação",
                        content: error.message || "Ocorreu um erro ao salvar os dados no banco.",
                    });
                } finally {
                    setIsImporting(false);
                    // Reseta o input de arquivo (se o usuário quiser subir a mesma planilha editada de novo)
                    const input = document.getElementById("csv-upload-input") as HTMLInputElement;
                    if (input) input.value = '';
                }
            },
            error: (_err) => {
                message.error("Erro ao ler o arquivo CSV. Verifique o formato.");
                setIsImporting(false);
            }
        });
    };

    return (
        <>
            <input
                type="file"
                id="csv-upload-input"
                accept=".csv"
                style={{ display: "none" }}
                onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                        processFile(e.target.files[0]);
                    }
                }}
            />
            
            <Button
                icon={<UploadOutlined />}
                loading={isImporting}
                onClick={() => document.getElementById("csv-upload-input")?.click()}
                style={{ borderRadius: 8, height: 40, fontWeight: 600 }}
            >
                Importar CSV
            </Button>
        </>
    );
};