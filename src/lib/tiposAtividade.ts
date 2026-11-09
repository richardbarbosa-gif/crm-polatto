/**
 * Rótulo legível do tipo de atividade gravado na tarefa ("ligacao",
 * "reuniao", "follow_up"…). Os tipos padrão têm nome fixo; os criados pela
 * empresa em Configurações > Tipos de atividade viram texto legível
 * ("visita_tecnica" → "Visita tecnica" só se não houver acento conhecido).
 */
const ROTULOS: Record<string, string> = {
    visita: "Visita",
    visita_tecnica: "Visita técnica",
    ligacao: "Ligação",
    whatsapp: "WhatsApp",
    email: "E-mail",
    "e-mail": "E-mail",
    reuniao: "Reunião",
    tarefa: "Tarefa",
    follow_up: "Follow-up",
    "follow-up": "Follow-up",
    followup: "Follow-up",
    proposta: "Proposta",
};

export const rotuloTipoAtividade = (tipo?: string | null): string => {
    const valor = (tipo ?? "").trim();
    if (!valor) return "Sem tipo";
    const chave = valor.toLowerCase();
    if (chave === "etec" || chave === "etc") return "Outro";
    if (ROTULOS[chave]) return ROTULOS[chave];
    const legivel = valor.replace(/[_-]+/g, " ").trim();
    return legivel.charAt(0).toUpperCase() + legivel.slice(1);
};
