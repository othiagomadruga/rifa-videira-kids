// Ajudantes de teste do movimento (RIFA-020). O jsdom não tem matchMedia, requestAnimationFrame controlável
// nem Element.animate: aqui eles viram simulações que o teste comanda.
import { vi } from "vitest";
import { CONSULTA_MENOS_MOVIMENTO } from "../lib/movimento";

type Ouvinte = () => void;

/**
 * Simula a preferência do sistema: `reduzir` true é prefers-reduced-motion: reduce. Devolve `mudar`, que troca
 * a preferência com a página aberta (avisa quem assinou, como o navegador faz). Desfaça com desfazerMovimento.
 */
export function simularPreferencia(reduzir: boolean) {
  const ouvintes = new Set<Ouvinte>();
  const midia = {
    matches: reduzir,
    media: CONSULTA_MENOS_MOVIMENTO,
    addEventListener: (_tipo: string, ouvinte: Ouvinte) =>
      ouvintes.add(ouvinte),
    removeEventListener: (_tipo: string, ouvinte: Ouvinte) =>
      ouvintes.delete(ouvinte),
  };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn(() => midia),
  });
  return {
    mudar(agora: boolean) {
      midia.matches = agora;
      for (const ouvinte of ouvintes) ouvinte();
    },
  };
}

/** Animação falsa devolvida pelo Element.animate simulado. */
export type AnimacaoFalsa = { cancel: ReturnType<typeof vi.fn> };

/** Troca o Element.animate (que o jsdom não tem) por um espião. */
export function espiarAnimate() {
  const animate = vi.fn<
    (
      quadros: Keyframe[] | PropertyIndexedKeyframes | null,
      opcoes?: number | KeyframeAnimationOptions,
    ) => AnimacaoFalsa
  >(() => ({ cancel: vi.fn() }));
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    writable: true,
    value: animate,
  });
  return animate;
}

/**
 * requestAnimationFrame que só anda quando o teste manda: `quadro(ms)` roda os callbacks pendentes com o
 * tempo `ms` (como o timestamp do navegador).
 */
export function controlarQuadros() {
  let proximo = 1;
  const pendentes = new Map<number, FrameRequestCallback>();
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      const id = proximo++;
      pendentes.set(id, callback);
      return id;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((id: number) => pendentes.delete(id)),
  );
  return {
    quadro(ms: number) {
      const agora = [...pendentes.values()];
      pendentes.clear();
      for (const callback of agora) callback(ms);
    },
    pendentes: () => pendentes.size,
  };
}

/** Desfaz simularPreferencia, espiarAnimate e controlarQuadros. */
export function desfazerMovimento() {
  Reflect.deleteProperty(window, "matchMedia");
  Reflect.deleteProperty(Element.prototype, "animate");
  vi.unstubAllGlobals();
}
