import { Authenticated, Refine } from "@refinedev/core";
import { PolattoLogo } from "./components/polatto-logo";
import { DevtoolsPanel, DevtoolsProvider } from "@refinedev/devtools";
import { RefineKbar, RefineKbarProvider } from "@refinedev/kbar";
import { ChatPlaceholderPage } from "./pages/chat";
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
import { App as AntdApp, Button } from "antd";
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
    FlagOutlined,
    MessageOutlined,
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

import {
    InsightsActivitiesPage,
    InsightsActivityLogPage,
    InsightsEmployeesPage,
    InsightsGainsLossesPage,
    InsightsGoalsPage,
    InsightsPanelPage,
    InsightsROIPage,
} from "./pages/insights";

const CustomTitle = ({ collapsed }: { collapsed?: boolean }) => (
    <div className={`crm-sider-brand ${collapsed ? "crm-sider-brand--collapsed" : ""}`}>
        <PolattoLogo collapsed={collapsed} variant="sidebar" size="sm" />
    </div>
);

function App() {
    return (
        <BrowserRouter>
            <RefineKbarProvider>
                <ColorModeContextProvider>
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
                                    {
    name: "chat",
    list: "/chat",
    meta: { label: "Chat", icon: <MessageOutlined /> },
},
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
                                                            Title={CustomTitle} // <-- INJETAMOS AQUI PARA MATAR O BUG!
                                                            Sider={(props) => (
                                                                <ThemedSider
                                                                    {...props}
                                                                    fixed
                                                                    Title={CustomTitle} // <-- E AQUI TAMBÉM!
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
                                            <Route path="/chat" element={<ChatPlaceholderPage />} />
                                            <Route path="*" element={<ErrorComponent />} />
                                        </Route>

                                        <Route
                                            element={
                                                <Authenticated key="authenticated-outer" fallback={<Outlet />}>
                                                    <NavigateToResource />
                                                </Authenticated>
                                            }
                                        >
                                           <Route path="/login" element={<AuthPage type="login" title={<PolattoLogo variant="login" size="lg" />} />} />
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
                </ColorModeContextProvider>
            </RefineKbarProvider>
        </BrowserRouter>
    );
}

export default App;