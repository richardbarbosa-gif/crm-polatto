import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { useInvalidate } from "@refinedev/core";
import { Alert, Button, Input, InputNumber, Modal, Select, Space, Steps, Switch, Typography, message } from "antd";
import { useRef, useState, type ReactNode } from "react";
import {
    descreverAutomacao,
    GATILHOS,
    GATILHOS_AGENDADOS,
    mensagemErroAutomacao,
    montarPayloadSalvar,
    novaAcao,
    pendenciasParaAtivar,
    ROTULO_ACAO,
    ROTULO_GATILHO,
    TEMPERATURAS,
    ROTULO_TEMPERATURA,
    TIPOS_ACAO,
    validarAutomacao,
    MAX_ACOES,
    type AcaoAutomacao,
    type ContextoAutomacao,
    type RegraAutomacao,
    type TipoAcao,
} from "../../../lib/automacoes";
import { supabaseClient } from "../../../utility";
import type { Opcao, OpcaoEtapa } from "./dados";

const { Text } = Typography;

type Opcoes = { etapas: OpcaoEtapa[]; funis: Opcao[]; usuarios: Opcao[]; tipos: Opcao[]; origens: Opcao[] };

type Props = {
    inicial: RegraAutomacao;
    contexto: ContextoAutomacao;
    opcoes: Opcoes;
    onClose: () => void;
    onSalvo: () => void;
};

const temperaturaOpcoes = TEMPERATURAS.map((t) => ({ value: t, label: ROTULO_TEMPERATURA[t] }));

const Campo = ({ rotulo, children, ajuda }: { rotulo: string; children: ReactNode; ajuda?: string }) => (
    <div style={{ marginBottom: 14, minWidth: 0 }}>
        <Text strong style={{ display: "block", marginBottom: 4, fontSize: 13 }}>
            {rotulo}
        </Text>
        {children}
        {ajuda ? (
            <Text type="secondary" style={{ display: "block", fontSize: 12, marginTop: 4 }}>
                {ajuda}
            </Text>
        ) : null}
    </div>
);

const larguraTotal = { width: "100%" };

