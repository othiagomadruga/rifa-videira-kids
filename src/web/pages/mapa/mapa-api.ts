// Chamada da tela Mapa (coordenação, com valores): GET /api/painel/mapa-ddd (docs/api.md, "Mapa de vendas por
// DDD"; D17). De onde vêm as vendas aprovadas, pelo DDD do telefone do comprador, por UF e por DDD.
//
// Do contrato vêm só os TIPOS de api.ts (os valores poriam o zod no pacote do site; veja lib/api.ts) e os valores
// puros de calculos.ts e ddd.ts (módulos sem zod). O caminho e os períodos são cópias, conferidas pelo tipo e por
// mapa-contrato.test.ts. Os filtros ficam na URL da tela, com os nomes e valores da consulta da API; os padrões
// dela (a campanha inteira, todas as divisões) ficam fora da URL.
import type { ROTAS, RespostaMapaDdd } from "../../../shared/contracts/api";
import {
  ORDEM_DIVISOES,
  type Divisao,
  type JanelaRanking,
} from "../../../shared/contracts/calculos";
import { ErroApi, api } from "../../lib/api";

export const CAMINHO_MAPA_DDD: (typeof ROTAS)["mapaDdd"]["caminho"] =
  "/api/painel/mapa-ddd";

/** Os períodos, na ordem do seletor (JANELAS_RANKING do contrato, conferido no teste). */
export const PERIODOS: readonly JanelaRanking[] = ["campanha", "atual"];

/** O que a tela pede: o período e a divisão (null = todas). */
export type FiltrosMapa = { periodo: JanelaRanking; divisao: Divisao | null };

/** O padrão da API: a campanha inteira (até hoje), todas as divisões. */
export const FILTROS_PADRAO: Readonly<FiltrosMapa> = {
  periodo: "campanha",
  divisao: null,
};

function escolher<T extends string>(
  opcoes: readonly T[],
  valor: string | null,
): T | undefined {
  return opcoes.find((opcao) => opcao === valor);
}

/** "campanha" ou "atual"; qualquer outro valor vale o padrão (a campanha). */
export function lerPeriodo(valor: string | null): JanelaRanking {
  return escolher(PERIODOS, valor) ?? FILTROS_PADRAO.periodo;
}

/** "jovens" ou "adultos"; qualquer outro valor (inclusive "" = todas) vira null. */
export function lerDivisao(valor: string | null): Divisao | null {
  return escolher(ORDEM_DIVISOES, valor) ?? null;
}

/** Lê os filtros da URL da tela; valor ausente ou desconhecido vale o padrão. */
export function lerFiltros(parametros: URLSearchParams): FiltrosMapa {
  return {
    periodo: lerPeriodo(parametros.get("periodo")),
    divisao: lerDivisao(parametros.get("divisao")),
  };
}

/** Os filtros como parâmetros da URL da tela, sem os que estão no padrão. */
export function parametrosDosFiltros(filtros: FiltrosMapa): URLSearchParams {
  const parametros = new URLSearchParams();
  if (filtros.periodo !== FILTROS_PADRAO.periodo)
    parametros.set("periodo", filtros.periodo);
  if (filtros.divisao) parametros.set("divisao", filtros.divisao);
  return parametros;
}

/** "/api/painel/mapa-ddd?periodo=campanha&divisao=jovens" (divisão só quando filtrada). */
export function caminhoDoMapa({ periodo, divisao }: FiltrosMapa): string {
  const consulta = new URLSearchParams({ periodo });
  if (divisao) consulta.set("divisao", divisao);
  return `${CAMINHO_MAPA_DDD}?${consulta.toString()}`;
}

export function carregarMapa(
  caminho: string,
  opcoes: { signal?: AbortSignal } = {},
): Promise<RespostaMapaDdd> {
  return api.get<RespostaMapaDdd>(caminho, opcoes);
}

/** 404 nao_encontrado: não há campanha ativa. */
export function ehSemCampanha(erro: unknown): boolean {
  return (
    erro instanceof ErroApi &&
    erro.status === 404 &&
    erro.codigo === "nao_encontrado"
  );
}
