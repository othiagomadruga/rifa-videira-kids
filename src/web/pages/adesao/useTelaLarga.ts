import { useSyncExternalStore } from "react";

/** A partir de 48rem (o ponto de quebra das tabelas em tema/tokens.css), o painel usa o resumo completo. */
export const CONSULTA_TELA_LARGA = "(min-width: 48rem)";

function lista(): MediaQueryList | null {
  return typeof window.matchMedia === "function"
    ? window.matchMedia(CONSULTA_TELA_LARGA)
    : null;
}

function assinar(aoMudar: () => void): () => void {
  const consulta = lista();
  consulta?.addEventListener("change", aoMudar);
  return () => consulta?.removeEventListener("change", aoMudar);
}

function telaLarga(): boolean {
  return lista()?.matches ?? false;
}

/**
 * true em tela larga (computador, tablet deitado); false no celular. Acompanha a mudança (girar o
 * aparelho, redimensionar a janela). Sem matchMedia (ex.: jsdom), vale o celular: o site é celular primeiro.
 */
export function useTelaLarga(): boolean {
  return useSyncExternalStore(assinar, telaLarga);
}
