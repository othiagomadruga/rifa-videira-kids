// Chamadas da tela pública ("/", o link do grupo de WhatsApp): só GET /api/publico/ranking, a rota aberta
// do ranking. Ela nunca devolve dinheiro nem quantidades: só posição, nome, divisão e, se a campanha
// permitir, o % da meta (docs/api.md e docs/regras-de-calculo.md, R9). Esta tela não chama nenhuma rota
// da coordenação, nem a da sessão.
//
// Do contrato vêm os tipos e os valores puros de calculos.ts (módulo sem zod) e, de api.ts, só o TIPO do
// catálogo ROTAS, que confere o caminho copiado aqui.
import type { ROTAS } from "../../../shared/contracts/api";
import {
  ORDEM_DIVISOES,
  type Divisao,
  type FaseCampanha,
  type ItemRankingPublico,
  type JanelaRanking,
  type JanelaRankingResposta,
  type ReferenciaCampanha,
  type RespostaRankingPublico,
} from "../../../shared/contracts/calculos";
import { ErroApi, api } from "../../lib/api";

export const CAMINHO_RANKING_PUBLICO: (typeof ROTAS)["rankingPublico"]["caminho"] =
  "/api/publico/ranking";

export type RankingDaDivisao = {
  /** null: o ranking único, de todas as células (a campanha não separa por divisão, D27). */
  divisao: Divisao | null;
  /** Só quem já vendeu, até o limite da campanha (a API corta; empates no limite entram todos). */
  itens: ItemRankingPublico[];
};

/** O ranking público das células: jovens e adultos, cada divisão um ranking separado (ou um só, D27). */
export type RankingPublico = {
  referencia: ReferenciaCampanha;
  janela: JanelaRankingResposta;
  /** Na ordem de ORDEM_DIVISOES (jovens, adultos); sem ranking por divisão, uma entrada só (divisão null). */
  divisoes: RankingDaDivisao[];
  /** A campanha separa o ranking por divisão (a resposta não traz `por_divisao: false`). */
  porDivisao: boolean;
  atualizadoEm: string;
};

/** O que a consulta anterior mostrou: a fase escolhe a janela; `porDivisao`, se pede uma ou duas listas. */
export type RankingConhecido = {
  fase: FaseCampanha | null;
  porDivisao: boolean;
};

/** Antes da 1ª resposta: a fase não se sabe e vale o padrão (separa por divisão). */
export const RANKING_DESCONHECIDO: RankingConhecido = {
  fase: null,
  porDivisao: true,
};

/** "/api/publico/ranking?nivel=celula&divisao=jovens&periodo=atual"; sem divisão (null), o ranking de todas. */
export function caminhoDoRankingPublico(
  divisao: Divisao | null,
  periodo: JanelaRanking,
): string {
  const consulta = new URLSearchParams({ nivel: "celula" });
  if (divisao) consulta.set("divisao", divisao);
  consulta.set("periodo", periodo);
  return `${CAMINHO_RANKING_PUBLICO}?${consulta.toString()}`;
}

/**
 * A janela que a tela mostra: antes e durante a campanha, o período atual (a disputa da semana); depois
 * do fim, a campanha inteira (o resultado final, como no bumbo).
 */
export function janelaDaFase(fase: FaseCampanha | null): JanelaRanking {
  return fase === "encerrada" ? "campanha" : "atual";
}

type Opcoes = { signal?: AbortSignal };

async function carregarDivisoes(
  periodo: JanelaRanking,
  porDivisao: boolean,
  opcoes: Opcoes,
): Promise<RankingPublico> {
  const pedidas = porDivisao ? ORDEM_DIVISOES : [null];
  const respostas = await Promise.all(
    pedidas.map((divisao) =>
      api.get<RespostaRankingPublico>(
        caminhoDoRankingPublico(divisao, periodo),
        opcoes,
      ),
    ),
  );
  const [primeira] = respostas;
  // Sem ranking por divisão, a API ignora a divisão pedida: as respostas são a mesma lista, de todas.
  const unico = primeira.por_divisao === false;
  return {
    referencia: primeira.referencia,
    janela: primeira.janela,
    divisoes: unico
      ? [{ divisao: null, itens: primeira.itens }]
      : respostas.map((resposta, indice) => ({
          divisao: pedidas[indice],
          itens: resposta.itens,
        })),
    porDivisao: !unico,
    atualizadoEm: primeira.atualizado_em,
  };
}

/**
 * Os rankings de jovens e de adultos (ou o único, D27). O `conhecido` (o da resposta anterior) escolhe a janela e
 * quantas listas pedir; se a resposta mostrar outra fase (ex.: a campanha acabou desde a última consulta), ou que a
 * campanha voltou a separar por divisão depois de um pedido sem divisão, pede de novo do jeito certo. Separar ou não
 * na 1ª consulta não custa uma ida a mais: os dois pedidos por divisão já trazem o ranking único.
 */
export async function carregarRankingPublico(
  conhecido: RankingConhecido,
  opcoes: Opcoes = {},
): Promise<RankingPublico> {
  const periodo = janelaDaFase(conhecido.fase);
  const ranking = await carregarDivisoes(periodo, conhecido.porDivisao, opcoes);
  const certa = janelaDaFase(ranking.referencia.fase);
  // Pedido sem divisão e a campanha separa: veio o ranking geral, e não os das divisões. O contrário não acontece: o
  // pedido por divisão já traz o ranking único.
  const faltamDivisoes = !conhecido.porDivisao && ranking.porDivisao;
  return certa === periodo && !faltamDivisoes
    ? ranking
    : carregarDivisoes(certa, ranking.porDivisao, opcoes);
}

/** 404 nao_encontrado: ainda não há campanha ativa. */
export function ehSemCampanha(erro: unknown): boolean {
  return (
    erro instanceof ErroApi &&
    erro.status === 404 &&
    erro.codigo === "nao_encontrado"
  );
}
