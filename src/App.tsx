import { Authenticated, Refine } from "@refinedev/core";
import { PolattoLogo } from "./components/polatto-logo";
import { DevtoolsPanel, DevtoolsProvider } from "@refinedev/devtools";
import {
    AuthPage,
    ErrorComponent,
    ThemedLayout,
    ThemedSider,
    useNotificationProvider,
} from "@refinedev/antd";
import "@refinedev/antd/dist/reset.css";

import routerProvider, {
    CatchAllNavigate,
    DocumentTitleHandler,
    NavigateToResource,
    UnsavedChangesNotifier,
} from "@refinedev/react-router";
import { dataProvider, liveProvider } from "@refinedev/supabase";
import { App as AntdApp, Button, Spin } from "antd";
import { lazy, Suspense } from "react";
import { BrowserRouter, Outlet, Route, Routes, Link } from "react-router";

import {
    BankOutlined,
    BarChartOutlined,
    CalendarOutlined,
    ContactsOutlined,
    DashboardOutlined,
    LineChartOutlined,
    ProjectOutlined,
    RiseOutlined,
    TeamOutlined,
    SettingOutlined,
    UsergroupAddOutlined,
    ProfileOutlined,
    FlagOutlined,
} from "@ant-design/icons";

import authProvider from "./authProvider";
import { i18nProvider } from "./i18n/ptBR";
import { Header } from "./components/header";
import { RouteErrorBoundary } from "./components/route-error-boundary";
import { ColorModeContextProvider } from "./contexts/color-mode";
import { RequireTenant, TenantProvider } from "./contexts/tenant";
import { supabaseClient } from "./utility";
import { comPaginacaoCompleta } from "./lib/dataProviderPaginado";

// Telas carregadas sob demanda: o usuário baixa o código de uma tela só
// quando abre aquela tela (antes, todas iam no bundle inicial).
const DashboardPage = lazy(() => import("./pages/dashboard").then((m) => ({ default: m.DashboardPage })));
const ClienteList = lazy(() => import("./pages/clientes/list").then((m) => ({ default: m.ClienteList })));
const ClienteCreate = lazy(() => import("./pages/clientes/create").then((m) => ({ default: m.ClienteCreate })));
const ClienteEdit = lazy(() => import("./pages/clientes/edit").then((m) => ({ default: m.ClienteEdit })));
const ClienteShow = lazy(() => import("./pages/clientes/show").then((m) => ({ default: m.ClienteShow })));
const AgendaPage = lazy(() => import("./pages/agenda").then((m) => ({ default: m.AgendaPage })));
const BaseClientesPage = lazy(() => import("./pages/base-clientes").then((m) => ({ default: m.BaseClientesPage })));
const ConfiguracoesPage = lazy(() => import("./pages/configuracoes").then((m) => ({ default: m.ConfiguracoesPage })));
const OrganizacoesPage = lazy(() => import("./pages/organizacoes").then((m) => ({ default: m.OrganizacoesPage })));
const PessoasPage = lazy(() => import("./pages/pessoas").then((m) => ({ default: m.PessoasPage })));
const HistoricoPage = lazy(() => import("./pages/historico").then((m) => ({ default: m.HistoricoPage })));
const InsightsPanelPage = lazy(() => import("./pages/insights/panel").then((m) => ({ default: m.InsightsPanelPage })));
const InsightsROIPage = lazy(() => import("./pages/insights/roi").then((m) => ({ default: m.InsightsROIPage })));
const InsightsGainsLossesPage = lazy(() =>
    import("./pages/insights/gains-losses").then((m) => ({ default: m.InsightsGainsLossesPage })),
);
const InsightsActivitiesPage = lazy(() =>
    import("./pages/insights/activities").then((m) => ({ default: m.InsightsActivitiesPage })),
);
const InsightsActivityLogPage = lazy(() =>
    import("./pages/insights/activity-log").then((m) => ({ default: m.InsightsActivityLogPage })),
);
const InsightsEmployeesPage = lazy(() =>
    import("./pages/insights/employees").then((m) => ({ default: m.InsightsEmployeesPage })),
);
const InsightsGoalsPage = lazy(() => import("./pages/insights/goals").then((m) => ({ default: m.InsightsGoalsPage })));

