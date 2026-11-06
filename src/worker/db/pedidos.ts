// pedidos (D3, D4): estado atual de cada pedido da Rifei, sem nenhum dado pessoal (D1).
import {
  STATUS_PEDIDO,
  TRANSICOES_PERMITIDAS,
  decidirTransicaoPedido,
  reaisParaCentavos,
  type PayloadRifeiRedigido,
  type RespostaWebhookRifei,
  type StatusPedido,
} from "../../shared/contracts";
import { prepararRegistroAfiliadoOrfao } from "./afiliados";
import { prepararRegistroEventoSeStatusAtual } from "./webhook-eventos";

/**
 * Uma tentativa só falha se o status mudou entre a leitura e a gravação. Na vida de um pedido o status
 * muda no máximo 3 vezes (nenhum → in_process → expired → approved), então a 4ª sempre grava.
 */
const MAX_TENTATIVAS = 4;

export async function buscarStatusPedido(
  db: D1Database,
  id: string,
): Promise<StatusPedido | null> {
  const linha = await db
    .prepare("SELECT status FROM pedidos WHERE id = ?1")
    .bind(id)
    .first<{ status: StatusPedido }>();
  return linha?.status ?? null;
}

/** Estados a partir dos quais `alvo` é transição permitida (D4): a guarda do UPSERT condicional. */
function origensPermitidas(alvo: StatusPedido): StatusPedido[] {
  return STATUS_PEDIDO.filter((origem) => {
    const destinos: readonly StatusPedido[] = TRANSICOES_PERMITIDAS[origem];
    return destinos.includes(alvo);
  });
}

// Campos informativos são tratados como anuláveis: um valor ausente segue como null, sem inventar dado.

/** D8: instantes da Rifei (com fuso) são guardados em UTC. */
function utcOuNulo(instante: string | null): string | null {
  return instante === null ? null : new Date(instante).toISOString();
}

/** D2: reais para centavos inteiros. */
function centavosOuNulo(reais: number | null): number | null {
  return reais === null ? null : reaisParaCentavos(reais);
}

interface GravacaoPedido {
  campanhaId: number;
  payload: PayloadRifeiRedigido;
  statusAnterior: StatusPedido | null;
  statusResultante: StatusPedido;
  recebidoEm: string;
}

/**
 * Cria ou atualiza o pedido com os dados DESTE evento (D2 centavos, D8 UTC, D1 só ddd e país).
 * Grava só se o pedido ainda está em `statusAnterior` (a mesma guarda do evento, no mesmo batch) e,
 * no conflito, só a partir de um estado que permite a transição (D4). `registrado_em` não muda.
 */
