/**
 * Quem comprou, para o líder da célula (RIFA-089, adendo da D38; GET /api/minha/compradores): as vendas pagas da
 * campanha ativa que contam (aprovadas, sem os desconsiderados, D20) da célula da sessão, pela célula EFETIVA (D41:
 * os pedidos dos afiliados da célula e os atribuídos à mão a ela que não têm célula pelo afiliado), de `aprovado_em`
 * mais recente para o mais antigo (empate pelo id), com o cursor `(aprovado_em, id)`. Só lê: o nome do comprador, o
 * instante e os bilhetes; nunca o telefone, os números nem o valor (D12).
 *
 * Custo (D10): uma ida ao D1 (um lote com a campanha ativa e a página). A página é um MULTI-INDEX OR, como o filtro por
 * célula da lista de pedidos (db/lista-pedidos.ts): os afiliados da célula e os pedidos de cada um pelo índice por
 * afiliado, e os atribuídos pelo índice parcial da 0020; depois ordena numa B-tree temporária só os da célula. Os `+`
 * tiram do planejador os índices da campanha (0007) e de status (`pedidos_por_status_aprovacao`), que percorreriam a
 * campanha inteira para achar os poucos da célula. Testado em routes/quem-comprou.test.ts.
 */
import type {
  ConsultaQuemComprou,
  ItemQuemComprou,
} from "../../shared/contracts";
import { semCelulaDoAfiliado } from "./celula-efetiva";
import {
  codificarCursorPedidos,
  decodificarCursorPedidos,
} from "./lista-pedidos";

/** Posição na lista: a última venda da página anterior. */
export interface CursorQuemComprou {
  aprovado_em: string;
  id: string;
}

/**
 * O cursor tem a mesma forma do da lista de pedidos (base64url do JSON `[instante, id]`, conferido na forma canônica);
 * aqui o instante é o `aprovado_em`.
 */
export function codificarCursorQuemComprou(cursor: CursorQuemComprou): string {
  return codificarCursorPedidos({
    registrado_em: cursor.aprovado_em,
    id: cursor.id,
  });
}

export function decodificarCursorQuemComprou(
  texto: string,
): CursorQuemComprou | null {
  const cursor = decodificarCursorPedidos(texto);
  return cursor === null
    ? null
    : { aprovado_em: cursor.registrado_em, id: cursor.id };
}

const LER_CAMPANHA = "SELECT id, fuso_horario FROM campanhas WHERE ativa = 1";

/** A página: ?1 a célula, ?2 o limite + 1 e, com o cursor, ?3 e ?4. */
export function comandoQuemComprou(comCursor: boolean): string {
  return `SELECT p.id, p.comprador_nome AS nome, p.aprovado_em, p.qtd_bilhetes AS bilhetes
  FROM pedidos AS p
  WHERE +p.campanha_id = (SELECT id FROM campanhas WHERE ativa = 1)
    AND +p.status = 'approved' AND +p.desconsiderado_em IS NULL
    AND (p.affiliate_id IN (SELECT affiliate_id FROM afiliados WHERE celula_id = ?1)
      OR (p.celula_atribuida_id = ?1 AND ${semCelulaDoAfiliado()}))${
        comCursor ? "\n    AND (p.aprovado_em, p.id) < (?3, ?4)" : ""
      }
  ORDER BY p.aprovado_em DESC, p.id DESC
  LIMIT ?2`;
}

export interface LeituraQuemComprou {
  fuso_horario: string;
  itens: ItemQuemComprou[];
  proximo: string | null;
}

/** As vendas pagas da célula `celulaId`, uma página. null = sem campanha ativa. */
export async function lerQuemComprou(
  db: D1Database,
  celulaId: number,
  consulta: Pick<ConsultaQuemComprou, "limite">,
  cursor: CursorQuemComprou | null,
): Promise<LeituraQuemComprou | null> {
  const pagina = db
    .prepare(comandoQuemComprou(cursor !== null))
    .bind(
      celulaId,
      consulta.limite + 1,
      ...(cursor === null ? [] : [cursor.aprovado_em, cursor.id]),
    );
  const [campanhas, linhas] = await db.batch([
    db.prepare(LER_CAMPANHA),
    pagina,
  ]);
  const campanha = campanhas.results[0] as
    { id: number; fuso_horario: string } | undefined;
  if (campanha === undefined) return null;
  const todas = linhas.results as (ItemQuemComprou & { id: string })[];
  const itens = todas.slice(0, consulta.limite);
  const ultima = itens.at(-1);
  return {
    fuso_horario: campanha.fuso_horario,
    itens: itens.map(({ nome, aprovado_em, bilhetes }) => ({
      nome,
      aprovado_em,
      bilhetes,
    })),
    proximo:
      todas.length > consulta.limite && ultima !== undefined
        ? codificarCursorQuemComprou(ultima)
        : null,
  };
}
