import { CheckCircleFilled, RocketOutlined } from "@ant-design/icons";
import { Popconfirm, Progress, Typography, message } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { lerStatusPrimeiroAcesso, montarChecklist, type StatusPrimeiroAcesso } from "../lib/primeiroAcesso";
import { supabaseClient } from "../utility";
import { Button, Card } from "./ui";

const { Text } = Typography;

/**
 * Primeiro acesso guiado (só gerente). Cada passo vem marcado pelo estado
 * real dos dados (status_primeiro_acesso, migration 16). Dispensar grava
 * no banco, por empresa: some para todos os gerentes da empresa.
 */
export const PrimeiroAcesso = ({ isGerente, tenantId }: { isGerente: boolean; tenantId: string | null }) => {
    const navigate = useNavigate();
    const [status, setStatus] = useState<StatusPrimeiroAcesso | null>(null);
    const [dispensando, setDispensando] = useState(false);

    useEffect(() => {
        if (!isGerente || !tenantId) return;
        let ativo = true;
        void supabaseClient.rpc("status_primeiro_acesso").then(({ data, error }) => {
            // Sem a migration 16 (ou erro), o card simplesmente não aparece
            if (ativo) setStatus(error ? null : lerStatusPrimeiroAcesso(data));
        });
        return () => {
            ativo = false;
        };
    }, [isGerente, tenantId]);

    const checklist = montarChecklist(status, isGerente);
    if (!checklist.visivel) return null;

    const dispensar = async () => {
        setDispensando(true);
        const { error } = await supabaseClient
            .from("onboarding_empresa")
            .upsert({ dispensado_em: new Date().toISOString() }, { onConflict: "tenant_id" });
        setDispensando(false);
        if (error) {
            message.error("Não foi possível dispensar o guia agora.");
            return;
        }
        setStatus((atual) => (atual ? { ...atual, dispensado: true } : atual));
        message.success("Guia de primeiro acesso dispensado para a empresa.");
    };

    return (
        <Card
            title={
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <RocketOutlined style={{ color: "#2563eb" }} />
                    <Text strong style={{ fontSize: 15 }}>
                        Primeiros passos no CRM
                    </Text>
                </span>
            }
            extra={
                <Popconfirm
                    title="Dispensar o guia?"
                    description="Ele some para todos os gerentes da empresa."
                    okText="Dispensar"
                    cancelText="Cancelar"
                    onConfirm={dispensar}
                >
                    <Button size="small" type="text" loading={dispensando}>
                        Dispensar
                    </Button>
                </Popconfirm>
            }
            style={{ marginBottom: 14 }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <Progress percent={checklist.percentual} size="small" style={{ flex: 1, margin: 0 }} />
                <Text type="secondary" style={{ whiteSpace: "nowrap" }}>
                    {checklist.feitos} de {checklist.total}
                </Text>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
                {checklist.itens.map((item) => (
                    <div
                        key={item.chave}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "8px 10px",
                            borderRadius: 10,
                            border: "1px solid var(--crm-border-subtle)",
                            background: item.feito ? "rgba(16,185,129,0.05)" : "transparent",
                        }}
                    >
                        <CheckCircleFilled
                            aria-label={item.feito ? "Concluído" : "Pendente"}
                            style={{ fontSize: 18, color: item.feito ? "#10b981" : "var(--crm-ink-300)" }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <Text strong delete={item.feito} style={{ display: "block" }}>
                                {item.titulo}
                            </Text>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                                {item.descricao}
                            </Text>
                        </div>
                        {!item.feito ? (
                            <Button size="small" onClick={() => navigate(item.rota)}>
                                {item.acao}
                            </Button>
                        ) : null}
                    </div>
                ))}
            </div>
        </Card>
    );
};
