import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { erroApiSchema } from "../shared/contracts";
import app from "./index";

describe("CA7: API responde erros no formato único", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(["/api/rota-inexistente", "/api", "/api/"])(
    "%s responde 404 nao_encontrado em JSON",
    async (caminho) => {
      const res = await exports.default.fetch(`http://localhost${caminho}`);

      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("application/json");
      const corpo: unknown = await res.json();
      expect(erroApiSchema.parse(corpo)).toEqual(corpo);
      expect(corpo).toEqual({
        erro: { codigo: "nao_encontrado", mensagem: "Rota não encontrada" },
      });
    },
  );

  it.each(["/api/webhooks/rifei", "/api/webhooks/rifei/"])(
    "método sem rota (GET em %s) também é 404 no formato único",
    async (caminho) => {
      const res = await exports.default.fetch(`http://localhost${caminho}`);

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        erro: { codigo: "nao_encontrado", mensagem: "Rota não encontrada" },
      });
    },
  );

  it("falha inesperada numa rota real (D1 fora do ar no webhook) vira 500 erro_interno", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const dbComFalha = {
      prepare: () => {
        throw new Error("D1 indisponível");
      },
    } as unknown as D1Database;

    const res = await app.request(
      "/api/webhooks/rifei",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RIFEI_WEBHOOK_TOKEN}` },
        body: "{}",
      },
      { ...env, DB: dbComFalha },
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      erro: { codigo: "erro_interno", mensagem: "Erro interno" },
    });
    expect(consoleError).toHaveBeenCalledOnce();
  });
});
