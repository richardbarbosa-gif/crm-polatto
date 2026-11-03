import { DeleteOutlined, FilePdfOutlined, UploadOutlined } from "@ant-design/icons";
import { Alert, App, ColorPicker, Divider, Form, Input, InputNumber, Skeleton, Space, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui";
import { useTenant } from "../../contexts/tenant";
import { useCrmAccess } from "../../hooks/useCrmAccess";
import { regraCpfCnpj, somenteDigitos } from "../../lib/documentos";
import { formatCpfCnpj } from "../../lib/formatters";
import {
    LOGO_MAX_BYTES,
    baixarArquivo,
    buscarIdentidade,
    carregarLogoParaPdf,
    enviarLogo,
    removerLogo,
    salvarIdentidade,
    urlAssinadaLogo,
    type ValoresIdentidade,
} from "../../lib/orcamentos/api";
import { clarear, corDeTextoSobre, corLegivelEmBranco, ehCorHex, hexParaRgb, hojeEmBrasilia, somarDias } from "../../lib/orcamentos/formato";
import { gerarPropostaPdf } from "../../lib/orcamentos/pdf";
import { empresaParaPdf } from "../../lib/orcamentos/proposta";
import type { EmpresaIdentidade } from "../../lib/orcamentos/tipos";
import { isSupabaseMissingRelation } from "../../lib/supabaseErrors";
import "../orcamentos/orcamentos.css";

const { Text, Title } = Typography;

type ValoresForm = Omit<ValoresIdentidade, "validade_dias"> & { validade_dias: number | null };

const SITE_RE = /^(https?:\/\/)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{2,5})?(\/\S*)?$/i;

const PADRAO: ValoresForm = {
    nome_fantasia: "",
    razao_social: "",
    cnpj: "",
    endereco: "",
    telefone: "",
    email: "",
    site: "",
    cor_primaria: "#0F4C81",
    cor_secundaria: "#F2A900",
    condicoes_pagamento: "",
    validade_dias: 15,
    observacoes_padrao: "",
    rodape: "",
};

type Carga =
    | { estado: "carregando" }
    | { estado: "ausente" }
    | { estado: "erro"; mensagem: string }
    | { estado: "pronto"; identidade: EmpresaIdentidade | null };

const rgbCss = (rgb: [number, number, number]) => `rgb(${rgb.join(",")})`;

const paraForm = (identidade: EmpresaIdentidade | null): ValoresForm =>
    identidade
        ? {
              nome_fantasia: identidade.nome_fantasia ?? "",
              razao_social: identidade.razao_social ?? "",
              cnpj: identidade.cnpj ? formatCpfCnpj(identidade.cnpj) : "",
              endereco: identidade.endereco ?? "",
              telefone: identidade.telefone ?? "",
              email: identidade.email ?? "",
              site: identidade.site ?? "",
              cor_primaria: identidade.cor_primaria,
              cor_secundaria: identidade.cor_secundaria,
              condicoes_pagamento: identidade.condicoes_pagamento ?? "",
              validade_dias: identidade.validade_dias,
              observacoes_padrao: identidade.observacoes_padrao ?? "",
              rodape: identidade.rodape ?? "",
          }
        : PADRAO;

const vazioParaNulo = (valor?: string | null) => (valor && valor.trim() ? valor.trim() : null);

