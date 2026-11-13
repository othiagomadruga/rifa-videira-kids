import { useState, useSyncExternalStore } from "react";

/**
 * A partir de 48rem (o ponto de quebra da DataTable, em tema/tokens.css), os filtros ficam sempre à mostra, como
 * antes; abaixo, num <details> "Filtros", fechado ao abrir a tela (RIFA-051, P3.7).
 */
export const CONSULTA_FILTROS_A_MOSTRA = "(min-width: 48rem)";

function lista(): MediaQueryList | null {
  return typeof window.matchMedia === "function"
    ? window.matchMedia(CONSULTA_FILTROS_A_MOSTRA)
    : null;
}

function assinar(aoMudar: () => void): () => void {
  const consulta = lista();
  consulta?.addEventListener("change", aoMudar);
  return () => consulta?.removeEventListener("change", aoMudar);
}

/** Sem matchMedia (navegador antigo; o jsdom dos testes), os filtros ficam à mostra: nada se esconde. */
const telaLarga = () => lista()?.matches ?? true;

export type FiltrosRecolhidos = {
  /** Celular: os filtros ficam num <details> que a pessoa abre e fecha. */
  recolhiveis: boolean;
  /** O <details> está aberto (no computador, sempre). */
  abertos: boolean;
  /** Abre ou fecha (o `toggle` do <details>, ou a tela, ex.: antes de levar o foco a um filtro). */
  mudar: (abertos: boolean) => void;
};

/**
 * Os filtros da lista de pedidos: à mostra no computador; no celular, recolhidos ao abrir a tela, para o primeiro
 * pedido aparecer logo (A-04). Acompanha a largura (girar o aparelho): na tela larga, abre; ao voltar para a
 * estreita, fecha de novo.
 */
export function useFiltrosRecolhidos(): FiltrosRecolhidos {
  const larga = useSyncExternalStore(assinar, telaLarga, () => true);
  const [abertos, setAbertos] = useState(larga);
  const [largaAntes, setLargaAntes] = useState(larga);
  if (larga !== largaAntes) {
    setLargaAntes(larga);
    setAbertos(larga);
  }
  return {
    recolhiveis: !larga,
    abertos: larga || abertos,
    mudar: setAbertos,
  };
}
