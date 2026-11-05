/**
 * Junta orçamento + itens + cliente + identidade da empresa e gera o PDF.
 * A identidade e o logo são lidos na hora (sempre a versão atual da marca).
 */
import { formatCpfCnpj } from "../formatters";
import { buscarIdentidade, buscarOrcamentoCompleto, carregarLogoParaPdf } from "./api";
import { nomeArquivoProposta } from "./formato";
import { gerarPropostaPdf, type DadosPropostaPdf, type EmpresaPdf } from "./pdf";
import type { ClienteDoNegocio, EmpresaIdentidade, OrcamentoCompleto } from "./tipos";

export interface PropostaGerada {
    blob: Blob;
    nomeArquivo: string;
    orcamento: OrcamentoCompleto;
    identidade: EmpresaIdentidade | null;
    /** true quando havia logo cadastrado mas ele não pôde ser carregado. */
    semLogo: boolean;
}

export const empresaParaPdf = (identidade: Partial<EmpresaIdentidade> | null): EmpresaPdf => ({
    nomeFantasia: identidade?.nome_fantasia,
    razaoSocial: identidade?.razao_social,
    cnpj: identidade?.cnpj ? formatCpfCnpj(identidade.cnpj) : null,
    endereco: identidade?.endereco,
    telefone: identidade?.telefone,
    email: identidade?.email,
    site: identidade?.site,
    corPrimaria: identidade?.cor_primaria,
    corSecundaria: identidade?.cor_secundaria,
    rodape: identidade?.rodape,
});

export const montarDadosPdf = (
    orcamento: OrcamentoCompleto,
    cliente: ClienteDoNegocio | null,
    identidade: EmpresaIdentidade | null,
): Omit<DadosPropostaPdf, "logo"> => ({
    empresa: empresaParaPdf(identidade),
    cliente: {
        nome: cliente?.nome,
        documento: cliente?.cpf_cnpj ? formatCpfCnpj(cliente.cpf_cnpj) : null,
        telefone: cliente?.telefone,
        email: cliente?.email,
        endereco: cliente?.endereco,
    },
    orcamento: {
        numero: orcamento.numero,
        revisao: orcamento.revisao,
        titulo: orcamento.titulo,
        dataEmissao: orcamento.data_emissao,
        validoAte: orcamento.valido_ate,
        descontoTipo: orcamento.desconto_tipo,
        descontoValor: orcamento.desconto_valor,
        condicoesPagamento: orcamento.condicoes_pagamento,
        observacoes: orcamento.observacoes,
        vendedorNome: orcamento.responsavel_nome,
        vendedorEmail: orcamento.responsavel_email,
        vendedorTelefone: orcamento.responsavel_telefone,
        totaisDoBanco: { subtotal: orcamento.subtotal, desconto: orcamento.desconto_total, total: orcamento.total },
    },
    itens: orcamento.itens.map((item) => ({
        descricao: item.descricao,
        detalhes: item.detalhes,
        unidade: item.unidade,
        quantidade: item.quantidade,
        valorUnitario: item.valor_unitario,
        descontoTipo: item.desconto_tipo,
        descontoValor: item.desconto_valor,
    })),
});

export const gerarPropostaDoOrcamento = async (
    orcamentoId: string,
    tenantId: string,
    cliente: ClienteDoNegocio | null,
): Promise<PropostaGerada> => {
    const [orcamento, identidade] = await Promise.all([
        buscarOrcamentoCompleto(orcamentoId),
        buscarIdentidade(tenantId),
    ]);
    const logo = await carregarLogoParaPdf(identidade?.logo_path);
    const blob = await gerarPropostaPdf({ ...montarDadosPdf(orcamento, cliente, identidade), logo });
    return {
        blob,
        nomeArquivo: nomeArquivoProposta(orcamento.numero, cliente?.nome, orcamento.revisao),
        orcamento,
        identidade,
        semLogo: Boolean(identidade?.logo_path) && !logo,
    };
};
