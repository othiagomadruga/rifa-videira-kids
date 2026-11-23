/**
 * Leitura dos grupos do discipulador para o ranking por grupo da coordenação (RIFA-084, D39;
 * GET /api/painel/ranking-grupos). As células herdam o grupo do discipulador; quem não tem grupo fica de fora.
 *
 * Sem ida a mais ao banco: o comando vai no MESMO lote do cálculo (`comandosExtras` de `lerEntradaDoCalculo`), e lê
 * só os discipuladores que têm grupo (pelo índice `discipuladores_por_grupo` da migração 0018) e os 4 grupos.
 */
import type { GrupoCalculo } from "../../shared/contracts";

/** Cada discipulador com grupo, com o grupo dele. Grupo sem discipulador não aparece (não tem células). */
export const SELECIONAR_GRUPOS_DO_RANKING = `
  SELECT g.id, g.nome, g.ordem, d.id AS discipulador_id
  FROM discipuladores AS d
  JOIN grupos AS g ON g.id = d.grupo_id
  ORDER BY g.ordem, g.id, d.id`;

/** O comando do lote (no formato de `comandosExtras`). */
export const comandosDosGrupos = (db: D1Database): D1PreparedStatement[] => [
  db.prepare(SELECIONAR_GRUPOS_DO_RANKING),
];

type LinhaGrupo = {
  id: number;
  nome: string;
  ordem: number;
  discipulador_id: number;
};

/** As linhas do comando, juntadas por grupo (a ordem e os grupos sem células ficam com o montador). */
export function gruposDoRanking(
  resultado: D1Result | undefined,
): GrupoCalculo[] {
  const grupos = new Map<number, GrupoCalculo & { discipuladores: number[] }>();
  for (const linha of (resultado?.results ?? []) as LinhaGrupo[]) {
    const grupo = grupos.get(linha.id);
    if (grupo) grupo.discipuladores.push(linha.discipulador_id);
    else
      grupos.set(linha.id, {
        id: linha.id,
        nome: linha.nome,
        ordem: linha.ordem,
        discipuladores: [linha.discipulador_id],
      });
  }
  return [...grupos.values()];
}
