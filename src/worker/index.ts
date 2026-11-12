import { Hono } from "hono";
import { ROTAS, ROTAS_ACESSO } from "../shared/contracts";
import { LIMITE_PUBLICO, limitarRequisicoes } from "./lib/limite-requisicoes";
import { erroNaoTratado, rotaInexistente } from "./lib/respostas-erro";
import { cabecalhosSeguranca } from "./middleware/cabecalhos-seguranca";
import { limitarCorpoDaCoordenacao } from "./middleware/limite-corpo";
import { exigirSessao } from "./middleware/sessao";
import { sessao } from "./routes/acesso";
import {
  PREFIXO_ACESSOS_HIERARQUIA,
  acessosHierarquia,
} from "./routes/acessos-hierarquia";
import { adminUsuarios } from "./routes/admin-usuarios";
import {
  PREFIXO_AFILIADOS_ADESAO,
  afiliadosAdesao,
} from "./routes/afiliados-adesao";
import { PREFIXO_AUDITORIA, auditoria } from "./routes/auditoria";
import { PREFIXO_CAMPANHA, campanha } from "./routes/campanha";
import { health } from "./routes/health";
import { PREFIXO_HIERARQUIA, hierarquia } from "./routes/hierarquia";
import { PREFIXO_LINKS_VENDAS, linksVendas } from "./routes/links-vendas";
import { PREFIXO_MINHA, minha } from "./routes/minha";
import { PREFIXO_PAINEL, painel } from "./routes/painel";
import { PREFIXO_PEDIDOS, pedidos } from "./routes/pedidos";
import {
  PREFIXO_PEDIDOS_SUSPEITOS,
  pedidosSuspeitos,
} from "./routes/pedidos-suspeitos";
import { PREFIXO_PUBLICO, publico } from "./routes/publico";
import { PREFIXO_RECONCILIACAO, reconciliacao } from "./routes/reconciliacao";
import {
  PREFIXO_WEBHOOK_COORDENACAO,
  webhookCoordenacao,
} from "./routes/webhook-coordenacao";
import { webhookRifei } from "./routes/webhook-rifei";
import { PREFIXO_TOKEN_WEBHOOK, tokenWebhook } from "./routes/webhook-token";

// API do sistema. O Worker só recebe /api e /api/* (assets.run_worker_first no
// wrangler.jsonc); o resto é o site React, servido pelos Static Assets.
// Erros sempre no formato único do contrato: { erro: { codigo, mensagem, detalhes? } }.
//
// A ORDEM DO REGISTRO IMPORTA (docs/acesso.md, seção 6): o Hono roda middlewares e rotas na ordem em
// que foram registrados, e um middleware registrado depois de uma rota não protege essa rota. Toda
// rota da coordenação (/api/admin/* e /api/painel/*) e da hierarquia (/api/minha/*) entra DEPOIS do
// passo 4. O teste src/worker/protecao.test.ts confere isso no app real.
const app = new Hono<{ Bindings: Cloudflare.Env }>();

// 1. Cabeçalhos de segurança em toda resposta da API, inclusive 401, 403, 404 e 500.
app.use("*", cabecalhosSeguranca);

// 2. Aberta. Cada chamada lê o D1: conta no limite por IP das rotas abertas (RIFA-013b).
app.use(ROTAS.health.caminho, limitarRequisicoes(LIMITE_PUBLICO));
app.route(ROTAS.health.caminho, health);

// 3. Sessão da equipe (RIFA-007): POST abre a sessão com o link pessoal, GET diz quem está
// conectado, POST /sair encerra. Os POSTs só aceitam a mesma origem (CSRF).
app.route(ROTAS_ACESSO.entrar.caminho, sessao);

// 4. Coordenação: todo /api/admin/* e /api/painel/* exige sessão (e a mesma origem nas escritas),
// exista a rota ou não. Papéis escritos aqui de propósito: um papel novo não ganha acesso sozinho.
app.use("/api/admin/*", exigirSessao(["admin", "coordenacao"]));
app.use("/api/painel/*", exigirSessao(["admin", "coordenacao"]));
// 4b. Teto do corpo das escritas da coordenação (RIFA-013b), DEPOIS do login: sem sessão, o corpo nem é
// lido. As importações de CSV conferem o teto delas na própria rota (middleware/limite-corpo.ts).
app.use("/api/admin/*", limitarCorpoDaCoordenacao);
app.use("/api/painel/*", limitarCorpoDaCoordenacao);
// 4c. Hierarquia (RIFA-014, D12): todo /api/minha/* exige a sessão de um líder, discipulador ou rede, exista
// a rota ou não; a coordenação leva 403. Papéis escritos aqui de propósito, como no passo 4. Os papéis da
// hierarquia não entram em /api/admin/* nem em /api/painel/* (403 no passo 4). Com o acesso do papel desligado
// na campanha (RIFA-029, D20), o discipulador e a rede levam 403 `acesso_desligado` em todo /api/minha/*
// (a chave é lida junto com a sessão, na hora; o líder não tem chave).
app.use(
  "/api/minha/*",
  exigirSessao(["lider", "discipulador", "rede"], { acessoDaCampanha: true }),
);

