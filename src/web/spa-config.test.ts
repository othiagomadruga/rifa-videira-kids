// @vitest-environment node
// O fallback de SPA e o roteamento de /api/* são feitos pelos Workers Static
// Assets (na Cloudflare e no Miniflare local) a partir do wrangler.jsonc. Este
// teste garante que a configuração lida pelo wrangler é a esperada.
import { unstable_readConfig } from "wrangler";
import { describe, expect, it } from "vitest";

describe("wrangler.jsonc: site servido como SPA pelo mesmo Worker", () => {
  // Caminho relativo à raiz do projeto (de onde o `npm test` roda o Vitest).
  const config = unstable_readConfig({ config: "wrangler.jsonc" });

  it("rota desconhecida do site devolve o index.html", () => {
    expect(config.assets?.not_found_handling).toBe("single-page-application");
  });

  it("/api e /api/* vão para o Worker antes dos assets", () => {
    expect(config.assets?.run_worker_first).toEqual(["/api", "/api/*"]);
  });

  it("tem o D1 no binding DB com as migrações em migrations/", () => {
    expect(config.d1_databases).toEqual([
      expect.objectContaining({
        binding: "DB",
        database_name: "rifa-videira-kids",
        migrations_dir: "migrations",
      }),
    ]);
  });
});
