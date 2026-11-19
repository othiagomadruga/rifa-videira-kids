/**
 * A planilha de compradores (RIFA-076, D36; GET /api/admin/pedidos/compradores, só admin): os pedidos da campanha
 * ativa que contam (sem os desconsiderados, D20), com o nome e o telefone gravados pelo webhook, juntados por
 * comprador (agruparCompradores, do contrato). Uma ida ao D1: a campanha, os pedidos e o registro na trilha num
 * db.batch. A trilha guarda só o filtro (o total de linhas sai depois da leitura e não cabe no mesmo lote), nunca
 * nomes ou telefones.
 *
 * Custo: lê todos os pedidos da campanha (uma linha por pedido, D10). É um botão que o admin aperta poucas vezes.
 */
import {
  agruparCompradores,
  montarCsvCompradores,
  type PedidoDoComprador,
} from "../../shared/contracts";
import { prepararRegistroAuditoria, type Autoria } from "./auditoria";

/** O alvo do registro na trilha (sem id: há uma planilha só). */
export const ALVO_AUDITORIA_COMPRADORES = "compradores";

const LER_CAMPANHA = "SELECT id, fuso_horario FROM campanhas WHERE ativa = 1";

const LER_PEDIDOS = `SELECT p.comprador_nome AS nome, p.comprador_telefone AS telefone, p.status, p.qtd_bilhetes,
    p.total_centavos, c.nome AS celula_nome, COALESCE(p.criado_em, p.registrado_em) AS reservado_em
  FROM pedidos AS p
  LEFT JOIN afiliados AS a ON a.affiliate_id = p.affiliate_id
  LEFT JOIN celulas AS c ON c.id = a.celula_id
  WHERE p.campanha_id = (SELECT id FROM campanhas WHERE ativa = 1)
    AND p.desconsiderado_em IS NULL
    AND (p.comprador_nome IS NOT NULL OR p.comprador_telefone IS NOT NULL)`;

export interface ExportacaoCompradores {
  csv: string;
  fuso: string;
  linhas: number;
}

/** null sem campanha ativa (nada é registrado na trilha). */
export async function exportarCompradores(
  db: D1Database,
  opcoes: { soPagou: boolean; autoria: Autoria },
): Promise<ExportacaoCompradores | null> {
  const [campanhas, pedidos] = await db.batch([
    db.prepare(LER_CAMPANHA),
    db.prepare(LER_PEDIDOS),
    prepararRegistroAuditoria(
      db,
      {
        ...opcoes.autoria,
        acao: "compradores.exportar",
        alvo: ALVO_AUDITORIA_COMPRADORES,
        resumo: opcoes.soPagou
          ? "Planilha de compradores baixada (só quem pagou)"
          : "Planilha de compradores baixada (todos)",
      },
      // Só com campanha ativa (sem ela, a rota responde 404 e nada fica na trilha).
      { sql: "EXISTS (SELECT 1 FROM campanhas WHERE ativa = 1)", valores: [] },
    ),
  ]);
  const campanha = campanhas.results[0] as
    { id: number; fuso_horario: string } | undefined;
  if (campanha === undefined) return null;
  const linhas = agruparCompradores(pedidos.results as PedidoDoComprador[], {
    soPagou: opcoes.soPagou,
  });
  return {
    csv: montarCsvCompradores(linhas, campanha.fuso_horario),
    fuso: campanha.fuso_horario,
    linhas: linhas.length,
  };
}
