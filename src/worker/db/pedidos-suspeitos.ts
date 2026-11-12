/**
 * Pedidos aprovados marcados como implausíveis pelo webhook (RIFA-013b; migrations/0005_auditoria.sql e
 * lib/plausibilidade.ts). A marcação vai no mesmo db.batch que aprova o pedido; a leitura é a lista de
 * revisão da coordenação (GET /api/admin/pedidos/suspeitos). Sem nenhum dado do comprador (D1).
 */
import {
  LIMITE_PEDIDOS_SUSPEITOS,
  type MotivoDesconsideracao,
  type PedidoSuspeito,
  type RespostaPedidosSuspeitos,
} from "../../shared/contracts";
import type { MotivoSuspeita } from "../lib/plausibilidade";

export interface MarcacaoSuspeito {
  pedidoId: string;
  qtdBilhetes: number;
  totalCentavos: number;
  esperadoCentavos: number;
  motivos: readonly MotivoSuspeita[];
  /** Instante do recebimento do evento que aprovou o pedido. */
  marcadoEm: string;
}

/**
 * Para o db.batch do processamento (db/pedidos.ts), DEPOIS da gravação do pedido: só marca se o pedido
 * ficou aprovado POR ESTE evento (`atualizado_em` é o instante do recebimento dele). Se outra entrega
 * gravou antes, a gravação deste evento não acontece, e a marcação também não.
 */
export function prepararMarcacaoSuspeito(
  db: D1Database,
  marcacao: MarcacaoSuspeito,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO pedidos_suspeitos
         (pedido_id, qtd_bilhetes, total_centavos, esperado_centavos, motivos, marcado_em)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6
       WHERE EXISTS (SELECT 1 FROM pedidos
                     WHERE id = ?1 AND status = 'approved' AND atualizado_em = ?6)
       ON CONFLICT (pedido_id) DO UPDATE SET
         qtd_bilhetes = excluded.qtd_bilhetes,
         total_centavos = excluded.total_centavos,
         esperado_centavos = excluded.esperado_centavos,
         motivos = excluded.motivos,
         marcado_em = excluded.marcado_em`,
    )
    .bind(
      marcacao.pedidoId,
      marcacao.qtdBilhetes,
      marcacao.totalCentavos,
      marcacao.esperadoCentavos,
      JSON.stringify(marcacao.motivos),
      marcacao.marcadoEm,
    );
}

interface LinhaSuspeito extends Omit<
  PedidoSuspeito,
  "motivos" | "desconsiderado"
> {
  motivos: string;
  desconsiderado_em: string | null;
  desconsiderado_motivo: MotivoDesconsideracao | null;
  desconsiderado_observacao: string | null;
}

/**
 * Os pedidos marcados da campanha ativa, o mais recente primeiro (no máximo LIMITE_PEDIDOS_SUSPEITOS), com
 * a célula atual do afiliado (D7: o pedido conta para ela) e o total de marcados. Lê só as linhas
 * marcadas (e as suas junções), nunca a tabela de pedidos inteira. O pedido que o admin desconsiderou (D20)
 * continua na lista e no total, com `desconsiderado` (a revisão terminou); as colunas estão na linha de pedidos
 * que o JOIN já lê.
 */
export async function listarPedidosSuspeitos(
  db: D1Database,
): Promise<RespostaPedidosSuspeitos> {
  // As duas leituras no mesmo lote (uma transação): o total bate com a lista.
  const [itens, contagem] = await db.batch([
    db
      .prepare(
        `SELECT s.pedido_id, p.affiliate_id, a.celula_id, c.nome AS celula_nome,
                s.qtd_bilhetes, s.total_centavos, s.esperado_centavos, s.motivos,
                p.aprovado_em, s.marcado_em, p.desconsiderado_em, p.desconsiderado_motivo,
                p.desconsiderado_observacao
         FROM pedidos_suspeitos AS s
         JOIN pedidos AS p ON p.id = s.pedido_id
         LEFT JOIN afiliados AS a ON a.affiliate_id = p.affiliate_id
         LEFT JOIN celulas AS c ON c.id = a.celula_id
         WHERE p.campanha_id = (SELECT id FROM campanhas WHERE ativa = 1)
         ORDER BY s.marcado_em DESC, s.pedido_id
         LIMIT ?1`,
      )
      .bind(LIMITE_PEDIDOS_SUSPEITOS),
    db.prepare(
      `SELECT count(*) AS total
       FROM pedidos_suspeitos AS s JOIN pedidos AS p ON p.id = s.pedido_id
       WHERE p.campanha_id = (SELECT id FROM campanhas WHERE ativa = 1)`,
    ),
  ]);
  return {
    itens: (itens.results as LinhaSuspeito[]).map(
      ({
        desconsiderado_em: em,
        desconsiderado_motivo: motivo,
        desconsiderado_observacao: observacao,
        ...linha
      }) => ({
        ...linha,
        motivos: JSON.parse(linha.motivos) as PedidoSuspeito["motivos"],
        desconsiderado:
          em === null || motivo === null ? null : { motivo, observacao, em },
      }),
    ),
    total: (contagem.results[0] as { total: number } | undefined)?.total ?? 0,
  };
}
