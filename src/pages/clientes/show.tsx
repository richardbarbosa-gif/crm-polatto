import { Show } from "@refinedev/antd";
import { useShow } from "@refinedev/core";
import { useState } from "react";
import { TaskFormModal } from "../../components/modal/agenda";
import { useCrmAccess } from "../../hooks/useCrmAccess";
import { LeadDetails, type LeadDetalhe } from "./lead-details";

export const ClienteShow = () => {
    const { query } = useShow<LeadDetalhe & { id: string | number }>();
    const isLoading = query.isLoading;
    const record = query.data?.data;
    // Todo vendedor vê os leads da empresa; excluir (lixeira) é do gerente ou
    // do dono do lead — a mesma regra que o banco garante (migration 12).
    const { podeExcluir, ownerDisplayName } = useCrmAccess();
    const [isModalOpen, setIsModalOpen] = useState(false);

    return (
        <Show canDelete={Boolean(record) && podeExcluir(record)} isLoading={isLoading} title="Detalhes do lead">
            <LeadDetails
                record={record}
                isLoading={isLoading}
                currentUserLabel={ownerDisplayName}
                onScheduleVisit={() => setIsModalOpen(true)}
            />

            {record?.id ? (
                <TaskFormModal
                    open={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    contextData={{
                        clienteId: record.id,
                        clienteNome: record.nome || "Cliente",
                        clienteEndereco: record.endereco_instalacao || "",
                    }}
                />
            ) : null}
        </Show>
    );
};
