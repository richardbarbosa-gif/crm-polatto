import { normalizeText } from "./formatters";

/**
 * Papéis do CRM (regras do Richard, 2026-11-03):
 * - GERENTE faz tudo na empresa: vê, edita, exclui, restaura, configura e
 *   administra a equipe.
 * - VENDEDOR vê os leads de todos, mas só exclui/restaura o que é dele.
 *
 * Mesmos termos de `eh_admin_do_tenant()` no banco (migration 10): o banco
 * é quem garante; aqui a tela só evita oferecer o que vai ser recusado.
 */
const GERENTE_TERMS = ["admin", "superadmin", "owner", "administrador", "gerente", "gestor", "manager"];

export type Papel = "gerente" | "vendedor";

export const ehPapelGerente = (role?: string | null): boolean => {
    const normalized = normalizeText(role);
    if (!normalized) return false;
    return GERENTE_TERMS.some((term) => normalized === term || normalized.includes(term));
};

export const normalizarPapel = (role?: string | null): Papel => (ehPapelGerente(role) ? "gerente" : "vendedor");

export const rotuloDoPapel = (role?: string | null): string =>
    normalizeText(role) === "superadmin" ? "Superadmin" : ehPapelGerente(role) ? "Gerente" : "Vendedor";

/** Pode excluir QUALQUER registro e mexer na configuração (gerente). */
export const canDelete = (role?: string | null, isSystemAdmin = false): boolean => {
    if (isSystemAdmin) return true;
    return ehPapelGerente(role);
};

export type RegistroComDono = {
    created_by?: string | null;
    responsavel?: string | null;
    responsavel_id?: string | null;
};

export type ContextoDeDono = {
    ehGerente: boolean;
    userId?: string | null;
    funcionarioId?: string | null;
    /** Nome/e-mail do usuário já normalizados (useCrmAccess.ownerCandidatesNormalized). */
    nomesNormalizados: string[];
};

/** O registro é do usuário: cadastrou ou é o responsável (mesma regra do banco). */
export const registroEhDoUsuario = (registro: RegistroComDono | null | undefined, ctx: ContextoDeDono): boolean => {
    if (!registro) return false;
    const userId = ctx.userId ? String(ctx.userId) : "";
    if (userId && registro.created_by && String(registro.created_by) === userId) return true;

    const respId = registro.responsavel_id ? String(registro.responsavel_id) : "";
    if (respId && (respId === userId || (ctx.funcionarioId && respId === String(ctx.funcionarioId)))) return true;

    const resp = normalizeText(registro.responsavel);
    return Boolean(resp) && ctx.nomesNormalizados.includes(resp as string);
};

/** Pode mandar para a lixeira / restaurar: gerente sempre; vendedor só o que é dele. */
export const podeExcluirRegistro = (registro: RegistroComDono | null | undefined, ctx: ContextoDeDono): boolean =>
    ctx.ehGerente || registroEhDoUsuario(registro, ctx);
