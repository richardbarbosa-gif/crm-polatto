// =====================================================================
// Edge Function `equipe-usuarios` — cria e remove o LOGIN de um membro
// da equipe pela API de administração do Supabase Auth.
//
// Por que existe: a service_role (única chave que cria/apaga contas) não
// pode ir para o navegador, e o banco não deve escrever nas tabelas
// internas do Auth (auth.users). Aqui a chave fica no servidor e o banco
// continua decidindo QUEM pode (migration 18):
//
//   criar   1. equipe_preparar_criacao  (JWT do gerente) valida tudo
//           2. auth.admin.createUser    cria o login, marcado em
//              app_metadata para ESTA empresa e ESTE gerente
//           3. equipe_concluir_criacao  (JWT do gerente) confere a marca
//              e grava funcionário + vínculo
//           falhou o passo 3 -> o login é apagado (nada fica pela metade)
//
//   remover 1. equipe_remover_membro    (JWT do gerente) desfaz o vínculo
//           2. auth.admin.deleteUser    só se a conta ficou sem empresa
//
// As RPCs rodam com o token de quem chamou: esta função nunca decide
// permissão por conta própria e nunca usa a service_role para ler ou
// gravar dado de negócio.
//
// Deploy: verify_jwt = true. Variáveis usadas (já existem no projeto):
// SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY. Opcional:
// CRM_ORIGENS_PERMITIDAS (lista separada por vírgula) restringe o CORS
// aos domínios do CRM.
// =====================================================================
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

type Resposta = {
    success: boolean;
    error?: string;
    message?: string;
    user_id?: string;
    tenant_id?: string;
};

const SENHA_MINIMA = 8;
// O bcrypt do Auth só considera os primeiros 72 bytes.
const SENHA_MAXIMA_BYTES = 72;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const origensPermitidas = (Deno.env.get("CRM_ORIGENS_PERMITIDAS") ?? "")
    .split(",")
    .map((origem) => origem.trim())
    .filter(Boolean);

// Sem cookie nem credencial ambiente: a autenticação é o Bearer enviado
// pelo próprio app, então "*" não abre nada. Com a lista configurada, só
// os domínios do CRM recebem o cabeçalho.
const cabecalhosCors = (requisicao: Request): Record<string, string> => {
    const origem = requisicao.headers.get("origin") ?? "";
    const permitida =
        origensPermitidas.length === 0 ? "*" : origensPermitidas.includes(origem) ? origem : origensPermitidas[0];
    return {
        "Access-Control-Allow-Origin": permitida,
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-id",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        Vary: "Origin",
    };
};

const responder = (requisicao: Request, status: number, corpo: Resposta): Response =>
    new Response(JSON.stringify(corpo), {
        status,
        headers: { ...cabecalhosCors(requisicao), "Content-Type": "application/json; charset=utf-8" },
    });

const texto = (valor: unknown, limite: number): string =>
    typeof valor === "string" ? valor.trim().slice(0, limite) : "";

const lerResposta = (dados: unknown): Resposta & { apagar_login?: boolean; email?: string } => {
    if (dados && typeof dados === "object" && typeof (dados as { success?: unknown }).success === "boolean") {
        return dados as Resposta & { apagar_login?: boolean; email?: string };
    }
    return { success: false, error: "Resposta inesperada do banco." };
};

const validarSenha = (senha: unknown): string | null => {
    if (typeof senha !== "string" || senha.length < SENHA_MINIMA) {
        return `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`;
    }
    if (new TextEncoder().encode(senha).length > SENHA_MAXIMA_BYTES) {
        return `A senha pode ter no máximo ${SENHA_MAXIMA_BYTES} caracteres.`;
    }
    if (!senha.trim()) return "A senha não pode ser só espaços.";
    return null;
};

const criar = async (
    comoGerente: SupabaseClient,
    admin: SupabaseClient,
    gerenteId: string,
    corpo: Record<string, unknown>,
): Promise<Resposta> => {
    const email = texto(corpo.email, 254).toLowerCase();
    const nome = texto(corpo.nome, 200);
    const cargo = texto(corpo.cargo, 100);
    const papel = texto(corpo.papel, 30) || "vendedor";

    const erroSenha = validarSenha(corpo.senha);
    if (erroSenha) return { success: false, error: erroSenha };

    const preparo = await comoGerente.rpc("equipe_preparar_criacao", { p_email: email, p_nome: nome });
    if (preparo.error) {
        console.error("equipe_preparar_criacao:", preparo.error.message);
        return { success: false, error: "Não foi possível validar o cadastro. Tente novamente." };
    }
    const validado = lerResposta(preparo.data);
    if (!validado.success || !validado.tenant_id) {
        return { success: false, error: validado.error || "Cadastro não autorizado." };
    }

    const criado = await admin.auth.admin.createUser({
        email: validado.email || email,
        password: corpo.senha as string,
        // O gerente responde pelos e-mails da própria equipe; sem isso o
        // membro não conseguiria entrar com a senha inicial.
        email_confirm: true,
        user_metadata: { full_name: nome },
        // app_metadata só é gravável com a service_role: é a prova, para o
        // passo 3, de que ESTE login nasceu aqui, para esta empresa.
        app_metadata: { crm_equipe_tenant: validado.tenant_id, crm_equipe_criado_por: gerenteId },
    });
    if (criado.error || !criado.data.user) {
        const jaExiste = criado.error?.status === 422 || /already|registered|exists/i.test(criado.error?.message ?? "");
        if (!jaExiste) console.error("auth.admin.createUser:", criado.error?.message);
        return {
            success: false,
            error: jaExiste ? "Este e-mail já possui conta." : "Não foi possível criar o login. Tente novamente.",
        };
    }
    const novoId = criado.data.user.id;

    const conclusao = await comoGerente.rpc("equipe_concluir_criacao", {
        p_user_id: novoId,
        p_nome: nome,
        p_cargo: cargo || null,
        p_role: papel,
    });
    const concluido = conclusao.error ? null : lerResposta(conclusao.data);
    if (!concluido?.success) {
        if (conclusao.error) console.error("equipe_concluir_criacao:", conclusao.error.message);
        const desfeito = await admin.auth.admin.deleteUser(novoId);
        if (desfeito.error) {
            // Login órfão (sem empresa): não dá acesso a nada, mas ocupa o e-mail.
            console.error(`LOGIN ÓRFÃO ${novoId}: falha ao desfazer —`, desfeito.error.message);
        }
        return { success: false, error: concluido?.error || "Não foi possível concluir o cadastro do membro." };
    }

    return {
        success: true,
        user_id: concluido.user_id,
        tenant_id: concluido.tenant_id,
        message: concluido.message,
    };
};

