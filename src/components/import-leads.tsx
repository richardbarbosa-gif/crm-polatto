import React from "react";
import { useImport, useInvalidate } from "@refinedev/core";
import { Button, message } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { useCrmAccess } from "../hooks/useCrmAccess";

export const ImportLeadsButton = () => {
    const { tenantId, ownerDisplayName } = useCrmAccess();
    const invalidate = useInvalidate();

    // Extraímos apenas o que importa: a função que lê o arquivo e o status de carregamento
    const { handleChange, isLoading } = useImport({
        resource: "clientes",
        mapData: (item) => {
            return {
                tenant_id: tenantId || undefined,
                nome: item.Nome || item.nome || item.Name || "Lead Sem Nome",
                email: item.Email || item.email || null,
                telefone: item.Telefone || item.telefone || item.Phone || null,
                responsavel: item.Responsavel || item.responsavel || item.Responsável || ownerDisplayName,
                conta_energia_media: Number(item.Valor || item.valor || item.conta_energia_media) || 0,
                status: item.Status || item.status || item.Etapa || "Novo Lead",
                temperatura: item.Temperatura || item.temperatura || null,
            };
        },
        batchSize: 50,
        onFinish: () => {
            message.success("Planilha importada com sucesso!");
            invalidate({
                resource: "clientes",
                invalidates: ["list"],
            });
        }
    });

    return (
        <>
            {/* Input nativo de HTML escondido. Impossível o TypeScript reclamar dele! */}
            <input
                type="file"
                id="csv-upload-input"
                accept=".csv"
                style={{ display: "none" }}
                onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                        // Passa o arquivo direto para a inteligência do Refine
                        handleChange({ file: e.target.files[0] });
                        
                        // Reseta o input para permitir subir a mesma planilha de novo, se precisar
                        e.target.value = ''; 
                    }
                }}
            />
            
            {/* Nosso Botão UI perfeito */}
            <Button
                icon={<UploadOutlined />}
                loading={isLoading}
                onClick={() => document.getElementById("csv-upload-input")?.click()}
                style={{ borderRadius: 8, height: 40, fontWeight: 600 }}
            >
                Importar CSV
            </Button>
        </>
    );
};