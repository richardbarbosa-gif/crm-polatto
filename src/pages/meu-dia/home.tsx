import { Spin } from "antd";
import { lazy, Suspense } from "react";
import { Navigate } from "react-router";
import { useCrmAccess } from "../../hooks/useCrmAccess";
import { CHAVE_INICIO_MEU_DIA, deveAbrirMeuDia } from "../../lib/meuDia";

const DashboardPage = lazy(() => import("../dashboard").then((m) => ({ default: m.DashboardPage })));

const lerFlag = (): boolean => {
    try {
        return window.sessionStorage.getItem(CHAVE_INICIO_MEU_DIA) === "1";
    } catch {
        return true; // storage bloqueado: não força redirecionamento
    }
};

/**
 * Página inicial ("/"): o gerente vê o Dashboard; o vendedor é levado ao
 * Meu dia na primeira vez da sessão e depois pode abrir o Dashboard pelo
 * menu normalmente.
 */
export const HomePage = () => {
    const { isGerente, isLoadingAccess } = useCrmAccess();

    if (isLoadingAccess) {
        return (
            <div style={{ display: "grid", placeItems: "center", padding: 64 }}>
                <Spin size="large" />
            </div>
        );
    }

    if (deveAbrirMeuDia({ isGerente, jaAbriuNestaSessao: lerFlag() })) {
        // A marca é gravada pelo próprio Meu dia ao abrir (efeito, não render)
        return <Navigate to="/meu-dia" replace />;
    }

    return (
        <Suspense fallback={null}>
            <DashboardPage />
        </Suspense>
    );
};
