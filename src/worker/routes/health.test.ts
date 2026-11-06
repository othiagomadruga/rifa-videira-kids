import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../index";

describe("GET /api/health", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("responde 200 com db ok depois de consultar o D1", async () => {
    const res = await exports.default.fetch("http://localhost/api/health");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({
      ok: true,
      db: "ok",
      latenciaMs: expect.any(Number),
    });
  });

  it("responde 503 banco_indisponivel no formato único quando o D1 falha", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const dbComFalha = {
      prepare: () => {
        throw new Error("D1 indisponível");
      },
    } as unknown as D1Database;

    const res = await app.request(
      "/api/health",
      {},
      { ...env, DB: dbComFalha },
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      erro: {
        codigo: "banco_indisponivel",
        mensagem: "Falha ao consultar o banco de dados",
      },
    });
    expect(consoleError).toHaveBeenCalledOnce();
  });
});
