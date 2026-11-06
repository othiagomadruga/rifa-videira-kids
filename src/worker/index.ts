import { Hono } from "hono";
import { ROTAS } from "../shared/contracts";
import { erroNaoTratado, rotaInexistente } from "./lib/respostas-erro";
import { health } from "./routes/health";
import { webhookRifei } from "./routes/webhook-rifei";

// API do sistema. O Worker só recebe /api e /api/* (assets.run_worker_first no
// wrangler.jsonc); o resto é o site React, servido pelos Static Assets.
// Erros sempre no formato único do contrato: { erro: { codigo, mensagem, detalhes? } }.
const app = new Hono<{ Bindings: Cloudflare.Env }>();

app.route(ROTAS.health.caminho, health);
// O webhook declara os próprios caminhos (CAMINHOS_WEBHOOK_RIFEI: com e sem barra no fim).
app.route("/", webhookRifei);

app.notFound(rotaInexistente);
app.onError(erroNaoTratado);

export default app;
