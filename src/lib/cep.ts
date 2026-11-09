/**
 * Busca de endereço por CEP (ViaCEP), compartilhada entre "Novo lead" e
 * "Editar lead". A CSP de produção já libera viacep.com.br (connect-src).
 */

/** "01310100" → "01310-100" (aceita digitação parcial). */
export const formatarCep = (valor: string): string =>
    valor.replace(/\D/g, "").slice(0, 8).replace(/^(\d{5})(\d)/, "$1-$2");

export type ResultadoCep =
    | { status: "ok"; endereco: string }
    | { status: "nao_encontrado" }
    | { status: "falha" };

type RespostaViaCep = {
    erro?: boolean | string;
    logradouro?: string;
    bairro?: string;
    localidade?: string;
    uf?: string;
};

/** Monta "Rua X, Bairro, Cidade - UF" a partir da resposta do ViaCEP. */
export const enderecoDaRespostaViaCep = (dados: RespostaViaCep): string => {
    const endereco = [dados.logradouro, dados.bairro].filter(Boolean).join(", ");
    const cidade = [dados.localidade, dados.uf].filter(Boolean).join(" - ");
    return [endereco, cidade].filter(Boolean).join(", ");
};

/** Só consulta com 8 dígitos; qualquer outro caso não chama a rede. */
export const buscarEnderecoPorCep = async (cep: string): Promise<ResultadoCep> => {
    const digitos = cep.replace(/\D/g, "");
    if (digitos.length !== 8) return { status: "nao_encontrado" };
    try {
        const resposta = await fetch(`https://viacep.com.br/ws/${digitos}/json/`);
        if (!resposta.ok) return { status: "falha" };
        const dados = (await resposta.json()) as RespostaViaCep;
        if (dados.erro) return { status: "nao_encontrado" };
        const endereco = enderecoDaRespostaViaCep(dados);
        return endereco ? { status: "ok", endereco } : { status: "nao_encontrado" };
    } catch {
        return { status: "falha" };
    }
};
