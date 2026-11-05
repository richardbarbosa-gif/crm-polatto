import {
    BranchesOutlined,
    CheckCircleOutlined,
    CloudUploadOutlined,
    CopyOutlined,
    DeleteOutlined,
    DownloadOutlined,
    EditOutlined,
    EyeOutlined,
    FilePdfOutlined,
    MailOutlined,
    MoreOutlined,
    SendOutlined,
    WhatsAppOutlined,
} from "@ant-design/icons";
import { useInvalidate } from "@refinedev/core";
import { App, Dropdown, Modal, Space, Typography, type MenuProps } from "antd";
import { useState } from "react";
import { Button } from "../../components/ui";
import { useTenant } from "../../contexts/tenant";
import { formatCurrencyBRL } from "../../lib/formatters";
import {
    alterarStatus,
    atualizarValorNegocio,
    baixarArquivo,
    buscarOrcamentoCompleto,
    criarNovaVersao,
    duplicarOrcamento,
    excluirOrcamento,
    salvarPdfNoLead,
} from "../../lib/orcamentos/api";
import {
    ROTULO_STATUS,
    assuntoProposta,
    hojeEmBrasilia,
    linkEmail,
    linkWhatsApp,
    mensagemProposta,
    type StatusOrcamento,
} from "../../lib/orcamentos/formato";
import { gerarPropostaDoOrcamento, type PropostaGerada } from "../../lib/orcamentos/proposta";
import {
    efeitoDaNovaVersao,
    orcamentoEditavel,
    podeCriarNovaVersao,
    transicoesDisponiveis,
} from "../../lib/orcamentos/regras";
import type { ClienteDoNegocio, Orcamento } from "../../lib/orcamentos/tipos";

const { Paragraph, Text } = Typography;

type Ocupado = null | "pdf" | "lead" | "status" | "duplicar" | "versao" | "excluir";
type Canal = "whatsapp" | "email";

type Props = {
    orcamento: Orcamento;
    cliente: ClienteDoNegocio | null;
    podeExcluir: boolean;
    /** Abre o editor: edição no rascunho, somente leitura nos demais status. */
    onAbrir: () => void;
    /** Chamado com o id da revisão criada por "Nova versão" (abre o editor nela). */
    onNovaVersao: (id: string) => void;
    onAlterado: () => void;
    onArquivoSalvo?: () => void;
};

