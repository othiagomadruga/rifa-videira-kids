/**
 * Leitura dos maiores compradores (RIFA-083, D38; docs/api.md, "Maiores compradores"): os pedidos que contam na janela,
 * com o nome e o telefone gravados pela D36 e a célula do afiliado, para a regra única do contrato
 * (`classificarMaioresCompradores`). Este módulo só LÊ; quem junta, ordena e corta é a regra.
 *
 * A compra conta pela regra do ranking (R6), sem cópia dela, como o mapa por DDD (db/mapa-ddd.ts):
 * - a campanha: a ativa (`buscarCampanhaAtiva`); sem ela, 404;
 * - a janela: a dos rankings (`janelaDosRankings`: `atual` = o período que contém hoje; `campanha` = do primeiro dia),
 *   cortada em hoje, em UTC pelo `intervaloUtcDaJanela` (o dia local de `aprovado_em` dentro da janela, R6);
 * - só `approved`, sem os desconsiderados pelo admin (D20), com nome ou telefone (sem os dois, não há comprador);
 * - a célula: a do afiliado na leitura (D7); sem afiliado ou afiliado não vinculado, null ("sem célula").
 * Com `discipuladorId` (a rota da /minha, o alvo da sessão), só os pedidos dos afiliados das células dele.
 *
 * Custo (D10): duas idas ao banco (a campanha e os pedidos). A consulta desce pelo índice
 * `pedidos_por_status_aprovacao (status, aprovado_em)` só na janela (os `+` tiram campanha_id e desconsiderado_em do
 * planejador, como no mapa) e busca o afiliado e a célula pela chave: ~3 linhas lidas por pedido aprovado da janela.
 * Sem cache: o admin e os discipuladores são poucos, e a resposta traz nomes (é por pessoa).
 */
import {
  classificarMaioresCompradores,
  hojeNoFuso,
  type ConsultaMaioresCompradores,
  type JanelaRankingResposta,
  type MaiorComprador,
  type PedidoDoMaiorComprador,
} from "../../shared/contracts";
import { buscarCampanhaAtiva, montarCampanha } from "./campanha";
import type { ComandoSql } from "./lista-pedidos";
import { intervaloUtcDaJanela, janelaDosRankings } from "./mapa-ddd";
import type { Relogio } from "./painel";
import { juntarAfiliado, juntarCelulaEfetiva } from "./celula-efetiva";

/**
 * Os pedidos que contam: aprovados da campanha (?1) com `aprovado_em` em [?2, ?3), sem desconsideração, com nome ou
 * telefone; com `discipuladorId` (?4), só os das células dele.
 */
export function comandoMaioresCompradores(
  campanhaId: number,
  janelaUtc: { inicio: string; fim: string },
  discipuladorId?: number,
): ComandoSql {
  const valores: unknown[] = [campanhaId, janelaUtc.inicio, janelaUtc.fim];
  let doDiscipulador = "";
  if (discipuladorId !== undefined) {
    valores.push(discipuladorId);
    doDiscipulador = "\n    AND c.discipulador_id = ?4";
  }
  const sql = `
  SELECT p.comprador_nome AS nome, p.comprador_telefone AS telefone, p.qtd_bilhetes, p.total_centavos,
    c.nome AS celula_nome, p.aprovado_em
  FROM pedidos AS p
  ${juntarAfiliado()}
  ${juntarCelulaEfetiva()}
  WHERE p.status = 'approved' AND p.aprovado_em >= ?2 AND p.aprovado_em < ?3 AND +p.campanha_id = ?1
    AND +p.desconsiderado_em IS NULL
    AND (p.comprador_nome IS NOT NULL OR p.comprador_telefone IS NOT NULL)${doDiscipulador}`;
  return { sql, valores };
}

export type LeituraMaioresCompradores =
  | {
      ok: true;
      /** O instante único da requisição (o da janela e o `atualizado_em`). */
      agora: Date;
      janela: JanelaRankingResposta;
      /** Já classificados e cortados no `limite`. */
      compradores: MaiorComprador[];
    }
  | { ok: false; codigo: "nao_encontrado"; mensagem: string };

/**
 * Os maiores compradores da janela pedida. Sem campanha ativa: 404 `nao_encontrado` (a mesma mensagem do painel).
 * Chama o relógio uma vez só.
 */
export async function lerMaioresCompradores(
  db: D1Database,
  relogio: Relogio,
  consulta: ConsultaMaioresCompradores,
  escopo: { discipuladorId?: number } = {},
): Promise<LeituraMaioresCompradores> {
  const agora = relogio();
  const ativa = await buscarCampanhaAtiva(db);
  if (!ativa)
    return {
      ok: false,
      codigo: "nao_encontrado",
      mensagem: "A campanha ainda não foi configurada",
    };
  const campanha = montarCampanha(ativa);
  const janela = janelaDosRankings(campanha, consulta.janela, agora);
  const fuso = campanha.fuso_horario;
  const { sql, valores } = comandoMaioresCompradores(
    ativa.id,
    intervaloUtcDaJanela(janela, hojeNoFuso(fuso, agora), fuso),
    escopo.discipuladorId,
  );
  const { results } = await db
    .prepare(sql)
    .bind(...valores)
    .all<PedidoDoMaiorComprador>();
  return {
    ok: true,
    agora,
    janela,
    compradores: classificarMaioresCompradores(results, consulta.limite),
  };
}
