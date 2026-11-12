/**
 * Leitura do relatório da campanha para baixar (RIFA-038; docs/decisions.md D23). Nenhuma consulta daqui SOMA
 * pedidos: os seis tipos do painel leem pela leitura do painel (`lerEntradaDoCalculo`, db/painel.ts) e o `ddd` pela do
 * mapa (`lerMapaDdd`, db/mapa-ddd.ts), que já excluem o desconsiderado (D20). Aqui ficam só os dois comandos a mais,
 * que vão NO MESMO lote da leitura do painel (`comandosExtras`): duas idas ao D1 por download em todos os tipos (a
 * campanha ativa e um lote; no `ddd`, a campanha e a consulta do mapa), D10.
 * - Os líderes, só em `celulas`: `id, lider_nome` e nada mais (nunca `lider_telefone` nem `lider_email`). Uma linha
 *   lida por célula.
 * - A contagem dos desconsiderados, só em `totais`: só o número, de qualquer status, da campanha ativa (o id vem da
 *   1ª ida, sem subconsulta). Desce pelo índice parcial `pedidos_desconsiderados_por_registro` (0008, `WHERE
 *   desconsiderado_em IS NOT NULL`) só na campanha: o plano sai `USING INDEX`, não `USING COVERING INDEX`, porque a
 *   coluna do filtro não está no índice (o SQLite só dispensa a tabela para os termos `coluna = constante` de um
 *   índice parcial; a mesma nota da 0008 em docs/modelo-de-dados.md), e um índice de cobertura seria índice novo. O
 *   D1 conta só as entradas do índice percorridas: N linhas lidas para N desconsiderados (N + 1 se o índice tem
 *   desconsiderados de uma campanha de id maior). Plano e linhas travados em routes/relatorio-desempenho.test.ts.
 */
import type { ExtrasDoRelatorio, TipoDoPainel } from "../lib/relatorio";

/** O nome do líder de cada célula (só o nome, como na hierarquia). */
export const SELECIONAR_LIDERES = "SELECT id, lider_nome FROM celulas";

/** Quantos pedidos da campanha (?1) estão desconsiderados, de qualquer status (D20). Só conta. */
export const CONTAR_DESCONSIDERADOS = `
  SELECT count(*) AS total
  FROM pedidos
  WHERE campanha_id = ?1 AND desconsiderado_em IS NOT NULL`;

/** Os comandos a mais do tipo, para o lote de `lerEntradaDoCalculo` (nenhum fora de `celulas` e `totais`). */
export function comandosDoRelatorio(tipo: TipoDoPainel) {
  return (db: D1Database, campanhaId: number): D1PreparedStatement[] => {
    if (tipo === "celulas") return [db.prepare(SELECIONAR_LIDERES)];
    if (tipo === "totais")
      return [db.prepare(CONTAR_DESCONSIDERADOS).bind(campanhaId)];
    return [];
  };
}

/** Os resultados dos comandos a mais (`extras` da leitura), na forma que o montador do relatório recebe. */
export function extrasDoRelatorio(
  tipo: TipoDoPainel,
  extras: readonly D1Result[],
): ExtrasDoRelatorio {
  if (tipo === "celulas") {
    const linhas = extras[0].results as { id: number; lider_nome: string }[];
    return {
      lideres: new Map(linhas.map((linha) => [linha.id, linha.lider_nome])),
      desconsiderados: null,
    };
  }
  if (tipo === "totais") {
    const [linha] = extras[0].results as { total: number }[];
    return { lideres: null, desconsiderados: linha.total };
  }
  return { lideres: null, desconsiderados: null };
}
