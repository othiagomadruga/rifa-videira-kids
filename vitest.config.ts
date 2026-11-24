import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const pastaMigracoes = fileURLToPath(new URL("./migrations", import.meta.url));

export default defineConfig({
  test: {
    projects: [
      {
        // Testes do Worker: rodam no workerd com o D1 local (em memória).
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              // D1 só dos testes, vazio no início de cada arquivo: a 0006 e a 0007 aplicadas sobre dados gravados
              // com as migrações anteriores (src/worker/test/migrations.test.ts) e a 0004 aplicada depois da 0007
              // (src/worker/test/migracao-0004-depois.test.ts). Soma-se ao DB do wrangler.jsonc.
              d1Databases: ["DB_MIGRACAO"],
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations(pastaMigracoes),
                // Segredo do webhook da Rifei nos testes (valor fictício; em dev vem do .dev.vars).
                RIFEI_WEBHOOK_TOKEN: "token-ficticio-dos-testes-do-webhook",
                // RIFA-091: sem token da API da Rifei nos testes, mesmo com um .dev.vars de dev: nenhum teste chama a
                // Rifei de verdade (a atribuição de célula a chama sozinha; os testes da Rifei passam o env próprio).
                RIFEI_API_TOKEN: "",
              },
            },
          })),
        ],
        test: {
          name: "worker",
          include: ["src/worker/**/*.test.ts"],
          setupFiles: ["./src/worker/test/apply-migrations.ts"],
        },
      },
      {
        // Testes do site (e do código compartilhado): jsdom + Testing Library.
        // scripts/ (Node) entra aqui com `// @vitest-environment node` no arquivo de teste.
        plugins: [react()],
        test: {
          name: "web",
          environment: "jsdom",
          include: [
            "src/web/**/*.test.{ts,tsx}",
            "src/shared/**/*.test.ts",
            "scripts/**/*.test.mjs",
          ],
          setupFiles: ["./src/web/test/setup.ts"],
        },
      },
    ],
  },
});
