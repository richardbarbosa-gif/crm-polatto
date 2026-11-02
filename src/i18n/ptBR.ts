/**
 * Traduções PT-BR das strings geradas pelo Refine.
 *
 * Sem um i18nProvider, o Refine renderiza tudo em inglês: a tela de login
 * ("Sign in to your account", "Remember me"), os botões de salvar/excluir,
 * as confirmações de exclusão e as notificações de sucesso e erro. Em um
 * produto vendido para empresas brasileiras isso aparece já na primeira tela.
 *
 * Dicionário simples de propósito — não vale trazer i18next para um único
 * idioma. Se um dia houver um segundo, esta é a hora de trocar.
 */
export const traducoesPtBR: Record<string, string> = {
    // ---- Autenticação ----
    "pages.login.title": "Acesse sua conta",
    "pages.login.signin": "Entrar",
    "pages.login.signup": "Criar conta",
    "pages.login.divider": "ou",
    "pages.login.fields.email": "E-mail",
    "pages.login.fields.password": "Senha",
    "pages.login.buttons.submit": "Entrar",
    "pages.login.buttons.forgotPassword": "Esqueceu a senha?",
    "pages.login.buttons.noAccount": "Ainda não tem conta?",
    "pages.login.buttons.haveAccount": "Já tem uma conta?",
    "pages.login.buttons.rememberMe": "Continuar conectado",
    "pages.login.register": "Criar conta",
    "pages.login.forgotPassword": "Esqueceu a senha?",

    "pages.register.title": "Crie sua conta",
    "pages.register.email": "E-mail",
    "pages.register.fields.email": "E-mail",
    "pages.register.fields.password": "Senha",
    "pages.register.buttons.submit": "Criar conta",
    "pages.register.buttons.haveAccount": "Já tem uma conta?",
    "pages.register.signin": "Entrar",

    "pages.forgotPassword.title": "Recuperar senha",
    "pages.forgotPassword.fields.email": "E-mail",
    "pages.forgotPassword.buttons.submit": "Enviar link de recuperação",
    "pages.forgotPassword.signin": "Entrar",

    "pages.updatePassword.title": "Definir nova senha",
    "pages.updatePassword.fields.password": "Nova senha",
    "pages.updatePassword.fields.confirmPassword": "Confirme a nova senha",
    "pages.updatePassword.buttons.submit": "Salvar senha",
    "pages.updatePassword.errors.confirmPasswordNotMatch": "As senhas não conferem",

    // ---- Botões ----
    "buttons.save": "Salvar",
    "buttons.cancel": "Cancelar",
    "buttons.confirm": "Tem certeza?",
    "buttons.delete": "Excluir",
    "buttons.edit": "Editar",
    "buttons.create": "Criar",
    "buttons.show": "Ver",
    "buttons.list": "Listar",
    "buttons.clone": "Duplicar",
    "buttons.filter": "Filtrar",
    "buttons.clear": "Limpar",
    "buttons.refresh": "Atualizar",
    "buttons.logout": "Sair",
    "buttons.import": "Importar",
    "buttons.export": "Exportar",
    "buttons.undo": "Desfazer",
    "buttons.notAccessTitle": "Você não tem permissão para esta ação",

    // ---- Ações e tabela ----
    "actions.list": "Listar",
    "actions.create": "Criar",
    "actions.edit": "Editar",
    "actions.show": "Ver",
    "table.actions": "Ações",

    // ---- Notificações ----
    "notifications.success": "Tudo certo",
    "notifications.error": "Não foi possível concluir (status {{statusCode}})",
    "notifications.createSuccess": "Registro criado com sucesso",
    "notifications.createError": "Não foi possível criar o registro (status {{statusCode}})",
    "notifications.editSuccess": "Alterações salvas",
    "notifications.editError": "Não foi possível salvar as alterações (status {{statusCode}})",
    "notifications.deleteSuccess": "Registro excluído",
    "notifications.deleteError": "Não foi possível excluir o registro (status {{statusCode}})",
    "notifications.undoable": "Desfazer em {{seconds}} segundos",

    // ---- Erros de página ----
    "pages.error.404": "Página não encontrada",
    "pages.error.info": "A página que você procura não existe ou foi movida.",
    "pages.error.backHome": "Voltar ao início",

    // ---- Título do documento ----
    "documentTitle.default": "CRM Polatto",
    "documentTitle.suffix": " | CRM Polatto",

    // ---- Genéricos ----
    "loading": "Carregando...",
    "tags.clone": "Duplicar",
    "warnWhenUnsavedChanges": "Há alterações não salvas. Deseja sair mesmo assim?",
};

/**
 * Interpola {{variaveis}} no texto traduzido, como o Refine espera.
 */
const interpolar = (texto: string, params?: Record<string, unknown>): string => {
    if (!params) return texto;
    return texto.replace(/\{\{(\w+)\}\}/g, (original, chave) => {
        const valor = params[chave];
        return valor === undefined || valor === null ? original : String(valor);
    });
};

/**
 * i18nProvider do Refine. Cai no fallback (2º argumento que o Refine passa)
 * quando a chave não está no dicionário, então nenhuma tela quebra por falta
 * de tradução — no pior caso mostra o texto original em inglês.
 */
export const i18nProvider = {
    translate: (key: string, options?: unknown, defaultMessage?: string): string => {
        // O Refine chama translate(key, options, defaultMessage) ou
        // translate(key, defaultMessage) — o 2º argumento pode ser o fallback.
        const params =
            options && typeof options === "object" ? (options as Record<string, unknown>) : undefined;
        const fallback =
            typeof options === "string" ? options : defaultMessage;

        const traducao = traducoesPtBR[key];
        if (traducao) return interpolar(traducao, params);

        return fallback ?? key;
    },
    changeLocale: () => Promise.resolve(),
    getLocale: () => "pt-BR",
};
