// CA4 (RIFA-020): o count-up. Com prefers-reduced-motion (ou sem como saber), o valor final aparece na hora,
// no primeiro render; com movimento, conta de 0 (ou do valor anterior) até o alvo e termina exato nele.
import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TextoContado } from "../components/movimento";
import { Stat } from "../components/ui";
import {
  controlarQuadros,
  desfazerMovimento,
  simularPreferencia,
} from "../test/movimento";
import { lerNumero, useContagem } from "./contagem";
import { DURACAO_CONTAGEM_MS } from "./movimento";

afterEach(() => {
  desfazerMovimento();
});

describe("lerNumero: o número de um texto já formatado", () => {
  it.each([
    ["1.234", 1234, 56.4, "56"],
    ["35%", 35, 12.4, "12%"],
    ["+12%", 12, 3, "+3%"],
    ["R$ 1.234,56", 1234.56, 1000, "R$ 1.000,00"],
    ["12,5%", 12.5, 7.25, "7,3%"],
    ["1234", 1234, 1234, "1234"],
    ["7 células", 7, 2, "2 células"],
  ])(
    "%s vale %d e escreve outro valor no mesmo formato",
    (texto, valor, outro, escrito) => {
      const numero = lerNumero(texto);
      expect(numero?.valor).toBe(valor);
      expect(numero?.escrever(outro)).toBe(escrito);
    },
  );

  it.each(["12 de 24", "19:30", "03/12", "—", "Sem meta", "", "1.5"])(
    "%j não é um número só: fica parado",
    (texto) => {
      expect(lerNumero(texto)).toBeNull();
    },
  );
});

describe("useContagem com prefers-reduced-motion: reduce", () => {
  it("mostra o valor final na hora, no primeiro render, e também quando muda", () => {
    simularPreferencia(true);
    const quadros = controlarQuadros();
    const { result, rerender } = renderHook(({ alvo }) => useContagem(alvo), {
      initialProps: { alvo: 1234 },
    });
    expect(result.current).toEqual({ valor: 1234, animando: false });

    rerender({ alvo: 2000 });
    expect(result.current).toEqual({ valor: 2000, animando: false });
    expect(quadros.pendentes()).toBe(0);
  });

  it("sem matchMedia (o navegador não diz), também não conta", () => {
    const { result } = renderHook(() => useContagem(80));
    expect(result.current).toEqual({ valor: 80, animando: false });
  });
});

describe("useContagem com movimento", () => {
  it("conta de 0 até o alvo em DURACAO_CONTAGEM_MS (desacelerando) e termina exato nele", () => {
    simularPreferencia(false);
    const quadros = controlarQuadros();
    const { result } = renderHook(() => useContagem(100));
    expect(result.current).toEqual({ valor: 0, animando: true });

    act(() => quadros.quadro(1000));
    expect(result.current.valor).toBe(0);
    act(() => quadros.quadro(1000 + DURACAO_CONTAGEM_MS / 2));
    // Metade do tempo, 87,5% do caminho (ease-out cúbica).
    expect(result.current.valor).toBeCloseTo(87.5, 5);
    act(() => quadros.quadro(1000 + DURACAO_CONTAGEM_MS));
    expect(result.current).toEqual({ valor: 100, animando: false });
    expect(quadros.pendentes()).toBe(0);
  });

  it("quando o alvo muda, conta do valor na tela até o novo", () => {
    simularPreferencia(false);
    const quadros = controlarQuadros();
    const { result, rerender } = renderHook(({ alvo }) => useContagem(alvo), {
      initialProps: { alvo: 100 },
    });
    act(() => quadros.quadro(0));
    act(() => quadros.quadro(DURACAO_CONTAGEM_MS));
    expect(result.current).toEqual({ valor: 100, animando: false });

    rerender({ alvo: 120 });
    expect(result.current).toEqual({ valor: 100, animando: true });
    act(() => quadros.quadro(5000));
    act(() => quadros.quadro(5000 + DURACAO_CONTAGEM_MS));
    expect(result.current).toEqual({ valor: 120, animando: false });
  });

  it("no meio da contagem, a preferência vira reduce: o valor final aparece na hora", () => {
    const preferencia = simularPreferencia(false);
    const quadros = controlarQuadros();
    const { result } = renderHook(() => useContagem(100));
    act(() => quadros.quadro(0));
    act(() => quadros.quadro(100));
    expect(result.current.animando).toBe(true);

    act(() => preferencia.mudar(true));
    expect(result.current).toEqual({ valor: 100, animando: false });
    expect(quadros.pendentes()).toBe(0);
  });
});

describe("TextoContado", () => {
  it("com prefers-reduced-motion, é só o texto final (nenhum elemento a mais)", () => {
    simularPreferencia(true);
    controlarQuadros();
    const { container } = render(
      <p>
        <TextoContado texto="112%" />
      </p>,
    );
    expect(container.innerHTML).toBe("<p>112%</p>");
  });

  it("contando: o texto final fica no lugar (transparente, o que o leitor de tela lê) e o número que conta vai por cima, aria-hidden", () => {
    simularPreferencia(false);
    const quadros = controlarQuadros();
    const { container } = render(
      <p>
        <TextoContado texto="112%" />
      </p>,
    );
    const final = container.querySelector(".mov-contagem__final");
    const quadro = container.querySelector(".mov-contagem__quadro");
    expect(final).toHaveTextContent("112%");
    expect(quadro).toHaveAttribute("aria-hidden", "true");
    expect(quadro).toHaveTextContent("0%");

    act(() => quadros.quadro(0));
    act(() => quadros.quadro(DURACAO_CONTAGEM_MS / 2));
    expect(container.querySelector(".mov-contagem__quadro")).toHaveTextContent(
      "98%",
    );

    act(() => quadros.quadro(DURACAO_CONTAGEM_MS));
    expect(container.innerHTML).toBe("<p>112%</p>");
  });

  it("texto que não é um número só fica parado", () => {
    simularPreferencia(false);
    const quadros = controlarQuadros();
    const { container } = render(
      <p>
        <TextoContado texto="Dia 12 de 24" />
      </p>,
    );
    expect(container.innerHTML).toBe("<p>Dia 12 de 24</p>");
    expect(quadros.pendentes()).toBe(0);
  });
});

describe("Stat conta até o valor", () => {
  it("com movimento: conta e, no fim, o valor fica no <p> do indicador", () => {
    simularPreferencia(false);
    const quadros = controlarQuadros();
    render(<Stat rotulo="Bilhetes vendidos" valor="1.234" />);
    expect(document.querySelector(".mov-contagem__quadro")).toHaveTextContent(
      "0",
    );
    act(() => quadros.quadro(0));
    act(() => quadros.quadro(DURACAO_CONTAGEM_MS));
    expect(screen.getByText("1.234")).toHaveClass("ui-stat__valor");
  });

  it("com prefers-reduced-motion: o valor final já no primeiro render", () => {
    simularPreferencia(true);
    render(<Stat rotulo="Bilhetes vendidos" valor="1.234" />);
    expect(screen.getByText("1.234")).toHaveClass("ui-stat__valor");
    expect(document.querySelector(".mov-contagem")).toBeNull();
  });
});
