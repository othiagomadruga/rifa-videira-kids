import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `vite dev` roda o Worker (wrangler.jsonc) no workerd junto com o site React;
// `vite build` gera dist/client (site) e dist/rifa_videira_kids (Worker).
export default defineConfig({
  plugins: [react(), cloudflare()],
  build: {
    // O aviso de pedaço grande passa de 500 para 600 kB por causa de um pedaço só: o do pdf.js (RIFA-068, ~500 kB,
    // ~150 kB em gzip), carregado só quando a pessoa escolhe um PDF na conferência do extrato. O pacote inicial
    // (~400 kB) continua bem abaixo; o peso de cada pedaço vai no relatório da tarefa (D26).
    chunkSizeWarningLimit: 600,
  },
});
