import React from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { AppErrorBoundary } from "./components/error-boundary";
import { installErrorMonitoring } from "./utility/errorMonitoring";
import "./styles/premium-theme.css";

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
