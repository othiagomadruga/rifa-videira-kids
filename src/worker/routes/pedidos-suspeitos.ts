/**
 * GET /api/admin/pedidos/suspeitos (grupo `coordenacao`, RIFA-013b; docs/api.md): os pedidos aprovados
 * que o webhook marcou como implausíveis (lib/plausibilidade.ts), para a coordenação conferir na Rifei.
 * Eles continuam contando nas vendas. Sem nenhum dado do comprador (D1).
 *
 * Este sub-app NÃO autentica: o index.ts o monta sob /api/admin, depois do login da coordenação:
 * `app.route(PREFIXO_PEDIDOS_SUSPEITOS, pedidosSuspeitos)`.
 */
import { Hono } from "hono";
import { ROTAS } from "../../shared/contracts";
import { listarPedidosSuspeitos } from "../db/pedidos-suspeitos";

type Ambiente = { Bindings: Cloudflare.Env };

/** Onde o index.ts monta este sub-app. */
export const PREFIXO_PEDIDOS_SUSPEITOS = "/api/admin";

export const pedidosSuspeitos = new Hono<Ambiente>();

pedidosSuspeitos.get(
  ROTAS.pedidosSuspeitos.caminho.slice(PREFIXO_PEDIDOS_SUSPEITOS.length),
  async (c) => c.json(await listarPedidosSuspeitos(c.env.DB), 200),
);