export const EditorAutomacao = ({ inicial, contexto, opcoes, onClose, onSalvo }: Props) => {
    const [regra, setRegra] = useState<RegraAutomacao>(inicial);
    const [passo, setPasso] = useState(0);
    const [salvando, setSalvando] = useState(false);
    const [erros, setErros] = useState<string[]>([]);
    const salvandoRef = useRef(false);
    const invalidate = useInvalidate();

    const atualizar = (parcial: Partial<RegraAutomacao>) => setRegra((atual) => ({ ...atual, ...parcial }));
    const atualizarAcao = (indice: number, nova: AcaoAutomacao) =>
        setRegra((atual) => ({ ...atual, acoes: atual.acoes.map((a, i) => (i === indice ? nova : a)) }));
    const removerAcao = (indice: number) =>
        setRegra((atual) => ({ ...atual, acoes: atual.acoes.filter((_, i) => i !== indice) }));
    const moverAcao = (indice: number, delta: -1 | 1) =>
        setRegra((atual) => {
            const destino = indice + delta;
            if (destino < 0 || destino >= atual.acoes.length) return atual;
            const acoes = [...atual.acoes];
            const [item] = acoes.splice(indice, 1);
            if (item) acoes.splice(destino, 0, item);
            return { ...atual, acoes };
        });

    const pendencias = pendenciasParaAtivar(regra);

    const salvar = async () => {
        if (salvandoRef.current) return;
        const { valida, erros: lista } = validarAutomacao(regra);
        setErros(lista);
        if (!valida) return;
        salvandoRef.current = true;
        setSalvando(true);
        try {
            const { error } = await supabaseClient.rpc("salvar_automacao", montarPayloadSalvar(regra));
            if (error) {
                setErros([mensagemErroAutomacao(error.message)]);
                return;
            }
            message.success(regra.ativo ? "Automação salva e ativa." : "Automação salva (desativada).");
            await Promise.all(
                ["automacoes", "automacoes_acoes", "vw_automacoes_resumo"].map((resource) =>
                    invalidate({ resource, invalidates: ["list"] }),
                ),
            );
            onSalvo();
        } finally {
            salvandoRef.current = false;
            setSalvando(false);
        }
    };

    const passoQuando = (
        <>
            <Campo rotulo="Nome da automação">
                <Input
                    value={regra.nome}
                    maxLength={80}
                    placeholder="Ex.: Proposta enviada: ligar em 2 dias"
                    onChange={(e) => atualizar({ nome: e.target.value })}
                />
            </Campo>
            <Campo rotulo="Quando">
                <Select
                    style={larguraTotal}
                    value={regra.gatilho}
                    options={GATILHOS.map((g) => ({ value: g, label: ROTULO_GATILHO[g] }))}
                    onChange={(gatilho) => atualizar({ gatilho })}
                />
            </Campo>
            {regra.gatilho === "etapa_entrou" ? (
                <Campo rotulo="Etapa" ajuda="Os nomes das etapas variam por empresa: escolha a etapa do seu funil.">
                    <Select
                        style={larguraTotal}
                        placeholder="Escolha a etapa"
                        value={regra.gatilho_etapa_id ?? undefined}
                        options={opcoes.etapas}
                        showSearch
                        optionFilterProp="label"
                        status={regra.gatilho_etapa_id === null ? "warning" : undefined}
                        onChange={(valor: number) => atualizar({ gatilho_etapa_id: valor })}
                    />
                </Campo>
            ) : null}
            {regra.gatilho === "temperatura_mudou" ? (
                <Campo rotulo="Temperatura">
                    <Select
                        style={larguraTotal}
                        placeholder="Escolha a temperatura"
                        value={regra.gatilho_temperatura ?? undefined}
                        options={temperaturaOpcoes}
                        onChange={(valor) => atualizar({ gatilho_temperatura: valor })}
                    />
                </Campo>
            ) : null}
            {regra.gatilho === "proposta_sem_resposta" ? (
                <Campo rotulo="Dias sem resposta" ajuda="Proposta com status Enviado, sem aceite nem recusa, há este número de dias.">
                    <InputNumber
                        style={larguraTotal}
                        min={1}
                        max={365}
                        precision={0}
                        value={regra.gatilho_dias ?? undefined}
                        onChange={(valor) => atualizar({ gatilho_dias: typeof valor === "number" ? valor : null })}
                    />
                </Campo>
            ) : null}
            {GATILHOS_AGENDADOS.includes(regra.gatilho) ? (
                <Alert
                    type="info"
                    showIcon
                    message="Verificado de hora em hora"
                    description={
                        regra.gatilho === "negocio_parado"
                            ? "Usa o prazo de “parado” de cada etapa (Configurações > Funis). Cada parada dispara uma vez só."
                            : "Cada proposta dispara uma vez só."
                    }
                />
            ) : null}
        </>
    );

    const passoSe = (
        <>
            <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
                Opcional: deixe em branco para valer para todos os negócios.
            </Text>
            <Campo rotulo="Funil">
                <Select
                    style={larguraTotal}
                    allowClear
                    placeholder="Qualquer funil"
                    value={regra.cond_pipeline_id ?? undefined}
                    options={opcoes.funis}
                    onChange={(valor?: string) => atualizar({ cond_pipeline_id: valor ?? null })}
                />
            </Campo>
            <Campo rotulo="Temperatura do negócio">
                <Select
                    style={larguraTotal}
                    allowClear
                    placeholder="Qualquer temperatura"
                    value={regra.cond_temperatura ?? undefined}
                    options={temperaturaOpcoes}
                    onChange={(valor) => atualizar({ cond_temperatura: valor ?? null })}
                />
            </Campo>
            <Campo rotulo="Valor mínimo (R$)">
                <InputNumber
                    style={larguraTotal}
                    min={0}
                    max={999999999999}
                    precision={2}
                    decimalSeparator=","
                    placeholder="Qualquer valor"
                    value={regra.cond_valor_minimo ?? undefined}
                    onChange={(valor) => atualizar({ cond_valor_minimo: typeof valor === "number" ? valor : null })}
                />
            </Campo>
            <Campo rotulo="Origem do lead">
                <Select
                    style={larguraTotal}
                    allowClear
                    placeholder="Qualquer origem"
                    value={regra.cond_origem_id ?? undefined}
                    options={opcoes.origens}
                    onChange={(valor?: string) => atualizar({ cond_origem_id: valor ?? null })}
                />
            </Campo>
        </>
    );

    const camposDaAcao = (acao: AcaoAutomacao, indice: number) => {
        switch (acao.tipo) {
            case "criar_tarefa":
                return (
                    <>
                        <Campo rotulo="Título da tarefa">
                            <Input
                                value={acao.titulo}
                                maxLength={200}
                                placeholder="Ex.: Ligar para saber o que achou"
                                onChange={(e) => atualizarAcao(indice, { ...acao, titulo: e.target.value })}
                            />
                        </Campo>
                        <Campo rotulo="Tipo">
                            <Select
                                style={larguraTotal}
                                allowClear
                                placeholder="Tarefa"
                                value={acao.tipo_atividade_id ?? undefined}
                                options={opcoes.tipos}
                                onChange={(valor?: string) => atualizarAcao(indice, { ...acao, tipo_atividade_id: valor ?? null })}
                            />
                        </Campo>
                        <Campo rotulo="Prazo a partir do evento">
                            <Space.Compact style={larguraTotal}>
                                <InputNumber
                                    style={{ width: "50%" }}
                                    min={0}
                                    max={3650}
                                    precision={0}
                                    value={acao.prazo_quantidade}
                                    onChange={(valor) =>
                                        atualizarAcao(indice, { ...acao, prazo_quantidade: typeof valor === "number" ? valor : 0 })
                                    }
                                />
                                <Select
                                    style={{ width: "50%" }}
                                    value={acao.prazo_unidade}
                                    options={[
                                        { value: "horas", label: "horas" },
                                        { value: "dias", label: "dias" },
                                    ]}
                                    onChange={(valor) => atualizarAcao(indice, { ...acao, prazo_unidade: valor })}
                                />
                            </Space.Compact>
                        </Campo>
                        <Campo rotulo="Para quem">
                            <Select
                                style={larguraTotal}
                                value={acao.responsavel_modo}
                                options={[
                                    { value: "responsavel_negocio", label: "Responsável pelo negócio" },
                                    { value: "usuario_fixo", label: "Um usuário fixo" },
                                ]}
                                onChange={(valor) => atualizarAcao(indice, { ...acao, responsavel_modo: valor })}
                            />
                        </Campo>
                        {acao.responsavel_modo === "usuario_fixo" ? (
                            <Campo rotulo="Usuário">
                                <Select
                                    style={larguraTotal}
                                    placeholder="Escolha o usuário"
                                    showSearch
                                    optionFilterProp="label"
                                    value={acao.usuario_id ?? undefined}
                                    options={opcoes.usuarios}
                                    onChange={(valor: string) => atualizarAcao(indice, { ...acao, usuario_id: valor })}
                                />
                            </Campo>
                        ) : null}
                    </>
                );
            case "mudar_temperatura":
                return (
                    <Campo rotulo="Nova temperatura">
                        <Select
                            style={larguraTotal}
                            value={acao.temperatura}
                            options={temperaturaOpcoes}
                            onChange={(valor) => atualizarAcao(indice, { ...acao, temperatura: valor })}
                        />
                    </Campo>
                );
            case "atribuir_responsavel":
                return (
                    <>
                        <Campo
                            rotulo="Como atribuir"
                            ajuda={
                                acao.atribuicao_modo === "rodizio"
                                    ? "Um de cada vez, em ordem, entre os vendedores ativos (gerentes ficam fora)."
                                    : undefined
                            }
                        >
                            <Select
                                style={larguraTotal}
                                value={acao.atribuicao_modo}
                                options={[
                                    { value: "rodizio", label: "Rodízio entre os vendedores" },
                                    { value: "usuario_fixo", label: "Um usuário fixo" },
                                ]}
                                onChange={(valor) => atualizarAcao(indice, { ...acao, atribuicao_modo: valor })}
                            />
                        </Campo>
                        {acao.atribuicao_modo === "usuario_fixo" ? (
                            <Campo rotulo="Usuário">
                                <Select
                                    style={larguraTotal}
                                    placeholder="Escolha o usuário"
                                    showSearch
                                    optionFilterProp="label"
                                    value={acao.usuario_id ?? undefined}
                                    options={opcoes.usuarios}
                                    onChange={(valor: string) => atualizarAcao(indice, { ...acao, usuario_id: valor })}
                                />
                            </Campo>
                        ) : null}
                    </>
                );
            case "notificar_gerente":
                return (
                    <>
                        <Campo rotulo="Aviso" ajuda="Vira uma tarefa para o gerente com vencimento imediato: aparece no sino e no Meu dia.">
                            <Input
                                value={acao.titulo}
                                maxLength={200}
                                placeholder="Ex.: Negócio ganho: acompanhar a instalação"
                                onChange={(e) => atualizarAcao(indice, { ...acao, titulo: e.target.value })}
                            />
                        </Campo>
                        <Campo rotulo="Quem recebe">
                            <Select
                                style={larguraTotal}
                                allowClear
                                placeholder="Todos os gerentes"
                                showSearch
                                optionFilterProp="label"
                                value={acao.usuario_id ?? undefined}
                                options={opcoes.usuarios}
                                onChange={(valor?: string) => atualizarAcao(indice, { ...acao, usuario_id: valor ?? null })}
                            />
                        </Campo>
                    </>
                );
        }
    };

    const passoEntao = (
        <>
            {regra.acoes.map((acao, indice) => (
                <div
                    // A ordem é a identidade da ação na lista (o banco grava ordem 1..n)
                    key={`${indice}-${acao.tipo}`}
                    style={{
                        border: "1px solid var(--crm-border, #e7edf5)",
                        borderRadius: 10,
                        padding: 12,
                        marginBottom: 12,
                        minWidth: 0,
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                        <Text strong style={{ flex: "0 0 auto" }}>
                            {indice + 1}.
                        </Text>
                        <Select<TipoAcao>
                            style={{ flex: "1 1 160px", minWidth: 0 }}
                            value={acao.tipo}
                            options={TIPOS_ACAO.map((t) => ({ value: t, label: ROTULO_ACAO[t] }))}
                            onChange={(tipo) => atualizarAcao(indice, novaAcao(tipo))}
                        />
                        <Space size={4}>
                            <Button
                                size="small"
                                icon={<ArrowUpOutlined />}
                                aria-label="Mover ação para cima"
                                disabled={indice === 0}
                                onClick={() => moverAcao(indice, -1)}
                            />
                            <Button
                                size="small"
                                icon={<ArrowDownOutlined />}
                                aria-label="Mover ação para baixo"
                                disabled={indice === regra.acoes.length - 1}
                                onClick={() => moverAcao(indice, 1)}
                            />
                            <Button
                                size="small"
                                danger
                                icon={<DeleteOutlined />}
                                aria-label="Remover ação"
                                disabled={regra.acoes.length === 1}
                                onClick={() => removerAcao(indice)}
                            />
                        </Space>
                    </div>
                    {camposDaAcao(acao, indice)}
                </div>
            ))}
            <Button
                icon={<PlusOutlined />}
                block
                disabled={regra.acoes.length >= MAX_ACOES}
                onClick={() => atualizar({ acoes: [...regra.acoes, novaAcao("criar_tarefa")] })}
            >
                Adicionar ação
            </Button>
        </>
    );

    const conteudos = [passoQuando, passoSe, passoEntao];

    return (
        <Modal
            open
            title={regra.id ? "Editar automação" : "Nova automação"}
            onCancel={onClose}
            width={720}
            destroyOnHidden
            maskClosable={false}
            footer={
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
                    <Space size={8}>
                        <Switch
                            checked={regra.ativo}
                            onChange={(ativo) => atualizar({ ativo })}
                            aria-label="Ativar ao salvar"
                        />
                        <Text>{regra.ativo ? "Ativa" : "Desativada"}</Text>
                    </Space>
                    <Space size={8} wrap>
                        {passo > 0 ? <Button onClick={() => setPasso(passo - 1)}>Voltar</Button> : null}
                        {passo < 2 ? (
                            <Button type="primary" onClick={() => setPasso(passo + 1)}>
                                Próximo
                            </Button>
                        ) : null}
                        <Button type={passo === 2 ? "primary" : "default"} loading={salvando} onClick={() => void salvar()}>
                            Salvar
                        </Button>
                    </Space>
                </div>
            }
        >
            <Steps
                size="small"
                current={passo}
                onChange={setPasso}
                style={{ marginBottom: 16 }}
                items={[{ title: "Quando" }, { title: "Se" }, { title: "Então" }]}
            />
            <div style={{ minWidth: 0 }}>{conteudos[passo]}</div>
            <div
                style={{
                    marginTop: 16,
                    padding: 12,
                    borderRadius: 10,
                    background: "var(--crm-surface-2, #f5f7fa)",
                    overflowWrap: "anywhere",
                }}
            >
                <Text type="secondary" style={{ display: "block", fontSize: 12 }}>
                    Resumo
                </Text>
                <Text>{descreverAutomacao(regra, contexto)}</Text>
            </div>
            {regra.ativo && pendencias.length > 0 ? (
                <Alert style={{ marginTop: 12 }} type="warning" showIcon message="Antes de ativar" description={pendencias.join(" ")} />
            ) : null}
            {erros.length > 0 ? (
                <Alert
                    style={{ marginTop: 12 }}
                    type="error"
                    showIcon
                    message="Revise a automação"
                    description={
                        <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                            {erros.map((erro) => (
                                <li key={erro}>{erro}</li>
                            ))}
                        </ul>
                    }
                />
            ) : null}
        </Modal>
    );
};
