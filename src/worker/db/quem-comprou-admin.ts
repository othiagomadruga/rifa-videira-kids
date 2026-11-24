/**
 * Quem comprou por célula, para o admin (RIFA-093, adendo da D36; GET /api/admin/quem-comprou/celulas e
 * GET /api/admin/celulas/:id/compradores). As duas leituras contam só as vendas pagas da campanha ativa que contam
 * (aprovadas, sem os desconsiderados, D20), pela célula EFETIVA (D41: a do afiliado; sem ela, a atribuída à mão).
 *
 * - `lerCelulasQuemComprou`: todas as células (as sem venda também) com o discipulador, os pedidos e os bilhetes, de
 *   mais bilhetes para menos (empate: o nome em português). Uma ida ao D1 (a campanha e um GROUP BY pela célula
 *   efetiva das vendas aprovadas da campanha, a mesma junção do painel).
 * - `lerCompradoresDaCelula`: uma página das vendas da célula, a MESMA consulta e o mesmo cursor do "Quem comprou" do
 *   líder (db/quem-comprou.ts, com o telefone do pedido e a origem da célula) e os totais da célula, num lote só.
 */
import type {
  CelulaQuemComprou,
  ConsultaQuemComprou,
  ItemCompradorDaCelula,
} from "../../shared/contracts";
import { celulaEfetiva, juntarAfiliado } from "./celula-efetiva";
import {
  LER_CAMPANHA,
  VENDAS_DA_CELULA,
  codificarCursorQuemComprou,
  comandoQuemComprou,
  type CursorQuemComprou,
} from "./quem-comprou";

const COMPARAR_PT = new Intl.Collator("pt-BR", { sensitivity: "base" });

/** As vendas que contam, por célula efetiva; as células sem venda entram com zero. */
export const COMANDO_CELULAS_QUEM_COMPROU = `SELECT c.id, c.nome, d.nome AS discipulador,
    coalesce(v.pedidos, 0) AS pedidos, coalesce(v.bilhetes, 0) AS bilhetes
  FROM celulas AS c
  JOIN discipuladores AS d ON d.id = c.discipulador_id
  LEFT JOIN (
    SELECT ${celulaEfetiva()} AS celula_id, count(*) AS pedidos, sum(p.qtd_bilhetes) AS bilhetes
    FROM pedidos AS p
    ${juntarAfiliado()}
    WHERE p.campanha_id = (SELECT id FROM campanhas WHERE ativa = 1)
      AND p.status = 'approved' AND p.desconsiderado_em IS NULL
    GROUP BY 1
  ) AS v ON v.celula_id = c.id`;

/** Mais bilhetes primeiro; empate, o nome em português. */
export function ordenarCelulasQuemComprou(
  celulas: readonly CelulaQuemComprou[],
): CelulaQuemComprou[] {
  return [...celulas].sort(
    (a, b) => b.bilhetes - a.bilhetes || COMPARAR_PT.compare(a.nome, b.nome),
  );
}

/** Todas as células com o que venderam. null = sem campanha ativa. */
export async function lerCelulasQuemComprou(
  db: D1Database,
): Promise<CelulaQuemComprou[] | null> {
  const [campanhas, linhas] = await db.batch([
    db.prepare(LER_CAMPANHA),
    db.prepare(COMANDO_CELULAS_QUEM_COMPROU),
  ]);
  if (campanhas.results.length === 0) return null;
  return ordenarCelulasQuemComprou(linhas.results as CelulaQuemComprou[]);
}

const LER_CELULA = "SELECT id, nome FROM celulas WHERE id = ?1";
const TOTAIS_DA_CELULA = `SELECT count(*) AS pedidos, coalesce(sum(p.qtd_bilhetes), 0) AS bilhetes
  FROM pedidos AS p
  WHERE ${VENDAS_DA_CELULA}`;

export type LeituraCompradoresDaCelula =
  | { tipo: "sem_campanha" }
  | { tipo: "sem_celula" }
  | {
      tipo: "ok";
      celula: { id: number; nome: string };
      fuso_horario: string;
      totais: { pedidos: number; bilhetes: number };
      itens: ItemCompradorDaCelula[];
      proximo: string | null;
    };

type LinhaComprador = Omit<ItemCompradorDaCelula, "pedido_id"> & {
  id: string;
};

/** Uma página das vendas pagas da célula `celulaId`, com os totais dela. */
export async function lerCompradoresDaCelula(
  db: D1Database,
  celulaId: number,
  consulta: Pick<ConsultaQuemComprou, "limite">,
  cursor: CursorQuemComprou | null,
): Promise<LeituraCompradoresDaCelula> {
  const [campanhas, celulas, totais, linhas] = await db.batch([
    db.prepare(LER_CAMPANHA),
    db.prepare(LER_CELULA).bind(celulaId),
    db.prepare(TOTAIS_DA_CELULA).bind(celulaId),
    db
      .prepare(comandoQuemComprou(cursor !== null, true))
      .bind(
        celulaId,
        consulta.limite + 1,
        ...(cursor === null ? [] : [cursor.aprovado_em, cursor.id]),
      ),
  ]);
  const campanha = campanhas.results[0] as
    { id: number; fuso_horario: string } | undefined;
  if (campanha === undefined) return { tipo: "sem_campanha" };
  const celula = celulas.results[0] as { id: number; nome: string } | undefined;
  if (celula === undefined) return { tipo: "sem_celula" };
  const todas = linhas.results as LinhaComprador[];
  const pagina = todas.slice(0, consulta.limite);
  const ultima = pagina.at(-1);
  return {
    tipo: "ok",
    celula: { id: celula.id, nome: celula.nome },
    fuso_horario: campanha.fuso_horario,
    totais: totais.results[0] as { pedidos: number; bilhetes: number },
    itens: pagina.map(
      ({ id, nome, telefone, aprovado_em, bilhetes, origem_celula }) => ({
        pedido_id: id,
        nome,
        telefone,
        aprovado_em,
        bilhetes,
        origem_celula,
      }),
    ),
    proximo:
      todas.length > consulta.limite && ultima !== undefined
        ? codificarCursorQuemComprou(ultima)
        : null,
  };
}
