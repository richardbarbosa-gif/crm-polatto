import { MailOutlined, WhatsAppOutlined } from "@ant-design/icons";
import { useList } from "@refinedev/core";
import { Alert, Input, Modal, Select, Space, Typography } from "antd";
import { useMemo, useState } from "react";
import {
    aplicarModelo,
    linkEmailModelo,
    linkWhatsAppModelo,
    variaveisSemValor,
    VARIAVEIS_MODELO,
    type CanalModelo,
    type DadosModelo,
    type ModeloMensagem,
} from "../lib/modelosMensagem";

const { Text } = Typography;

const EM_BRANCO = "__em_branco__";

export type DestinoMensagem = {
    telefone?: string | null;
    ddi?: string | null;
    email?: string | null;
};

type Props = {
    aberto: boolean;
    onFechar: () => void;
    canal: CanalModelo;
    destino: DestinoMensagem;
    /** Variáveis já resolvidas (montarDadosModelo). */
    dados: DadosModelo;
    /** Nome do cliente, só para o título. */
    nomeCliente?: string | null;
};

/**
 * O vendedor escolhe um modelo (Configurações > Modelos de mensagem),
 * revisa o texto com as variáveis já preenchidas e abre o WhatsApp ou o
 * e-mail. Sem modelos cadastrados (ou com a migration 15 pendente),
 * funciona com mensagem em branco.
 *
 * Para usar em outra tela (ex.: ações do orçamento), basta montar `dados`
 * com montarDadosModelo({ ..., propostaNumero, validade, valor }).
 */
export const EscolherModelo = (props: Props) => {
    // Remonta a cada abertura: o texto editado de um lead não vaza para o outro
    if (!props.aberto) return null;
    return <EscolherModeloAberto {...props} />;
};

const EscolherModeloAberto = ({ aberto, onFechar, canal, destino, dados, nomeCliente }: Props) => {
    const { query, result } = useList<ModeloMensagem>({
        resource: "modelos_mensagem",
        pagination: { mode: "off" },
        filters: [
            { field: "canal", operator: "eq", value: canal },
            { field: "ativo", operator: "eq", value: true },
        ],
        sorters: [
            { field: "ordem", order: "asc" },
            { field: "nome", order: "asc" },
        ],
        meta: { select: "id,nome,canal,assunto,texto,ativo,ordem" },
        queryOptions: { retry: false },
    });

    // Filtro repetido no cliente: um modelo de outro canal nunca aparece aqui
    const modelos = useMemo(
        () => (result.data ?? []).filter((m) => m.canal === canal && m.ativo !== false),
        [result.data, canal],
    );
    const [escolhido, setEscolhido] = useState<string | null>(null);
    const [textoEditado, setTextoEditado] = useState<string | null>(null);
    const [assuntoEditado, setAssuntoEditado] = useState<string | null>(null);

    // Primeiro modelo ativo pré-selecionado assim que a lista chega
    const idSelecionado = escolhido ?? (modelos[0]?.id ?? EM_BRANCO);
    const modelo = modelos.find((m) => m.id === idSelecionado);

    const textoModelo = modelo ? aplicarModelo(modelo.texto, dados) : "";
    const assuntoModelo = modelo?.assunto ? aplicarModelo(modelo.assunto, dados) : "";
    const texto = textoEditado ?? textoModelo;
    const assunto = assuntoEditado ?? assuntoModelo;
    const faltando = modelo ? variaveisSemValor(`${modelo.assunto ?? ""} ${modelo.texto}`, dados) : [];

    const link =
        canal === "whatsapp"
            ? linkWhatsAppModelo(destino.telefone, texto, destino.ddi)
            : linkEmailModelo(destino.email, assunto, texto);

    const trocarModelo = (id: string) => {
        setEscolhido(id);
        setTextoEditado(null);
        setAssuntoEditado(null);
    };

    const ehWhats = canal === "whatsapp";
    const rotuloVariavel = (chave: string) => VARIAVEIS_MODELO.find((v) => v.chave === chave)?.descricao ?? chave;

    return (
        <Modal
            open={aberto}
            onCancel={onFechar}
            title={
                <Space>
                    {ehWhats ? <WhatsAppOutlined style={{ color: "#16a34a" }} /> : <MailOutlined />}
                    {ehWhats ? "Mensagem no WhatsApp" : "E-mail"}
                    {nomeCliente ? <Text type="secondary">· {nomeCliente}</Text> : null}
                </Space>
            }
            okText={ehWhats ? "Abrir WhatsApp" : "Abrir e-mail"}
            cancelText="Cancelar"
            okButtonProps={{
                disabled: !link,
                href: link ?? undefined,
                target: ehWhats ? "_blank" : undefined,
                rel: "noopener noreferrer",
                icon: ehWhats ? <WhatsAppOutlined /> : <MailOutlined />,
            }}
            onOk={onFechar}
            destroyOnHidden
        >
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
                {!link ? (
                    <Alert
                        type="warning"
                        showIcon
                        message={
                            ehWhats
                                ? "Este lead não tem um celular válido para o WhatsApp."
                                : "Este lead não tem um e-mail válido."
                        }
                    />
                ) : null}
                <div>
                    <Text strong style={{ display: "block", marginBottom: 4 }}>
                        Modelo
                    </Text>
                    <Select
                        value={idSelecionado}
                        onChange={trocarModelo}
                        loading={query.isLoading}
                        style={{ width: "100%" }}
                        aria-label="Modelo de mensagem"
                        options={[
                            ...modelos.map((m) => ({ value: m.id, label: m.nome })),
                            { value: EM_BRANCO, label: "Mensagem em branco" },
                        ]}
                    />
                </div>
                {!ehWhats ? (
                    <div>
                        <Text strong style={{ display: "block", marginBottom: 4 }}>
                            Assunto
                        </Text>
                        <Input
                            value={assunto}
                            maxLength={200}
                            onChange={(e) => setAssuntoEditado(e.target.value)}
                            aria-label="Assunto do e-mail"
                        />
                    </div>
                ) : null}
                <div>
                    <Text strong style={{ display: "block", marginBottom: 4 }}>
                        Mensagem
                    </Text>
                    <Input.TextArea
                        value={texto}
                        onChange={(e) => setTextoEditado(e.target.value)}
                        autoSize={{ minRows: 5, maxRows: 12 }}
                        maxLength={4000}
                        aria-label="Texto da mensagem"
                    />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                        Revise antes de enviar: você pode ajustar o texto à vontade.
                    </Text>
                </div>
                {faltando.length > 0 ? (
                    <Alert
                        type="info"
                        showIcon
                        message="Algumas informações não estão no cadastro e ficaram de fora:"
                        description={faltando.map(rotuloVariavel).join(", ")}
                    />
                ) : null}
            </Space>
        </Modal>
    );
};
