// Ganchos do telão: o relógio da tela e o cursor que some com o mouse parado.
import { useEffect, useState } from "react";
import { formatarHora } from "../../lib/formatadores";

/** De quanto em quanto tempo o relógio confere a hora (ele só muda de minuto em minuto). */
export const INTERVALO_RELOGIO_MS = 1000;

/** Com o mouse parado por este tempo, o cursor some do telão. */
export const CURSOR_PARADO_MS = 3000;

/** A hora de agora em Belém ("15:30"), atualizada sozinha. */
export function useRelogio(): string {
  const [hora, setHora] = useState(() => formatarHora(new Date()));
  useEffect(() => {
    // O mesmo texto não renderiza de novo: na prática, uma vez por minuto.
    const relogio = setInterval(
      () => setHora(formatarHora(new Date())),
      INTERVALO_RELOGIO_MS,
    );
    return () => clearInterval(relogio);
  }, []);
  return hora;
}

/**
 * O cursor do mouse fica escondido no telão: aparece quando o mouse se mexe e some de novo depois de
 * CURSOR_PARADO_MS parado. Devolve true enquanto ele deve ficar escondido.
 */
export function useCursorEscondidoParado(): boolean {
  const [escondido, setEscondido] = useState(true);
  useEffect(() => {
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    function aoMexer() {
      setEscondido(false);
      clearTimeout(temporizador);
      temporizador = setTimeout(() => setEscondido(true), CURSOR_PARADO_MS);
    }
    document.addEventListener("mousemove", aoMexer);
    return () => {
      document.removeEventListener("mousemove", aoMexer);
      clearTimeout(temporizador);
    };
  }, []);
  return escondido;
}