/** Prévia em miniatura da folha da proposta, com as cores e o logo atuais. */
const PreviaProposta = ({ valores, logoUrl }: { valores: Partial<ValoresForm>; logoUrl: string | null }) => {
    const primaria = hexParaRgb(valores.cor_primaria ?? "");
    const secundaria = hexParaRgb(valores.cor_secundaria ?? "", [242, 169, 0]);
    const titulo = corLegivelEmBranco(primaria);
    return (
        <div className="orc-previa-folha" aria-label="Prévia do cabeçalho da proposta">
            <div className="orc-previa-faixa">
                <span style={{ flex: 3, background: rgbCss(primaria) }} />
                <span style={{ flex: 1, background: rgbCss(secundaria) }} />
            </div>
            <div className="orc-previa-corpo">
                <div className="orc-previa-cabecalho">
                    {logoUrl ? (
                        <img src={logoUrl} alt="Logo da empresa" />
                    ) : (
                        <strong style={{ color: rgbCss(titulo), fontSize: 13 }}>{valores.nome_fantasia || "Sua empresa"}</strong>
                    )}
                    <div style={{ textAlign: "right", color: "#6b7280" }}>
                        {logoUrl ? <strong style={{ display: "block", color: "#1f2937" }}>{valores.nome_fantasia || "Sua empresa"}</strong> : null}
                        <span style={{ display: "block" }}>{valores.telefone || "(00) 0000-0000"}</span>
                        <span>{valores.site || valores.email || "contato@empresa.com.br"}</span>
                    </div>
                </div>
                <div>
                    <div className="orc-previa-rotulo" style={{ color: rgbCss(titulo) }}>
                        Proposta comercial
                    </div>
                    <strong style={{ fontSize: 15 }}>Nº 2026-0001</strong>
                </div>
                <div style={{ background: rgbCss(clarear(primaria, 0.92)), borderLeft: `3px solid ${rgbCss(primaria)}`, borderRadius: 4, padding: "6px 8px" }}>
                    <div className="orc-previa-rotulo" style={{ color: "#6b7280" }}>
                        Preparado para
                    </div>
                    <strong>Nome do cliente</strong>
                </div>
                <div style={{ background: rgbCss(primaria), color: rgbCss(corDeTextoSobre(primaria)), borderRadius: 3, padding: "4px 6px", fontWeight: 700 }}>
                    Descrição · Qtd. · Total
                </div>
                <div className="orc-previa-linhas">
                    <span style={{ width: "92%" }} />
                    <span style={{ width: "78%" }} />
                    <span style={{ width: "85%" }} />
                </div>
                <div className="orc-previa-total" style={{ background: rgbCss(primaria), color: rgbCss(corDeTextoSobre(primaria)), borderLeft: `3px solid ${rgbCss(secundaria)}` }}>
                    <span>TOTAL</span>
                    <span>R$ 28.544,61</span>
                </div>
                <div style={{ marginTop: "auto", borderTop: "1px solid #e5e7eb", paddingTop: 6, color: "#6b7280" }}>
                    {valores.rodape || "Rodapé da proposta"}
                </div>
            </div>
            <div style={{ height: 4, background: rgbCss(primaria) }} />
        </div>
    );
};

