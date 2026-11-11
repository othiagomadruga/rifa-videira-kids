/**
 * Entregas e estado do webhook da Rifei para a coordenação (grupo `coordenacao`, RIFA-025, D16; docs/api.md):
 * - GET /api/admin/webhook/entregas: cada entrega autenticada, da mais nova para a mais antiga, só com os códigos
 *   do erro e dos avisos (db/entregas-webhook.ts);
 * - GET /api/admin/webhook/estado: a `situacao` do alerta de webhook parado e as contagens (db/estado-webhook.ts).
 * Só leitura, sem dado pessoal.
 *
 * Este sub-app NÃO autentica: o index.ts o monta sob /api/admin, depois do login da coordenação (passo 4):
 * `app.route(PREFIXO_WEBHOOK_COORDENACAO, webhookCoordenacao)`. O webhook em si (POST /api/webhooks/rifei) é
 * outro sub-app (routes/webhook-rifei.ts), aberto e autenticado só pelo Bearer.
 */
import { Hono } from "hono";
import { ROTAS } from "../../shared/contracts";
import { listarEntregasWebhook } from "../db/entregas-webhook";
import { lerEstadoWebhook } from "../db/estado-webhook";
import { relogioDoSistema, type Relogio } from "../db/painel";
import { validarConsulta } from "../middleware/validacao";

type Ambiente = { Bindings: Cloudflare.Env };

/** Onde o index.ts monta este sub-app. */
export const PREFIXO_WEBHOOK_COORDENACAO = "/api/admin";

const local = (caminho: string) =>
  caminho.slice(PREFIXO_WEBHOOK_COORDENACAO.length);

/** O sub-app com o relógio dado (os testes fixam o instante; em produção, o do sistema). */
export function criarWebhookCoordenacao(relogio: Relogio = relogioDoSistema) {
  const rotas = new Hono<Ambiente>();

  rotas.get(
    local(ROTAS.entregasWebhook.caminho),
    validarConsulta(ROTAS.entregasWebhook.consulta),
    async (c) =>
      c.json(await listarEntregasWebhook(c.env.DB, c.req.valid("query")), 200),
  );

  rotas.get(local(ROTAS.estadoWebhook.caminho), async (c) =>
    c.json(await lerEstadoWebhook(c.env.DB, relogio()), 200),
  );

  return rotas;
}

export const webhookCoordenacao = criarWebhookCoordenacao();
