// Filtros da tela de rankings na URL (/coordenacao/rankings?nivel=rede&divisao=jovens&periodo=campanha):
// o endereço guarda a escolha (dá para recarregar e compartilhar com a coordenação). Os nomes e valores
// são os da consulta da API; os padrões dela (célula, todas as divisões, período atual) ficam fora da URL.
import {
  ORDEM_DIVISOES,
  type Divisao,
  type JanelaRanking,
  type NivelRanking,
} from "../../../shared/contracts/calculos";
import type { FiltrosRanking } from "./rankings-api";

/** Os níveis, na ordem das abas (NIVEIS_RANKING do contrato, conferido no teste). */
export const NIVEIS: readonly NivelRanking[] = [
  "celula",
  "discipulador",
  "rede",
];

/** As janelas, na ordem do seletor (JANELAS_RANKING do contrato, conferido no teste). */
export const JANELAS: readonly JanelaRanking[] = ["atual", "campanha"];

export const FILTROS_PADRAO: Readonly<FiltrosRanking> = {
  nivel: "celula",
  divisao: null,
  periodo: "atual",
};

function escolher<T extends string>(
  opcoes: readonly T[],
  valor: string | null,
): T | undefined {
  return opcoes.find((opcao) => opcao === valor);
}

/** Lê os filtros da URL; valor ausente ou desconhecido vale o padrão. */
export function lerFiltros(parametros: URLSearchParams): FiltrosRanking {
  return {
    nivel: escolher(NIVEIS, parametros.get("nivel")) ?? FILTROS_PADRAO.nivel,
    divisao: lerDivisao(parametros.get("divisao")),
    periodo: lerJanela(parametros.get("periodo")),
  };
}

/** "jovens" ou "adultos"; qualquer outro valor (inclusive "" = todas) vira null. */
export function lerDivisao(valor: string | null): Divisao | null {
  return escolher(ORDEM_DIVISOES, valor) ?? null;
}

/** "atual" ou "campanha"; qualquer outro valor vale o padrão (período atual). */
export function lerJanela(valor: string | null): JanelaRanking {
  return escolher(JANELAS, valor) ?? FILTROS_PADRAO.periodo;
}

/** Os filtros como parâmetros da URL da tela, sem os que estão no padrão. */
export function parametrosDosFiltros(filtros: FiltrosRanking): URLSearchParams {
  const parametros = new URLSearchParams();
  if (filtros.nivel !== FILTROS_PADRAO.nivel)
    parametros.set("nivel", filtros.nivel);
  if (filtros.divisao) parametros.set("divisao", filtros.divisao);
  if (filtros.periodo !== FILTROS_PADRAO.periodo)
    parametros.set("periodo", filtros.periodo);
  return parametros;
}
