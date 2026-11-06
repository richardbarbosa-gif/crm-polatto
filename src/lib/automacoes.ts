/**
 * Automações do funil ("quando X, se Y, então Z") — regras puras, sem
 * Supabase: descrição legível em PT-BR, validação (espelha a do banco,
 * migration 17), leitura segura das linhas do banco e o payload da RPC
 * salvar_automacao.
 */
import { formatCurrencyBRL } from "./formatters";

export const GATILHOS = [
    "negocio_criado",
    "etapa_entrou",
    "negocio_ganho",
    "negocio_perdido",
    "temperatura_mudou",
    "negocio_parado",
    "proposta_sem_resposta",
] as const;
export type GatilhoAutomacao = (typeof GATILHOS)[number];

export const TEMPERATURAS = ["quente", "morno", "frio"] as const;
export type TemperaturaAutomacao = (typeof TEMPERATURAS)[number];

export const TIPOS_ACAO = ["criar_tarefa", "mudar_temperatura", "atribuir_responsavel", "notificar_gerente"] as const;
export type TipoAcao = (typeof TIPOS_ACAO)[number];

export type UnidadePrazo = "horas" | "dias";
export type ModoResponsavel = "responsavel_negocio" | "usuario_fixo";
export type ModoAtribuicao = "usuario_fixo" | "rodizio";

export type AcaoCriarTarefa = {
    tipo: "criar_tarefa";
    titulo: string;
    tipo_atividade_id: string | null;
    prazo_quantidade: number;
    prazo_unidade: UnidadePrazo;
    responsavel_modo: ModoResponsavel;
    usuario_id: string | null;
};
export type AcaoMudarTemperatura = { tipo: "mudar_temperatura"; temperatura: TemperaturaAutomacao };
export type AcaoAtribuir = { tipo: "atribuir_responsavel"; atribuicao_modo: ModoAtribuicao; usuario_id: string | null };
export type AcaoNotificar = { tipo: "notificar_gerente"; titulo: string; usuario_id: string | null };
export type AcaoAutomacao = AcaoCriarTarefa | AcaoMudarTemperatura | AcaoAtribuir | AcaoNotificar;

export type RegraAutomacao = {
    id?: string;
    nome: string;
    ativo: boolean;
    gatilho: GatilhoAutomacao;
    gatilho_etapa_id: number | null;
    gatilho_temperatura: TemperaturaAutomacao | null;
    gatilho_dias: number | null;
    cond_pipeline_id: string | null;
    cond_temperatura: TemperaturaAutomacao | null;
    cond_valor_minimo: number | null;
    cond_origem_id: string | null;
    acoes: AcaoAutomacao[];
};

/** Nomes para a descrição (id → nome). Ausente = item excluído ou de outra empresa. */
export type ContextoAutomacao = {
    etapas?: Record<string, string>;
    funis?: Record<string, string>;
    usuarios?: Record<string, string>;
    tiposAtividade?: Record<string, string>;
    origens?: Record<string, string>;
};

export const MAX_ACOES = 10;
export const MAX_PRAZO = 3650;

export const ROTULO_GATILHO: Record<GatilhoAutomacao, string> = {
    negocio_criado: "Negócio criado",
    etapa_entrou: "Negócio entrou na etapa",
    negocio_ganho: "Negócio ganho",
    negocio_perdido: "Negócio perdido",
    temperatura_mudou: "Temperatura mudou",
    negocio_parado: "Negócio parado",
    proposta_sem_resposta: "Proposta sem resposta",
};

export const ROTULO_ACAO: Record<TipoAcao, string> = {
    criar_tarefa: "Criar tarefa",
    mudar_temperatura: "Mudar temperatura",
    atribuir_responsavel: "Atribuir responsável",
    notificar_gerente: "Avisar o gerente",
};

export const ROTULO_TEMPERATURA: Record<TemperaturaAutomacao, string> = {
    quente: "Quente",
    morno: "Morno",
    frio: "Frio",
};

/** Gatilhos que rodam pelo agendador (de hora em hora), não na hora do evento. */
export const GATILHOS_AGENDADOS: readonly GatilhoAutomacao[] = ["negocio_parado", "proposta_sem_resposta"];

