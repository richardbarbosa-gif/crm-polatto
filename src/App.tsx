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
                                colorPrimary: "#4c8bf5", 
                                colorInfo: "#4c8bf5",
                                colorSuccess: "#10b981", 
                                colorWarning: "#f59e0b",
                                colorError: "#ef4444",
                                borderRadius: 8, 
                                fontFamily: "'Inter', 'Segoe UI', sans-serif",
                            },
                            components: {
                                Layout: {
                                    headerBg: "#ffffff", 
                                    siderBg: "#0f172a", 
                                    triggerBg: "#0f172a",
                                    bodyBg: "#f8fafc", 
                                },
                                Menu: {
                                    itemBg: "#0f172a",
                                    subMenuItemBg: "#0f172a",
                                    itemColor: "#94a3b8", 
                                    itemHoverColor: "#ffffff",
                                    itemSelectedColor: "#ffffff",
                                    itemSelectedBg: "#1e293b", 
                                    iconSize: 18,
                                },
                                Button: { borderRadius: 8 },
                                Card: { borderRadiusLG: 12 },
                                Input: { borderRadius: 6 },
                                Select: { borderRadius: 6 },
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
                                    <Routes>
                                        <Route
                                            element={
                                                <Authenticated key="authenticated-inner" fallback={<CatchAllNavigate to="/login" />}>
                                                    <ThemedLayout
                                                        Header={Header}
                                                        Sider={(props) => (
                                                            <ThemedSider
                                                                {...props}
                                                                fixed
                                                                Title={({ collapsed }) => (
                                                                    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", margin: "-16px", width: "calc(100% + 32px)", height: "64px", backgroundColor: "#0f172a", overflow: "hidden" }}>
                                                                        <img src="/logo.png" alt="Polatto" style={{ width: collapsed ? "40px" : "100%", height: "100%", objectFit: "cover", transition: "all 0.3s ease" }} />
                                                                    </div>
                                                                )}
                                                                render={({ items, logout, collapsed }) => (
                                                                    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                                                                        <div style={{ flex: 1, overflowY: "auto" }}>{items}</div>
                                                                        <div style={{ padding: "16px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                                                                            <Link to="/configuracoes">
                                                                                <Button type="text" icon={<SettingOutlined style={{ color: "#94a3b8" }} />} style={{ width: "100%", color: "#94a3b8", textAlign: collapsed ? "center" : "left", display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "flex-start", padding: collapsed ? "0" : "4px 15px", marginBottom: "8px" }}>
                                                                                    {!collapsed && <span style={{ marginLeft: "10px" }}>Configurações</span>}
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