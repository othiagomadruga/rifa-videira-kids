// Ajudantes de teste das dicas (RIFA-045): abrir e fechar uma dica pelo mouse e pelo teclado, e a varredura que
// passa o mouse em cada botão e campo de uma tela e diz quais ficaram sem dica (a fase 2 reaproveita nas telas dela).
import { act, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { ATRASO_DA_DICA_MS, FOLGA_DA_DICA_MS } from "../components/ui";

/** O que precisa de dica: botões, campos, abas, links com cara de botão, os links do menu e o "abrir" de um <details>. */
export const SELETOR_COM_DICA = [
  "button",
  "summary",
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "a.ui-button",
  "[role='tab']",
  "nav a",
].join(", ");

/** A dica ligada ao controle pelo `aria-describedby` (role="tooltip"), ou null. */
export function dicaDe(controle: Element): HTMLElement | null {
  const ids = (controle.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean);
  for (const id of ids) {
    const elemento = document.getElementById(id);
    if (elemento?.getAttribute("role") === "tooltip") return elemento;
  }
  return null;
}

/** Mouse entra no controle (sem esperar o tempo da dica). */
export function passarOMouse(controle: Element) {
  fireEvent.pointerEnter(controle, { pointerType: "mouse" });
}

/** Mouse sai do controle (sem esperar a folga). */
export function tirarOMouse(controle: Element) {
  fireEvent.pointerLeave(controle, { pointerType: "mouse" });
}

/** Foco que veio do teclado (como o Tab): a tecla de navegação e o foco logo depois. */
export function focarPeloTeclado(controle: HTMLElement) {
  fireEvent.keyDown(document.body, { key: "Tab" });
  act(() => controle.focus());
}

/** Visível para a varredura: fora de painel oculto (`hidden`) e fora do que um diálogo deixou `inert`. */
function participa(controle: HTMLElement): boolean {
  return !controle.closest("[hidden], [inert]");
}

/** Um nome legível do controle para a mensagem de falha. */
function nomeDoControle(controle: HTMLElement): string {
  const rotulo =
    controle.getAttribute("aria-label") ??
    (controle instanceof HTMLInputElement ||
    controle instanceof HTMLSelectElement ||
    controle instanceof HTMLTextAreaElement
      ? controle.labels?.[0]?.textContent
      : null) ??
    controle.textContent;
  const papel =
    controle.getAttribute("role") ??
    (controle instanceof HTMLInputElement
      ? `input ${controle.type}`
      : controle.tagName.toLowerCase());
  return `${papel} "${(rotulo ?? "").replace(/\s+/g, " ").trim()}"`;
}

/**
 * Passa o mouse em cada botão e campo visível de `raiz` (padrão: o <body>, com os diálogos abertos), espera o tempo
 * da dica, confere a dica (role="tooltip" com texto, no `aria-describedby`), tira o mouse e confere que ela some.
 * Devolve os controles que falharam (vazio: todos têm dica). Usa o relógio falso só durante a varredura: chame
 * depois de a tela carregar. Num teste que já usa o relógio falso, usa o dele e o deixa ligado (avançar o tempo
 * também roda os timers da tela).
 */
export function controlesSemDica(raiz: ParentNode = document.body): string[] {
  const controles = Array.from(
    raiz.querySelectorAll<HTMLElement>(SELETOR_COM_DICA),
  ).filter(participa);
  const falhas: string[] = [];
  const relogioJaFalso = vi.isFakeTimers();
  if (!relogioJaFalso) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  }
  try {
    for (const controle of controles) {
      passarOMouse(controle);
      act(() => vi.advanceTimersByTime(ATRASO_DA_DICA_MS));
      const dica = dicaDe(controle);
      if (!dica || !dica.textContent?.trim()) {
        falhas.push(`${nomeDoControle(controle)}: sem dica`);
      }
      tirarOMouse(controle);
      act(() => vi.advanceTimersByTime(FOLGA_DA_DICA_MS));
      if (dica?.isConnected) {
        falhas.push(`${nomeDoControle(controle)}: a dica não sumiu`);
      }
    }
  } finally {
    if (!relogioJaFalso) vi.useRealTimers();
  }
  return falhas;
}

/** Quantos controles a varredura confere em `raiz` (para o teste garantir que ela achou o que devia). */
export function contarControles(raiz: ParentNode = document.body): number {
  return Array.from(
    raiz.querySelectorAll<HTMLElement>(SELETOR_COM_DICA),
  ).filter(participa).length;
}

/**
 * O texto da dica de cada botão e campo visível de `raiz` (RIFA-065: a varredura da rede única confere o que as dicas
 * dizem). Como `controlesSemDica`: passa o mouse, espera o tempo da dica, lê e tira o mouse. Chame depois de a tela
 * carregar.
 */
export function textosDasDicas(raiz: ParentNode = document.body): string[] {
  const controles = Array.from(
    raiz.querySelectorAll<HTMLElement>(SELETOR_COM_DICA),
  ).filter(participa);
  const textos: string[] = [];
  const relogioJaFalso = vi.isFakeTimers();
  if (!relogioJaFalso) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  }
  try {
    for (const controle of controles) {
      passarOMouse(controle);
      act(() => vi.advanceTimersByTime(ATRASO_DA_DICA_MS));
      const texto = dicaDe(controle)?.textContent?.trim();
      if (texto) textos.push(texto);
      tirarOMouse(controle);
      act(() => vi.advanceTimersByTime(FOLGA_DA_DICA_MS));
    }
  } finally {
    if (!relogioJaFalso) vi.useRealTimers();
  }
  return textos;
}
