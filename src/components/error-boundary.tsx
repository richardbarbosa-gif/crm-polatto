import { Button, Result } from "antd";
import React from "react";
import { reportError } from "../utility/errorMonitoring";

type ErrorBoundaryProps = { children: React.ReactNode };
type ErrorBoundaryState = { hasError: boolean };

/**
 * Error boundary global: um erro de render em qualquer tela vira uma
 * mensagem amigável + registro em client_errors, em vez de tela branca.
 */
export class AppErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = { hasError: false };

    static getDerivedStateFromError(): ErrorBoundaryState {
        return { hasError: true };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo): void {
        reportError(error, "error-boundary", { componentStack: info.componentStack });
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
                    <Result
                        status="500"
                        title="Algo deu errado"
                        subTitle="O erro foi registrado e nossa equipe será notificada. Tente recarregar a página."
                        extra={
                            <Button type="primary" onClick={() => window.location.reload()}>
                                Recarregar
                            </Button>
                        }
                    />
                </div>
            );
        }
        return this.props.children;
    }
}
