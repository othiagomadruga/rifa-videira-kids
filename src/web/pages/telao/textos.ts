// Textos do telão: onde a campanha está (curto, para caber no topo com letra grande) e o corte de cada
// lista para caber na tela sem rolagem. Só datas, dias, posições e nomes (e o % da meta, quando a API o
// traz): nenhum valor em dinheiro nem quantidade (regra em docs/frontend.md).
import type {
  ItemRankingPublico,
  ReferenciaCampanha,
} from "../../../shared/contracts/calculos";
import { formatarData } from "../../lib/formatadores";

/** "2026-12-03" → "03/12". */
const diaEMes = (data: string) => formatarData(data).slice(0, 5);

export type FaseDoTelao = {
  /** Em destaque no topo: "Dia 12 de 24", "Começa em 3 dias", "Começa amanhã", "Campanha encerrada". */
  destaque: string;
  detalhe: string;
};

/** Onde a campanha está hoje (a `referencia` da resposta: a data é a do servidor, no fuso da campanha). */
export function faseDoTelao(referencia: ReferenciaCampanha): FaseDoTelao {
  const vendas = `Vendas de ${diaEMes(referencia.data_inicio)} a ${diaEMes(referencia.data_fim)}`;
  if (referencia.fase === "antes") {
    const faltam = referencia.dias_para_inicio ?? 1;
    return {
      destaque: faltam === 1 ? "Começa amanhã" : `Começa em ${faltam} dias`,
      detalhe: vendas,
    };
  }
  if (referencia.fase === "encerrada")
    return {
      destaque: "Campanha encerrada",
      detalhe: `Terminou em ${formatarData(referencia.data_fim)}`,
    };
  // dias_restantes conta hoje: no último dia vale 1.
  const restantes = referencia.dias_restantes;
  return {
    destaque: `Dia ${referencia.dia_campanha ?? 1} de ${referencia.duracao_dias}`,
    detalhe:
      restantes <= 1 ? "Hoje é o último dia" : `Faltam ${restantes} dias`,
  };
}

/**
 * Linhas de cada divisão no telão, contando a do "e mais": o que cabe em 1920×1080 (e em 1280×720) com
 * as letras do tamanho de ler a 8 m, mesmo com nomes de duas linhas. É o mesmo limite de nomes por
 * divisão do bumbo (NOMES_POR_DIVISAO_NO_BUMBO).
 */
export const LINHAS_POR_DIVISAO = 5;

export type ListaDoTelao = {
  itens: ItemRankingPublico[];
  /** "e mais 3 empatadas no 3º lugar" (ou "e mais 5 células"); null quando todos cabem. */
  resto: string | null;
};

/**
 * Quantas colunas a lista ocupa: com as duas divisões, uma cada. Sem ranking por divisão (D27), a lista única tem a
 * tela toda: até LINHAS_POR_DIVISAO itens, uma coluna larga; acima disso, a mesma lista em duas colunas (de cima para
 * baixo, depois a da direita), que cabem o dobro de linhas.
 */
export function colunasDaLista(unica: boolean, itens: number): 1 | 2 {
  return unica && itens > LINHAS_POR_DIVISAO ? 2 : 1;
}

/**
 * O `data-itens` da disputa (a escala do telao.css): os itens da maior lista; em duas colunas, os de cada coluna, com
 * pelo menos LINHAS_POR_DIVISAO - 1 (com 6 itens, 4 e 2). A escala de até 3 itens (letras maiores) não cabe na meia
 * tela: com 3 e 3, um nome de 17 caracteres ou mais ficava cortado em reticências (revisão da RIFA-061).
 */
export function itensDaEscala(itens: number, colunas: 1 | 2): number {
  return colunas === 1
    ? itens
    : Math.max(LINHAS_POR_DIVISAO - 1, Math.ceil(itens / colunas));
}

/**
 * A lista de uma divisão como cabe no telão. A API já corta no limite da campanha (top 3, com os
 * empatados no último lugar); se ainda passar de LINHAS_POR_DIVISAO por coluna, ficam os primeiros e uma
 * linha diz quantos faltam, como no bumbo.
 */
export function listaDoTelao(
  itens: ItemRankingPublico[],
  colunas: 1 | 2 = 1,
): ListaDoTelao {
  if (itens.length <= LINHAS_POR_DIVISAO * colunas)
    return { itens, resto: null };
  const visiveis = itens.slice(0, (LINHAS_POR_DIVISAO - 1) * colunas);
  const sobra = itens.slice(visiveis.length);
  const posicoes = new Set(sobra.map((item) => item.posicao));
  const [posicao] = posicoes;
  const resto =
    posicoes.size === 1
      ? `e mais ${sobra.length} ${sobra.length === 1 ? "empatada" : "empatadas"} no ${posicao}º lugar`
      : `e mais ${sobra.length} células`;
  return { itens: visiveis, resto };
}
