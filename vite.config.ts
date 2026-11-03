import react from "@vitejs/plugin-react";
import { readFileSync } from "fs";
import path from "path";
import { defineConfig } from "vite";

type ServeHeaderRule = { source: string; headers: Array<{ key: string; value: string }> };

/**
 * Cabeçalhos de segurança de produção (CSP, X-Frame-Options...) lidos de
 * public/serve.json — a mesma fonte usada pelo container (serve) e espelhada
 * no public/.htaccess (Hostinger). O `vite preview` também os aplica, para
 * que a CSP seja testada localmente antes do deploy. O dev server NÃO usa:
 * o HMR do Vite depende de script inline.
 */
const productionSecurityHeaders = (): Record<string, string> => {
    const config = JSON.parse(
        readFileSync(path.resolve(__dirname, "public/serve.json"), "utf8"),
    ) as { headers: ServeHeaderRule[] };
    const global = config.headers.find((rule) => rule.source === "**");
    return Object.fromEntries((global?.headers ?? []).map((h) => [h.key, h.value]));
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  preview: {
    headers: productionSecurityHeaders(),
  },
  build: {
    // Divide dependências pesadas em chunks próprios: melhora cache do
    // navegador entre deploys e reduz o bundle inicial.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router"],
          antd: ["antd", "@ant-design/icons"],
          refine: [
            "@refinedev/core",
            "@refinedev/antd",
            "@refinedev/supabase",
            "@refinedev/react-router",
          ],
        },
      },
    },
  },
});
