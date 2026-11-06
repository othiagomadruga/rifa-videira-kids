import { Hono } from "hono";
import { health } from "./routes/health";

// API do sistema. O Worker só recebe /api/* (assets.run_worker_first no
// wrangler.jsonc); o resto é o site React, servido pelos Static Assets.
const app = new Hono<{ Bindings: Cloudflare.Env }>();

app.route("/api/health", health);

app.notFound((c) => c.json({ ok: false, erro: "Rota não encontrada" }, 404));

app.onError((erro, c) => {
  console.error(`${c.req.method} ${c.req.path}: erro não tratado`, erro);
  return c.json({ ok: false, erro: "Erro interno" }, 500);
});

export default app;
