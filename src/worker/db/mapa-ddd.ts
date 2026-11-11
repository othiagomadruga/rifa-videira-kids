/**
 * Leitura do mapa de vendas por DDD (RIFA-015, D17; docs/api.md, "Mapa de vendas por DDD"). Este módulo só LÊ o
 * banco, de forma agregada; a conta do mapa (DDD → UF, partes e ordem) é de lib/mapa-ddd.ts.
 *
 * A venda conta pela regra do painel (R6), sem cópia da regra:
 * - a campanha: a ativa, por `buscarCampanhaAtiva` (a mesma leitura do painel); sem ela, 404;
 * - a janela: a dos rankings, tirada do próprio montador deles (`montarRankingPainel` sem células: só o calendário
 *   e o período atual), e cortada em hoje (`hojeNoFuso`), como o realizado do painel e dos rankings (os dias depois
 *   da data de referência não entram);
 * - o dia local de `aprovado_em`: a venda conta se ele está entre o primeiro e o último dia da janela, ou seja, se
 *   `aprovado_em` está em `[início do primeiro dia, fim do último dia)` em UTC, pelo `intervaloUtcDoDia` do contrato
 *   (R6; texto UTC no mesmo formato: a ordem alfabética é a cronológica). Vale para qualquer fuso, com ou sem
 *   horário de verão, e é o mesmo conjunto que o painel separa por dia.
 * Com `divisao`, só as vendas cujo afiliado está numa célula da divisão (D7, a célula resolvida na leitura): as sem
 * afiliado e as de afiliado não vinculado ficam de fora, como no painel.
 *
 * Custo (D10; src/worker/db/mapa-ddd-desempenho.test.ts, com 7 mil pedidos): duas idas ao banco (a campanha e a
 * consulta agregada). A consulta desce pelo índice `pedidos_por_status_aprovacao (status, aprovado_em)` só na
 * janela e agrupa por país e DDD numa B-tree temporária, que o D1 também conta: ~2 linhas lidas por pedido
 * aprovado da janela. Os `+` tiram campanha_id e affiliate_id do planejador: o índice da migração 0003 (campanha,
 * afiliado, dia...) não cobre país e DDD, e o de (affiliate_id, status) leria os pedidos aprovados de todas as
 * datas. Hoje o planejador já escolhe (status, aprovado_em) sem eles (conferido na revisão, com e sem ANALYZE, e com
 * uma divisão de um afiliado só); os `+` são a garantia de que estatísticas novas não o levem àqueles índices. Sem
 * índice novo (D17). Nenhum dado do comprador além de país e DDD é lido.
 */
import {
  diasEntre,
  hojeNoFuso,
  intervaloUtcDoDia,
  montarRankingPainel,
  type Campanha,
  type ConsultaMapaDdd,
  type JanelaRankingResposta,
} from "../../shared/contracts";
import { buscarCampanhaAtiva, montarCampanha } from "./campanha";
import type { ComandoSql } from "./lista-pedidos";
import type { Relogio } from "./painel";

/** Vendas aprovadas da janela de um país e DDD (`pais` e `ddd` como estão em pedidos). */
export interface LinhaMapaDdd {
  pais: string | null;
  ddd: string | null;
  pedidos: number;
  bilhetes: number;
  centavos: number;
}

/** Os afiliados vinculados a uma célula da divisão (D7): a célula, o discipulador e a rede dela. */
const AFILIADOS_DA_DIVISAO = `
    SELECT a.affiliate_id
    FROM afiliados AS a
    JOIN celulas AS c ON c.id = a.celula_id
    JOIN discipuladores AS d ON d.id = c.discipulador_id
    JOIN redes AS r ON r.id = d.rede_id
    WHERE r.divisao = ?4`;

/**
 * A consulta agregada do mapa: pedidos aprovados da campanha (?1) com `aprovado_em` em [?2, ?3), por país e DDD;
 * com `divisao` (?4), só os dos afiliados da divisão.
 */
