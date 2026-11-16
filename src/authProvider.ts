import { AuthProvider } from "@refinedev/core";
import { supabaseClient } from "./utility";
import { traduzirErroDeAuth } from "./lib/errosDeAutenticacao";

/**
 * Estado do app no navegador que não pode passar de um usuário para o
 * próximo no mesmo computador: empresa ativa e leads recém-criados.
 * (Preferências neutras, como o tema, ficam.)
 */
const CHAVES_DA_SESSAO = ["crm_tenant_id", "crm-polatto:recent-created-leads:v1"];

const limparEstadoDaSessao = () => {
  try {
    CHAVES_DA_SESSAO.forEach((chave) => window.localStorage.removeItem(chave));
  } catch {
    // storage indisponível (modo privado restrito): nada a limpar
  }
};

const authProvider: AuthProvider = {
  login: async ({ email, password, providerName }) => {
    // sign in with oauth
    try {
      if (providerName) {
        const { data, error } = await supabaseClient.auth.signInWithOAuth({
          provider: providerName,
        });

        if (error) {
          return {
            success: false,
            error: traduzirErroDeAuth(error, "Não foi possível entrar"),
          };
        }

        if (data?.url) {
          return {
            success: true,
            redirectTo: "/",
          };
        }
      }

      // sign in with email and password
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return {
          success: false,
          error: traduzirErroDeAuth(error, "Não foi possível entrar"),
        };
      }

      if (data?.user) {
        return {
          success: true,
          redirectTo: "/",
        };
      }
    } catch (error) {
      return {
        success: false,
        error: traduzirErroDeAuth(error, "Não foi possível entrar"),
      };
    }

    return {
      success: false,
      error: {
        name: "Não foi possível entrar",
        message: "Não foi possível concluir. Tente novamente em instantes.",
      },
    };
  },
  register: async ({ email, password }) => {
    try {
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
      });

      if (error) {
        return {
          success: false,
          error: traduzirErroDeAuth(error, "Não foi possível criar a conta"),
        };
      }

      // Com a confirmação de e-mail ligada o Supabase cria a conta SEM
      // sessão: redirecionar para "/" devolvia a pessoa à tela de login sem
      // nenhuma explicação.
      if (data.user && !data.session) {
        return {
          success: true,
          redirectTo: "/login",
          successNotification: {
            message: "Confirme seu e-mail",
            description: "Enviamos um link de confirmação. Abra-o para ativar a conta e depois entre com seu e-mail e senha.",
          },
        };
      }

      if (data.session) {
        return {
          success: true,
          redirectTo: "/",
        };
      }
    } catch (error) {
      return {
        success: false,
        error: traduzirErroDeAuth(error, "Não foi possível criar a conta"),
      };
    }

    return {
      success: false,
      error: {
        name: "Não foi possível criar a conta",
        message: "Não foi possível concluir. Tente novamente em instantes.",
      },
    };
  },
  forgotPassword: async ({ email }) => {
    try {
      const { data, error } = await supabaseClient.auth.resetPasswordForEmail(
        email,
        {
          redirectTo: `${window.location.origin}/update-password`,
        }
      );

      if (error) {
        return {
          success: false,
          error: traduzirErroDeAuth(error, "Não foi possível enviar o link"),
        };
      }

      if (data) {
        return {
          success: true,
        };
      }
    } catch (error) {
      return {
        success: false,
        error: traduzirErroDeAuth(error, "Não foi possível enviar o link"),
      };
    }

    return {
      success: false,
      error: {
        name: "Não foi possível enviar o link",
        message: "Não foi possível concluir. Tente novamente em instantes.",
      },
    };
  },
  updatePassword: async ({ password }) => {
    try {
      const { data, error } = await supabaseClient.auth.updateUser({
        password,
      });

      if (error) {
        return {
          success: false,
          error: traduzirErroDeAuth(error, "Não foi possível trocar a senha"),
        };
      }

      if (data) {
        return {
          success: true,
          redirectTo: "/",
        };
      }
    } catch (error) {
      return {
        success: false,
        error: traduzirErroDeAuth(error, "Não foi possível trocar a senha"),
      };
    }
    return {
      success: false,
      error: {
        name: "Não foi possível trocar a senha",
        message: "Não foi possível concluir. Tente novamente em instantes.",
      },
    };
  },
  logout: async () => {
    const { error } = await supabaseClient.auth.signOut();

    if (error) {
      return {
        success: false,
        error: traduzirErroDeAuth(error, "Não foi possível sair"),
      };
    }

    // SEGURANÇA: o cache do Refine/react-query fica em memória e não é
    // limpo no logout — quem entrasse em seguida na mesma aba via, por um
    // instante, as listas do usuário anterior (outra empresa, inclusive).
    // Limpa o estado local e recarrega a página do zero.
    limparEstadoDaSessao();
    window.location.assign("/login");

    return {
      success: true,
      redirectTo: "/login",
    };
  },
  onError: async (error) => {
    console.error(error);
    return { error };
  },
  check: async () => {
    try {
      const { data } = await supabaseClient.auth.getSession();
      const { session } = data;

      if (!session) {
        return {
          authenticated: false,
          error: {
            message: "Check failed",
            name: "Session not found",
          },
          logout: true,
          redirectTo: "/login",
        };
      }
    } catch (error) {
      return {
        authenticated: false,
        error: (error as Error) || {
          message: "Check failed",
          name: "Not authenticated",
        },
        logout: true,
        redirectTo: "/login",
      };
    }

    return {
      authenticated: true,
    };
  },
  getPermissions: async () => {
    const user = await supabaseClient.auth.getUser();

    if (user) {
      return user.data.user?.role;
    }

    return null;
  },
  getIdentity: async () => {
    const { data } = await supabaseClient.auth.getUser();

    if (data?.user) {
      return {
        ...data.user,
        name: data.user.email,
      };
    }

    return null;
  },
};

export default authProvider;
