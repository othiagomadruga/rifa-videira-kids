import { Hono } from "hono";

export const health = new Hono<{ Bindings: Cloudflare.Env }>();

// GET /api/health: confirma que o Worker está no ar e que o D1 responde
// (lendo a tabela _meta, criada pela migração 0000).
health.get("/", async (c) => {
  const inicio = Date.now();
  try {
    await c.env.DB.prepare("SELECT COUNT(*) AS total FROM _meta").first();
  } catch (erro) {
    console.error("GET /api/health: falha ao consultar o D1", erro);
    return c.json(
      { ok: false, db: "erro", erro: "Falha ao consultar o banco de dados" },
      503,
    );
  }
  return c.json({ ok: true, db: "ok", latenciaMs: Date.now() - inicio });
});
