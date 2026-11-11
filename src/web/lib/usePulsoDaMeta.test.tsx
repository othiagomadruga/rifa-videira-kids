// Pulso da meta batida (RIFA-020, B1 da revisão): pela Web Animations API, só quando a meta passa a estar batida
// (ou o item já aparece batido); re-render com a meta ainda batida não pulsa; com reduce, nada.
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  desfazerMovimento,
  espiarAnimate,
  simularPreferencia,
} from "../test/movimento";
import { ATRASO_PULSO_MS, usePulsoDaMeta } from "./usePulsoDaMeta";

function Pilula({ batida, texto }: { batida: boolean; texto: string }) {
  const ref = usePulsoDaMeta<HTMLSpanElement>(batida);
  return <span ref={ref}>{texto}</span>;
}

afterEach(() => {
  desfazerMovimento();
});

describe("usePulsoDaMeta", () => {
  it("pulsa quando a meta passa a estar batida, e só nessa hora", () => {
    simularPreferencia(false);
    const animate = espiarAnimate();
    const { rerender } = render(<Pilula batida={false} texto="96%" />);
    expect(animate).not.toHaveBeenCalled();

    rerender(<Pilula batida texto="104%" />);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0][1]).toMatchObject({
      duration: 450,
      delay: ATRASO_PULSO_MS,
      iterations: 2,
    });

    // Continua batida (o % subiu, a célula trocou de lugar...): não pulsa de novo.
    rerender(<Pilula batida texto="118%" />);
    expect(animate).toHaveBeenCalledTimes(1);

    // Deixou de estar batida e bateu de novo: pulsa de novo.
    rerender(<Pilula batida={false} texto="99%" />);
    rerender(<Pilula batida texto="101%" />);
    expect(animate).toHaveBeenCalledTimes(2);
  });

  it("o item que já aparece batido pulsa ao aparecer", () => {
    simularPreferencia(false);
    const animate = espiarAnimate();
    render(<Pilula batida texto="112%" />);
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("com prefers-reduced-motion: reduce, não pulsa", () => {
    simularPreferencia(true);
    const animate = espiarAnimate();
    const { rerender } = render(<Pilula batida={false} texto="96%" />);
    rerender(<Pilula batida texto="104%" />);
    expect(animate).not.toHaveBeenCalled();
  });
});
