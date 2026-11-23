/**
 * A célula atribuída à mão pelo admin a um pedido sem célula pelo afiliado (RIFA-088, docs/decisions.md D41; colunas
 * da migração 0020): PUT /api/admin/pedidos/:id/celula. A regra da célula efetiva está em ./celula-efetiva.ts.
 *
 * Atomicidade (como a desconsideração, D20 OBRIGATÓRIO 2): um db.batch só, com (a) o registro da trilha ANTES do
 * UPDATE e com a MESMA condição (o resumo sai da própria linha do pedido: a célula atribuída de antes), (b) o UPDATE
 * das três colunas pela chave primária, e (c) a leitura do item como a lista o monta, só se o UPDATE mudou a linha.
 * A condição confere tudo DENTRO do lote: o pedido é da campanha ativa, não tem célula pelo afiliado (um vínculo do
 * afiliado feito ao mesmo tempo não deixa passar) e a célula existe. Sem mudança, uma leitura curta decide a resposta:
 * 404 (sem campanha ou pedido fora dela), 409 (já tem célula pelo afiliado), 400 (célula inexistente) ou 200 com o
 * pedido como está (atribuir de novo a mesma célula, ou desfazer o que não existe), sem trilha.
 *
 * O webhook nunca escreve nestas colunas (db/pedidos.ts): a atribuição sobrevive a qualquer evento da Rifei.
 */
import {
  alvoDoPedidoNaAuditoria,
  type ItemPedido,
} from "../../shared/contracts";
import type { Autoria } from "./auditoria";
import { juntarAfiliado, juntarCelulaEfetiva } from "./celula-efetiva";
import { COLUNAS_ITEM, itemDaLinha, type LinhaPedido } from "./lista-pedidos";
import { LER_ITEM_SE_MUDOU } from "./regras-campanha";

const ID_DA_ATIVA = "(SELECT id FROM campanhas WHERE ativa = 1)";

/**
 * A condição da gravação, com os valores ?1 (id do pedido) e ?6 (a célula, ou null para desfazer). Atribuir: o pedido
 * da campanha ativa, sem célula pelo afiliado, com outra célula atribuída (ou nenhuma), e a célula existe. Desfazer: o
 * pedido da campanha ativa com alguma célula atribuída (desfazer vale mesmo se o afiliado ganhou célula depois: a
 * atribuída não contava, e sai).
 */
const CONDICAO = {
  atribuir: `p.id = ?1 AND p.campanha_id = ${ID_DA_ATIVA}
    AND p.celula_atribuida_id IS NOT ?6
    AND EXISTS (SELECT 1 FROM celulas WHERE id = ?6)
    AND NOT EXISTS (SELECT 1 FROM afiliados AS x
      WHERE x.affiliate_id = p.affiliate_id AND x.celula_id IS NOT NULL)`,
  desfazer: `p.id = ?1 AND p.campanha_id = ${ID_DA_ATIVA} AND p.celula_atribuida_id IS NOT NULL`,
} as const;

/**
 * Os mesmos seis valores em todos os comandos do lote: ?1 id do pedido, ?2 quem, ?3 quando, ?4 alvo da trilha, ?5 o
 * id do pedido em JSON (para o resumo; pode ter aspas) e ?6 a célula (ou null).
 */
const REGISTRAR = (
  condicao: string,
) => `INSERT INTO auditoria (usuario_id, em, acao, alvo, resumo)
  SELECT ?2, ?3, 'pedido.atribuir_celula', ?4, substr('Pedido ' || ?5 || ': célula atribuída à mão '
    || coalesce(p.celula_atribuida_id, 'nenhuma') || ' → ' || coalesce(CAST(?6 AS INTEGER), 'nenhuma'), 1, 1000)
  FROM pedidos AS p
  WHERE ${condicao}`;

const GRAVAR = (condicao: string) => `UPDATE pedidos AS p SET
    celula_atribuida_id = ?6,
    celula_atribuida_em = CASE WHEN ?6 IS NULL THEN NULL ELSE ?3 END,
    celula_atribuida_por = CASE WHEN ?6 IS NULL THEN NULL ELSE ?2 END
  WHERE ${condicao}`;

/**
 * A leitura curta, só quando o lote não mudou nada: a campanha ativa, o pedido dela como um item da lista, a célula
 * do afiliado e se a célula pedida existe. Nenhuma linha = sem campanha ativa; `id` null = o pedido não é dela.
 */
const LER_CURTA = `SELECT a.celula_id AS celula_do_afiliado,
    (SELECT count(*) FROM celulas WHERE id = ?2) AS celula_existe, ${COLUNAS_ITEM}
  FROM (SELECT id FROM campanhas WHERE ativa = 1) AS k
  LEFT JOIN pedidos AS p ON p.id = ?1 AND p.campanha_id = k.id
  ${juntarAfiliado()}
  ${juntarCelulaEfetiva()}`;

export type ResultadoAtribuicaoCelula =
  | { ok: true; item: ItemPedido; mudou: boolean }
  | {
      ok: false;
      motivo:
        "pedido_nao_encontrado" | "pedido_ja_tem_celula" | "celula_inexistente";
    };

/**
 * Atribui (`celulaId` número) ou desfaz (`celulaId` null) a célula à mão do pedido da campanha ativa. `autoria` é quem
 * fez e o instante (o mesmo grava `celula_atribuida_em`). O item volta com o comprador: só o admin atribui (RIFA-076,
 * D36, como na lista dele).
 */
export async function atribuirCelulaDoPedido(
  db: D1Database,
  pedidoId: string,
  celulaId: number | null,
  autoria: Autoria,
): Promise<ResultadoAtribuicaoCelula> {
  const condicao = celulaId === null ? CONDICAO.desfazer : CONDICAO.atribuir;
  const valores = [
    pedidoId,
    autoria.usuarioId,
    autoria.em,
    alvoDoPedidoNaAuditoria(pedidoId),
    JSON.stringify(pedidoId),
    celulaId,
  ];
  const [, gravado, item] = await db.batch([
    db.prepare(REGISTRAR(condicao)).bind(...valores),
    db.prepare(GRAVAR(condicao)).bind(...valores),
    db.prepare(LER_ITEM_SE_MUDOU).bind(pedidoId),
  ]);
  const mudado = item.results[0] as LinhaPedido | undefined;
  if (gravado.meta.changes > 0 && mudado)
    return { ok: true, item: itemDaLinha(mudado, true), mudou: true };

  const curta = await db
    .prepare(LER_CURTA)
    .bind(pedidoId, celulaId)
    .first<
      { celula_do_afiliado: number | null; celula_existe: number } & Omit<
        LinhaPedido,
        "id"
      > & { id: string | null }
    >();
  if (curta === null || curta.id === null)
    return { ok: false, motivo: "pedido_nao_encontrado" };
  const {
    celula_do_afiliado: doAfiliado,
    celula_existe: existe,
    ...linha
  } = curta;
  if (celulaId !== null) {
    if (doAfiliado !== null)
      return { ok: false, motivo: "pedido_ja_tem_celula" };
    if (existe === 0) return { ok: false, motivo: "celula_inexistente" };
  }
  return {
    ok: true,
    item: itemDaLinha({ ...linha, id: curta.id }, true),
    mudou: false,
  };
}