// 5. Usuários e links: só admin (o sub-app também exige, em /usuarios/* e /links/*).
app.route("/api/admin", adminUsuarios);
// Trilha de auditoria (RIFA-013b): só admin (o sub-app também exige).
app.route(PREFIXO_AUDITORIA, auditoria);
// Acessos da hierarquia (RIFA-014): lista dos alvos e links em lote, só admin (o sub-app também exige).
app.route(PREFIXO_ACESSOS_HIERARQUIA, acessosHierarquia);

// 6. Demais rotas.
// Webhook da Rifei: público, autenticado só pelo Bearer (D6), fora da sessão: o token gerado pela tela (D21, lido
// do D1 a cada requisição) ou, só sem ele, o segredo do Worker. Declara os próprios caminhos
// (CAMINHOS_WEBHOOK_RIFEI: com e sem barra no fim).
app.route("/", webhookRifei);
// Hierarquia (RIFA-005): CRUD e importação sob /api/admin, protegidos pelo passo 4.
app.route(PREFIXO_HIERARQUIA, hierarquia);
// Campanha (RIFA-004): GET/PUT da configuração sob /api/admin, protegidos pelo passo 4.
app.route(PREFIXO_CAMPANHA, campanha);
// Pedidos que o webhook marcou como implausíveis (RIFA-013b): sob /api/admin, protegidos pelo passo 4.
app.route(PREFIXO_PEDIDOS_SUSPEITOS, pedidosSuspeitos);
// Pedidos da campanha, entregas e estado do webhook (RIFA-025, D16): leitura, sob /api/admin (passo 4). Com
// desconsiderar e reconsiderar pedido (RIFA-028, D20), só admin (o sub-app exige nas duas rotas).
app.route(PREFIXO_PEDIDOS, pedidos);
app.route(PREFIXO_WEBHOOK_COORDENACAO, webhookCoordenacao);
// Token do webhook da Rifei gerado pela tela (RIFA-039, D21): GET e POST /api/admin/webhook/token, só admin (o
// sub-app exige no handler das duas rotas, nunca num use de /api/admin/webhook/*: as entregas e o estado acima
// continuam da coordenação).
app.route(PREFIXO_TOKEN_WEBHOOK, tokenWebhook);
// Afiliados e adesão (RIFA-006): vínculo afiliado → célula e "quem falta" sob /api/admin (passo 4). Remover
// afiliado de teste (RIFA-031, D20) é só admin (o sub-app exige no DELETE; o PUT do caminho segue da coordenação).
app.route(PREFIXO_AFILIADOS_ADESAO, afiliadosAdesao);
// Link de vendas de cada célula (RIFA-046, D24): GET /api/admin/links-vendas (admin e coordenação, para a Adesão) e
// PUT /api/admin/links-vendas/modelo, só admin (o sub-app exige no handler do PUT, antes do corpo; nunca num use de
// /api/admin/links-vendas/*, que pegaria o GET). O GET da hierarquia fica no sub-app de /api/minha (abaixo).
app.route(PREFIXO_LINKS_VENDAS, linksVendas);
// Conferência pelo CSV da Rifei (RIFA-012): análise, "Recuperar" e auditoria sob /api/admin (passo 4).
app.route(PREFIXO_RECONCILIACAO, reconciliacao);
// Painel e ranking da coordenação (RIFA-PAINEL): sob /api/painel, protegidos pelo passo 4.
app.route(PREFIXO_PAINEL, painel);
// Visão pública (RIFA-PAINEL): ranking e bumbo sob /api/publico, ABERTOS (fora dos prefixos do
// passo 4) e nunca com valores em R$ ou bilhetes (o sub-app confere a resposta no schema estrito).
app.route(PREFIXO_PUBLICO, publico);
// Visão individual (RIFA-014) e links de vendas das células do alvo (RIFA-046, D24): sob /api/minha, protegidos
// pelo passo 4c; o alvo vem só da sessão e a resposta nunca traz dinheiro (o sub-app confere no schema estrito).
app.route(PREFIXO_MINHA, minha);

app.notFound(rotaInexistente);
app.onError(erroNaoTratado);

export default app;
