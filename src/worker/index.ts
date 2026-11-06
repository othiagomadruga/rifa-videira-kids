import { Hono } from "hono";
import { ROTAS, ROTAS_ACESSO } from "../shared/contracts";
import { erroNaoTratado, rotaInexistente } from "./lib/respostas-erro";
import { cabecalhosSeguranca } from "./middleware/cabecalhos-seguranca";
import { exigirSessao } from "./middleware/sessao";
import { sessao } from "./routes/acesso";
import { adminUsuarios } from "./routes/admin-usuarios";
import { health } from "./routes/health";
import { PREFIXO_HIERARQUIA, hierarquia } from "./routes/hierarquia";
import { webhookRifei } from "./routes/webhook-rifei";

// API do sistema. O Worker só recebe /api e /api/* (assets.run_worker_first no
// wrangler.jsonc); o resto é o site React, servido pelos Static Assets.
// Erros sempre no formato único do contrato: { erro: { codigo, mensagem, detalhes? } }.
//
// A ORDEM DO REGISTRO IMPORTA (docs/acesso.md, seção 6): o Hono roda middlewares e rotas na ordem em
// que foram registrados, e um middleware registrado depois de uma rota não protege essa rota. Toda
// rota da coordenação (/api/admin/* e /api/painel/*) entra DEPOIS do passo 4. O teste
// src/worker/protecao.test.ts confere isso no app real.
const app = new Hono<{ Bindings: Cloudflare.Env }>();

// 1. Cabeçalhos de segurança em toda resposta da API, inclusive 401, 403, 404 e 500.
app.use("*", cabecalhosSeguranca);

// 2. Aberta.
app.route(ROTAS.health.caminho, health);

// 3. Sessão da equipe (RIFA-007): POST abre a sessão com o link pessoal, GET diz quem está
// conectado, POST /sair encerra. Os POSTs só aceitam a mesma origem (CSRF).
app.route(ROTAS_ACESSO.entrar.caminho, sessao);

// 4. Coordenação: todo /api/admin/* e /api/painel/* exige sessão (e a mesma origem nas escritas),
// exista a rota ou não. Papéis escritos aqui de propósito: um papel novo não ganha acesso sozinho.
app.use("/api/admin/*", exigirSessao(["admin", "coordenacao"]));
app.use("/api/painel/*", exigirSessao(["admin", "coordenacao"]));

// 5. Usuários e links: só admin (o sub-app também exige, em /usuarios/* e /links/*).
app.route("/api/admin", adminUsuarios);

// 6. Demais rotas.
// Webhook da Rifei: público, autenticado só pelo Bearer (D6), fora da sessão. Declara os próprios
// caminhos (CAMINHOS_WEBHOOK_RIFEI: com e sem barra no fim).
app.route("/", webhookRifei);
// Hierarquia (RIFA-005): CRUD e importação sob /api/admin, protegidos pelo passo 4.
app.route(PREFIXO_HIERARQUIA, hierarquia);

app.notFound(rotaInexistente);
app.onError(erroNaoTratado);

export default app;
