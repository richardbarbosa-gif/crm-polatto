import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { useGetIdentity } from "@refinedev/core";
import {
    Alert,
    App,
    DatePicker,
    Divider,
    Drawer,
    Form,
    Input,
    InputNumber,
    Select,
    Skeleton,
    Space,
    Typography,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui";
import { useTenant } from "../../contexts/tenant";
import { fetchEmployeeByEmail } from "../../lib/crmEmployees";
import { propsMoeda } from "../../lib/moedaInput";
import {
    buscarIdentidade,
    buscarOrcamentoCompleto,
    listarProdutosAtivos,
    salvarOrcamento,
} from "../../lib/orcamentos/api";
import { calcularOrcamento, type TipoDesconto } from "../../lib/orcamentos/calculo";
import { ROTULO_STATUS, hojeEmBrasilia, somarDias } from "../../lib/orcamentos/formato";
import type { EmpresaIdentidade, OrcamentoCompleto, OrcamentoItem, Produto } from "../../lib/orcamentos/tipos";
import "./orcamentos.css";

const { Text } = Typography;

type ItemForm = {
    id?: string;
    produto_id?: string | null;
    descricao?: string;
    detalhes?: string;
    unidade?: string;
    quantidade?: number | string | null;
    valor_unitario?: number | string | null;
    desconto_tipo?: TipoDesconto;
    desconto_valor?: number | string | null;
};

type ValoresForm = {
    titulo?: string;
    data_emissao?: Dayjs;
    valido_ate?: Dayjs;
    desconto_tipo: TipoDesconto;
    desconto_valor?: number | string | null;
    condicoes_pagamento?: string;
    observacoes?: string;
    responsavel_nome?: string;
    responsavel_email?: string;
    responsavel_telefone?: string;
    itens: ItemForm[];
};

type Carga =
    | { estado: "carregando" }
    | { estado: "erro"; mensagem: string }
    | { estado: "pronto"; produtos: Produto[]; orcamento: OrcamentoCompleto | null };

type IdentidadeUsuario = {
    email?: string | null;
    user_metadata?: { full_name?: string; name?: string } | null;
};

type Props = {
    negocioId: string;
    orcamentoId?: string | null;
    clienteNome?: string | null;
    onFechar: () => void;
    onSalvo: (id: string) => void;
};

const reais = (valor: number) => valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const numero = (valor: unknown): number => {
    const n = typeof valor === "number" ? valor : Number(valor);
    return Number.isFinite(n) ? n : 0;
};

const arredondar = (valor: unknown, casas: number) => {
    const fator = 10 ** casas;
    return Math.round(numero(valor) * fator) / fator;
};

const ITEM_VAZIO: ItemForm = { quantidade: 1, unidade: "un", desconto_tipo: "valor", desconto_valor: 0 };

const valoresIniciais = (
    orcamento: OrcamentoCompleto | null,
    identidade: EmpresaIdentidade | null,
    vendedor: { nome?: string; email?: string; telefone?: string },
): ValoresForm => {
    if (orcamento) {
        return {
            titulo: orcamento.titulo ?? "",
            data_emissao: dayjs(orcamento.data_emissao),
            valido_ate: dayjs(orcamento.valido_ate),
            desconto_tipo: orcamento.desconto_tipo,
            desconto_valor: orcamento.desconto_valor,
            condicoes_pagamento: orcamento.condicoes_pagamento ?? "",
            observacoes: orcamento.observacoes ?? "",
            responsavel_nome: orcamento.responsavel_nome ?? "",
            responsavel_email: orcamento.responsavel_email ?? "",
            responsavel_telefone: orcamento.responsavel_telefone ?? "",
            itens: orcamento.itens.map((item) => ({ ...item, detalhes: item.detalhes ?? "" })),
        };
    }
    const hoje = hojeEmBrasilia();
    return {
        titulo: "",
        data_emissao: dayjs(hoje),
        valido_ate: dayjs(somarDias(hoje, identidade?.validade_dias ?? 15)),
        desconto_tipo: "valor",
        desconto_valor: 0,
        condicoes_pagamento: identidade?.condicoes_pagamento ?? "",
        observacoes: identidade?.observacoes_padrao ?? "",
        responsavel_nome: vendedor.nome ?? "",
        responsavel_email: vendedor.email ?? "",
        responsavel_telefone: vendedor.telefone ?? "",
        itens: [{ ...ITEM_VAZIO }],
    };
};

export const EditorOrcamento = ({ negocioId, orcamentoId, clienteNome, onFechar, onSalvo }: Props) => {
    const { message, modal } = App.useApp();
    const { tenantId } = useTenant();
    const { data: usuario } = useGetIdentity<IdentidadeUsuario>();
    const [form] = Form.useForm<ValoresForm>();
    const [carga, setCarga] = useState<Carga>({ estado: "carregando" });
    const [salvando, setSalvando] = useState(false);
    const salvandoRef = useRef(false);

    const emailUsuario = usuario?.email ?? null;
    const nomeUsuario = usuario?.user_metadata?.full_name || usuario?.user_metadata?.name || "";

    // Carrega catálogo, identidade (textos padrão) e o orçamento em edição.
    useEffect(() => {
        if (!tenantId) return;
        let ativo = true;
        Promise.all([
            listarProdutosAtivos(),
            buscarIdentidade(tenantId),
            orcamentoId ? buscarOrcamentoCompleto(orcamentoId) : Promise.resolve(null),
            orcamentoId ? Promise.resolve(null) : fetchEmployeeByEmail(emailUsuario).catch(() => null),
        ])
            .then(([produtos, identidade, orcamento, funcionario]) => {
                if (!ativo) return;
                const telefone = funcionario?.raw?.telefone;
                form.setFieldsValue(
                    valoresIniciais(orcamento, identidade, {
                        nome: funcionario?.nome || nomeUsuario,
                        email: funcionario?.email || emailUsuario || "",
                        telefone: typeof telefone === "string" ? telefone : "",
                    }),
                );
                setCarga({ estado: "pronto", produtos, orcamento });
            })
            .catch((erro: unknown) => {
                if (ativo) setCarga({ estado: "erro", mensagem: erro instanceof Error ? erro.message : "Falha ao carregar." });
            });
        return () => {
            ativo = false;
        };
    }, [emailUsuario, form, nomeUsuario, orcamentoId, tenantId]);

    const itensObservados = (Form.useWatch("itens", form) ?? []) as ItemForm[];
    const descontoTipo = Form.useWatch("desconto_tipo", form) as TipoDesconto | undefined;
    const descontoValor = Form.useWatch("desconto_valor", form) as number | string | undefined;
    const totais = calcularOrcamento(itensObservados.filter(Boolean), { tipo: descontoTipo, valor: descontoValor });

    const produtos = carga.estado === "pronto" ? carga.produtos : [];
    const orcamento = carga.estado === "pronto" ? carga.orcamento : null;

    // Produto que saiu do catálogo ativo (inativado ou apagado) continua
    // legível no item já gravado, em vez de aparecer o id cru no select.
    const opcoesProduto = [
        ...produtos.map((p) => ({ value: p.id, label: `${p.nome} — ${reais(p.preco_padrao)}/${p.unidade}` })),
        ...(orcamento?.itens ?? [])
            .filter((item) => item.produto_id && !produtos.some((p) => p.id === item.produto_id))
            .filter((item, indice, lista) => lista.findIndex((outro) => outro.produto_id === item.produto_id) === indice)
            .map((item) => ({ value: item.produto_id as string, label: `${item.descricao} (fora do catálogo ativo)` })),
    ];

    const aplicarProduto = (indice: number, produtoId?: string | null) => {
        const produto = produtos.find((p) => p.id === produtoId);
        if (!produto) return;
        const atual = form.getFieldValue(["itens", indice]) as ItemForm;
        form.setFieldValue(["itens", indice], {
            ...atual,
            produto_id: produto.id,
            descricao: produto.nome,
            unidade: produto.unidade,
            valor_unitario: produto.preco_padrao,
            detalhes: atual?.detalhes?.trim() ? atual.detalhes : (produto.descricao ?? ""),
        });
    };

    const fechar = () => {
        if (!form.isFieldsTouched() || salvando) {
            onFechar();
            return;
        }
        modal.confirm({
            title: "Descartar as alterações?",
            content: "O que foi digitado neste orçamento ainda não foi salvo.",
            okText: "Descartar",
            okButtonProps: { danger: true },
            cancelText: "Continuar editando",
            onOk: onFechar,
        });
    };

    const salvar = async () => {
        if (salvandoRef.current) return;
        let valores: ValoresForm;
        try {
            valores = await form.validateFields();
        } catch (erro: unknown) {
            const campos = (erro as { errorFields?: Array<{ name: (string | number)[] }> }).errorFields;
            if (campos?.[0]) form.scrollToField(campos[0].name, { behavior: "smooth", block: "center" });
            return;
        }
        salvandoRef.current = true;
        setSalvando(true);
        try {
            const itens: OrcamentoItem[] = valores.itens.map((item) => ({
                id: item.id,
                produto_id: item.produto_id ?? null,
                descricao: (item.descricao ?? "").trim(),
                detalhes: item.detalhes?.trim() || null,
                unidade: item.unidade?.trim() || "un",
                quantidade: arredondar(item.quantidade, 3),
                valor_unitario: arredondar(item.valor_unitario, 2),
                desconto_tipo: item.desconto_tipo ?? "valor",
                desconto_valor: arredondar(item.desconto_valor, 2),
            }));
            const id = await salvarOrcamento(
                {
                    id: orcamentoId ?? undefined,
                    negocio_id: negocioId,
                    titulo: valores.titulo?.trim() || null,
                    data_emissao: (valores.data_emissao ?? dayjs()).format("YYYY-MM-DD"),
                    valido_ate: (valores.valido_ate ?? dayjs()).format("YYYY-MM-DD"),
                    desconto_tipo: valores.desconto_tipo,
                    desconto_valor: arredondar(valores.desconto_valor, 2),
                    condicoes_pagamento: valores.condicoes_pagamento ?? "",
                    observacoes: valores.observacoes ?? "",
                    responsavel_nome: valores.responsavel_nome?.trim() || null,
                    responsavel_email: valores.responsavel_email?.trim() || null,
                    responsavel_telefone: valores.responsavel_telefone?.trim() || null,
                },
                itens,
            );
            message.success(orcamentoId ? "Orçamento atualizado." : "Orçamento criado.");
            onSalvo(id);
        } catch (erro: unknown) {
            message.error(erro instanceof Error ? erro.message : "Não foi possível salvar o orçamento.");
        } finally {
            salvandoRef.current = false;
            setSalvando(false);
        }
    };

    const titulo = orcamento
        ? `Editar orçamento ${orcamento.numero}`
        : `Novo orçamento${clienteNome ? ` — ${clienteNome}` : ""}`;

    return (
        <Drawer
            open
            title={titulo}
            width="min(980px, 100vw)"
            onClose={fechar}
            maskClosable={false}
            destroyOnHidden
            footer={
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ fontVariantNumeric: "tabular-nums" }}>
                        <Text type="secondary">Total </Text>
                        <Text strong style={{ fontSize: 18 }}>
                            {reais(totais.total)}
                        </Text>
                    </div>
                    <Space>
                        <Button onClick={fechar} disabled={salvando}>
                            Cancelar
                        </Button>
                        <Button type="primary" onClick={salvar} loading={salvando} disabled={carga.estado !== "pronto"}>
                            Salvar orçamento
                        </Button>
                    </Space>
                </div>
            }
        >
            {carga.estado === "carregando" ? <Skeleton active paragraph={{ rows: 10 }} /> : null}
            {carga.estado === "erro" ? <Alert type="error" showIcon message={carga.mensagem} /> : null}

            <Form<ValoresForm>
                form={form}
                layout="vertical"
                requiredMark="optional"
                style={{ display: carga.estado === "pronto" ? "block" : "none" }}
                initialValues={{ desconto_tipo: "valor", desconto_valor: 0, itens: [] }}
            >
                {orcamento && orcamento.status !== "rascunho" ? (
                    <Alert
                        type="warning"
                        showIcon
                        style={{ marginBottom: 16 }}
                        message={`Esta proposta está como "${ROTULO_STATUS[orcamento.status]}".`}
                        description="O cliente pode já ter recebido o PDF. Para manter o histórico, prefira Duplicar e editar a cópia."
                    />
                ) : null}

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0 16px" }}>
                    <Form.Item label="Título da proposta" name="titulo" rules={[{ max: 200, message: "Até 200 caracteres." }]} style={{ gridColumn: "1 / -1" }}>
                        <Input placeholder="Ex.: Sistema fotovoltaico 8 kWp" maxLength={200} />
                    </Form.Item>
                    <Form.Item label="Emissão" name="data_emissao" rules={[{ required: true, message: "Informe a data de emissão." }]}>
                        <DatePicker format="DD/MM/YYYY" style={{ width: "100%" }} allowClear={false} />
                    </Form.Item>
                    <Form.Item
                        label="Válida até"
                        name="valido_ate"
                        dependencies={["data_emissao"]}
                        rules={[
                            { required: true, message: "Informe a validade." },
                            ({ getFieldValue }) => ({
                                validator: async (_, valor?: Dayjs) => {
                                    const emissao = getFieldValue("data_emissao") as Dayjs | undefined;
                                    if (valor && emissao && valor.isBefore(emissao, "day")) {
                                        throw new Error("A validade não pode ser anterior à emissão.");
                                    }
                                },
                            }),
                        ]}
                    >
                        <DatePicker format="DD/MM/YYYY" style={{ width: "100%" }} allowClear={false} />
                    </Form.Item>
                </div>

                <Divider orientation="left" plain style={{ marginTop: 4 }}>
                    Itens
                </Divider>

                <Form.List
                    name="itens"
                    rules={[
                        {
                            validator: async (_, itens?: ItemForm[]) => {
                                if (!itens?.length) throw new Error("Inclua pelo menos um item.");
                            },
                        },
                    ]}
                >
                    {(campos, { add, remove, move }, { errors }) => (
                        <div className="orc-itens">
                            {campos.map((campo, indice) => {
                                const observado = itensObservados[indice];
                                const percentual = observado?.desconto_tipo === "percentual";
                                return (
                                    <div className="orc-item" key={campo.key}>
                                        <div className="orc-item-topo">
                                            <Text strong>Item {indice + 1}</Text>
                                            <Space size={2} wrap>
                                                <Text className="orc-item-total">{reais(totais.itens[indice]?.total ?? 0)}</Text>
                                                <Button
                                                    size="small"
                                                    type="text"
                                                    icon={<ArrowUpOutlined />}
                                                    disabled={indice === 0}
                                                    onClick={() => move(indice, indice - 1)}
                                                    aria-label={`Mover item ${indice + 1} para cima`}
                                                />
                                                <Button
                                                    size="small"
                                                    type="text"
                                                    icon={<ArrowDownOutlined />}
                                                    disabled={indice === campos.length - 1}
                                                    onClick={() => move(indice, indice + 1)}
                                                    aria-label={`Mover item ${indice + 1} para baixo`}
                                                />
                                                <Button
                                                    size="small"
                                                    type="text"
                                                    danger
                                                    icon={<DeleteOutlined />}
                                                    onClick={() => remove(campo.name)}
                                                    aria-label={`Remover item ${indice + 1}`}
                                                />
                                            </Space>
                                        </div>
                                        <div className="orc-item-grade">
                                            <Form.Item name={[campo.name, "id"]} hidden>
                                                <Input />
                                            </Form.Item>
                                            <Form.Item name={[campo.name, "produto_id"]} label="Do catálogo" className="orc-col-cheia">
                                                <Select
                                                    allowClear
                                                    showSearch
                                                    optionFilterProp="label"
                                                    placeholder={produtos.length ? "Escolha um produto ou deixe em branco (item livre)" : "Catálogo vazio: item livre"}
                                                    options={opcoesProduto}
                                                    onChange={(id?: string) => aplicarProduto(campo.name, id)}
                                                />
                                            </Form.Item>
                                            <Form.Item
                                                name={[campo.name, "descricao"]}
                                                label="Descrição"
                                                rules={[
                                                    { required: true, whitespace: true, message: "Descreva o item." },
                                                    { max: 500, message: "Até 500 caracteres." },
                                                ]}
                                            >
                                                <Input maxLength={500} placeholder="O que será entregue" />
                                            </Form.Item>
                                            <Form.Item
                                                name={[campo.name, "quantidade"]}
                                                label="Qtd."
                                                rules={[
                                                    { required: true, message: "Informe." },
                                                    {
                                                        validator: async (_, v) => {
                                                            if (v !== undefined && v !== null && v !== "" && !(numero(v) > 0)) throw new Error("Maior que zero.");
                                                        },
                                                    },
                                                ]}
                                            >
                                                <InputNumber min={0} max={99999999999} decimalSeparator="," style={{ width: "100%" }} />
                                            </Form.Item>
                                            <Form.Item
                                                name={[campo.name, "unidade"]}
                                                label="Unidade"
                                                rules={[{ required: true, whitespace: true, message: "Informe." }, { max: 20, message: "Até 20." }]}
                                            >
                                                <Input maxLength={20} placeholder="un" />
                                            </Form.Item>
                                            <Form.Item name={[campo.name, "valor_unitario"]} label="Valor unitário" rules={[{ required: true, message: "Informe o valor." }]}>
                                                <InputNumber {...propsMoeda} max={999999999999} />
                                            </Form.Item>
                                            <Form.Item label="Desconto">
                                                <Space.Compact style={{ width: "100%" }}>
                                                    <Form.Item name={[campo.name, "desconto_tipo"]} noStyle>
                                                        <Select
                                                            style={{ width: 72 }}
                                                            options={[
                                                                { value: "valor", label: "R$" },
                                                                { value: "percentual", label: "%" },
                                                            ]}
                                                            aria-label="Tipo de desconto do item"
                                                        />
                                                    </Form.Item>
                                                    <Form.Item
                                                        name={[campo.name, "desconto_valor"]}
                                                        noStyle
                                                        rules={[
                                                            {
                                                                validator: async (_, v) => {
                                                                    if (percentual && numero(v) > 100) throw new Error("Desconto acima de 100%.");
                                                                },
                                                            },
                                                        ]}
                                                    >
                                                        {percentual ? (
                                                            <InputNumber min={0} max={100} decimalSeparator="," style={{ width: "100%" }} aria-label="Desconto do item" />
                                                        ) : (
                                                            <InputNumber {...propsMoeda} prefix={undefined} aria-label="Desconto do item" />
                                                        )}
                                                    </Form.Item>
                                                </Space.Compact>
                                            </Form.Item>
                                            <Form.Item name={[campo.name, "detalhes"]} label="Detalhes (opcional, aparece em letra menor no PDF)" className="orc-col-cheia" rules={[{ max: 2000 }]}>
                                                <Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} maxLength={2000} placeholder="Marca, modelo, garantia, prazo..." />
                                            </Form.Item>
                                        </div>
                                    </div>
                                );
                            })}
                            <Form.ErrorList errors={errors} />
                            <Button icon={<PlusOutlined />} onClick={() => add({ ...ITEM_VAZIO })} style={{ alignSelf: "flex-start" }}>
                                Adicionar item
                            </Button>
                        </div>
                    )}
                </Form.List>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginTop: 20 }}>
                    <Form.Item label="Desconto geral" style={{ marginBottom: 0 }}>
                        <Space.Compact style={{ width: "100%" }}>
                            <Form.Item name="desconto_tipo" noStyle>
                                <Select
                                    style={{ width: 72 }}
                                    options={[
                                        { value: "valor", label: "R$" },
                                        { value: "percentual", label: "%" },
                                    ]}
                                    aria-label="Tipo de desconto geral"
                                />
                            </Form.Item>
                            <Form.Item
                                name="desconto_valor"
                                noStyle
                                rules={[
                                    {
                                        validator: async (_, v) => {
                                            if (descontoTipo === "percentual" && numero(v) > 100) throw new Error("Desconto acima de 100%.");
                                        },
                                    },
                                ]}
                            >
                                {descontoTipo === "percentual" ? (
                                    <InputNumber min={0} max={100} decimalSeparator="," style={{ width: "100%" }} aria-label="Desconto geral" />
                                ) : (
                                    <InputNumber {...propsMoeda} prefix={undefined} aria-label="Desconto geral" />
                                )}
                            </Form.Item>
                        </Space.Compact>
                    </Form.Item>
                    <div className="orc-resumo" aria-live="polite">
                        <div className="orc-resumo-linha">
                            <span>Subtotal</span>
                            <span>{reais(totais.subtotal)}</span>
                        </div>
                        <div className="orc-resumo-linha">
                            <span>Desconto</span>
                            <span>{totais.desconto > 0 ? `- ${reais(totais.desconto)}` : reais(0)}</span>
                        </div>
                        <div className="orc-resumo-total">
                            <span>Total</span>
                            <span>{reais(totais.total)}</span>
                        </div>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                            O total oficial é recalculado pelo servidor ao salvar.
                        </Text>
                    </div>
                </div>

                <Divider orientation="left" plain>
                    Condições e observações
                </Divider>
                <Form.Item label="Condições de pagamento" name="condicoes_pagamento" rules={[{ max: 4000 }]}>
                    <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} maxLength={4000} />
                </Form.Item>
                <Form.Item label="Observações" name="observacoes" rules={[{ max: 4000 }]}>
                    <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} maxLength={4000} />
                </Form.Item>

                <Divider orientation="left" plain>
                    Consultor (rodapé do PDF)
                </Divider>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0 16px" }}>
                    <Form.Item label="Nome" name="responsavel_nome" rules={[{ max: 120 }]}>
                        <Input maxLength={120} />
                    </Form.Item>
                    <Form.Item label="Telefone" name="responsavel_telefone" rules={[{ max: 40 }]}>
                        <Input maxLength={40} inputMode="tel" />
                    </Form.Item>
                    <Form.Item label="E-mail" name="responsavel_email" rules={[{ type: "email", message: "E-mail inválido." }, { max: 254 }]}>
                        <Input maxLength={254} inputMode="email" />
                    </Form.Item>
                </div>
            </Form>
        </Drawer>
    );
};