function prepararGravacaoPedido(
  db: D1Database,
  gravacao: GravacaoPedido,
): D1PreparedStatement {
  const { payload, statusResultante, recebidoEm } = gravacao;
  // Pedido aprovado sem approved_at: vale o instante do recebimento (CHECK da tabela).
  const aprovadoEm =
    utcOuNulo(payload.approved_at) ??
    (statusResultante === "approved" ? recebidoEm : null);
  return db
    .prepare(
      `INSERT INTO pedidos (
         id, campanha_id, affiliate_id, status, status_rifei, status_detail_rifei,
         qtd_bilhetes, numeros, subtotal_centavos, total_centavos,
         desconto_promocao_centavos, desconto_cupom_centavos, cupom_id, metodo_pagamento, rifinha,
         ddd, pais, utm_source, utm_campaign, utm_medium, utm_content, utm_term,
         criado_em, expira_em, aprovado_em, expirado_em, registrado_em, atualizado_em
       )
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17,
         ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?27
       WHERE (SELECT status FROM pedidos WHERE id = ?1) IS ?28
       ON CONFLICT (id) DO UPDATE SET
         campanha_id = excluded.campanha_id,
         affiliate_id = excluded.affiliate_id,
         status = excluded.status,
         status_rifei = excluded.status_rifei,
         status_detail_rifei = excluded.status_detail_rifei,
         qtd_bilhetes = excluded.qtd_bilhetes,
         numeros = excluded.numeros,
         subtotal_centavos = excluded.subtotal_centavos,
         total_centavos = excluded.total_centavos,
         desconto_promocao_centavos = excluded.desconto_promocao_centavos,
         desconto_cupom_centavos = excluded.desconto_cupom_centavos,
         cupom_id = excluded.cupom_id,
         metodo_pagamento = excluded.metodo_pagamento,
         rifinha = excluded.rifinha,
         ddd = excluded.ddd,
         pais = excluded.pais,
         utm_source = excluded.utm_source,
         utm_campaign = excluded.utm_campaign,
         utm_medium = excluded.utm_medium,
         utm_content = excluded.utm_content,
         utm_term = excluded.utm_term,
         criado_em = excluded.criado_em,
         expira_em = excluded.expira_em,
         aprovado_em = excluded.aprovado_em,
         expirado_em = excluded.expirado_em,
         atualizado_em = excluded.atualizado_em
       WHERE pedidos.status IN (SELECT value FROM json_each(?29))`,
    )
    .bind(
      payload.id,
      gravacao.campanhaId,
      payload.affiliate_id,
      statusResultante,
      payload.status,
      payload.status_detail,
      payload.numbers_count,
      payload.numbers === null ? null : JSON.stringify(payload.numbers),
      centavosOuNulo(payload.subtotal),
      centavosOuNulo(payload.total),
      centavosOuNulo(payload.promotion_discount),
      centavosOuNulo(payload.coupon_discount),
      payload.coupon_id,
      payload.payment_method,
      payload.is_rifinha ? 1 : 0,
      payload.comprador.ddd,
      payload.comprador.pais,
      payload.utm?.source ?? null,
      payload.utm?.campaign ?? null,
      payload.utm?.medium ?? null,
      payload.utm?.content ?? null,
      payload.utm?.term ?? null,
      utcOuNulo(payload.created_at),
      utcOuNulo(payload.expires_at),
      aprovadoEm,
      utcOuNulo(payload.expired_at),
      recebidoEm,
      gravacao.statusAnterior,
      JSON.stringify(origensPermitidas(statusResultante)),
    );
}

interface EventoDoPedido {
  campanhaId: number;
  /** Payload já redigido (D1) e da campanha ativa (D5). */
  payload: PayloadRifeiRedigido;
  recebidoEm: string;
}

/**
 * Processa um evento da campanha ativa (passos 7 a 10 de docs/integracao-rifei.md): decide a
 * transição (D4) e grava, num único db.batch (uma transação), o afiliado órfão (D7), o evento e o
 * pedido. Concorrência otimista: o evento e o pedido levam a mesma guarda ("o status ainda é o lido"),
 * então o resultado gravado é sempre o da escrita que de fato aconteceu. Se outra entrega do mesmo
 * pedido gravou no meio do caminho, nada é gravado (o INSERT do evento não devolve id) e a decisão é
 * refeita com o status novo: duas entregas simultâneas do mesmo evento dão processado + duplicado.
 */
export async function processarEventoPedido(
  db: D1Database,
  { campanhaId, payload, recebidoEm }: EventoDoPedido,
): Promise<RespostaWebhookRifei> {
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    const statusAnterior = await buscarStatusPedido(db, payload.id);
    const decisao = decidirTransicaoPedido(statusAnterior, payload.event);

    const comandos: D1PreparedStatement[] = [];
    if (payload.affiliate_id !== null) {
      comandos.push(
        prepararRegistroAfiliadoOrfao(db, payload.affiliate_id, recebidoEm),
      );
    }
    const posicaoEvento =
      comandos.push(
        prepararRegistroEventoSeStatusAtual(db, {
          recebido_em: recebidoEm,
          evento: payload.event,
          pedido_id: payload.id,
          slug: payload.slug,
          resultado: decisao.resultado,
          status_anterior: statusAnterior,
          status_resultante: decisao.status_resultante,
          payload_redigido: payload,
          erro: null,
        }),
      ) - 1;
    if (decisao.resultado === "processado") {
      comandos.push(
        prepararGravacaoPedido(db, {
          campanhaId,
          payload,
          statusAnterior,
          statusResultante: decisao.status_resultante,
          recebidoEm,
        }),
      );
    }

    const resultados = await db.batch<{ id: number }>(comandos);
    const eventoId = resultados[posicaoEvento]?.results[0]?.id;
    if (eventoId !== undefined) {
      return { resultado: decisao.resultado, evento_id: eventoId };
    }
  }
  throw new Error(
    `webhook Rifei: o status do pedido mudou durante ${MAX_TENTATIVAS} tentativas seguidas`,
  );
}
