import React from "react";
import { createRoot } from "react-dom/client";
import dayjs from "dayjs";
import "dayjs/locale/pt-br";

import App from "./App";
import { AppErrorBoundary } from "./components/error-boundary";
import { installErrorMonitoring } from "./utility/errorMonitoring";
import "./styles/premium-theme.css";

// Datas, meses e dias da semana em português (calendário, "03 de novembro").
dayjs.locale("pt-br");

installErrorMonitoring();

const container = document.getElementById("root") as HTMLElement;
const root = createRoot(container);

root.render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
