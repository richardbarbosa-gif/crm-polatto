import { Tag, Tooltip } from "antd";
import { COR_STATUS, ROTULO_STATUS, estaVencido, formatarDataIso, type StatusOrcamento } from "../../lib/orcamentos/formato";

type Props = {
    status: StatusOrcamento;
    validoAte?: string | null;
};

export const StatusOrcamentoTag = ({ status, validoAte }: Props) => (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
        <Tag color={COR_STATUS[status]} style={{ marginInlineEnd: 0 }}>
            {ROTULO_STATUS[status]}
        </Tag>
        {estaVencido(validoAte, status) ? (
            <Tooltip title={`Validade terminou em ${formatarDataIso(validoAte)}. Renove a validade ou marque como expirado.`}>
                <Tag color="warning" style={{ marginInlineEnd: 0 }}>
                    Vencido
                </Tag>
            </Tooltip>
        ) : null}
    </span>
);
