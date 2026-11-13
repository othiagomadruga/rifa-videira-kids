// "↑ subiu" no telão (RIFA-050, P2.3; D25): quem subiu de posição na última atualização que mudou a ordem. O chip
// fica até a próxima atualização com mudança (nenhum temporizador: o telão só se mexe quando os dados mudam). Uma
// atualização igual não muda nada; a primeira lista (ao abrir a página, ou a primeira venda) não marca ninguém.
import { useState } from "react";

/** Um item da lista: a chave estável (chavesPorNome) e a posição no ranking (empatados têm a mesma). */
export type PosicaoNaLista = { chave: string; posicao: number };

type Memoria = {
  /** A ordem e as posições da última mudança, num texto (para comparar sem percorrer a lista). */
  assinatura: string;
  posicoes: ReadonlyMap<string, number>;
  subiram: ReadonlySet<string>;
};

const NINGUEM: ReadonlySet<string> = new Set();

const assinar = (itens: readonly PosicaoNaLista[]) =>
  itens.map(({ chave, posicao }) => `${posicao}:${chave}`).join("|");

const mapear = (itens: readonly PosicaoNaLista[]) =>
  new Map(itens.map(({ chave, posicao }) => [chave, posicao]));

/**
 * Quem subiu de `antes` para `agora`: a posição ficou menor (3º → 2º, ou 2º → 1º empatado) ou a célula entrou na
 * lista (veio de fora do top). Sem lista antes (a primeira), ninguém.
 */
export function quemSubiu(
  antes: ReadonlyMap<string, number>,
  agora: readonly PosicaoNaLista[],
): ReadonlySet<string> {
  if (antes.size === 0) return NINGUEM;
  const subiram = agora.filter(({ chave, posicao }) => {
    const anterior = antes.get(chave);
    return anterior === undefined || posicao < anterior;
  });
  return subiram.length === 0
    ? NINGUEM
    : new Set(subiram.map(({ chave }) => chave));
}

/**
 * As chaves de quem subiu na última atualização que mudou a ordem (ou as posições) da lista. Guarda a lista dessa
 * mudança no estado (o padrão do React para "o que mudou desde a renderização anterior") e só recalcula quando a
 * ordem muda: o % que sobe sem trocar ninguém de lugar não apaga o chip.
 */
export function useSubiu(
  itens: readonly PosicaoNaLista[],
): ReadonlySet<string> {
  const assinatura = assinar(itens);
  const [memoria, setMemoria] = useState<Memoria>(() => ({
    assinatura,
    posicoes: mapear(itens),
    subiram: NINGUEM,
  }));
  if (memoria.assinatura === assinatura) return memoria.subiram;
  const nova: Memoria = {
    assinatura,
    posicoes: mapear(itens),
    subiram: quemSubiu(memoria.posicoes, itens),
  };
  setMemoria(nova);
  return nova.subiram;
}
