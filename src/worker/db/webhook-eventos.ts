// webhook_eventos (D3): uma linha por entrega autenticada, com o payload REDIGIDO (D1), os problemas
// (erro_validacao) e os avisos (payload aceito com diferenças da doc, RIFA-002b).
import type { NovoEventoWebhook } from "../../shared/contracts";

const COLUNAS =
  "recebido_em, evento, pedido_id, slug, resultado, status_anterior, status_resultante, payload_redigido, erro, avisos";

function jsonOuNulo(valor: unknown): string | null {
  return valor === null ? null : JSON.stringify(valor);
}

function valores(evento: NovoEventoWebhook) {
  return [
    evento.recebido_em,
    evento.evento,
    evento.pedido_id,
    evento.slug,
    evento.resultado,
    evento.status_anterior,
    evento.status_resultante,
    jsonOuNulo(evento.payload_redigido),
    jsonOuNulo(evento.erro),
    jsonOuNulo(evento.avisos),
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
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       RETURNING id`,
    )
    .bind(...valores(evento))
    .first<{ id: number }>();
  if (linha === null) throw new Error("webhook_eventos: INSERT sem id");
  return linha.id;
}

/**
 * A mesma gravação, para o db.batch do processamento de um pedido: só grava se o pedido ainda está
 * como foi lido (status `status_anterior` e afiliado `afiliadoLido`; ambos null = ainda não existe).
 * Se outra entrega do mesmo pedido gravou entre a leitura e a gravação, nada é gravado (RETURNING
 * vazio) e o processamento decide de novo.
 */
export function prepararRegistroEventoSePedidoIgual(
  db: D1Database,
  evento: NovoEventoWebhook,
  afiliadoLido: number | null,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO webhook_eventos (${COLUNAS})
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10
       WHERE (SELECT status FROM pedidos WHERE id = ?3) IS ?6
         AND (SELECT affiliate_id FROM pedidos WHERE id = ?3) IS ?11
       RETURNING id`,
    )
    .bind(...valores(evento), afiliadoLido);
}