const ehUm = <T extends string>(lista: readonly T[], valor: unknown): valor is T =>
    typeof valor === "string" && (lista as readonly string[]).includes(valor);

export const ehGatilho = (valor: unknown): valor is GatilhoAutomacao => ehUm(GATILHOS, valor);
export const ehTemperatura = (valor: unknown): valor is TemperaturaAutomacao => ehUm(TEMPERATURAS, valor);

const nomeDe = (mapa: Record<string, string> | undefined, id: string | number | null | undefined): string | null => {
    if (id === null || id === undefined || id === "") return null;
    const nome = mapa?.[String(id)];
    return nome && nome.trim() ? nome.trim() : null;
};

export const formatarPrazo = (quantidade: number, unidade: UnidadePrazo): string => {
    if (!Number.isFinite(quantidade) || quantidade <= 0) return "na hora";
    const n = Math.floor(quantidade);
    if (unidade === "horas") return n === 1 ? "em 1 hora" : `em ${n} horas`;
    return n === 1 ? "em 1 dia" : `em ${n} dias`;
};

export const descreverGatilho = (regra: Pick<RegraAutomacao, "gatilho" | "gatilho_etapa_id" | "gatilho_temperatura" | "gatilho_dias">, ctx: ContextoAutomacao = {}): string => {
    switch (regra.gatilho) {
        case "negocio_criado":
            return "Quando um negócio for criado";
        case "etapa_entrou": {
            const etapa = nomeDe(ctx.etapas, regra.gatilho_etapa_id);
            return etapa ? `Quando o negócio entrar em ${etapa}` : "Quando o negócio entrar na etapa (escolha a etapa)";
        }
        case "negocio_ganho":
            return "Quando o negócio for ganho";
        case "negocio_perdido":
            return "Quando o negócio for perdido";
        case "temperatura_mudou":
            return regra.gatilho_temperatura
                ? `Quando a temperatura mudar para ${ROTULO_TEMPERATURA[regra.gatilho_temperatura]}`
                : "Quando a temperatura mudar (escolha a temperatura)";
        case "negocio_parado":
            return "Quando o negócio ficar parado";
        case "proposta_sem_resposta": {
            const dias = regra.gatilho_dias ?? 0;
            if (dias <= 0) return "Quando a proposta enviada ficar sem resposta (informe os dias)";
            return `Quando a proposta enviada ficar sem resposta há ${dias} ${dias === 1 ? "dia" : "dias"}`;
        }
    }
};

