import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
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
