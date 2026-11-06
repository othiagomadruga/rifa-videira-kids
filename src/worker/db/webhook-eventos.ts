// webhook_eventos (D3): uma linha por entrega autenticada, com o payload REDIGIDO (D1).
import type {
  DetalheValidacao,
  PayloadRifeiRedigido,
  ResultadoEventoWebhook,
  StatusPedido,
} from "../../shared/contracts";

export interface NovoEventoWebhook {
  recebido_em: string;
  evento: string | null;
  pedido_id: string | null;
  slug: string | null;
  resultado: ResultadoEventoWebhook;
  status_anterior: StatusPedido | null;
  status_resultante: StatusPedido | null;
  /** null só em erro_validacao. */
  payload_redigido: PayloadRifeiRedigido | null;
  /** Problemas de validação (sem valores); só em erro_validacao. */
  erro: DetalheValidacao[] | null;
}

const COLUNAS =
  "recebido_em, evento, pedido_id, slug, resultado, status_anterior, status_resultante, payload_redigido, erro";

function valores(evento: NovoEventoWebhook) {
  return [
    evento.recebido_em,
    evento.evento,
    evento.pedido_id,
    evento.slug,
    evento.resultado,
    evento.status_anterior,
    evento.status_resultante,
    evento.payload_redigido === null
      ? null
      : JSON.stringify(evento.payload_redigido),
    evento.erro === null ? null : JSON.stringify(evento.erro),
  ];
}

/** Grava a entrega e devolve o id (o `evento_id` da resposta). */
export async function registrarEvento(
  db: D1Database,
  evento: NovoEventoWebhook,
): Promise<number> {
  const linha = await db
    .prepare(
      `INSERT INTO webhook_eventos (${COLUNAS})
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
       RETURNING id`,
    )
    .bind(...valores(evento))
    .first<{ id: number }>();
  if (linha === null) throw new Error("webhook_eventos: INSERT sem id");
  return linha.id;
}

/**
 * A mesma gravação, para o db.batch do processamento de um pedido: só grava se o pedido ainda está
 * em `status_anterior` (null = ainda não existe). Se outra entrega do mesmo pedido mudou o status
 * entre a leitura e a gravação, nada é gravado (RETURNING vazio) e o processamento decide de novo.
 */
export function prepararRegistroEventoSeStatusAtual(
  db: D1Database,
  evento: NovoEventoWebhook,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO webhook_eventos (${COLUNAS})
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
       WHERE (SELECT status FROM pedidos WHERE id = ?3) IS ?6
       RETURNING id`,
    )
    .bind(...valores(evento));
}