const remover = async (
    comoGerente: SupabaseClient,
    admin: SupabaseClient,
    corpo: Record<string, unknown>,
): Promise<Resposta> => {
    const alvo = texto(corpo.user_id, 36);
    if (!UUID_RE.test(alvo)) return { success: false, error: "Membro inválido." };

    const remocao = await comoGerente.rpc("equipe_remover_membro", { p_user_id: alvo });
    if (remocao.error) {
        console.error("equipe_remover_membro:", remocao.error.message);
        return { success: false, error: "Não foi possível remover o membro. Tente novamente." };
    }
    const removido = lerResposta(remocao.data);
    if (!removido.success) return { success: false, error: removido.error || "Não foi possível remover o membro." };

    if (removido.apagar_login) {
        // Confere de novo, agora com a service_role: só apaga a conta que
        // realmente não pertence a mais nenhuma empresa.
        const vinculos = await admin
            .from("utilizadores_empresas")
            .select("auth_uid", { count: "exact", head: true })
            .eq("auth_uid", alvo);
        if (!vinculos.error && vinculos.count === 0) {
            const apagado = await admin.auth.admin.deleteUser(alvo);
            // 404 = funcionário que nunca teve login: nada a apagar.
            if (apagado.error && apagado.error.status !== 404) {
                console.error(`LOGIN ÓRFÃO ${alvo}: vínculo removido, conta não apagada —`, apagado.error.message);
            }
        } else if (vinculos.error) {
            console.error("conferência de vínculos:", vinculos.error.message);
        }
    }

    return { success: true, message: removido.message };
};

Deno.serve(async (requisicao: Request): Promise<Response> => {
    if (requisicao.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: cabecalhosCors(requisicao) });
    }
    if (requisicao.method !== "POST") {
        return responder(requisicao, 405, { success: false, error: "Método não permitido." });
    }

    const url = Deno.env.get("SUPABASE_URL");
    const chavePublica = Deno.env.get("SUPABASE_ANON_KEY");
    const chaveServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !chavePublica || !chaveServico) {
        console.error("equipe-usuarios: variáveis SUPABASE_* ausentes.");
        return responder(requisicao, 500, { success: false, error: "Serviço indisponível." });
    }

    const autorizacao = requisicao.headers.get("authorization") ?? "";
    const token = autorizacao.replace(/^Bearer\s+/i, "").trim();
    if (!token) return responder(requisicao, 401, { success: false, error: "Faça login para continuar." });

    let corpo: Record<string, unknown>;
    try {
        const lido: unknown = await requisicao.json();
        if (!lido || typeof lido !== "object" || Array.isArray(lido)) throw new Error("corpo inválido");
        corpo = lido as Record<string, unknown>;
    } catch {
        return responder(requisicao, 400, { success: false, error: "Requisição inválida." });
    }

    // Mesma empresa ativa que o app envia ao banco; current_tenant_id()
    // valida o valor contra os vínculos reais do usuário.
    const cabecalhos: Record<string, string> = { Authorization: `Bearer ${token}` };
    const empresaAtiva = requisicao.headers.get("x-tenant-id") ?? "";
    if (UUID_RE.test(empresaAtiva)) cabecalhos["x-tenant-id"] = empresaAtiva;

    const semSessao = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
    const comoGerente = createClient(url, chavePublica, { auth: semSessao, global: { headers: cabecalhos } });
    const admin = createClient(url, chaveServico, { auth: semSessao });

    const { data: sessao, error: erroSessao } = await comoGerente.auth.getUser(token);
    if (erroSessao || !sessao.user) {
        return responder(requisicao, 401, { success: false, error: "Sessão expirada. Entre novamente." });
    }

    try {
        const acao = texto(corpo.acao, 20);
        if (acao === "criar") return responder(requisicao, 200, await criar(comoGerente, admin, sessao.user.id, corpo));
        if (acao === "remover") return responder(requisicao, 200, await remover(comoGerente, admin, corpo));
        return responder(requisicao, 400, { success: false, error: "Ação desconhecida." });
    } catch (erro) {
        console.error("equipe-usuarios:", erro instanceof Error ? erro.message : erro);
        return responder(requisicao, 500, { success: false, error: "Erro inesperado. Tente novamente." });
    }
});
