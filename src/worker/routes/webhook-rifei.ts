import { Hono, type Context } from "hono";
import {
  CAMINHOS_WEBHOOK_RIFEI,
  LIMITE_CORPO_WEBHOOK_BYTES,
  SEGREDO_WEBHOOK_RIFEI,
  analisarPayloadRifei,
  avisosParaGravar,
  identificarPayloadInvalido,
  redigirPayloadRifei,
  type DetalheResumido,
  type RespostaWebhookRifei,
} from "../../shared/contracts";
import { buscarCampanhaAtiva } from "../db/campanha";
import { processarEventoPedido } from "../db/pedidos";
import { registrarEvento } from "../db/webhook-eventos";
import { lerCorpoComLimite } from "../lib/corpo-limitado";
import { MENSAGEM_JSON_INVALIDO, responderErro } from "../lib/respostas-erro";
import { textosIguaisEmTempoConstante } from "../lib/tempo-constante";

type Ambiente = { Bindings: Cloudflare.Env };

const MENSAGEM_CORPO_MUITO_GRANDE = `O corpo passa do limite de ${LIMITE_CORPO_WEBHOOK_BYTES} bytes (1 MiB)`;

/** Token de `Authorization: Bearer <token>`. O esquema não diferencia maiúsculas (RFC 7235). */
function tokenBearer(autorizacao: string | undefined): string | null {
  const token = /^Bearer\s+(.+)$/i.exec(autorizacao ?? "")?.[1]?.trim();
  return token ? token : null;
}

/** Problema único, sem valor, no formato DetalheResumido (json_invalido e corpo_muito_grande). */
function problemaDoCorpo(codigo: string, mensagem: string): DetalheResumido {
  return { caminho: [], codigo, mensagem, ocorrencias: 1 };
}

/** D9: corpo recusado vira um evento erro_validacao (só event/id/slug e os problemas, sem payload). */
async function recusarCorpo(
  c: Context<Ambiente>,
  codigo: "json_invalido" | "payload_invalido" | "corpo_muito_grande",
  mensagem: string,
  corpo: unknown,
  problemas: DetalheResumido[],
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
    avisos: null,
  });
  return responderErro(c, codigo, mensagem, {
    evento_id: eventoId,
    problemas,
  });
}

// POST /api/webhooks/rifei (com ou sem barra no fim): pedidos da Rifei. Passo a passo em
// docs/integracao-rifei.md, seção 5. O corpo bruto só existe na memória desta requisição: o que se
// grava é o payload redigido (D1).
async function receberWebhookRifei(c: Context<Ambiente>): Promise<Response> {
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

  // Limite de tamanho só depois da autenticação: sem token, nada é lido nem gravado.
  const recebidoEm = new Date().toISOString();
  const texto = await lerCorpoComLimite(c.req.raw, LIMITE_CORPO_WEBHOOK_BYTES);
  if (texto === null) {
    return recusarCorpo(
      c,
      "corpo_muito_grande",
      MENSAGEM_CORPO_MUITO_GRANDE,
      undefined,
      [problemaDoCorpo("corpo_muito_grande", MENSAGEM_CORPO_MUITO_GRANDE)],
      recebidoEm,
    );
  }
  let corpo: unknown;
  try {
    corpo = JSON.parse(texto);
  } catch {
    // A mensagem do SyntaxError cita trechos do corpo: não vai para a resposta, o banco nem o log (D1).
    return recusarCorpo(
      c,
      "json_invalido",
      MENSAGEM_JSON_INVALIDO,
      undefined,
      [problemaDoCorpo("json_invalido", MENSAGEM_JSON_INVALIDO)],
      recebidoEm,
    );
  }

  // RIFA-002b: só falta de essencial recusa; o resto é tolerado e vira avisos.
  const analise = analisarPayloadRifei(corpo);
  if (!analise.aceito) {
    return recusarCorpo(
      c,
      "payload_invalido",
      "O corpo não traz o essencial do webhook da Rifei",
      corpo,
      analise.problemas,
      recebidoEm,
    );
  }
  const payload = redigirPayloadRifei(analise.payload);

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
      avisos: avisosParaGravar(analise.avisos),
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
    precoBilheteCentavos: campanha.preco_bilhete_centavos,
    payload,
    avisos: analise.avisos,
    recebidoEm,
  });
  return c.json(resposta satisfies RespostaWebhookRifei, 200);
}

/** Montado em "/" no app: os caminhos completos vêm do contrato (com e sem barra no fim). */
export const webhookRifei = new Hono<Ambiente>();
for (const caminho of CAMINHOS_WEBHOOK_RIFEI) {
  webhookRifei.post(caminho, receberWebhookRifei);
}
