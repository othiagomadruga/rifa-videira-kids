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
  divisao: Divisao;
  /** Só quem já vendeu, até o limite da campanha (a API corta; empates no limite entram todos). */
  itens: ItemRankingPublico[];
};

/** O ranking público das células: jovens e adultos, cada divisão um ranking separado. */
export type RankingPublico = {
  referencia: ReferenciaCampanha;
  janela: JanelaRankingResposta;
  /** Na ordem de ORDEM_DIVISOES (jovens, adultos). */
  divisoes: RankingDaDivisao[];
  atualizadoEm: string;
};

/** "/api/publico/ranking?nivel=celula&divisao=jovens&periodo=atual". */
export function caminhoDoRankingPublico(
  divisao: Divisao,
  periodo: JanelaRanking,
): string {
  const consulta = new URLSearchParams({ nivel: "celula", divisao, periodo });
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
  opcoes: Opcoes,
): Promise<RankingPublico> {
  const respostas = await Promise.all(
    ORDEM_DIVISOES.map((divisao) =>
      api.get<RespostaRankingPublico>(
        caminhoDoRankingPublico(divisao, periodo),
        opcoes,
      ),
    ),
  );
  const [primeira] = respostas;
  return {
    referencia: primeira.referencia,
    janela: primeira.janela,
    divisoes: respostas.map((resposta, indice) => ({
      divisao: ORDEM_DIVISOES[indice],
      itens: resposta.itens,
    })),
    atualizadoEm: primeira.atualizado_em,
  };
}

/**
 * Os rankings de jovens e de adultos. `faseConhecida` (a da resposta anterior) escolhe a janela; se a
 * resposta mostrar outra fase (ex.: a campanha acabou desde a última consulta), pede de novo na janela certa.
 */
export async function carregarRankingPublico(
  faseConhecida: FaseCampanha | null,
  opcoes: Opcoes = {},
): Promise<RankingPublico> {
  const periodo = janelaDaFase(faseConhecida);
  const ranking = await carregarDivisoes(periodo, opcoes);
  const certa = janelaDaFase(ranking.referencia.fase);
  return certa === periodo ? ranking : carregarDivisoes(certa, opcoes);
}

/** 404 nao_encontrado: ainda não há campanha ativa. */
export function ehSemCampanha(erro: unknown): boolean {
  return (
    erro instanceof ErroApi &&
    erro.status === 404 &&
    erro.codigo === "nao_encontrado"
  );
}