const CustomTitle = ({ collapsed }: { collapsed?: boolean }) => (
    <div className={`crm-sider-brand ${collapsed ? "crm-sider-brand--collapsed" : ""}`}>
        <PolattoLogo collapsed={collapsed} variant="sidebar" size="sm" />
    </div>
);

const CarregandoTela = () => (
    <div style={{ display: "grid", placeItems: "center", padding: 64 }}>
        <Spin size="large" />
    </div>
);

// Paginação "off" passa a trazer todas as linhas (ver dataProviderPaginado).
const dataProviderCrm = comPaginacaoCompleta(dataProvider(supabaseClient));

function App() {
    return (
        <BrowserRouter>
            <ColorModeContextProvider>
                <AntdApp>
                    <DevtoolsProvider>
                        <Refine
                            dataProvider={dataProviderCrm}
                            liveProvider={liveProvider(supabaseClient)}
                            authProvider={authProvider}
                            routerProvider={routerProvider}
                            notificationProvider={useNotificationProvider}
                            i18nProvider={i18nProvider}
                            resources={[
                                {
                                    name: "dashboard",
                                    list: "/",
                                    meta: { label: "Dashboard", icon: <DashboardOutlined /> },
                                },
                                {
                                    name: "clientes",
                                    list: "/clientes",
                                    create: "/clientes/create",
                                    edit: "/clientes/edit/:id",
                                    show: "/clientes/show/:id",
                                    meta: { canDelete: true, label: "Oportunidades", icon: <ProjectOutlined /> },
                                },
                                {
                                    name: "agenda",
                                    list: "/agenda",
                                    meta: { label: "Agenda", icon: <CalendarOutlined /> },
                                },
                                {
                                    name: "base_clientes",
                                    list: "/base-clientes",
                                    meta: { label: "Base de Clientes", icon: <TeamOutlined /> },
                                },
                                {
                                    name: "organizacoes",
                                    list: "/organizacoes",
                                    meta: { canDelete: true, label: "Organizações", icon: <BankOutlined /> },
                                },
                                {
                                    name: "pessoas",
                                    list: "/pessoas",
                                    meta: { canDelete: true, label: "Contatos", icon: <ContactsOutlined /> },
                                },
                                {
                                    name: "historico",
                                    list: "/historico",
                                    meta: { label: "Histórico", icon: <ProfileOutlined /> },
                                },
                                {
                                    name: "funcionarios",
                                    list: "/equipe",
                                    meta: { label: "Equipe", icon: <UsergroupAddOutlined /> },
                                },
                                {
                                    name: "metas",
                                    list: "/metas",
                                    meta: { label: "Metas", icon: <FlagOutlined /> },
                                },
                                {
                                    name: "insights",
                                    list: "/insights",
                                    meta: { label: "Relatórios", icon: <BarChartOutlined /> },
                                },
                                {
                                    name: "insights_panel",
                                    list: "/insights/painel",
                                    meta: { label: "Painel", parent: "insights", icon: <DashboardOutlined /> },
                                },
                                {
                                    name: "insights_roi",
                                    list: "/insights/roi",
                                    meta: { label: "ROI", parent: "insights", icon: <LineChartOutlined /> },
                                },
                                {
                                    name: "insights_gains_losses",
                                    list: "/insights/gains-losses",
                                    meta: { label: "Ganhos e perdas", parent: "insights", icon: <RiseOutlined /> },
                                },
                                {
                                    name: "insights_activities",
                                    list: "/insights/activities",
                                    meta: { label: "Atividades", parent: "insights", icon: <CalendarOutlined /> },
                                },
                                {
                                    name: "insights_logs",
                                    list: "/insights/logs",
                                    meta: { label: "Logs", parent: "insights", icon: <ProfileOutlined /> },
                                },
                                { name: "atividades_lead" },
                                { name: "tarefas" },
                                { name: "pipeline_stages" },
                                { name: "cliente_status_history" },
                                { name: "pipelines" },
                                { name: "custom_fields" },
                                { name: "motivos_perda" },
                                { name: "tipos_atividade" },
                                { name: "negocios" },
                                { name: "tenant_features" },
                            ]}
                            options={{ syncWithLocation: true, warnWhenUnsavedChanges: true, projectId: "XZv4yn-qFPddw-0qWPSU" }}
                        >
                            <TenantProvider>
                                <Routes>
                                    <Route
                                        element={
                                            <Authenticated key="authenticated-inner" fallback={<CatchAllNavigate to="/login" />}>
                                                <RequireTenant>
                                                    <ThemedLayout
                                                        Header={Header}
                                                        Title={CustomTitle}
                                                        Sider={(props) => (
                                                            <ThemedSider
                                                                {...props}
                                                                fixed
                                                                Title={CustomTitle}
                                                                render={({ items, logout, collapsed }) => (
                                                                    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                                                                        <div className="crm-sider-nav">{items}</div>
                                                                        <div className="crm-sider-footer">
                                                                            <Link to="/configuracoes">
                                                                                <Button
                                                                                    type="text"
                                                                                    icon={<SettingOutlined />}
                                                                                    aria-label="Configurações"
                                                                                    className={
                                                                                        collapsed
                                                                                            ? "crm-sider-settings crm-sider-settings-collapsed"
                                                                                            : "crm-sider-settings"
                                                                                    }
                                                                                >
                                                                                    {!collapsed && <span>Configurações</span>}
                                                                                </Button>
                                                                            </Link>
                                                                            <div>{logout}</div>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            />
                                                        )}
                                                    >
                                                        <RouteErrorBoundary>
                                                            <Suspense fallback={<CarregandoTela />}>
                                                                <Outlet />
                                                            </Suspense>
                                                        </RouteErrorBoundary>
                                                    </ThemedLayout>
                                                </RequireTenant>
                                            </Authenticated>
                                        }
                                    >
                                        <Route index element={<DashboardPage />} />
                                        <Route path="/configuracoes" element={<ConfiguracoesPage />} />

                                        <Route path="/equipe" element={<InsightsEmployeesPage />} />
                                        <Route path="/metas" element={<InsightsGoalsPage />} />

                                        <Route path="/clientes">
                                            <Route index element={<ClienteList />} />
                                            <Route path="create" element={<ClienteCreate />} />
                                            <Route path="edit/:id" element={<ClienteEdit />} />
                                            <Route path="show/:id" element={<ClienteShow />} />
                                        </Route>
                                        <Route path="/agenda" element={<AgendaPage />} />
                                        <Route path="/base-clientes" element={<BaseClientesPage />} />
                                        <Route path="/organizacoes" element={<OrganizacoesPage />} />
                                        <Route path="/pessoas" element={<PessoasPage />} />
                                        <Route path="/historico" element={<HistoricoPage />} />
                                        <Route path="/insights" element={<InsightsPanelPage />} />
                                        <Route path="/insights/painel" element={<InsightsPanelPage />} />
                                        <Route path="/insights/roi" element={<InsightsROIPage />} />
                                        <Route path="/insights/gains-losses" element={<InsightsGainsLossesPage />} />
                                        <Route path="/insights/activities" element={<InsightsActivitiesPage />} />
                                        <Route path="/insights/logs" element={<InsightsActivityLogPage />} />
                                        <Route path="*" element={<ErrorComponent />} />
                                    </Route>

                                    {/* Destino do link "Esqueceu a senha?" (authProvider.forgotPassword).
                                        A rota não existia: o usuário clicava no e-mail de recuperação e
                                        caía numa página 404, sem como trocar a senha. Fica fora dos dois
                                        grupos porque o link já autentica a sessão de recuperação. */}
                                    <Route
                                        path="/update-password"
                                        element={<AuthPage type="updatePassword" title={<PolattoLogo variant="login" size="lg" />} />}
                                    />

                                    <Route
                                        element={
                                            <Authenticated key="authenticated-outer" fallback={<Outlet />}>
                                                <NavigateToResource />
                                            </Authenticated>
                                        }
                                    >
                                        <Route path="/login" element={<AuthPage type="login" title={<PolattoLogo variant="login" size="lg" />} />} />
                                        <Route path="/register" element={<AuthPage type="register" title={<PolattoLogo variant="login" size="lg" />} />} />
                                        <Route path="/forgot-password" element={<AuthPage type="forgotPassword" title={<PolattoLogo variant="login" size="lg" />} />} />
                                    </Route>
                                </Routes>
                            </TenantProvider>
                            <UnsavedChangesNotifier />
                            <DocumentTitleHandler />
                        </Refine>
                        <DevtoolsPanel />
                    </DevtoolsProvider>
                </AntdApp>
            </ColorModeContextProvider>
        </BrowserRouter>
    );
}

export default App;
