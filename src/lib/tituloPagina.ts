/**
 * Título da aba do navegador. O título automático do Refine misturava inglês
 * e o id do registro ("#3f25… Show Oportunidades | CRM Polatto"): aqui cada
 * rota tem um nome em português e sempre termina com o nome do produto.
 */

export const NOME_PRODUTO = "CRM Polatto";

const TITULOS_EXATOS: Record<string, string> = {
    "/": "Dashboard",
    "/meu-dia": "Meu dia",
    "/perfil": "Meu perfil",
    "/clientes": "Oportunidades",
    "/clientes/create": "Novo lead",
    "/orcamentos": "Orçamentos",
    "/agenda": "Agenda",
    "/base-clientes": "Base de clientes",
    "/organizacoes": "Organizações",
    "/pessoas": "Contatos",
    "/historico": "Histórico",
    "/equipe": "Equipe",
    "/metas": "Metas",
    "/lixeira": "Lixeira",
    "/configuracoes": "Configurações",
    "/insights": "Relatórios",
    "/insights/painel": "Relatórios · Painel",
    "/insights/roi": "Relatórios · ROI",
    "/insights/gains-losses": "Relatórios · Ganhos e perdas",
    "/insights/origens": "Relatórios · Vendas por origem",
    "/insights/activities": "Relatórios · Atividades",
    "/insights/logs": "Relatórios · Registro de alterações",
    "/login": "Entrar",
    "/register": "Criar conta",
    "/forgot-password": "Recuperar senha",
    "/update-password": "Definir nova senha",
};

const TITULOS_POR_PREFIXO: Array<[string, string]> = [
    ["/clientes/edit/", "Editar lead"],
    ["/clientes/show/", "Detalhes do lead"],
];

export const tituloDaPagina = (pathname?: string | null): string => {
    const caminho = (pathname || "/").replace(/\/+$/, "") || "/";
    const titulo =
        TITULOS_EXATOS[caminho] ??
        TITULOS_POR_PREFIXO.find(([prefixo]) => caminho.startsWith(prefixo))?.[1] ??
        "Página não encontrada";
    return `${titulo} | ${NOME_PRODUTO}`;
};
