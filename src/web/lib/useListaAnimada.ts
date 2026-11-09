// Listas que se mexem com os dados (RIFA-020): os itens entram em sequência (stagger) quando a lista aparece
// e, quando uma atualização muda a ordem, cada item desliza do lugar antigo para o novo (FLIP). Tudo pela
// Web Animations API (animar, em movimento.ts): com prefers-reduced-motion, nada anima. Só transform e
// opacity: o layout já está no lugar final, então não há layout shift.
import { useEffect, useLayoutEffect, useRef } from "react";
import {
  CURVA_SAIDA,
  DURACAO_ENTRADA_MS,
  DURACAO_REORDENAR_MS,
  animar,
  atrasoNaSequencia,
  prefereMenosMovimento,
} from "./movimento";

/** Atributo que identifica um item entre uma atualização e outra (o mesmo item, mesmo que mude de lugar). */
export const ATRIBUTO_CHAVE = "data-chave-animada";

type Ponto = { x: number; y: number };

/**
 * Chave estável de cada item pelo nome; nomes repetidos ganham "#2", "#3"... (na ordem em que aparecem).
 * Use como `key` do React e no atributo ATRIBUTO_CHAVE.
 */
export function chavesPorNome<T extends { nome: string }>(
  itens: readonly T[],
): { chave: string; item: T }[] {
  const vistos = new Map<string, number>();
  return itens.map((item) => {
    const vezes = (vistos.get(item.nome) ?? 0) + 1;
    vistos.set(item.nome, vezes);
    return { chave: vezes === 1 ? item.nome : `${item.nome}#${vezes}`, item };
  });
}

function itensDa(lista: HTMLElement): HTMLElement[] {
  return [...lista.children].filter(
    (filho): filho is HTMLElement =>
      filho instanceof HTMLElement && filho.hasAttribute(ATRIBUTO_CHAVE),
  );
}

// offsetLeft/offsetTop: o lugar no layout, sem o transform de uma animação em curso; relativo à lista, então
// rolar a página ou mudar o que vem antes dela não conta como movimento do item.
function posicaoNaLista(item: HTMLElement, lista: HTMLElement): Ponto {
  if (item.offsetParent === lista)
    return { x: item.offsetLeft, y: item.offsetTop };
  return {
    x: item.offsetLeft - lista.offsetLeft,
    y: item.offsetTop - lista.offsetTop,
  };
}

function medir(lista: HTMLElement): Map<string, Ponto> {
  return new Map(
    itensDa(lista).map((item) => [
      item.getAttribute(ATRIBUTO_CHAVE) ?? "",
      posicaoNaLista(item, lista),
    ]),
  );
}

/**
 * Anima a lista do ref devolvido quando `assinatura` muda (passe as chaves na ordem, ex.: "Ágape|Betel").
 * Os itens são os filhos com ATRIBUTO_CHAVE. Item novo entra (fade e deslize curto, em sequência); item que
 * mudou de lugar desliza do lugar antigo (FLIP). Mesma assinatura (atualização sem mudança): nada se mexe.
 */
export function useListaAnimada<T extends HTMLElement>(assinatura: string) {
  const refLista = useRef<T>(null);
  // Onde cada item estava depois da última mudança (null: a lista ainda não apareceu).
  const lugares = useRef<Map<string, Ponto> | null>(null);
  const emCurso = useRef<WeakMap<Element, Animation> | null>(null);
  const vigia = useRef<{ lista: Element; observador: ResizeObserver } | null>(
    null,
  );

  useLayoutEffect(() => {
    const lista = refLista.current;
    if (!lista || assinatura === "") {
      lugares.current = null;
      return;
    }
    const antes = lugares.current;
    const agora = medir(lista);
    lugares.current = agora;
    // A tela mudou de tamanho (girou o celular, redimensionou a janela): os lugares guardados mudam junto,
    // senão a próxima atualização animaria um "movimento" que foi só da tela. A lista pode aparecer depois
    // (só quando tem itens): vigia a que estiver na tela agora.
    if (
      vigia.current?.lista !== lista &&
      typeof ResizeObserver === "function"
    ) {
      vigia.current?.observador.disconnect();
      const observador = new ResizeObserver(() => {
        if (lugares.current) lugares.current = medir(lista);
      });
      observador.observe(lista);
      vigia.current = { lista, observador };
    }
    if (prefereMenosMovimento()) return;

    emCurso.current ??= new WeakMap();
    const animacoes = emCurso.current;
    let novos = 0;
    for (const item of itensDa(lista)) {
      const chave = item.getAttribute(ATRIBUTO_CHAVE) ?? "";
      const de = antes?.get(chave);
      const para = agora.get(chave);
      let animacao: Animation | null;
      if (!de || !para) {
        animacao = animar(
          item,
          [
            { opacity: 0, transform: "translateY(0.5rem)" },
            { opacity: 1, transform: "none" },
          ],
          {
            duration: DURACAO_ENTRADA_MS,
            delay: atrasoNaSequencia(novos++),
            easing: CURVA_SAIDA,
            fill: "backwards",
          },
        );
      } else {
        const dx = de.x - para.x;
        const dy = de.y - para.y;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
        animacoes.get(item)?.cancel();
        // Quem sobe passa por cima de quem desce: agora ele vem antes no DOM e seria pintado por baixo deles.
        const camada = dy > 0 ? { zIndex: "1" } : {};
        animacao = animar(
          item,
          [
            { transform: `translate(${dx}px, ${dy}px)`, ...camada },
            { transform: "none", ...camada },
          ],
          { duration: DURACAO_REORDENAR_MS, easing: CURVA_SAIDA },
        );
      }
      if (animacao) animacoes.set(item, animacao);
    }
  }, [assinatura]);

  useEffect(
    () => () => {
      vigia.current?.observador.disconnect();
      vigia.current = null;
    },
    [],
  );

  return refLista;
}
