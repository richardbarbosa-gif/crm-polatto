import { Authenticated, Refine } from "@refinedev/core";
import { DevtoolsPanel, DevtoolsProvider } from "@refinedev/devtools";
import { RefineKbar, RefineKbarProvider } from "@refinedev/kbar";
import { AgendaPage } from "./pages/agenda";

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
import { App as AntdApp, ConfigProvider } from "antd";
import { BrowserRouter, Outlet, Route, Routes } from "react-router";
import authProvider from "./authProvider";
import { Header } from "./components/header";
import { ColorModeContextProvider } from "./contexts/color-mode";
import {
  BlogPostCreate,
  BlogPostEdit,
  BlogPostList,
  BlogPostShow,
} from "./pages/blog-posts";
import { supabaseClient } from "./utility";

// --- IMPORTAÇÃO DO DASHBOARD ---
import { DashboardPage } from "./pages/dashboard";
import { 
    DashboardOutlined, 
    ProjectOutlined, 
    CalendarOutlined, 
    TeamOutlined 
} from "@ant-design/icons";

function App() {
  return (
    <BrowserRouter>
      <RefineKbarProvider>
        <ColorModeContextProvider>
          <ConfigProvider
            theme={{
              token: {
                colorPrimary: "#001529", // Azul Polatto
              },
              components: {
                Layout: {
                  headerBg: "#001529",
                  siderBg: "#001529",
                  triggerBg: "#001529",
                  bodyBg: "#f0f2f5",
                },
                Menu: {
                  itemBg: "#001529",
                  subMenuItemBg: "#001529",
                  itemColor: "#ffffff",
                  itemHoverColor: "#FFD700",
                  itemSelectedColor: "#FFD700",
                  itemSelectedBg: "rgba(255, 215, 0, 0.1)",
                  iconSize: 18,
                }
              }
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
                        meta: {
                            label: "Dashboard",
                            icon: <DashboardOutlined />,
                        },
                    },
                    {
                      name: "clientes",
                      list: "/clientes",
                      create: "/clientes/create",
                      edit: "/clientes/edit/:id",
                      show: "/clientes/show/:id",
                      meta: {
                        canDelete: true,
                        label: "Oportunidades",
                        icon: <ProjectOutlined />,
                      },
                    },
                    {
                        name: "agenda",
                        list: "/agenda",
                        meta: {
                            label: "Agenda",
                            icon: <CalendarOutlined />
                        }
                    },
                    {
                        name: "base_clientes",
                        list: "/base-clientes",
                        meta: {
                            label: "Base de Clientes",
                            icon: <TeamOutlined />
                        }
                    }
                  ]}
                  options={{
                    syncWithLocation: true,
                    warnWhenUnsavedChanges: true,
                    projectId: "XZv4yn-qFPddw-0qWPSU",
                  }}
                >
                  <Routes>
                    <Route
                      element={
                        <Authenticated
                          key="authenticated-inner"
                          fallback={<CatchAllNavigate to="/login" />}
                        >
                          <ThemedLayout
                            Header={Header}
                            Sider={(props) => (
                                <ThemedSider
                                    {...props}
                                    fixed
                                    Title={({ collapsed }) => (
                                        <div style={{
                                            display: "flex",
                                            justifyContent: "center",
                                            alignItems: "center",
                                            margin: "-16px",
                                            width: "calc(100% + 32px)", 
                                            height: "64px",
                                            backgroundColor: "#001529",
                                            overflow: "hidden"
                                        }}>
                                            <img
                                                src="/logo.png"
                                                alt="Polatto"
                                                style={{
                                                    width: collapsed ? "40px" : "100%", 
                                                    height: "100%",
                                                    objectFit: "cover",
                                                    transition: "all 0.3s ease"
                                                }}
                                            />
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
                      {/* ROTA PRINCIPAL */}
                      <Route index element={<DashboardPage />} />

                      <Route path="/clientes">
                        <Route index element={<BlogPostList />} />
                        <Route path="create" element={<BlogPostCreate />} />
                        <Route path="edit/:id" element={<BlogPostEdit />} />
                        <Route path="show/:id" element={<BlogPostShow />} />
                      </Route>

                      <Route path="/agenda" element={<AgendaPage />} />
                      <Route path="/base-clientes" element={<div style={{padding: 20}}><h1>👥 Base de Clientes em Breve</h1></div>} />

                      <Route path="*" element={<ErrorComponent />} />
                    </Route>
                    
                    <Route
                      element={
                        <Authenticated
                          key="authenticated-outer"
                          fallback={<Outlet />}
                        >
                          <NavigateToResource />
                        </Authenticated>
                      }
                    >
                      <Route
                        path="/login"
                        element={
                          <AuthPage
                            type="login"
                            title={
                                <div style={{ display: "flex", justifyContent: "center", marginBottom: "24px" }}>
                                    <img src="/logo.png" alt="Polatto" style={{ width: "250px" }} />
                                </div>
                             }
                            formProps={{
                              initialValues: { email: "info@refine.dev", password: "refine-supabase" },
                            }}
                          />
                        }
                      />
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