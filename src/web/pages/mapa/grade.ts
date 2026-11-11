// Grade do mapa (cartograma, D17): um quadrado por UF, na posição aproximada do Brasil, numa grade fixa de 7 colunas
// por 8 linhas. Sem SVG de mapa e sem dependência: a forma vem só desta tabela. O norte fica em cima (RR e AP), o
// Nordeste à direita (o "bico" do RN e da PB), o Centro-Oeste no meio (MT, GO e DF) e o Sul embaixo (PR, SC e RS).
//
//        0    1    2    3    4    5    6
//   0         RR   AP
//   1         AM   PA   MA   PI   CE   RN
//   2    AC   RO   MT   TO   BA   PE   PB
//   3              MS   GO   DF   SE   AL
//   4                   SP   MG   ES
//   5                   PR   RJ
//   6                   SC
//   7                   RS
import { UFS, type Uf } from "../../../shared/contracts/ddd";

export const COLUNAS_DA_GRADE = 7;
export const LINHAS_DA_GRADE = 8;

/** [linha, coluna] de cada UF, a partir de 0. */
export const POSICAO_DA_UF: Readonly<Record<Uf, readonly [number, number]>> = {
  RR: [0, 1],
  AP: [0, 2],
  AM: [1, 1],
  PA: [1, 2],
  MA: [1, 3],
  PI: [1, 4],
  CE: [1, 5],
  RN: [1, 6],
  AC: [2, 0],
  RO: [2, 1],
  MT: [2, 2],
  TO: [2, 3],
  BA: [2, 4],
  PE: [2, 5],
  PB: [2, 6],
  MS: [3, 2],
  GO: [3, 3],
  DF: [3, 4],
  SE: [3, 5],
  AL: [3, 6],
  SP: [4, 3],
  MG: [4, 4],
  ES: [4, 5],
  PR: [5, 3],
  RJ: [5, 4],
  SC: [6, 3],
  RS: [7, 3],
};

/**
 * As UFs na ordem de leitura da grade (linha a linha, da esquerda para a direita): é a ordem do HTML (a do leitor de
 * tela, do norte para o sul) e a do Home e do End no teclado (RIFA-027).
 */
export const UFS_NA_ORDEM_DA_GRADE: readonly Uf[] = [...UFS].sort((a, b) => {
  const [linhaA, colunaA] = POSICAO_DA_UF[a];
  const [linhaB, colunaB] = POSICAO_DA_UF[b];
  return linhaA - linhaB || colunaA - colunaB;
});

/** A direção de uma seta do teclado na grade. */
export type Direcao = "cima" | "baixo" | "esquerda" | "direita";

const PASSO: Readonly<Record<Direcao, readonly [number, number]>> = {
  cima: [-1, 0],
  baixo: [1, 0],
  esquerda: [0, -1],
  direita: [0, 1],
};

/**
 * A casa para onde a seta leva (RIFA-027): a mais perto na direção, na mesma linha (esquerda e direita) ou na mesma
 * coluna (cima e baixo), pulando as casas vazias; sem nenhuma na direção, fica onde está. Recebe as posições para
 * o teste usar uma grade com buracos (a do mapa não tem buraco entre duas UFs da mesma linha ou coluna).
 */
export function vizinhaNaDirecao<T extends string>(
  posicoes: Readonly<Record<T, readonly [number, number]>>,
  atual: T,
  direcao: Direcao,
): T {
  const [linha, coluna] = posicoes[atual];
  const [passoLinha, passoColuna] = PASSO[direcao];
  let destino = atual;
  let menor = Infinity;
  for (const chave of Object.keys(posicoes) as T[]) {
    const [l, c] = posicoes[chave];
    const distancia =
      passoLinha !== 0
        ? c === coluna
          ? (l - linha) * passoLinha
          : 0
        : l === linha
          ? (c - coluna) * passoColuna
          : 0;
    if (distancia > 0 && distancia < menor) {
      menor = distancia;
      destino = chave;
    }
  }
  return destino;
}
