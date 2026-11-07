// Chamada da tela de rankings: GET /api/painel/ranking (coordenação, com valores). Contrato em
// docs/api.md e regras em docs/regras-de-calculo.md (R8: níveis, janela, critério, empates e situação).
//
// Do contrato vêm os tipos e os valores puros de calculos.ts (módulo sem zod) e, de api.ts, só o TIPO do
// catálogo ROTAS: os valores de api.ts poriam o zod no pacote do site (veja lib/api.ts). O caminho é uma
// cópia, conferida pelo tipo e por rankings-contrato.test.ts.
import type { ROTAS } from "../../../shared/contracts/api";
import type {
  Divisao,
  JanelaRanking,
  NivelRanking,
  RespostaRanking,
} from "../../../shared/contracts/calculos";
import { ErroApi, api } from "../../lib/api";

export const CAMINHO_RANKING: (typeof ROTAS)["painelRanking"]["caminho"] =
  "/api/painel/ranking";

/** O que a tela pede: nível, divisão (null = todas) e janela. Sem `data`: sempre hoje. */
export type FiltrosRanking = {
  nivel: NivelRanking;
  divisao: Divisao | null;
  periodo: JanelaRanking;
};

/** "/api/painel/ranking?nivel=celula&divisao=jovens&periodo=atual" (divisão só quando filtrada). */
export function caminhoDoRanking({
  nivel,
  divisao,
  periodo,
}: FiltrosRanking): string {
  const consulta = new URLSearchParams({ nivel });
  if (divisao) consulta.set("divisao", divisao);
  consulta.set("periodo", periodo);
  return `${CAMINHO_RANKING}?${consulta.toString()}`;
}

export function carregarRanking(
  caminho: string,
  opcoes: { signal?: AbortSignal } = {},
): Promise<RespostaRanking> {
  return api.get<RespostaRanking>(caminho, opcoes);
}

/** 404 nao_encontrado: não há campanha ativa (o ranking não existe ainda). */
export function ehSemCampanha(erro: unknown): boolean {
  return (
    erro instanceof ErroApi &&
    erro.status === 404 &&
    erro.codigo === "nao_encontrado"
  );
}
