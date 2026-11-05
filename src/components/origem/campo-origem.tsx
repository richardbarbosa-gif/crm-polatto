import { Form, Select } from "antd";
import { useMemo } from "react";
import type { CanalOrigem } from "../../lib/origemLead";

type Props = {
    canais: CanalOrigem[];
    /** Origem gravada que não está mais ativa (canal desativado/apagado). */
    origemAtual?: { id?: string; nome?: string };
    size?: "large" | "middle";
};

/** Campo "Origem do lead" (name="origem_id") para os formulários do lead. */
export const CampoOrigem = ({ canais, origemAtual, size = "large" }: Props) => {
    const opcoes = useMemo(() => {
        const lista = canais.map((c) => ({ value: c.id, label: c.nome }));
        if (origemAtual?.id && !canais.some((c) => c.id === origemAtual.id)) {
            lista.push({ value: origemAtual.id, label: `${origemAtual.nome ?? "Canal removido"} (inativo)` });
        }
        return lista;
    }, [canais, origemAtual?.id, origemAtual?.nome]);

    if (opcoes.length === 0) return null;
    return (
        <Form.Item
            label="Origem do lead"
            name="origem_id"
            tooltip="Por onde o cliente chegou. Alimenta o relatório Vendas por origem."
        >
            <Select size={size} allowClear placeholder="Instagram, Indicação..." options={opcoes} />
        </Form.Item>
    );
};