const juntarComE = (partes: string[]): string => {
    if (partes.length <= 1) return partes.join("");
    return `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
};

/** "se o funil for Vendas, a temperatura for Quente e o valor for a partir de R$ 20.000,00" (ou null) */
export const descreverCondicoes = (regra: Pick<RegraAutomacao, "cond_pipeline_id" | "cond_temperatura" | "cond_valor_minimo" | "cond_origem_id">, ctx: ContextoAutomacao = {}): string | null => {
    const partes: string[] = [];
    if (regra.cond_pipeline_id) {
        partes.push(`o funil for ${nomeDe(ctx.funis, regra.cond_pipeline_id) ?? "(funil removido)"}`);
    }
    if (regra.cond_temperatura) {
        partes.push(`a temperatura for ${ROTULO_TEMPERATURA[regra.cond_temperatura]}`);
    }
    if (regra.cond_valor_minimo !== null && regra.cond_valor_minimo !== undefined) {
        partes.push(`o valor for a partir de ${formatCurrencyBRL(regra.cond_valor_minimo, "R$ 0,00")}`);
    }
    if (regra.cond_origem_id) {
        partes.push(`a origem for ${nomeDe(ctx.origens, regra.cond_origem_id) ?? "(origem removida)"}`);
    }
    return partes.length ? `se ${juntarComE(partes)}` : null;
};

export const descreverAcao = (acao: AcaoAutomacao, ctx: ContextoAutomacao = {}): string => {
    switch (acao.tipo) {
        case "criar_tarefa": {
            const para =
                acao.responsavel_modo === "usuario_fixo"
                    ? `para ${nomeDe(ctx.usuarios, acao.usuario_id) ?? "(escolha o usuário)"}`
                    : "para o responsável";
            const titulo = acao.titulo.trim() || "(sem título)";
            return `criar tarefa «${titulo}» ${formatarPrazo(acao.prazo_quantidade, acao.prazo_unidade)} ${para}`;
        }
        case "mudar_temperatura":
            return `mudar a temperatura para ${ROTULO_TEMPERATURA[acao.temperatura]}`;
        case "atribuir_responsavel":
            return acao.atribuicao_modo === "rodizio"
                ? "distribuir em rodízio entre os vendedores ativos"
                : `atribuir a ${nomeDe(ctx.usuarios, acao.usuario_id) ?? "(escolha o usuário)"}`;
        case "notificar_gerente": {
            const quem = acao.usuario_id ? nomeDe(ctx.usuarios, acao.usuario_id) ?? "(usuário removido)" : "o gerente";
            return `avisar ${quem}: «${acao.titulo.trim() || "(sem texto)"}»`;
        }
    }
};

/**
 * Descrição legível da regra inteira, por exemplo:
 * "Quando o negócio entrar em Proposta Enviada → criar tarefa «Ligar» em 2 dias para o responsável"
 */
export const descreverAutomacao = (regra: RegraAutomacao, ctx: ContextoAutomacao = {}): string => {
    const quando = descreverGatilho(regra, ctx);
    const se = descreverCondicoes(regra, ctx);
    const entao = regra.acoes.length ? regra.acoes.map((acao) => descreverAcao(acao, ctx)).join("; ") : "(nenhuma ação)";
    return `${quando}${se ? `, ${se}` : ""} → ${entao}`;
};

/** O que falta para a regra poder ser ATIVADA (mesmas mensagens do banco). */
export const pendenciasParaAtivar = (regra: RegraAutomacao): string[] => {
    const pend: string[] = [];
    if (regra.gatilho === "etapa_entrou" && regra.gatilho_etapa_id === null) pend.push("Escolha a etapa do gatilho.");
    if (regra.gatilho === "temperatura_mudou" && regra.gatilho_temperatura === null) {
        pend.push("Escolha a temperatura do gatilho.");
    }
    if (regra.gatilho === "proposta_sem_resposta" && regra.gatilho_dias === null) {
        pend.push("Informe em quantos dias sem resposta.");
    }
    if (regra.acoes.length === 0) pend.push("Inclua pelo menos uma ação.");
    const faltaUsuario = regra.acoes.some(
        (acao) =>
            (acao.tipo === "criar_tarefa" && acao.responsavel_modo === "usuario_fixo" && !acao.usuario_id) ||
            (acao.tipo === "atribuir_responsavel" && acao.atribuicao_modo === "usuario_fixo" && !acao.usuario_id),
    );
    if (faltaUsuario) pend.push("Escolha o usuário fixo da ação.");
    return pend;
};

export type ResultadoValidacao = { valida: boolean; erros: string[] };

/** Validação para SALVAR (o que o banco recusaria por CHECK). Ativar exige também pendenciasParaAtivar. */
export const validarAutomacao = (regra: RegraAutomacao): ResultadoValidacao => {
    const erros: string[] = [];
    const nome = regra.nome.trim();
    if (!nome) erros.push("Dê um nome à automação.");
    else if (nome.length > 80) erros.push("O nome pode ter no máximo 80 caracteres.");
    if (!ehGatilho(regra.gatilho)) erros.push("Escolha quando a automação deve rodar.");
    if (regra.gatilho === "temperatura_mudou" && !regra.gatilho_temperatura) erros.push("Escolha a temperatura do gatilho.");
    if (regra.gatilho === "proposta_sem_resposta") {
        const dias = regra.gatilho_dias;
        if (dias === null || !Number.isInteger(dias) || dias < 1 || dias > 365) {
            erros.push("Informe de 1 a 365 dias sem resposta.");
        }
    }
    if (regra.cond_valor_minimo !== null && (!Number.isFinite(regra.cond_valor_minimo) || regra.cond_valor_minimo < 0)) {
        erros.push("O valor mínimo não pode ser negativo.");
    }
    if (regra.acoes.length === 0) erros.push("Inclua pelo menos uma ação.");
    if (regra.acoes.length > MAX_ACOES) erros.push(`Use no máximo ${MAX_ACOES} ações.`);
    regra.acoes.forEach((acao, i) => {
        const n = `Ação ${i + 1}`;
        if (acao.tipo === "criar_tarefa" || acao.tipo === "notificar_gerente") {
            const titulo = acao.titulo.trim();
            if (!titulo) erros.push(`${n}: escreva o título.`);
            else if (titulo.length > 200) erros.push(`${n}: título com no máximo 200 caracteres.`);
        }
        if (acao.tipo === "criar_tarefa") {
            if (!Number.isInteger(acao.prazo_quantidade) || acao.prazo_quantidade < 0 || acao.prazo_quantidade > MAX_PRAZO) {
                erros.push(`${n}: prazo de 0 a ${MAX_PRAZO}.`);
            }
        }
    });
    if (regra.ativo) {
        pendenciasParaAtivar(regra).forEach((p) => {
            if (!erros.includes(p)) erros.push(p);
        });
    }
    return { valida: erros.length === 0, erros };
};

/** Payload da RPC salvar_automacao (só os campos que a regra usa). */
export const montarPayloadSalvar = (regra: RegraAutomacao): { p_automacao: Record<string, unknown>; p_acoes: Record<string, unknown>[] } => ({
    p_automacao: {
        ...(regra.id ? { id: regra.id } : {}),
        nome: regra.nome.trim(),
        ativo: regra.ativo,
        gatilho: regra.gatilho,
        gatilho_etapa_id: regra.gatilho === "etapa_entrou" ? regra.gatilho_etapa_id : null,
        gatilho_temperatura: regra.gatilho === "temperatura_mudou" ? regra.gatilho_temperatura : null,
        gatilho_dias: regra.gatilho === "proposta_sem_resposta" ? regra.gatilho_dias : null,
        cond_pipeline_id: regra.cond_pipeline_id,
        cond_temperatura: regra.cond_temperatura,
        cond_valor_minimo: regra.cond_valor_minimo,
        cond_origem_id: regra.cond_origem_id,
    },
    p_acoes: regra.acoes.map((acao) => {
        switch (acao.tipo) {
            case "criar_tarefa":
                return {
                    tipo: acao.tipo,
                    titulo: acao.titulo.trim(),
                    tipo_atividade_id: acao.tipo_atividade_id,
                    prazo_quantidade: acao.prazo_quantidade,
                    prazo_unidade: acao.prazo_unidade,
                    responsavel_modo: acao.responsavel_modo,
                    usuario_id: acao.responsavel_modo === "usuario_fixo" ? acao.usuario_id : null,
                };
            case "mudar_temperatura":
                return { tipo: acao.tipo, temperatura: acao.temperatura };
            case "atribuir_responsavel":
                return {
                    tipo: acao.tipo,
                    atribuicao_modo: acao.atribuicao_modo,
                    usuario_id: acao.atribuicao_modo === "usuario_fixo" ? acao.usuario_id : null,
                };
            case "notificar_gerente":
                return { tipo: acao.tipo, titulo: acao.titulo.trim(), usuario_id: acao.usuario_id };
        }
    }),
});

const texto = (valor: unknown): string | null => (typeof valor === "string" && valor.trim() ? valor : null);
const id = (valor: unknown): string | null =>
    (typeof valor === "string" && valor.trim()) || typeof valor === "number" ? String(valor) : null;
const inteiro = (valor: unknown): number | null => {
    const n = typeof valor === "string" && valor.trim() ? Number(valor) : valor;
    return typeof n === "number" && Number.isInteger(n) ? n : null;
};
const numero = (valor: unknown): number | null => {
    const n = typeof valor === "string" && valor.trim() ? Number(valor) : valor;
    return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** Linha de automacoes_acoes vinda do banco → ação tipada (null se inválida). */
export const acaoDoBanco = (linha: Record<string, unknown>): AcaoAutomacao | null => {
    switch (linha.tipo) {
        case "criar_tarefa": {
            const prazo = inteiro(linha.prazo_quantidade);
            const unidade = linha.prazo_unidade === "horas" || linha.prazo_unidade === "dias" ? linha.prazo_unidade : null;
            const modo =
                linha.responsavel_modo === "usuario_fixo" || linha.responsavel_modo === "responsavel_negocio"
                    ? linha.responsavel_modo
                    : null;
            if (prazo === null || !unidade || !modo) return null;
            return {
                tipo: "criar_tarefa",
                titulo: texto(linha.titulo) ?? "",
                tipo_atividade_id: id(linha.tipo_atividade_id),
                prazo_quantidade: prazo,
                prazo_unidade: unidade,
                responsavel_modo: modo,
                usuario_id: id(linha.usuario_id),
            };
        }
        case "mudar_temperatura":
            return ehTemperatura(linha.temperatura) ? { tipo: "mudar_temperatura", temperatura: linha.temperatura } : null;
        case "atribuir_responsavel":
            return linha.atribuicao_modo === "rodizio" || linha.atribuicao_modo === "usuario_fixo"
                ? { tipo: "atribuir_responsavel", atribuicao_modo: linha.atribuicao_modo, usuario_id: id(linha.usuario_id) }
                : null;
        case "notificar_gerente":
            return { tipo: "notificar_gerente", titulo: texto(linha.titulo) ?? "", usuario_id: id(linha.usuario_id) };
        default:
            return null;
    }
};

/** Linha de automacoes + linhas de automacoes_acoes → regra tipada (null se inválida). */
export const regraDoBanco = (linha: Record<string, unknown>, acoes: Record<string, unknown>[]): RegraAutomacao | null => {
    if (!ehGatilho(linha.gatilho) || typeof linha.id !== "string") return null;
    const ordenadas = [...acoes].sort((a, b) => (inteiro(a.ordem) ?? 0) - (inteiro(b.ordem) ?? 0));
    return {
        id: linha.id,
        nome: texto(linha.nome) ?? "",
        ativo: linha.ativo === true,
        gatilho: linha.gatilho,
        gatilho_etapa_id: inteiro(linha.gatilho_etapa_id),
        gatilho_temperatura: ehTemperatura(linha.gatilho_temperatura) ? linha.gatilho_temperatura : null,
        gatilho_dias: inteiro(linha.gatilho_dias),
        cond_pipeline_id: id(linha.cond_pipeline_id),
        cond_temperatura: ehTemperatura(linha.cond_temperatura) ? linha.cond_temperatura : null,
        cond_valor_minimo: numero(linha.cond_valor_minimo),
        cond_origem_id: id(linha.cond_origem_id),
        acoes: ordenadas.map(acaoDoBanco).filter((a): a is AcaoAutomacao => a !== null),
    };
};

export const novaAcao = (tipo: TipoAcao): AcaoAutomacao => {
    switch (tipo) {
        case "criar_tarefa":
            return {
                tipo,
                titulo: "",
                tipo_atividade_id: null,
                prazo_quantidade: 1,
                prazo_unidade: "dias",
                responsavel_modo: "responsavel_negocio",
                usuario_id: null,
            };
        case "mudar_temperatura":
            return { tipo, temperatura: "quente" };
        case "atribuir_responsavel":
            return { tipo, atribuicao_modo: "rodizio", usuario_id: null };
        case "notificar_gerente":
            return { tipo, titulo: "", usuario_id: null };
    }
};

export const novaRegra = (): RegraAutomacao => ({
    nome: "",
    ativo: false,
    gatilho: "etapa_entrou",
    gatilho_etapa_id: null,
    gatilho_temperatura: null,
    gatilho_dias: null,
    cond_pipeline_id: null,
    cond_temperatura: null,
    cond_valor_minimo: null,
    cond_origem_id: null,
    acoes: [novaAcao("criar_tarefa")],
});

/** Mensagem amigável para o erro do banco ao salvar/ativar. */
export const mensagemErroAutomacao = (mensagem: string): string => {
    const m = mensagem.trim();
    if (/automacoes_nome_uk|duplicate key/i.test(m)) return "Já existe uma automação com esse nome.";
    if (/Somente o gerente|row-level security|42501/i.test(m)) return "Somente o gerente pode criar ou editar automações.";
    if (/foreign key|23503/i.test(m)) return "Uma etapa, funil, origem ou usuário escolhido não existe mais. Revise a regra.";
    const incompleta = m.match(/Automação incompleta:\s*(.+)$/);
    if (incompleta?.[1]) return incompleta[1];
    return m || "Não foi possível salvar a automação.";
};
