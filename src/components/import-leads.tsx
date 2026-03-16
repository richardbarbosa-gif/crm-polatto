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

                    // 1. Mapear e higienizar os dados do CSV (Igual fazíamos antes)
                    const mappedLeads = rows.map((item) => ({
                        tenant_id: tenantId || undefined,
                        nome: item.Nome || item.nome || item.Name || "Lead Sem Nome",
                        email: item.Email || item.email || null,
                        telefone: String(item.Telefone || item.telefone || item.Phone || "").trim(),
                        responsavel: item.Responsavel || item.responsavel || item.Responsável || ownerDisplayName,
                        conta_energia_media: Number(item.Valor || item.valor || item.conta_energia_media) || 0,
                        status: item.Status || item.status || item.Etapa || "Novo Lead",
                        temperatura: item.Temperatura || item.temperatura || null,
                    }));

                    // 2. Extrair apenas os telefones válidos para nossa "Malha Fina"
                    const telefonesParaChecar = mappedLeads
                        .map(l => l.telefone)
                        .filter(tel => tel.length > 0);

                    // 3. Buscar no Supabase QUAIS desses telefones já existem (Consulta Bulk super rápida)
                    let telefonesExistentes = new Set<string>();
                    
                    if (telefonesParaChecar.length > 0) {
                        const { data: leadsExistentes, error } = await supabaseClient
                            .from("clientes")
                            .select("telefone")
                            .in("telefone", telefonesParaChecar)
                            .not("telefone", "is", null);
                            
                        if (!error && leadsExistentes) {
                            leadsExistentes.forEach(l => telefonesExistentes.add(l.telefone));
                        }
                    }

                    // 4. A Inteligência: Separar quem entra e quem é barrado
                    const leadsParaInserir = [];
                    let ignoradosCount = 0;

                    for (const lead of mappedLeads) {
                        // Se o lead tem telefone E esse telefone já foi pego na malha fina do banco, ignora!
                        if (lead.telefone && telefonesExistentes.has(lead.telefone)) {
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