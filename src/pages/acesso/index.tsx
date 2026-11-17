import { CheckCircleFilled } from "@ant-design/icons";
import { AuthPage } from "@refinedev/antd";
import type { ReactNode } from "react";
import { PolattoLogo } from "../../components/polatto-logo";

type TipoDeAcesso = "login" | "register" | "forgotPassword" | "updatePassword";

/**
 * Cadastro público de novas empresas. Fechado por padrão: o banco também
 * recusa (plataforma_config.cadastro_aberto) e, com a porta fechada, um
 * link "Criar conta" só levaria a um beco sem saída. Para abrir, ligue as
 * duas chaves: VITE_CADASTRO_ABERTO=true no site e cadastro_aberto no banco.
 */
export const CADASTRO_ABERTO = import.meta.env.VITE_CADASTRO_ABERTO === "true";

const DESTAQUES = [
    "Funil visual com o próximo passo de cada negócio sempre à vista",
    "Propostas em PDF com a identidade da sua empresa",
    "Metas, ranking e relatórios do time em tempo real",
];

/**
 * Moldura das telas de acesso (entrar, criar conta, recuperar e trocar a
 * senha). O formulário e as regras continuam sendo os do Refine; aqui fica
 * só a apresentação: painel da marca à esquerda e formulário à direita. No
 * celular o painel some e a marca sobe para cima do formulário.
 */
const Moldura = ({ formulario }: { formulario: ReactNode }) => (
    <div className="crm-acesso__grade">
        <aside className="crm-acesso__marca" aria-hidden="true">
            <PolattoLogo variant="sidebar" size="md" />
            <div className="crm-acesso__mensagem">
                <h1 className="crm-acesso__titulo">
                    Do primeiro contato ao <span>contrato assinado</span>.
                </h1>
                <p className="crm-acesso__texto">
                    O CRM que organiza o dia do vendedor e mostra ao gestor, sem planilha, onde o faturamento
                    está andando — e onde está parado.
                </p>
                <ul className="crm-acesso__lista">
                    {DESTAQUES.map((frase) => (
                        <li key={frase}>
                            <CheckCircleFilled />
                            <span>{frase}</span>
                        </li>
                    ))}
                </ul>
            </div>
            <span className="crm-acesso__rodape">Seus dados isolados por empresa e protegidos por criptografia.</span>
        </aside>
        <main className="crm-acesso__formulario">
            <div className="crm-acesso__logo-celular">
                <PolattoLogo variant="login" size="lg" />
            </div>
            {formulario}
        </main>
    </div>
);

export const TelaDeAcesso = ({ tipo }: { tipo: TipoDeAcesso }) => {
    const comuns = {
        title: false as const,
        wrapperProps: { className: "crm-acesso" },
        renderContent: (formulario: ReactNode) => <Moldura formulario={formulario} />,
    };

    if (tipo === "login") {
        // Sem cadastro aberto, o convite para criar conta não aparece.
        return <AuthPage type="login" {...comuns} {...(CADASTRO_ABERTO ? {} : { registerLink: false })} />;
    }
    return <AuthPage type={tipo} {...comuns} />;
};