export const IdentidadePropostaConfig = () => {
    const { message } = App.useApp();
    const { tenantId } = useTenant();
    const { isGerente: ehAdmin, isLoadingAccess: carregandoPapel } = useCrmAccess();
    const [form] = Form.useForm<ValoresForm>();
    const [carga, setCarga] = useState<Carga>({ estado: "carregando" });
    const [logoUrl, setLogoUrl] = useState<string | null>(null);
    const [ocupado, setOcupado] = useState<null | "salvar" | "logo" | "exemplo">(null);
    const entradaLogo = useRef<HTMLInputElement | null>(null);

    const identidade = carga.estado === "pronto" ? carga.identidade : null;
    const logoPath = identidade?.logo_path ?? null;

    useEffect(() => {
        if (!tenantId) return;
        let ativo = true;
        buscarIdentidade(tenantId)
            .then((dados) => {
                if (!ativo) return;
                form.setFieldsValue(paraForm(dados));
                setCarga({ estado: "pronto", identidade: dados });
            })
            .catch((erro: unknown) => {
                if (!ativo) return;
                setCarga(
                    isSupabaseMissingRelation(erro) || (erro as { code?: string })?.code === "PGRST205"
                        ? { estado: "ausente" }
                        : { estado: "erro", mensagem: erro instanceof Error ? erro.message : "Falha ao carregar." },
                );
            });
        return () => {
            ativo = false;
        };
    }, [form, tenantId]);

    // URL assinada curta só para a prévia do logo nesta tela.
    useEffect(() => {
        if (!logoPath) return;
        let ativo = true;
        urlAssinadaLogo(logoPath, 600).then((url) => {
            if (ativo) setLogoUrl(url);
        });
        return () => {
            ativo = false;
        };
    }, [logoPath]);

    const valores = Form.useWatch([], form) as Partial<ValoresForm> | undefined;
    const podeEditar = ehAdmin && carga.estado === "pronto";

    const montarValores = (v: ValoresForm): Partial<ValoresIdentidade> => ({
        nome_fantasia: vazioParaNulo(v.nome_fantasia),
        razao_social: vazioParaNulo(v.razao_social),
        cnpj: somenteDigitos(v.cnpj) || null,
        endereco: vazioParaNulo(v.endereco),
        telefone: vazioParaNulo(v.telefone),
        email: vazioParaNulo(v.email),
        site: vazioParaNulo(v.site),
        cor_primaria: (v.cor_primaria ?? PADRAO.cor_primaria).toUpperCase(),
        cor_secundaria: (v.cor_secundaria ?? PADRAO.cor_secundaria).toUpperCase(),
        condicoes_pagamento: vazioParaNulo(v.condicoes_pagamento),
        validade_dias: v.validade_dias ?? 15,
        observacoes_padrao: vazioParaNulo(v.observacoes_padrao),
        rodape: vazioParaNulo(v.rodape),
    });

    const salvar = async () => {
        if (!tenantId || ocupado || carga.estado !== "pronto") return;
        let v: ValoresForm;
        try {
            v = await form.validateFields();
        } catch {
            return;
        }
        setOcupado("salvar");
        try {
            const salvo = await salvarIdentidade(tenantId, carga.identidade, montarValores(v));
            setCarga({ estado: "pronto", identidade: salvo });
            form.setFieldsValue(paraForm(salvo));
            message.success("Identidade da empresa salva. As próximas propostas já saem com ela.");
        } catch (erro: unknown) {
            message.error(erro instanceof Error ? erro.message : "Não foi possível salvar.");
        } finally {
            setOcupado(null);
        }
    };

    const trocarLogo = async (arquivo?: File | null) => {
        if (!arquivo || !tenantId || carga.estado !== "pronto") return;
        setOcupado("logo");
        try {
            const salvo = await enviarLogo(tenantId, carga.identidade, arquivo);
            setCarga({ estado: "pronto", identidade: salvo });
            message.success("Logo atualizado.");
        } catch (erro: unknown) {
            message.error(erro instanceof Error ? erro.message : "Não foi possível enviar o logo.");
        } finally {
            setOcupado(null);
            if (entradaLogo.current) entradaLogo.current.value = "";
        }
    };

    const tirarLogo = async () => {
        if (!tenantId || !identidade) return;
        setOcupado("logo");
        try {
            const salvo = await removerLogo(tenantId, identidade);
            setCarga({ estado: "pronto", identidade: salvo });
            setLogoUrl(null);
            message.success("Logo removido.");
        } catch (erro: unknown) {
            message.error(erro instanceof Error ? erro.message : "Não foi possível remover o logo.");
        } finally {
            setOcupado(null);
        }
    };

    const baixarExemplo = async () => {
        if (ocupado) return;
        setOcupado("exemplo");
        try {
            const v = form.getFieldsValue(true) as ValoresForm;
            const hoje = hojeEmBrasilia();
            const logo = await carregarLogoParaPdf(logoPath);
            if (logoPath && !logo) message.warning("Não foi possível carregar o logo: o exemplo saiu sem ele.");
            const blob = await gerarPropostaPdf({
                empresa: empresaParaPdf({ ...montarValores(v) }),
                cliente: {
                    nome: "Maria da Conceição Araújo",
                    documento: "123.456.789-09",
                    telefone: "(11) 98888-7777",
                    email: "maria@exemplo.com.br",
                    endereco: "Rua das Acácias, 245 — Jardim Botânico, São Paulo/SP — CEP 01000-000",
                },
                orcamento: {
                    numero: "EXEMPLO",
                    titulo: "Proposta de exemplo",
                    dataEmissao: hoje,
                    validoAte: somarDias(hoje, v.validade_dias ?? 15),
                    descontoTipo: "percentual",
                    descontoValor: 5,
                    condicoesPagamento: v.condicoes_pagamento || "Condições de pagamento da empresa.",
                    observacoes: v.observacoes_padrao || "Observações padrão da proposta.",
                    vendedorNome: "Nome do consultor",
                    vendedorTelefone: "(11) 97777-6666",
                    vendedorEmail: "consultor@empresa.com.br",
                },
                itens: [
                    { descricao: "Produto principal", detalhes: "Detalhes técnicos, garantia e prazo", unidade: "un", quantidade: 10, valorUnitario: 1234.56, descontoTipo: "percentual", descontoValor: 10 },
                    { descricao: "Serviço de instalação", unidade: "serviço", quantidade: 1, valorUnitario: 3500 },
                ],
                logo,
            });
            baixarArquivo(blob, "Proposta-exemplo.pdf");
        } catch (erro: unknown) {
            message.error(erro instanceof Error ? erro.message : "Não foi possível gerar o exemplo.");
        } finally {
            setOcupado(null);
        }
    };

    if (carga.estado === "carregando" || carregandoPapel) return <Skeleton active paragraph={{ rows: 8 }} />;
    if (carga.estado === "ausente") {
        return (
            <Alert
                type="warning"
                showIcon
                message="Estrutura do banco pendente"
                description="Execute a migration 2026-11-03_13_orcamentos.sql no Supabase para configurar a identidade da proposta."
            />
        );
    }
    if (carga.estado === "erro") return <Alert type="error" showIcon message={carga.mensagem} />;

    const corValida = (_: unknown, valor?: string) =>
        ehCorHex(valor) ? Promise.resolve() : Promise.reject(new Error("Use o formato #RRGGBB."));

    return (
        <div className="orc-identidade">
            <div className="orc-identidade-grade">
                <div>
                    {!ehAdmin ? (
                        <Alert
                            type="info"
                            showIcon
                            style={{ marginBottom: 16 }}
                            message="Somente gerente ou administrador altera a identidade da empresa."
                            description="Você pode conferir os dados e baixar um PDF de exemplo."
                        />
                    ) : null}

                    <Title level={5} style={{ marginTop: 0 }}>
                        Logo
                    </Title>
                    <div className="orc-logo-caixa">
                        <div className="orc-logo-quadro">
                            {logoUrl && logoPath ? <img src={logoUrl} alt="Logo atual da empresa" /> : <Text type="secondary">Sem logo</Text>}
                        </div>
                        <Space direction="vertical" size={6}>
                            <input
                                ref={entradaLogo}
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                style={{ display: "none" }}
                                onChange={(e) => void trocarLogo(e.target.files?.[0])}
                            />
                            <Space wrap>
                                <Button icon={<UploadOutlined />} disabled={!podeEditar} loading={ocupado === "logo"} onClick={() => entradaLogo.current?.click()}>
                                    {logoPath ? "Trocar logo" : "Enviar logo"}
                                </Button>
                                {logoPath ? (
                                    <Button icon={<DeleteOutlined />} danger disabled={!podeEditar || ocupado === "logo"} onClick={tirarLogo}>
                                        Remover
                                    </Button>
                                ) : null}
                            </Space>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                                PNG, JPEG ou WEBP até {LOGO_MAX_BYTES / 1024 / 1024} MB. Fundo transparente fica melhor. SVG não é aceito.
                            </Text>
                        </Space>
                    </div>

                    <Form<ValoresForm> form={form} layout="vertical" disabled={!podeEditar} initialValues={PADRAO} style={{ marginTop: 20 }}>
                        <Divider orientation="left" plain>
                            Dados da empresa
                        </Divider>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "0 16px" }}>
                            <Form.Item label="Nome fantasia" name="nome_fantasia" rules={[{ max: 120 }]}>
                                <Input maxLength={120} placeholder="Como o cliente conhece a empresa" />
                            </Form.Item>
                            <Form.Item label="Razão social" name="razao_social" rules={[{ max: 160 }]}>
                                <Input maxLength={160} />
                            </Form.Item>
                            <Form.Item label="CNPJ" name="cnpj" rules={[regraCpfCnpj("cnpj")]} normalize={(v: string) => formatCpfCnpj(v)}>
                                <Input inputMode="numeric" placeholder="00.000.000/0000-00" />
                            </Form.Item>
                            <Form.Item label="Telefone" name="telefone" rules={[{ max: 40 }]}>
                                <Input maxLength={40} inputMode="tel" />
                            </Form.Item>
                            <Form.Item label="E-mail" name="email" rules={[{ type: "email", message: "E-mail inválido." }, { max: 254 }]}>
                                <Input maxLength={254} inputMode="email" />
                            </Form.Item>
                            <Form.Item
                                label="Site"
                                name="site"
                                rules={[
                                    { max: 200 },
                                    { validator: async (_, v?: string) => { if (v && !SITE_RE.test(v.trim())) throw new Error("Endereço de site inválido."); } },
                                ]}
                            >
                                <Input maxLength={200} placeholder="www.suaempresa.com.br" />
                            </Form.Item>
                            <Form.Item label="Endereço" name="endereco" rules={[{ max: 300 }]} style={{ gridColumn: "1 / -1" }}>
                                <Input maxLength={300} placeholder="Rua, número — bairro, cidade/UF, CEP" />
                            </Form.Item>
                        </div>

                        <Divider orientation="left" plain>
                            Cores da marca
                        </Divider>
                        <Space size={24} wrap>
                            <Form.Item
                                label="Cor principal"
                                name="cor_primaria"
                                rules={[{ validator: corValida }]}
                                getValueFromEvent={(cor: { toHexString: () => string }) => cor.toHexString().toUpperCase()}
                                tooltip="Faixas, cabeçalho da tabela e caixa do total"
                            >
                                <ColorPicker format="hex" disabledAlpha showText />
                            </Form.Item>
                            <Form.Item
                                label="Cor de destaque"
                                name="cor_secundaria"
                                rules={[{ validator: corValida }]}
                                getValueFromEvent={(cor: { toHexString: () => string }) => cor.toHexString().toUpperCase()}
                                tooltip="Detalhes de acento no topo e no total"
                            >
                                <ColorPicker format="hex" disabledAlpha showText />
                            </Form.Item>
                        </Space>

                        <Divider orientation="left" plain>
                            Textos padrão da proposta
                        </Divider>
                        <Form.Item label="Condições de pagamento" name="condicoes_pagamento" rules={[{ max: 2000 }]}>
                            <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} maxLength={2000} placeholder="Ex.: Entrada de 30% e saldo em até 6x no cartão." />
                        </Form.Item>
                        <Form.Item
                            label="Validade padrão (dias)"
                            name="validade_dias"
                            rules={[{ required: true, message: "Informe a validade." }]}
                            style={{ maxWidth: 220 }}
                        >
                            <InputNumber min={1} max={365} precision={0} style={{ width: "100%" }} />
                        </Form.Item>
                        <Form.Item label="Observações padrão" name="observacoes_padrao" rules={[{ max: 2000 }]}>
                            <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} maxLength={2000} placeholder="Ex.: Instalação e homologação inclusas." />
                        </Form.Item>
                        <Form.Item label="Rodapé" name="rodape" rules={[{ max: 300 }]}>
                            <Input maxLength={300} placeholder="Frase curta que aparece no pé de todas as páginas" />
                        </Form.Item>
                    </Form>

                    <Space wrap>
                        {ehAdmin ? (
                            <Button type="primary" onClick={salvar} loading={ocupado === "salvar"} disabled={Boolean(ocupado) && ocupado !== "salvar"}>
                                Salvar identidade
                            </Button>
                        ) : null}
                        <Button icon={<FilePdfOutlined />} onClick={baixarExemplo} loading={ocupado === "exemplo"}>
                            Baixar PDF de exemplo
                        </Button>
                    </Space>
                </div>

                <div className="orc-identidade-previa">
                    <Text type="secondary" style={{ display: "block", marginBottom: 8, fontSize: 12 }}>
                        Prévia (atualiza enquanto você edita)
                    </Text>
                    <PreviaProposta valores={valores ?? PADRAO} logoUrl={logoPath ? logoUrl : null} />
                </div>
            </div>
        </div>
    );
};
