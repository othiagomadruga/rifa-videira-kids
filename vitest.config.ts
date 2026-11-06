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
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations(pastaMigracoes),
                // Segredo do webhook da Rifei nos testes (valor fictício; em dev vem do .dev.vars).
                RIFEI_WEBHOOK_TOKEN: "token-ficticio-dos-testes-do-webhook",
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
        plugins: [react()],
        test: {
          name: "web",
          environment: "jsdom",
          include: ["src/web/**/*.test.{ts,tsx}", "src/shared/**/*.test.ts"],
          setupFiles: ["./src/web/test/setup.ts"],
        },
      },
    ],
  },
});
