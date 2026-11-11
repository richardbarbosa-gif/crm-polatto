import { supabaseClient } from "../utility/supabaseClient";

/**
 * Cadastro e remoção de LOGIN dos membros da equipe.
 *
 * Criar ou apagar uma conta exige a service_role, que nunca vem para o
 * navegador: quem faz é a Edge Function `equipe-usuarios`
 * (supabase/functions), chamada com o token do gerente. O banco continua
 * decidindo quem pode (migration 18).
 */
export type RespostaEquipe = {
    success: boolean;
    error?: string;
    message?: string;
    user_id?: string;
    tenant_id?: string;
};

export type NovoMembro = {
    email: string;
    senha: string;
    nome: string;
    cargo?: string | null;
    papel: string;
};

const FUNCAO = "equipe-usuarios";

const ehResposta = (valor: unknown): valor is RespostaEquipe =>
    Boolean(valor) && typeof valor === "object" && typeof (valor as { success?: unknown }).success === "boolean";

/**
 * Erros de protocolo (401, 400, 500) chegam como FunctionsHttpError, com a
 * Response original em `context`: a mensagem amigável está no corpo dela.
 */
const respostaDoErro = async (erro: unknown): Promise<RespostaEquipe> => {
    const contexto = (erro as { context?: unknown } | null)?.context;
    if (contexto instanceof Response) {
        if (contexto.status === 404) {
            return {
                success: false,
                error: "A função de gestão de usuários não está publicada neste projeto. Fale com o administrador do sistema.",
            };
        }
        try {
            const corpo: unknown = await contexto.clone().json();
            if (ehResposta(corpo)) return corpo;
        } catch {
            // corpo não é JSON (ex.: página de erro do gateway): cai na mensagem padrão
        }
    }
    return { success: false, error: "Não foi possível falar com o servidor. Confira sua conexão e tente novamente." };
};

const chamar = async (corpo: Record<string, unknown>): Promise<RespostaEquipe> => {
    const { data, error } = await supabaseClient.functions.invoke<unknown>(FUNCAO, { body: corpo });
    if (error) return respostaDoErro(error);
    if (ehResposta(data)) return data;
    return { success: false, error: "Resposta inesperada do servidor." };
};

export const criarMembroEquipe = (membro: NovoMembro): Promise<RespostaEquipe> =>
    chamar({
        acao: "criar",
        email: membro.email,
        senha: membro.senha,
        nome: membro.nome,
        cargo: membro.cargo ?? null,
        papel: membro.papel,
    });

export const removerMembroEquipe = (userId: string): Promise<RespostaEquipe> =>
    chamar({ acao: "remover", user_id: userId });
