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
 * Com `divisao`, só as vendas cuja célula EFETIVA é da divisão (RIFA-088, D41: a do afiliado, resolvida na leitura, D7,
 * ou, sem ela, a atribuída à mão): as sem célula ficam de fora, como no painel. O pedido desconsiderado pelo admin (D20) não
 * conta, como no painel: a coluna está na linha que a consulta já lê (nenhuma linha a mais). O `+` de
 * `+desconsiderado_em IS NULL` tira do planejador o índice parcial da 0003 recriado na 0008 (`status = 'approved' AND
 * desconsiderado_em IS NULL`), que a consulta satisfaria e que não cobre país e DDD: como os outros `+` abaixo.
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

/** As células da divisão (para a célula atribuída à mão, RIFA-088). */
const CELULAS_DA_DIVISAO = `
    SELECT c.id
    FROM celulas AS c
    JOIN discipuladores AS d ON d.id = c.discipulador_id
    JOIN redes AS r ON r.id = d.rede_id
    WHERE r.divisao = ?4`;

/**
 * A venda é da divisão pela célula EFETIVA (RIFA-088, D41): o afiliado numa célula da divisão, ou o pedido sem célula
 * pelo afiliado atribuído à mão a uma célula da divisão. Todos os termos com `+`: o pedido já foi lido pela janela
 * (`status, aprovado_em`), e o OR não pode levar o planejador a outro índice (o parcial da 0020 ou o por afiliado).
 */
const DA_DIVISAO = `
    AND (+affiliate_id IN (${AFILIADOS_DA_DIVISAO}
    )
      OR (+celula_atribuida_id IN (${CELULAS_DA_DIVISAO}
    )
        AND (+affiliate_id IS NULL OR +affiliate_id IN (SELECT affiliate_id FROM afiliados WHERE celula_id IS NULL))))`;

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
    daDivisao = DA_DIVISAO;
  }
  const sql = `
  SELECT pais, ddd, count(*) AS pedidos, sum(qtd_bilhetes) AS bilhetes, sum(total_centavos) AS centavos
  FROM pedidos
  WHERE status = 'approved' AND aprovado_em >= ?2 AND aprovado_em < ?3 AND +campanha_id = ?1
    AND +desconsiderado_em IS NULL${daDivisao}
  GROUP BY pais, ddd`;
  return { sql, valores };
}

/**
 * A janela como sai nos rankings (tipo, ordem, nome e datas), do próprio montador deles: sem células, ele só calcula
 * o calendário e o período da data de referência (hoje no fuso da campanha). Assim a janela do mapa é a dos
 * rankings por construção: `atual` é o período que contém hoje (antes do início, o primeiro; depois do fim, o último).
 */
export function janelaDosRankings(
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
      /** Hoje no fuso da campanha (`hojeNoFuso`), o fim da janela: a data do nome do arquivo do relatório (D23). */
      hoje: string;
      janela: JanelaRankingResposta;
      linhas: LinhaMapaDdd[];
    }
  | { ok: false; codigo: "nao_encontrado"; mensagem: string };

/**
 * Lê as vendas da janela agrupadas por país e DDD. Sem campanha ativa: 404 `nao_encontrado` (a mesma mensagem do
 * painel). Chama o relógio uma vez só e devolve o `hoje` que já calcula (o relatório por DDD, D23, o usa no nome do
 * arquivo, sem ida a mais).
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
  const hoje = hojeNoFuso(fuso, agora);
  const { sql, valores } = comandoMapaDdd(
    ativa.id,
    intervaloUtcDaJanela(janela, hoje, fuso),
    consulta.divisao,
  );
  const { results } = await db
    .prepare(sql)
    .bind(...valores)
    .all<LinhaMapaDdd>();
  return { ok: true, agora, hoje, janela, linhas: results };
}
