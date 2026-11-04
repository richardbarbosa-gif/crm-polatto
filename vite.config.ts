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
    //
    // Por CAMINHO do módulo, não por nome de pacote: com a forma de objeto,
    // o Rollup >= 4.55 passou a colocar o corpo CommonJS do React
    // (react/cjs/*) dentro do chunk "refine", criando import circular
    // react <-> refine e tela branca ("Cannot set properties of undefined
    // (setting 'Activity')"). Casando pelo caminho, todo arquivo do pacote
    // vai para o chunk dele e o grafo fica acíclico.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/.test(id)) {
            return "react";
          }
          if (/[\\/]node_modules[\\/](antd|@ant-design[\\/]icons)[\\/]/.test(id)) {
            return "antd";
          }
          if (/[\\/]node_modules[\\/]@refinedev[\\/](core|antd|supabase|react-router)[\\/]/.test(id)) {
            return "refine";
          }
          return undefined;
        },
      },
    },
  },
});