export const AcoesOrcamento = ({
    orcamento,
    cliente,
    podeExcluir,
    onAbrir,
    onNovaVersao,
    onAlterado,
    onArquivoSalvo,
}: Props) => {
    const { message, modal } = App.useApp();
    const { tenantId, identityEmail } = useTenant();
    const invalidate = useInvalidate();
    const [ocupado, setOcupado] = useState<Ocupado>(null);
    const [compartilhar, setCompartilhar] = useState<Canal | null>(null);

    const erro = (e: unknown, padrao: string) => message.error(e instanceof Error ? e.message : padrao);

    const gerar = async (): Promise<PropostaGerada | null> => {
        if (!tenantId) {
            message.error("Empresa ativa não identificada. Recarregue a página.");
            return null;
        }
        const proposta = await gerarPropostaDoOrcamento(orcamento.id, tenantId, cliente);
        if (proposta.semLogo) {
            message.warning("Não foi possível carregar o logo da empresa: o PDF saiu sem ele.");
        }
        return proposta;
    };

    const baixar = async () => {
        if (ocupado) return;
        setOcupado("pdf");
        try {
            const proposta = await gerar();
            if (proposta) baixarArquivo(proposta.blob, proposta.nomeArquivo);
        } catch (e) {
            erro(e, "Não foi possível gerar o PDF.");
        } finally {
            setOcupado(null);
        }
    };

    const salvarNoLead = async () => {
        if (ocupado || !tenantId) return;
        setOcupado("lead");
        try {
            const proposta = await gerar();
            if (!proposta) return;
            await salvarPdfNoLead({
                negocioId: orcamento.negocio_id,
                tenantId,
                blob: proposta.blob,
                nomeArquivo: proposta.nomeArquivo,
                numero: proposta.orcamento.numero,
                total: formatCurrencyBRL(proposta.orcamento.total),
                autor: identityEmail ?? undefined,
            });
            message.success("PDF salvo nos documentos do lead.");
            onArquivoSalvo?.();
        } catch (e) {
            erro(e, "Não foi possível salvar o PDF no lead.");
        } finally {
            setOcupado(null);
        }
    };

    const oferecerValorDoNegocio = (total: number) => {
        if (cliente?.valor !== null && cliente?.valor !== undefined && Math.abs(cliente.valor - total) < 0.005) return;
        modal.confirm({
            title: "Atualizar o valor do negócio?",
            content: (
                <span>
                    O orçamento aceito soma <strong>{formatCurrencyBRL(total)}</strong>.{" "}
                    {cliente?.valor !== null && cliente?.valor !== undefined
                        ? `Hoje o negócio está com ${formatCurrencyBRL(cliente.valor)}.`
                        : "O negócio ainda não tem valor."}
                </span>
            ),
            okText: "Atualizar valor",
            cancelText: "Manter como está",
            onOk: async () => {
                try {
                    await atualizarValorNegocio(orcamento.negocio_id, total);
                    await invalidate({ resource: "clientes", invalidates: ["list", "detail"] });
                    message.success("Valor do negócio atualizado.");
                    onAlterado();
                } catch (e) {
                    erro(e, "Não foi possível atualizar o valor do negócio.");
                }
            },
        });
    };

    const mudarStatus = async (status: StatusOrcamento) => {
        if (ocupado || status === orcamento.status) return;
        setOcupado("status");
        try {
            const atualizado = await alterarStatus(orcamento.id, status);
            message.success(`Orçamento ${atualizado.numero}: ${ROTULO_STATUS[status].toLowerCase()}.`);
            onAlterado();
            if (status === "aceito") oferecerValorDoNegocio(atualizado.total);
        } catch (e) {
            erro(e, "Não foi possível mudar o status.");
        } finally {
            setOcupado(null);
        }
    };

    const duplicar = async () => {
        if (ocupado) return;
        setOcupado("duplicar");
        try {
            const origem = await buscarOrcamentoCompleto(orcamento.id);
            await duplicarOrcamento(origem, hojeEmBrasilia());
            message.success("Cópia criada como rascunho, com número novo.");
            onAlterado();
        } catch (e) {
            erro(e, "Não foi possível duplicar o orçamento.");
        } finally {
            setOcupado(null);
        }
    };

    const novaVersao = () => {
        if (ocupado) return;
        modal.confirm({
            title: `Criar nova versão da proposta ${orcamento.numero}?`,
            content: (
                <span>
                    A revisão {orcamento.revisao + 1} nasce como <strong>rascunho</strong>, com número novo e o mesmo
                    conteúdo, para você ajustar. {efeitoDaNovaVersao(orcamento.status)}
                </span>
            ),
            okText: "Criar nova versão",
            cancelText: "Cancelar",
            onOk: async () => {
                setOcupado("versao");
                try {
                    const id = await criarNovaVersao(orcamento.id);
                    message.success("Nova versão pronta para editar.");
                    onAlterado();
                    onNovaVersao(id);
                } catch (e) {
                    erro(e, "Não foi possível criar a nova versão.");
                } finally {
                    setOcupado(null);
                }
            },
        });
    };

    const excluir = () => {
        modal.confirm({
            title: `Excluir o orçamento ${orcamento.numero}?`,
            content: "Ele sai das listas, mas o registro continua guardado (exclusão lógica) e pode ser restaurado por um administrador.",
            okText: "Excluir",
            okButtonProps: { danger: true },
            cancelText: "Cancelar",
            onOk: async () => {
                setOcupado("excluir");
                try {
                    await excluirOrcamento(orcamento.id);
                    message.success("Orçamento excluído.");
                    onAlterado();
                } catch (e) {
                    erro(e, "Não foi possível excluir o orçamento.");
                } finally {
                    setOcupado(null);
                }
            },
        });
    };

    const mensagem = mensagemProposta({
        cliente: cliente?.nome,
        numero: orcamento.numero,
        total: orcamento.total,
        validoAte: orcamento.valido_ate,
        vendedor: orcamento.responsavel_nome,
    });
    const linkZap = linkWhatsApp(cliente?.telefone, mensagem, cliente?.ddi);
    const linkMail = linkEmail(cliente?.email, assuntoProposta(orcamento.numero), mensagem);

    // Menu espelha o banco (migration 14): só rascunho se edita; o status só
    // oferece as transições que o banco aceita.
    const editavel = orcamentoEditavel(orcamento.status);
    const transicoes = transicoesDisponiveis(orcamento.status);

    const itensMenu: MenuProps["items"] = [
        editavel
            ? { key: "editar", icon: <EditOutlined />, label: "Editar", onClick: onAbrir }
            : { key: "ver", icon: <EyeOutlined />, label: "Ver", onClick: onAbrir },
        ...(podeCriarNovaVersao(orcamento.status)
            ? [{ key: "nova-versao", icon: <BranchesOutlined />, label: "Nova versão", onClick: novaVersao }]
            : []),
        { key: "baixar", icon: <DownloadOutlined />, label: "Baixar PDF", onClick: baixar },
        { key: "lead", icon: <CloudUploadOutlined />, label: "Salvar PDF no lead", onClick: salvarNoLead },
        { type: "divider" },
        // Proposta substituída não vai mais para o cliente: o que vale é a revisão.
        ...(orcamento.status === "substituido"
            ? []
            : [
                  {
                      key: "whatsapp",
                      icon: <WhatsAppOutlined />,
                      label: linkZap ? "Enviar pelo WhatsApp" : "WhatsApp (lead sem celular válido)",
                      disabled: !linkZap,
                      onClick: () => setCompartilhar("whatsapp"),
                  },
                  {
                      key: "email",
                      icon: <MailOutlined />,
                      label: linkMail ? "Enviar por e-mail" : "E-mail (lead sem e-mail válido)",
                      disabled: !linkMail,
                      onClick: () => setCompartilhar("email"),
                  },
              ]),
        ...(orcamento.status === "rascunho"
            ? [{ key: "enviado", icon: <SendOutlined />, label: "Marcar como enviado", onClick: () => mudarStatus("enviado") }]
            : transicoes.length
              ? [
                    {
                        key: "status",
                        icon: <CheckCircleOutlined />,
                        label: "Mudar status",
                        children: transicoes.map((s) => ({
                            key: `status-${s}`,
                            label: ROTULO_STATUS[s],
                            onClick: () => mudarStatus(s),
                        })),
                    },
                ]
              : []),
        { type: "divider" },
        { key: "duplicar", icon: <CopyOutlined />, label: "Duplicar", onClick: duplicar },
        ...(podeExcluir
            ? [{ key: "excluir", icon: <DeleteOutlined />, label: "Excluir", danger: true, onClick: excluir }]
            : []),
    ];

    const destino = compartilhar === "whatsapp" ? linkZap : linkMail;

    return (
        <>
            <Space size={6}>
                <Button
                    icon={<FilePdfOutlined />}
                    onClick={baixar}
                    loading={ocupado === "pdf"}
                    aria-label={`Baixar PDF do orçamento ${orcamento.numero}`}
                >
                    PDF
                </Button>

                <Dropdown menu={{ items: itensMenu }} trigger={["click"]} disabled={Boolean(ocupado)}>
                    <Button
                        icon={<MoreOutlined />}
                        loading={Boolean(ocupado) && ocupado !== "pdf"}
                        aria-label={`Mais ações do orçamento ${orcamento.numero}`}
                    />
                </Dropdown>
            </Space>

            <Modal
                open={compartilhar !== null}
                title={compartilhar === "whatsapp" ? "Enviar pelo WhatsApp" : "Enviar por e-mail"}
                onCancel={() => setCompartilhar(null)}
                footer={null}
                destroyOnHidden
            >
                <Paragraph>
                    {compartilhar === "whatsapp" ? "O WhatsApp" : "O e-mail"} abre com a mensagem pronta, mas{" "}
                    <strong>não anexa o PDF sozinho</strong>. Baixe o PDF primeiro e anexe na conversa.
                </Paragraph>
                <Space direction="vertical" style={{ width: "100%" }}>
                    <Button icon={<DownloadOutlined />} onClick={baixar} loading={ocupado === "pdf"} fullWidth>
                        1. Baixar o PDF
                    </Button>
                    <Button
                        type="primary"
                        icon={compartilhar === "whatsapp" ? <WhatsAppOutlined /> : <MailOutlined />}
                        href={destino ?? undefined}
                        target={compartilhar === "whatsapp" ? "_blank" : undefined}
                        rel="noopener noreferrer"
                        disabled={!destino}
                        fullWidth
                    >
                        2. Abrir {compartilhar === "whatsapp" ? "a conversa" : "o e-mail"} e anexar o PDF
                    </Button>
                    {orcamento.status === "rascunho" ? (
                        <Button
                            icon={<SendOutlined />}
                            onClick={async () => {
                                await mudarStatus("enviado");
                                setCompartilhar(null);
                            }}
                            loading={ocupado === "status"}
                            fullWidth
                        >
                            3. Marcar a proposta como enviada
                        </Button>
                    ) : null}
                </Space>
                <Text type="secondary" style={{ display: "block", marginTop: 12, fontSize: 12 }}>
                    Mensagem: “{mensagem}”
                </Text>
            </Modal>
        </>
    );
};
