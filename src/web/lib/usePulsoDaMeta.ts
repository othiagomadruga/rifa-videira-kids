// Pulso da meta batida (RIFA-020): 2 vezes, discreto, só quando a meta passa a estar batida (ou o item já aparece
// batido). Pela Web Animations API (animar respeita o reduce): diferente de uma animação de CSS, não recomeça
// quando o React move o nó no DOM, como na troca de posição do ranking. O useComemoracao (RIFA-049) usa o mesmo pulso.
import { useLayoutEffect, useRef } from "react";
import { DURACAO_CONTAGEM_MS, animar } from "./movimento";

/** O pulso começa depois que o % termina de contar. */
export const ATRASO_PULSO_MS = DURACAO_CONTAGEM_MS + 50;

/** Pulsa o elemento (2 vezes, cresce 12% e volta), depois que o % termina de contar. Nada com reduce. */
export function pulsarMeta(elemento: Element): Animation | null {
  return animar(
    elemento,
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
}

export function usePulsoDaMeta<T extends HTMLElement>(batida: boolean) {
  const ref = useRef<T>(null);
  const antes = useRef(false);
  useLayoutEffect(() => {
    if (batida && !antes.current && ref.current) pulsarMeta(ref.current);
    antes.current = batida;
  }, [batida]);
  return ref;
}
