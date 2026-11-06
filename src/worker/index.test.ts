import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("API: rotas inexistentes", () => {
  it("/api/rota-inexistente responde 404 em JSON", async () => {
    const res = await exports.default.fetch(
      "http://localhost/api/rota-inexistente",
    );

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({
      ok: false,
      erro: "Rota não encontrada",
    });
  });
});
