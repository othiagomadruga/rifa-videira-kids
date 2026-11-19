// A grade da tela Bilhetes (RIFA-075, D35): os mapas de bits da resposta e as medidas do desenho.
import {
  mapaDeBase64,
  situacaoNoIndice,
  type SituacaoBilhete,
} from "../../../shared/contracts/bilhetes";
import type { RespostaBilhetes } from "../../../shared/contracts/api";

export interface Grade {
  quantidade: number;
  inicial: number;
  pagos: Uint8Array;
  reservados: Uint8Array;
}

export function gradeDaResposta(r: RespostaBilhetes): Grade {
  return {
    quantidade: r.quantidade,
    inicial: r.numero_inicial,
    pagos: mapaDeBase64(r.pagos),
    reservados: mapaDeBase64(r.reservados),
  };
}

/** Situação de um número (fora da faixa: livre). */
export function situacaoDoNumero(
  grade: Grade,
  numero: number,
): SituacaoBilhete {
  const indice = numero - grade.inicial;
  if (indice < 0 || indice >= grade.quantidade) return "livre";
  return situacaoNoIndice(grade.pagos, grade.reservados, indice);
}

/** Lado de cada quadrado em px (com 1 px de espaço): menor no celular, para a grade não ficar alta demais. */
export function ladoDaCelula(largura: number): number {
  return largura < 600 ? 8 : 10;
}

export interface Medidas {
  lado: number;
  colunas: number;
  linhas: number;
}

export function medirGrade(largura: number, quantidade: number): Medidas {
  const lado = ladoDaCelula(largura);
  const colunas = Math.max(1, Math.floor(largura / lado));
  return { lado, colunas, linhas: Math.ceil(quantidade / colunas) };
}

/** O índice do quadrado no ponto (x, y) da grade, ou null fora dela. */
export function indiceNoPonto(
  medidas: Medidas,
  quantidade: number,
  x: number,
  y: number,
): number | null {
  const coluna = Math.floor(x / medidas.lado);
  const linha = Math.floor(y / medidas.lado);
  if (coluna < 0 || coluna >= medidas.colunas || linha < 0) return null;
  const indice = linha * medidas.colunas + coluna;
  return indice < quantidade ? indice : null;
}
