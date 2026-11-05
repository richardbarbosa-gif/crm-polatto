/**
 * Validações do "Meu perfil". O banco (atualizar_meu_perfil) repete as
 * mesmas regras; aqui é para o usuário ver o erro antes de enviar.
 */

export const SENHA_MINIMA = 8;
// Limite do bcrypt usado pelo Supabase Auth: acima de 72 bytes é ignorado
export const SENHA_MAXIMA = 72;

const TELEFONE_RE = /^[0-9 ()+.-]+$/;

export const validarNome = (nome?: string | null): string | null => {
    const valor = (nome ?? "").trim();
    if (valor.length < 2) return "Informe seu nome (pelo menos 2 letras).";
    if (valor.length > 120) return "Nome muito longo (máximo de 120 caracteres).";
    return null;
};

/** Telefone é opcional; se vier, só dígitos e pontuação comum, 8 a 15 dígitos. */
export const validarTelefonePerfil = (telefone?: string | null): string | null => {
    const valor = (telefone ?? "").trim();
    if (!valor) return null;
    const digitos = valor.replace(/\D/g, "").length;
    if (valor.length > 30 || !TELEFONE_RE.test(valor) || digitos < 8 || digitos > 15) {
        return "Telefone inválido: use só números, espaço, parênteses, + ou -.";
    }
    return null;
};

export const validarNovaSenha = (senha?: string | null, confirmacao?: string | null): string | null => {
    const valor = senha ?? "";
    if (valor.length < SENHA_MINIMA) return `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`;
    if (new TextEncoder().encode(valor).length > SENHA_MAXIMA) return `A senha pode ter no máximo ${SENHA_MAXIMA} caracteres.`;
    if (!valor.trim()) return "A senha não pode ser só espaços.";
    if (valor !== (confirmacao ?? "")) return "A confirmação não confere com a nova senha.";
    return null;
};

/** Resposta da RPC atualizar_meu_perfil: { success, message?, error? }. */
export const lerRespostaPerfil = (dado: unknown): { ok: boolean; mensagem: string } => {
    const r = (dado && typeof dado === "object" ? dado : {}) as { success?: unknown; message?: unknown; error?: unknown };
    if (r.success === true) return { ok: true, mensagem: typeof r.message === "string" ? r.message : "Perfil atualizado." };
    return { ok: false, mensagem: typeof r.error === "string" ? r.error : "Não foi possível salvar o perfil." };
};
