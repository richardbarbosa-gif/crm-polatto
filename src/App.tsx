import { Authenticated, Refine } from "@refinedev/core";
import { DevtoolsPanel, DevtoolsProvider } from "@refinedev/devtools";
import { RefineKbar, RefineKbarProvider } from "@refinedev/kbar";
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
import { App as AntdApp, ConfigProvider, Button } from "antd";
import { BrowserRouter, Outlet, Route, Routes, Link } from "react-router";
import {
    BarChartOutlined,
    CalendarOutlined,
    DashboardOutlined,
    LineChartOutlined,
    ProjectOutlined,
    RiseOutlined,
    TeamOutlined,
    SettingOutlined,
    UsergroupAddOutlined,
    ProfileOutlined,
    FlagOutlined
} from "@ant-design/icons";

import authProvider from "./authProvider";
import { Header } from "./components/header";
import { ColorModeContextProvider } from "./contexts/color-mode";
import { RequireTenant, TenantProvider } from "./contexts/tenant";
import { AgendaPage } from "./pages/agenda";
import { BaseClientesPage } from "./pages/base-clientes";
import { ClienteCreate, ClienteEdit, ClienteList, ClienteShow } from "./pages/clientes";
import { DashboardPage } from "./pages/dashboard";
import { ConfiguracoesPage } from "./pages/configuracoes";
import { supabaseClient } from "./utility";

// Importando todas as páginas originais que você já tem
import {
    InsightsActivitiesPage,
    InsightsActivityLogPage,
    InsightsEmployeesPage,
    InsightsGainsLossesPage,
    InsightsGoalsPage,
    InsightsPanelPage,
    InsightsROIPage,
} from "./pages/insights";

