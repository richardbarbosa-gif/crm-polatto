/** Forma mínima dos erros do Supabase/PostgREST que estas funções inspecionam. */
type ErroSupabase = { code?: unknown; statusCode?: unknown; message?: unknown; details?: unknown };

const comoErro = (error: unknown): ErroSupabase =>
    error && typeof error === "object" ? (error as ErroSupabase) : {};

export const isSupabaseMissingRelation = (erro: unknown): boolean => {
    if (!erro) {
        return false;
    }
    const error = comoErro(erro);

    const message = String(error?.message || error?.details || "").toLowerCase();

    return (
        error?.code === "42P01" ||
        error?.statusCode === 404 ||
        message.includes("does not exist") ||
        message.includes("could not find the table") ||
        message.includes("schema cache")
    );
};

export const isSupabaseMissingColumn = (erro: unknown): boolean => {
    if (!erro) {
        return false;
    }
    const error = comoErro(erro);

    const message = String(error?.message || error?.details || "").toLowerCase();
    return error?.code === "42703" || (message.includes("column") && message.includes("does not exist"));
};

export const isSupabasePolicyRecursion = (erro: unknown): boolean => {
    if (!erro) {
        return false;
    }
    const error = comoErro(erro);

    const message = String(error?.message || error?.details || "").toLowerCase();

    return (
        error?.code === "42P17" ||
        message.includes("infinite recursion detected in policy") ||
        (message.includes("policy for relation") && message.includes("recursion"))
    );
};

export const getSupabaseErrorMessage = (erro: unknown): string => {
    if (!erro) {
        return "";
    }
    const error = comoErro(erro);

    const message = String(error?.message || "").trim();
    const details = String(error?.details || "").trim();

    if (message && details && !message.includes(details)) {
        return `${message} ${details}`.trim();
    }

    return message || details || "Erro inesperado ao consultar o Supabase.";
};
