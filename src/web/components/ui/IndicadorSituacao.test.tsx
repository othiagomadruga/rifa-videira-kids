import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IndicadorSituacao } from "./IndicadorSituacao";

// O chip do ícone (só visual): o <svg> do Icone, com o nome do desenho.
const iconeDe = (raiz: Element | null) =>
  raiz?.querySelector(".ui-situacao__icone");

describe("IndicadorSituacao", () => {
  it("mostra o título e o detalhe; o ícone é só visual e o tom vira a classe", () => {
    const { container } = render(
      <IndicadorSituacao tom="sucesso" titulo="Em dia">
        6 bilhetes acima do esperado
      </IndicadorSituacao>,
    );

    expect(screen.getByText("Em dia")).toBeInTheDocument();
    expect(
      screen.getByText("6 bilhetes acima do esperado"),
    ).toBeInTheDocument();
    const raiz = container.firstElementChild;
    expect(raiz).toHaveClass("ui-situacao", "ui-situacao--sucesso");
    // O texto faz sentido sem a cor e sem o ícone; quem lê a tela ouve só o texto (o ícone é SVG, sem caractere).
    expect(raiz).toHaveTextContent(/^Em dia6 bilhetes acima do esperado$/);
    const chip = iconeDe(raiz);
    expect(chip).toHaveAttribute("aria-hidden", "true");
    expect(chip?.querySelector("svg")).toHaveAttribute("data-icone", "check");
    expect(chip?.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    // Não é região viva: numa tela que se atualiza sozinha seria ruído.
    expect(raiz).not.toHaveAttribute("role");
  });

  it("ícone padrão por tom, trocável (por nome ou pelo caractere de antes), e sem detalhe", () => {
    const { rerender, container } = render(
      <IndicadorSituacao tom="alerta" titulo="Abaixo do esperado" />,
    );
    const desenho = () =>
      iconeDe(container.firstElementChild)
        ?.querySelector("svg")
        ?.getAttribute("data-icone");
    expect(desenho()).toBe("alerta");
    expect(container.querySelector(".ui-situacao__detalhe")).toBeNull();

    // As telas passam "↓" (pages/minha e pages/visao-geral): vira o desenho, igual em todo celular.
    rerender(
      <IndicadorSituacao tom="alerta" titulo="Abaixo do esperado" icone="↓" />,
    );
    expect(desenho()).toBe("caiu");
    expect(container.firstElementChild).not.toHaveTextContent("↓");

    rerender(
      <IndicadorSituacao
        tom="alerta"
        titulo="Abaixo do esperado"
        icone="caiu"
      />,
    );
    expect(desenho()).toBe("caiu");

    rerender(<IndicadorSituacao tom="perigo" titulo="Muito abaixo" />);
    expect(desenho()).toBe("alerta");

    rerender(<IndicadorSituacao tom="neutro" titulo="Sem meta" />);
    expect(desenho()).toBe("menos");
    expect(container.firstElementChild).toHaveClass("ui-situacao--neutro");

    // Outro caractere (sem desenho): fica como texto, só visual.
    rerender(<IndicadorSituacao tom="neutro" titulo="Sem meta" icone="★" />);
    expect(screen.getByText("★")).toHaveAttribute("aria-hidden", "true");
  });
});
