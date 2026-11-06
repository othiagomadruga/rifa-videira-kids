import { Hono, type Context } from "hono";
import {
  SEGREDO_WEBHOOK_RIFEI,
  detalhesDeValidacao,
  identificarPayloadInvalido,
  payloadRifeiSchema,
  redigirPayloadRifei,
  type DetalheValidacao,
  type RespostaWebhookRifei,
} from "../../shared/contracts";
import { buscarCampanhaAtiva } from "../db/campanha-ativa";
import { processarEventoPedido } from "../db/pedidos";
import { registrarEvento } from "../db/webhook-eventos";
import { MENSAGEM_JSON_INVALIDO, responderErro } from "../lib/respostas-erro";
import { textosIguaisEmTempoConstante } from "../lib/tempo-constante";

type Ambiente = { Bindings: Cloudflare.Env };

// POST /api/webhooks/rifei: pedidos da Rifei (passo a passo em docs/integracao-rifei.md, seção 5).
// O corpo bruto só existe na memória desta requisição: o que se grava é o payload redigido (D1).
export const webhookRifei = new Hono<Ambiente>();

/** Token de `Authorization: Bearer <token>`. O esquema não diferencia maiúsculas (RFC 7235). */
function tokenBearer(autorizacao: string | undefined): string | null {
  const token = /^Bearer\s+(.+)$/i.exec(autorizacao ?? "")?.[1]?.trim();
  return token ? token : null;
}

/** D9: corpo rejeitado vira um evento erro_validacao (só event/id/slug e os problemas) e 400. */
async function rejeitarCorpo(
  c: Context<Ambiente>,
  codigo: "json_invalido" | "payload_invalido",
  mensagem: string,
  corpo: unknown,
  problemas: DetalheValidacao[],
  recebidoEm: string,
): Promise<Response> {
  const eventoId = await registrarEvento(c.env.DB, {
    recebido_em: recebidoEm,
    ...identificarPayloadInvalido(corpo),
    resultado: "erro_validacao",
    status_anterior: null,
    status_resultante: null,
    payload_redigido: null,
    erro: problemas,
  });
  return responderErro(c, codigo, mensagem, {
    evento_id: eventoId,
    problemas,
  });
}

webhookRifei.post("/", async (c) => {
  // D6: sem segredo configurado, nenhuma entrega é aceita (falha fechada).
  const segredo = c.env[SEGREDO_WEBHOOK_RIFEI];
  if (segredo === undefined || segredo.trim() === "") {
    return responderErro(
      c,
      "nao_configurado",
      "O webhook da Rifei não está configurado no servidor",
    );
  }
  const token = tokenBearer(c.req.header("Authorization"));
  if (token === null || !(await textosIguaisEmTempoConstante(token, segredo))) {
    c.header("WWW-Authenticate", "Bearer");
    return responderErro(
      c,
      "nao_autenticado",
      "Token do webhook ausente ou inválido",
    );
  }

  const recebidoEm = new Date().toISOString();
  const texto = await c.req.text();
  let corpo: unknown;
  try {
    corpo = JSON.parse(texto);
  } catch {
    // A mensagem do SyntaxError cita trechos do corpo: não vai para a resposta, o banco nem o log (D1).
    return rejeitarCorpo(
      c,
      "json_invalido",
      MENSAGEM_JSON_INVALIDO,
      undefined,
      [
        {
          caminho: [],
          codigo: "json_invalido",
          mensagem: MENSAGEM_JSON_INVALIDO,
        },
      ],
      recebidoEm,
    );
  }

  const validacao = payloadRifeiSchema.safeParse(corpo);
  if (!validacao.success) {
    return rejeitarCorpo(
      c,
      "payload_invalido",
      "O corpo não segue o formato do webhook da Rifei",
      corpo,
      detalhesDeValidacao(validacao.error),
      recebidoEm,
    );
  }
  const payload = redigirPayloadRifei(validacao.data);

  // D5: o webhook é da conta na Rifei; só a campanha ativa é processada.
  const db = c.env.DB;
  const campanha = await buscarCampanhaAtiva(db);
  if (campanha === null || campanha.slug_rifei !== payload.slug) {
    const eventoId = await registrarEvento(db, {
      recebido_em: recebidoEm,
      evento: payload.event,
      pedido_id: payload.id,
      slug: payload.slug,
      resultado: "ignorado_outra_campanha",
      status_anterior: null,
      status_resultante: null,
      payload_redigido: payload,
      erro: null,
    });
    return c.json(
      {
        resultado: "ignorado_outra_campanha",
        evento_id: eventoId,
      } satisfies RespostaWebhookRifei,
      200,
    );
  }

  const resposta = await processarEventoPedido(db, {
    campanhaId: campanha.id,
    payload,
    recebidoEm,
  });
  return c.json(resposta satisfies RespostaWebhookRifei, 200);
});
