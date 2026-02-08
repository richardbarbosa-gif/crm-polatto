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

function App() {
  return (
    <BrowserRouter>
      <RefineKbarProvider>
        <ColorModeContextProvider>
          <ConfigProvider
            theme={{
              token: {
                colorPrimary: "#001529", // Azul Polatto Base
              },
              components: {
                // Configuração Global de Cores
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
                      name: "clientes",
                      list: "/clientes",
                      create: "/clientes/create",
                      edit: "/clientes/edit/:id",
                      show: "/clientes/show/:id",
                      meta: {
                        canDelete: true,
                        label: "Clientes",
                      },
                    },
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
                                            // O TRUQUE ESTÁ AQUI:
                                            // 1. Margem negativa para 'comer' o espaço em branco lateral
                                            margin: "-16px", 
                                            // 2. Largura compensada (100% + o que tiramos da margem)
                                            width: "calc(100% + 32px)", 
                                            // 3. Altura fixa do cabeçalho
                                            height: "64px",
                                            backgroundColor: "#001529",
                                            overflow: "hidden" // Garante que nada saia para fora
                                        }}>
                                            <img
                                                src="/logo.png"
                                                alt="Polatto"
                                                style={{
                                                    // Agora o logo pode ocupar todo o espaço disponível
                                                    width: collapsed ? "40px" : "100%", 
                                                    height: "100%",
                                                    // 'cover' faz a imagem preencher tudo sem deixar buraco (pode cortar pontinhas)
                                                    // 'contain' mostra a imagem inteira (pode sobrar espaço se a proporção for diferente)
                                                    // Teste com 'cover' se o fundo do logo for igual ao azul do menu
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
                      <Route
                        index
                        element={<NavigateToResource resource="clientes" />}
                      />
                      <Route path="/clientes">
                        <Route index element={<BlogPostList />} />
                        <Route path="create" element={<BlogPostCreate />} />
                        <Route path="edit/:id" element={<BlogPostEdit />} />
                        <Route path="show/:id" element={<BlogPostShow />} />
                      </Route>

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
                                    <img
                                        src="/logo.png"
                                        alt="Polatto Energia Solar"
                                        style={{ width: "250px" }}
                                    />
                                </div>
                            }
                            formProps={{
                              initialValues: {
                                email: "info@refine.dev",
                                password: "refine-supabase",
                              },
                            }}
                          />
                        }
                      />
                      <Route
                        path="/register"
                        element={<AuthPage type="register" />}
                      />
                      <Route
                        path="/forgot-password"
                        element={<AuthPage type="forgotPassword" />}
                      />
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