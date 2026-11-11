// Movimento no site (RIFA-020): a preferência do sistema e a única porta para a Web Animations API.
// Regras em docs/frontend.md: só transform e opacity, durações curtas (150 a 450 ms) e nada de movimento
// com prefers-reduced-motion: reduce. Sem como saber a preferência (sem matchMedia, como no jsdom dos
// testes), o site não anima: o conteúdo aparece pronto, na hora.
import { useSyncExternalStore } from "react";

/** A media query do movimento reduzido. */
export const CONSULTA_MENOS_MOVIMENTO = "(prefers-reduced-motion: reduce)";

/** Entrada de um item (stagger): cada item espera este tanto a mais que o anterior... */
export const ATRASO_SEQUENCIA_MS = 45;
/** ...até este item; os seguintes entram juntos com ele (a lista não demora a aparecer inteira). */
export const LIMITE_SEQUENCIA = 6;
/** Entrada de um item: fade e deslize curto. */
export const DURACAO_ENTRADA_MS = 320;
/** Item que muda de lugar no ranking (FLIP). */
export const DURACAO_REORDENAR_MS = 420;
/** Número contando até o valor (count-up). */
export const DURACAO_CONTAGEM_MS = 450;
/** Desacelera no fim (a mesma curva de --curva-saida no tokens.css). */
export const CURVA_SAIDA = "cubic-bezier(0.22, 1, 0.36, 1)";

type ConsultaDeMidia = {
  matches: boolean;
  addEventListener?: (tipo: "change", ouvinte: () => void) => void;
  removeEventListener?: (tipo: "change", ouvinte: () => void) => void;
  addListener?: (ouvinte: () => void) => void;
  removeListener?: (ouvinte: () => void) => void;
};

function consulta(): ConsultaDeMidia | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return null;
  return window.matchMedia(CONSULTA_MENOS_MOVIMENTO) as ConsultaDeMidia;
}

/**
 * true quando o site não deve animar: o sistema pede menos movimento, ou o navegador não diz (sem
 * matchMedia). Leia na hora de animar (a preferência pode mudar com a página aberta).
 */
export function prefereMenosMovimento(): boolean {
  const midia = consulta();
  return midia === null || midia.matches;
}

function assinar(aoMudar: () => void): () => void {
  const midia = consulta();
  if (!midia) return () => {};
  if (midia.addEventListener) {
    midia.addEventListener("change", aoMudar);
    return () => midia.removeEventListener?.("change", aoMudar);
  }
  // Safari antigo (até o 13): só addListener.
  midia.addListener?.(aoMudar);
  return () => midia.removeListener?.(aoMudar);
}

/** prefereMenosMovimento() que se atualiza quando a pessoa muda a preferência do sistema. */
export function usePrefereMenosMovimento(): boolean {
  return useSyncExternalStore(assinar, prefereMenosMovimento, () => true);
}

/**
 * Anima um elemento pela Web Animations API (element.animate: não depende de estilo inline, então a CSP
 * do site vale). Não faz nada, e devolve null, com movimento reduzido ou sem suporte no navegador.
 */
export function animar(
  elemento: Element,
  quadros: Keyframe[],
  opcoes: KeyframeAnimationOptions,
): Animation | null {
  if (prefereMenosMovimento() || typeof elemento.animate !== "function")
    return null;
  return elemento.animate(quadros, opcoes);
}

/** Atraso de entrada do item `ordem` (0, 1, 2...) numa sequência. */
export function atrasoNaSequencia(ordem: number): number {
  return Math.min(ordem, LIMITE_SEQUENCIA) * ATRASO_SEQUENCIA_MS;
}
