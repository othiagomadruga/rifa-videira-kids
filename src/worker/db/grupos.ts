/**
 * Leitura dos grupos para o ranking por grupo da coordenação (RIFA-084, D39; GET /api/painel/ranking-grupos). As
 * células herdam o grupo do discipulador, menos as que têm grupo próprio (RIFA-085, adendo da D39): essas valem no
 * grupo delas no nível célula. Quem não tem grupo nenhum fica de fora.
 *
 * Sem ida a mais ao banco: o comando vai no MESMO lote do cálculo (`comandosExtras` de `lerEntradaDoCalculo`), e lê
 * só os discipuladores que têm grupo (pelo índice `discipuladores_por_grupo` da migração 0018), as células que têm
 * grupo próprio (pelo índice `celulas_por_grupo` da 0019) e os grupos deles.
 */
import type { GrupoCalculo } from "../../shared/contracts";

/**
 * Cada discipulador com grupo e cada célula com grupo próprio, com o grupo (uma linha cada; o outro id fica null).
 * Grupo sem nenhum dos dois não aparece (não tem células). No UNION, o ORDER BY só enxerga os nomes (AS) do 1º SELECT.
 */
export const SELECIONAR_GRUPOS_DO_RANKING = `
  SELECT g.id AS id, g.nome AS nome, g.ordem AS ordem, d.id AS discipulador_id, NULL AS celula_id
  FROM discipuladores AS d
  JOIN grupos AS g ON g.id = d.grupo_id
  UNION ALL
  SELECT g.id, g.nome, g.ordem, NULL AS discipulador_id, c.id AS celula_id
  FROM celulas AS c
  JOIN grupos AS g ON g.id = c.grupo_id
  ORDER BY ordem, id, discipulador_id, celula_id`;

/** O comando do lote (no formato de `comandosExtras`). */
export const comandosDosGrupos = (db: D1Database): D1PreparedStatement[] => [
  db.prepare(SELECIONAR_GRUPOS_DO_RANKING),
];

type LinhaGrupo = {
  id: number;
  nome: string;
  ordem: number;
  discipulador_id: number | null;
  celula_id: number | null;
};

/** As linhas do comando, juntadas por grupo (a ordem e os grupos sem células ficam com o montador). */
export function gruposDoRanking(
  resultado: D1Result | undefined,
): GrupoCalculo[] {
  const grupos = new Map<
    number,
    GrupoCalculo & { discipuladores: number[]; celulas: number[] }
  >();
  for (const linha of (resultado?.results ?? []) as LinhaGrupo[]) {
    let grupo = grupos.get(linha.id);
    if (!grupo) {
      grupo = {
        id: linha.id,
        nome: linha.nome,
        ordem: linha.ordem,
        discipuladores: [],
        celulas: [],
      };
      grupos.set(linha.id, grupo);
    }
    if (linha.discipulador_id !== null)
      grupo.discipuladores.push(linha.discipulador_id);
    if (linha.celula_id !== null) grupo.celulas.push(linha.celula_id);
  }
  return [...grupos.values()];
}
