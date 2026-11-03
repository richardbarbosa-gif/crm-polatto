/**
 * URL segura para mandar ao monitoramento de erros: só origem + caminho.
 *
 * SEGURANÇA: no retorno do link de recuperação de senha / OAuth, o Supabase
 * coloca access_token e refresh_token no hash da URL (#access_token=...).
 * Um erro de runtime nesse instante gravaria os tokens em client_errors,
 * tabela que todo o tenant consegue ler. Query string também cai fora
 * (busca, e-mail em filtro etc. são dado pessoal sem valor de diagnóstico).
 */
export const safeReportUrl = (href: string | null | undefined): string | null => {
    if (!href) return null;
    try {
        const url = new URL(href);
        return `${url.origin}${url.pathname}`;
    } catch {
        // URL relativa ou malformada: corta no primeiro "?" ou "#"
        return href.split(/[?#]/, 1)[0] || null;
    }
};
