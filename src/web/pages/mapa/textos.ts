// Textos, faixas de cor e formatos da tela Mapa (coordenação: aqui os valores em R$ aparecem).
import type { RespostaMapaDdd } from "../../../shared/contracts/api";
import {
  NOMES_DIVISAO,
  type Divisao,
  type JanelaRanking,
} from "../../../shared/contracts/calculos";
import { NOME_DA_UF, type Uf } from "../../../shared/contracts/ddd";
import {
  formatarMoeda,
  formatarNumero,
  formatarPercentual,
} from "../../lib/formatadores";

/** Pedidos aprovados, bilhetes, centavos e a parte dos bilhetes de um recorte (UF, DDD, exterior...). */
export type TotaisMapa = RespostaMapaDdd["total"];
export type UfDoMapa = RespostaMapaDdd["ufs"][number];
export type DddDoMapa = RespostaMapaDdd["ddds"][number];

/** Opções do seletor de período (curtas; o resumo mostra o nome e as datas da janela). */
export const TEXTO_PERIODO: Record<JanelaRanking, string> = {
  campanha: "Campanha inteira",
  atual: "Período atual",
};

/**
 * Faixas da cor do mapa, pela parte dos bilhetes (pontos-base): a faixa N começa em LIMITES_DAS_FAIXAS[N - 2]
 * (a 1 começa em qualquer venda). Faixas fixas (e não proporcionais ao maior estado): em Belém quase tudo vem do
 * Pará, e uma escala contínua deixaria todos os outros estados da mesma cor clara.
 */
export const LIMITES_DAS_FAIXAS = [100, 500, 1500, 4000] as const;

/** 0 = sem venda (neutro); 1 a 5 = da menor para a maior parte dos bilhetes. */
export type Faixa = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * A faixa de uma UF. Quem vendeu fica pelo menos na 1, mesmo com a parte truncada em 0 pontos-base (um bilhete
 * entre dezenas de milhares): só a UF sem venda fica neutra.
 */
export function faixaDaUf(totais: TotaisMapa | undefined): Faixa {
  if (!totais || !temVenda(totais)) return 0;
  const acima = LIMITES_DAS_FAIXAS.filter(
    (limite) => totais.parte_bilhetes_bp >= limite,
  ).length;
  return (1 + acima) as Faixa;
}

export function temVenda(totais: TotaisMapa): boolean {
  return totais.pedidos_aprovados > 0 || totais.bilhetes > 0;
}

/** O texto de cada faixa, na legenda. */
export const ROTULO_DA_FAIXA: Record<Faixa, string> = {
  0: "Sem venda",
  1: "Menos de 1%",
  2: "1% a 5%",
  3: "5% a 15%",
  4: "15% a 40%",
  5: "40% ou mais",
};

export function textoPedidos(quantidade: number): string {
  return `${formatarNumero(quantidade)} ${quantidade === 1 ? "pedido aprovado" : "pedidos aprovados"}`;
}

export function textoBilhetes(quantidade: number): string {
  return `${formatarNumero(quantidade)} ${quantidade === 1 ? "bilhete" : "bilhetes"}`;
}

/**
 * A parte dos bilhetes com uma casa ("72,3%"). Abaixo de 0,1% com venda, "menos de 0,1%" (truncar daria "0,0%",
 * como se não houvesse venda).
 */
export function textoParte(totais: TotaisMapa): string {
  if (totais.bilhetes > 0 && totais.parte_bilhetes_bp < 10) {
    return "menos de 0,1%";
  }
  return formatarPercentual(totais.parte_bilhetes_bp, { casasDecimais: 1 });
}

/** O rótulo completo de uma UF no mapa (o nome acessível do quadrado). */
export function rotuloDaUf(uf: Uf, totais: TotaisMapa | undefined): string {
  const nome = NOME_DA_UF[uf];
  if (!totais || !temVenda(totais)) return `${nome}: sem venda`;
  return `${nome}: ${textoPedidos(totais.pedidos_aprovados)}, ${textoBilhetes(totais.bilhetes)}, ${formatarMoeda(totais.total_centavos)}, ${textoParte(totais)} dos bilhetes`;
}

/** ", divisão Jovens" (sem divisão, nada), para o vazio e o anúncio. */
export function textoDaDivisao(divisao: Divisao | null): string {
  return divisao ? `, divisão ${NOMES_DIVISAO[divisao]}` : "";
}

/**
 * Posição dos DDDs que mais venderam bilhetes, só até a 3ª (empates dividem a posição: 1º, 1º, 3º). A API manda os
 * DDDs agrupados por UF, então o top 3 é calculado aqui.
 */
export function posicoesDoTop3(
  ddds: readonly DddDoMapa[],
): ReadonlyMap<string, number> {
  const comVenda = ddds.filter((item) => item.bilhetes > 0);
  const posicoes = new Map<string, number>();
  for (const item of comVenda) {
    const posicao =
      1 + comVenda.filter((outro) => outro.bilhetes > item.bilhetes).length;
    if (posicao <= 3) posicoes.set(item.ddd, posicao);
  }
  return posicoes;
}

/** "Pará, Amapá e Roraima" (os estados sem venda, por extenso). */
export function listaDeNomes(nomes: readonly string[]): string {
  if (nomes.length <= 1) return nomes.join("");
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}
