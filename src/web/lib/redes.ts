// Rede única (RIFA-065, D30): com uma rede só na hierarquia, o site esconde o nível rede em todas as telas da
// coordenação. A rede continua no banco, na planilha e na API: só some da tela. Com duas ou mais, tudo como antes.
//
// De onde o site sabe:
// - das listas que as telas já recebem da API e que trazem a hierarquia toda: as redes (Hierarquia) e as células
//   (Visão geral, Pedidos e Adesão), contadas por `contarRedes`. A tela usa o que recebeu (`useRedes(daTela)`) e
//   avisa o resto do site;
// - nas telas que não recebem a hierarquia (Rankings, Campanha e Acessos), da lista das redes
//   (GET /api/admin/redes, ROTAS.listarRedes), pedida uma vez por página aberta, só se o site ainda não souber
//   (`useBuscarRedes`). O ranking não serve: com o filtro de divisão, ele traz só parte das redes.
//
// O que se sabe fica no módulo (vale entre as telas, como o estado do webhook): `esquecerRedes` zera, nos testes.
import { useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import { api } from "./api";

/** ROTAS.listarRedes.caminho (cópia: o contrato poria o zod no pacote; `redes.test.ts` confere). */
export const CAMINHO_REDES = "/api/admin/redes";

/** Quantas redes a hierarquia tem, pelo que o site viu por último; null = ainda não sabe. */
let quantidade: number | null = null;
/** Uma pergunta à API em andamento ou já respondida: não pergunta de novo. */
let perguntou = false;
/** Muda a cada `esquecerRedes`: uma resposta que chega depois não vale mais. */
let geracao = 0;
const ouvintes = new Set<() => void>();

function avisar() {
  for (const ouvinte of [...ouvintes]) ouvinte();
}

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

const lerQuantidade = () => quantidade;

/** Quantas redes diferentes há entre os ids (as `rede_id` das células, por exemplo). */
export function contarRedes(redeIds: Iterable<number>): number {
  return new Set(redeIds).size;
}

/** O site passa a saber quantas redes a hierarquia tem (uma tela que recebeu a lista toda). */
export function informarRedes(novaQuantidade: number): void {
  if (quantidade === novaQuantidade) return;
  quantidade = novaQuantidade;
  avisar();
}

/** Esquece o que sabia: cada teste começa como uma página recém-aberta. */
export function esquecerRedes(): void {
  quantidade = null;
  perguntou = false;
  geracao += 1;
  avisar();
}

/**
 * Pergunta à API quantas redes há, se o site ainda não sabe: uma vez por página aberta. Uma resposta fora do formato
 * da lista não ensina nada e não é pedida de novo; uma falha (conexão, 401) deixa a próxima tela tentar.
 */
function perguntarRedes(): void {
  if (quantidade !== null || perguntou) return;
  perguntou = true;
  const minha = geracao;
  api.get<{ itens?: unknown }>(CAMINHO_REDES).then(
    (resposta) => {
      if (minha !== geracao) return;
      const itens = resposta?.itens;
      if (Array.isArray(itens)) informarRedes(itens.length);
    },
    () => {
      if (minha === geracao) perguntou = false;
    },
  );
}

/** Para a tela que não recebe a hierarquia: sem saber quantas redes há, pergunta à API ao abrir. */
export function useBuscarRedes(): void {
  useEffect(() => {
    perguntarRedes();
  }, []);
}

export type Redes = {
  /**
   * Sabe-se que a hierarquia tem uma rede só: o nível rede some (abas, colunas, filtros, campos e textos que citam a
   * rede). Sem saber, false: a tela fica como sempre foi.
   */
  unica: boolean;
  /**
   * Sabe-se que a rede não é única: os textos que só enumeram os níveis ("as redes, os discipuladores e as
   * células": descrições e dicas do menu) podem citá-la. Sem saber, false: o texto sem a rede, que vale nos dois casos.
   */
  citar: boolean;
};

/**
 * Quantas redes a hierarquia tem, como a tela deve mostrar. `daTela`: o que a própria tela contou na lista que recebeu
 * (vale antes do que o site guardou, e o atualiza); null ou ausente = a tela não sabe, vale o que o site guardou.
 */
export function useRedes(daTela?: number | null): Redes {
  const doSite = useSyncExternalStore(assinar, lerQuantidade, lerQuantidade);
  // Antes da pintura: as partes da tela que leem só o que o site guardou já aparecem certas.
  useLayoutEffect(() => {
    if (daTela !== undefined && daTela !== null) informarRedes(daTela);
  }, [daTela]);
  const conhecida = daTela ?? doSite;
  return {
    unica: conhecida === 1,
    citar: conhecida !== null && conhecida !== 1,
  };
}