export function comandoMapaDdd(
  campanhaId: number,
  janelaUtc: { inicio: string; fim: string },
  divisao: ConsultaMapaDdd["divisao"],
): ComandoSql {
  const valores: unknown[] = [campanhaId, janelaUtc.inicio, janelaUtc.fim];
  let daDivisao = "";
  if (divisao !== undefined) {
    valores.push(divisao);
    daDivisao = `\n    AND +affiliate_id IN (${AFILIADOS_DA_DIVISAO}\n    )`;
  }
  const sql = `
  SELECT pais, ddd, count(*) AS pedidos, sum(qtd_bilhetes) AS bilhetes, sum(total_centavos) AS centavos
  FROM pedidos
  WHERE status = 'approved' AND aprovado_em >= ?2 AND aprovado_em < ?3 AND +campanha_id = ?1${daDivisao}
  GROUP BY pais, ddd`;
  return { sql, valores };
}

/**
 * A janela como sai nos rankings (tipo, ordem, nome e datas), do próprio montador deles: sem células, ele só calcula
 * o calendário e o período da data de referência (hoje no fuso da campanha). Assim a janela do mapa é a dos
 * rankings por construção: `atual` é o período que contém hoje (antes do início, o primeiro; depois do fim, o último).
 */
function janelaDosRankings(
  campanha: Campanha,
  periodo: ConsultaMapaDdd["periodo"],
  agora: Date,
): JanelaRankingResposta {
  return montarRankingPainel(
    { campanha, celulas: [], vendas: [] },
    { nivel: "celula", periodo },
    agora,
  ).janela;
}

/**
 * Intervalo UTC em que uma venda conta no mapa: do início do primeiro dia da janela ao fim do último dia que já
 * chegou (o último da janela ou hoje, o que vier antes). Antes do primeiro dia da janela, o intervalo fica vazio
 * (`fim ≤ inicio`) e a consulta não acha nada.
 */
export function intervaloUtcDaJanela(
  janela: Pick<JanelaRankingResposta, "data_inicio" | "data_fim">,
  hoje: string,
  fuso: string,
): { inicio: string; fim: string } {
  const ultimo = diasEntre(hoje, janela.data_fim) > 0 ? hoje : janela.data_fim;
  return {
    inicio: intervaloUtcDoDia(janela.data_inicio, fuso).inicio,
    fim: intervaloUtcDoDia(ultimo, fuso).fim,
  };
}

export type LeituraMapaDdd =
  | {
      ok: true;
      /** O instante único da requisição (o da janela e o `atualizado_em`). */
      agora: Date;
      janela: JanelaRankingResposta;
      linhas: LinhaMapaDdd[];
    }
  | { ok: false; codigo: "nao_encontrado"; mensagem: string };

/**
 * Lê as vendas da janela agrupadas por país e DDD. Sem campanha ativa: 404 `nao_encontrado` (a mesma mensagem do
 * painel). Chama o relógio uma vez só.
 */
export async function lerMapaDdd(
  db: D1Database,
  relogio: Relogio,
  consulta: ConsultaMapaDdd,
): Promise<LeituraMapaDdd> {
  const agora = relogio();
  const ativa = await buscarCampanhaAtiva(db);
  if (!ativa)
    return {
      ok: false,
      codigo: "nao_encontrado",
      mensagem: "A campanha ainda não foi configurada",
    };
  const campanha = montarCampanha(ativa);
  const janela = janelaDosRankings(campanha, consulta.periodo, agora);
  const fuso = campanha.fuso_horario;
  const { sql, valores } = comandoMapaDdd(
    ativa.id,
    intervaloUtcDaJanela(janela, hojeNoFuso(fuso, agora), fuso),
    consulta.divisao,
  );
  const { results } = await db
    .prepare(sql)
    .bind(...valores)
    .all<LinhaMapaDdd>();
  return { ok: true, agora, janela, linhas: results };
}
