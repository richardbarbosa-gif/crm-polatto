/**
 * Validação tipada das variáveis de ambiente.
 * Falta de variável quebra IMEDIATAMENTE no boot com mensagem clara,
 * em vez de falhar silenciosamente em runtime.
 */

type EnvConfig = {
    supabaseUrl: string;
    supabaseKey: string;
};

const readRequired = (key: string): string => {
    const value = import.meta.env[key];
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(
            `Variável de ambiente obrigatória ausente: ${key}. ` +
                `Copie .env.example para .env e preencha os valores (ver README).`,
        );
    }
    return value.trim();
};

const validateUrl = (key: string, value: string): string => {
    try {
        new URL(value);
        return value;
    } catch {
        throw new Error(`Variável de ambiente ${key} não é uma URL válida: "${value}"`);
    }
};

export const env: EnvConfig = {
    supabaseUrl: validateUrl("VITE_SUPABASE_URL", readRequired("VITE_SUPABASE_URL")),
    supabaseKey: readRequired("VITE_SUPABASE_KEY"),
};
