import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IndicadorSituacao } from "./IndicadorSituacao";

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
    // O texto faz sentido sem a cor e sem o ícone; quem lê a tela ouve só o texto.
    expect(raiz).toHaveTextContent("✓Em dia6 bilhetes acima do esperado");
    expect(screen.getByText("✓")).toHaveAttribute("aria-hidden", "true");
    // Não é região viva: numa tela que se atualiza sozinha seria ruído.
    expect(raiz).not.toHaveAttribute("role");
  });

  it("ícone padrão por tom, trocável, e sem detalhe", () => {
    const { rerender, container } = render(
      <IndicadorSituacao tom="alerta" titulo="Abaixo do esperado" />,
    );
    expect(screen.getByText("!")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".ui-situacao__detalhe")).toBeNull();

    rerender(
      <IndicadorSituacao tom="alerta" titulo="Abaixo do esperado" icone="↓" />,
    );
    expect(screen.getByText("↓")).toBeInTheDocument();

    rerender(<IndicadorSituacao tom="neutro" titulo="Sem meta" />);
    expect(screen.getByText("–")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("ui-situacao--neutro");
  });
});
