// CA4 (RIFA-020): a preferência de movimento do sistema manda em todo o JS de animação. Sem matchMedia (jsdom,
// navegador que não diz) ou com prefers-reduced-motion: reduce, nada anima.
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ATRASO_SEQUENCIA_MS,
  LIMITE_SEQUENCIA,
  animar,
  atrasoNaSequencia,
  prefereMenosMovimento,
  usePrefereMenosMovimento,
} from "./movimento";
import {
  desfazerMovimento,
  espiarAnimate,
  simularPreferencia,
} from "../test/movimento";

afterEach(() => {
  desfazerMovimento();
});

describe("prefereMenosMovimento", () => {
  it("sem matchMedia (o navegador não diz), não anima", () => {
    expect(prefereMenosMovimento()).toBe(true);
  });

  it("segue a media query (prefers-reduced-motion: reduce)", () => {
    const preferencia = simularPreferencia(true);
    expect(prefereMenosMovimento()).toBe(true);
    preferencia.mudar(false);
    expect(prefereMenosMovimento()).toBe(false);
    expect(window.matchMedia).toHaveBeenCalledWith(
      "(prefers-reduced-motion: reduce)",
    );
  });

  it("o gancho acompanha a troca da preferência com a página aberta", () => {
    const preferencia = simularPreferencia(false);
    const { result } = renderHook(() => usePrefereMenosMovimento());
    expect(result.current).toBe(false);

    act(() => preferencia.mudar(true));
    expect(result.current).toBe(true);

    act(() => preferencia.mudar(false));
    expect(result.current).toBe(false);
  });
});

describe("animar (a única porta para a Web Animations API)", () => {
  const quadros = [{ opacity: 0 }, { opacity: 1 }];

  it("com prefers-reduced-motion: reduce, não chama element.animate", () => {
    simularPreferencia(true);
    const animate = espiarAnimate();
    expect(
      animar(document.createElement("div"), quadros, { duration: 300 }),
    ).toBeNull();
    expect(animate).not.toHaveBeenCalled();
  });

  it("sem matchMedia, também não anima", () => {
    const animate = espiarAnimate();
    expect(
      animar(document.createElement("div"), quadros, { duration: 300 }),
    ).toBeNull();
    expect(animate).not.toHaveBeenCalled();
  });

  it("com movimento liberado, anima pelo element.animate (sem estilo inline)", () => {
    simularPreferencia(false);
    const animate = espiarAnimate();
    const elemento = document.createElement("div");
    expect(animar(elemento, quadros, { duration: 300 })).not.toBeNull();
    expect(animate).toHaveBeenCalledWith(quadros, { duration: 300 });
    expect(elemento.getAttribute("style")).toBeNull();
  });

  it("navegador sem a Web Animations API: não quebra", () => {
    simularPreferencia(false);
    expect(
      animar(document.createElement("div"), quadros, { duration: 300 }),
    ).toBeNull();
  });
});

describe("atrasoNaSequencia (stagger)", () => {
  it("cada item espera um pouco mais, até o limite (a lista não demora a aparecer)", () => {
    expect(atrasoNaSequencia(0)).toBe(0);
    expect(atrasoNaSequencia(1)).toBe(ATRASO_SEQUENCIA_MS);
    expect(atrasoNaSequencia(LIMITE_SEQUENCIA + 10)).toBe(
      LIMITE_SEQUENCIA * ATRASO_SEQUENCIA_MS,
    );
    // O último item começa em até ~0,3 s.
    expect(LIMITE_SEQUENCIA * ATRASO_SEQUENCIA_MS).toBeLessThanOrEqual(300);
  });
});
