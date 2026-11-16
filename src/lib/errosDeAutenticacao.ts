/**
 * Mensagens do Supabase Auth em português. O serviço responde em inglês
 * ("Invalid login credentials", "AuthApiError") e era isso que aparecia na
 * tela de login.
 */
type ErroDeAuth = { name: string; message: string };

const POR_CODIGO: Record<string, string> = {
    invalid_credentials: "E-mail ou senha incorretos.",
    email_not_confirmed: "Confirme seu e-mail pelo link que enviamos antes de entrar.",
    user_already_exists: "Este e-mail já possui conta. Entre ou recupere a senha.",
    email_exists: "Este e-mail já possui conta. Entre ou recupere a senha.",
    weak_password: "Senha fraca: use pelo menos 8 caracteres, misturando letras e números.",
    same_password: "A nova senha precisa ser diferente da atual.",
    signup_disabled: "O cadastro de novas contas está fechado. Peça acesso ao gerente da sua empresa.",
    email_address_invalid: "E-mail inválido.",
    validation_failed: "Confira o e-mail e a senha informados.",
    over_email_send_rate_limit: "Muitos e-mails enviados em pouco tempo. Aguarde alguns minutos e tente de novo.",
    over_request_rate_limit: "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.",
    user_banned: "Esta conta está bloqueada. Fale com o gerente da sua empresa.",
    session_not_found: "Sua sessão expirou. Entre novamente.",
    otp_expired: "O link expirou ou já foi usado. Peça um novo.",
};

const POR_TEXTO: Array<[RegExp, string]> = [
    [/invalid login credentials/i, POR_CODIGO.invalid_credentials],
    [/email not confirmed/i, POR_CODIGO.email_not_confirmed],
    [/already registered|already exists/i, POR_CODIGO.user_already_exists],
    [/signups? not allowed|signup is disabled/i, POR_CODIGO.signup_disabled],
    [/password should be|weak password/i, POR_CODIGO.weak_password],
    [/different from the old password/i, POR_CODIGO.same_password],
    [/rate limit|too many requests/i, POR_CODIGO.over_request_rate_limit],
    [/expired|invalid.*(token|link)/i, POR_CODIGO.otp_expired],
    [/failed to fetch|network|load failed/i, "Sem conexão com o servidor. Confira sua internet e tente de novo."],
];

export const traduzirErroDeAuth = (erro: unknown, titulo: string): ErroDeAuth => {
    const codigo = String((erro as { code?: unknown } | null)?.code ?? "");
    const texto = String((erro as { message?: unknown } | null)?.message ?? "");
    const message =
        POR_CODIGO[codigo] ??
        POR_TEXTO.find(([padrao]) => padrao.test(texto))?.[1] ??
        "Não foi possível concluir. Tente novamente em instantes.";
    return { name: titulo, message };
};
