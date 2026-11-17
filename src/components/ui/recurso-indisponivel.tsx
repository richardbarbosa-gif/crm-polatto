import { Alert } from "antd";
import type { CSSProperties } from "react";

type Props = {
    /** Nome da parte do CRM como o usuário a conhece: "Orçamentos", "Contatos". */
    recurso: string;
    style?: CSSProperties;
};

/**
 * Aviso único para quando uma parte do CRM não responde porque a estrutura
 * dela ainda não existe no banco (site publicado antes da atualização do
 * banco). Quem usa o CRM não tem o que fazer com nome de tabela ou de
 * migration: a mensagem diz o que está fora do ar e o que fazer. O erro
 * técnico continua indo para o monitoramento pela camada de dados.
 */
export const RecursoIndisponivel = ({ recurso, style }: Props) => (
    <Alert
        type="warning"
        showIcon
        message={`${recurso}: indisponível no momento`}
        description="Esta parte do CRM está em atualização. Tente de novo em alguns minutos; se o aviso continuar, fale com o suporte."
        style={{ marginBottom: 16, ...style }}
    />
);
