import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `vite dev` roda o Worker (wrangler.jsonc) no workerd junto com o site React;
// `vite build` gera dist/client (site) e dist/rifa_videira_kids (Worker).
export default defineConfig({
  plugins: [react(), cloudflare()],
});
