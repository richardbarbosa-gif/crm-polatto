import { Show } from "@refinedev/antd";
import { useShow } from "@refinedev/core";
import { Alert } from "antd";
import { useMemo, useState } from "react";
import { TaskFormModal } from "../../components/modal/agenda";
import { matchesLeadOwner, useCrmAccess } from "../../hooks/useCrmAccess";
import { LeadDetails } from "./lead-details";

export const ClienteShow = () => {
    const showResult = useShow() as any;
    const { data, isLoading } = showResult.query || showResult;
    const record = data?.data;
    const { canDeleteRecords, canViewAllLeads, ownerCandidatesNormalized, ownerDisplayName } =
        useCrmAccess();
    const [isModalOpen, setIsModalOpen] = useState(false);

    const canAccessLead = useMemo(() => {
        if (!record) {
            return true;
        }
        if (canViewAllLeads) {
            return true;
        }
        return matchesLeadOwner(record.responsavel, ownerCandidatesNormalized);
    }, [canViewAllLeads, ownerCandidatesNormalized, record]);

    return (
        <Show canDelete={canDeleteRecords} isLoading={isLoading} title="Detalhes do Cliente">
            {!isLoading && !canAccessLead ? (
                <Alert
                    type="warning"
                    showIcon
                    message="Acesso restrito"
                    description="Este lead nao esta vinculado ao seu usuario."
                />
            ) : (
                <LeadDetails
                    record={record}
                    isLoading={isLoading}
                    currentUserLabel={ownerDisplayName}
                    onScheduleVisit={() => setIsModalOpen(true)}
                />
            )}

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