function App() {
    return (
        <BrowserRouter>
            <RefineKbarProvider>
                <ColorModeContextProvider>
                    <ConfigProvider
                        theme={{
                            token: {
                                colorPrimary: "#3b82f6",
                                colorPrimaryHover: "#2563eb",
                                colorPrimaryActive: "#1d4ed8",
                                colorInfo: "#3b82f6",
                                colorSuccess: "#10b981",
                                colorWarning: "#f59e0b",
                                colorError: "#ef4444",
                                colorText: "#0f172a",
                                colorTextSecondary: "#64748b",
                                colorBgLayout: "#f7f9fb",
                                colorBgContainer: "#ffffff",
                                colorBorder: "rgba(15,23,42,0.06)",
                                borderRadius: 10,
                                borderRadiusLG: 14,
                                fontFamily: "'Inter', -apple-system, 'Segoe UI', sans-serif",
                                fontSize: 14,
                                lineHeight: 1.55,
                                controlHeight: 36,
                            },
                            components: {
                                Layout: {
                                    headerBg: "#0a1120",
                                    siderBg: "#0a1120",
                                    triggerBg: "#0a1120",
                                    bodyBg: "#f7f9fb",
                                },
                                Menu: {
                                    itemBg: "transparent",
                                    subMenuItemBg: "transparent",
                                    itemColor: "rgba(148,163,184,0.85)",
                                    itemHoverColor: "#e2e8f0",
                                    itemSelectedColor: "#ffffff",
                                    itemSelectedBg: "rgba(255,255,255,0.07)",
                                    iconSize: 16,
                                },
                                Button: {
                                    borderRadius: 8,
                                    controlHeight: 36,
                                    fontWeight: 500,
                                },
                                Card: {
                                    borderRadiusLG: 14,
                                    paddingLG: 20,
                                },
                                Input: { borderRadius: 8, controlHeight: 36 },
                                Select: { borderRadius: 8, controlHeight: 36 },
                                Table: {
                                    headerBg: "#f7f9fb",
                                    headerColor: "#64748b",
                                    rowHoverBg: "rgba(248,250,252,0.7)",
                                },
                                Modal: {
                                    borderRadiusLG: 18,
                                },
                                Drawer: {
                                    colorBgElevated: "#ffffff",
                                },
                                Notification: {
                                    borderRadiusLG: 10,
                                },
                                Progress: {
                                    defaultColor: "#3b82f6",
                                },
                                Segmented: {
                                    borderRadius: 10,
                                },
                            },
                        }}
                    >
                        <AntdApp>
                            <DevtoolsProvider>
                                <Refine
                                    dataProvider={dataProvider(supabaseClient)}
                                    liveProvider={liveProvider(supabaseClient)}
                                    authProvider={authProvider}
                                    routerProvider={routerProvider}
                                    notificationProvider={useNotificationProvider}
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
                                        // AQUI A MÁGICA: Promovemos Equipe e Metas para o menu principal!
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
                                        // O menu de relatórios agora fica limpo
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
                                        // Invisíveis
                                        { name: "atividades_lead" },
                                        { name: "tarefas" },
                                        { name: "pipeline_stages" },
                                        { name: "cliente_status_history" }
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
                                                        Sider={(props) => (
                                                            <ThemedSider
                                                                {...props}
                                                                fixed
                                                                Title={({ collapsed }) => (
                                                                    <div className="crm-sider-brand">
                                                                        <img
                                                                            src="/logo.png"
                                                                            alt="Polatto"
                                                                            className={
                                                                                collapsed
                                                                                    ? "crm-sider-brand-logo crm-sider-brand-logo-collapsed"
                                                                                    : "crm-sider-brand-logo"
                                                                            }
                                                                        />
                                                                    </div>
                                                                )}
                                                                render={({ items, logout, collapsed }) => (
                                                                    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                                                                        <div className="crm-sider-nav">{items}</div>
                                                                        <div className="crm-sider-footer">
                                                                            <Link to="/configuracoes">
                                                                                <Button
                                                                                    type="text"
                                                                                    icon={<SettingOutlined />}
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
                                                            <Outlet />
                                                        </ThemedLayout>
                                                    </RequireTenant>
                                                </Authenticated>
                                            }
                                        >
                                            <Route index element={<DashboardPage />} />
                                            <Route path="/configuracoes" element={<ConfiguracoesPage />} />
                                            
                                            {/* Rotas conectadas às páginas que já existem! */}
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
                                            <Route path="/insights" element={<InsightsPanelPage />} />
                                            <Route path="/insights/painel" element={<InsightsPanelPage />} />
                                            <Route path="/insights/roi" element={<InsightsROIPage />} />
                                            <Route path="/insights/gains-losses" element={<InsightsGainsLossesPage />} />
                                            <Route path="/insights/activities" element={<InsightsActivitiesPage />} />
                                            <Route path="/insights/logs" element={<InsightsActivityLogPage />} />
                                            <Route path="*" element={<ErrorComponent />} />
                                        </Route>

                                        <Route
                                            element={
                                                <Authenticated key="authenticated-outer" fallback={<Outlet />}>
                                                    <NavigateToResource />
                                                </Authenticated>
                                            }
                                        >
                                            <Route path="/login" element={<AuthPage type="login" title={<div style={{ display: "flex", justifyContent: "center", marginBottom: "24px" }}><img src="/logo.png" alt="Polatto" style={{ width: "250px" }} /></div>} />} />
                                            <Route path="/register" element={<AuthPage type="register" />} />
                                            <Route path="/forgot-password" element={<AuthPage type="forgotPassword" />} />
                                        </Route>
                                        </Routes>
                                    </TenantProvider>
                                    <RefineKbar />
                                    <UnsavedChangesNotifier />
                                    <DocumentTitleHandler />
                                </Refine>
                                <DevtoolsPanel />
                            </DevtoolsProvider>
                        </AntdApp>
                    </ConfigProvider>
                </ColorModeContextProvider>
            </RefineKbarProvider>
        </BrowserRouter>
    );
}

export default App;
