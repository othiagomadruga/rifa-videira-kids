// Pulso da meta batida (RIFA-020): 2 vezes, discreto, só quando a meta passa a estar batida (ou o item já aparece
// batido). Pela Web Animations API (animar respeita o reduce): diferente de uma animação de CSS, não recomeça
// quando o React move o nó no DOM, como na troca de posição do ranking.
import { useLayoutEffect, useRef } from "react";
import { DURACAO_CONTAGEM_MS, animar } from "./movimento";

/** O pulso começa depois que o % termina de contar. */
export const ATRASO_PULSO_MS = DURACAO_CONTAGEM_MS + 50;

export function usePulsoDaMeta<T extends HTMLElement>(batida: boolean) {
  const ref = useRef<T>(null);
  const antes = useRef(false);
  useLayoutEffect(() => {
    if (batida && !antes.current && ref.current)
      animar(
        ref.current,
        [
          { transform: "scale(1)" },
          { transform: "scale(1.12)", offset: 0.45 },
          { transform: "scale(1)" },
        ],
        {
          duration: 450,
          delay: ATRASO_PULSO_MS,
          iterations: 2,
          easing: "cubic-bezier(0.4, 0, 0.2, 1)",
        },
      );
    antes.current = batida;
  }, [batida]);
  return ref;
}
