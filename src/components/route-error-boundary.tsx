import { Button, Result } from "antd";
import React from "react";
import { useLocation } from "react-router";
import { reportError } from "../utility/errorMonitoring";

type Props = { children: React.ReactNode; chave: string };
type State = { erro: boolean };

/**
 * Erro de render numa tela fica restrito àquela tela: o menu e o topo
 * continuam funcionando e, ao navegar para outra rota, a tela volta ao
 * normal. Antes qualquer erro derrubava o app inteiro até recarregar.
 */
class LimiteDeErroDaRota extends React.Component<Props, State> {
    state: State = { erro: false };

    static getDerivedStateFromError(): State {
        return { erro: true };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo): void {
        reportError(error, "error-boundary", { componentStack: info.componentStack, rota: this.props.chave });
    }

    componentDidUpdate(anterior: Props): void {
        if (anterior.chave !== this.props.chave && this.state.erro) {
            this.setState({ erro: false });
        }
    }

    render() {
        if (this.state.erro) {
            return (
                <Result
                    status="warning"
                    title="Não foi possível exibir esta tela"
                    subTitle="O erro foi registrado. Tente novamente ou use o menu para ir a outra tela."
                    extra={
                        <Button type="primary" onClick={() => this.setState({ erro: false })}>
                            Tentar novamente
                        </Button>
                    }
                />
            );
        }
        return this.props.children;
    }
}

export const RouteErrorBoundary = ({ children }: { children: React.ReactNode }) => {
    const { pathname } = useLocation();
    return <LimiteDeErroDaRota chave={pathname}>{children}</LimiteDeErroDaRota>;
};
