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
app.route(ROTAS.webhookRifei.caminho, webhookRifei);

app.notFound(rotaInexistente);
app.onError(erroNaoTratado);

export default app;
