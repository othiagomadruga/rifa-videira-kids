import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Aviso, Button } from ".";

describe("Aviso", () => {
  it.each([
    ["perigo", "alert"],
    ["alerta", "alert"],
    ["info", "status"],
    ["sucesso", "status"],
  ] as const)("tom %s é anunciado como %s", (tom, papel) => {
    render(
      <Aviso tom={tom} titulo="Título do aviso">
        <p>Texto do aviso.</p>
      </Aviso>,
    );

    const aviso = screen.getByRole(papel);
    expect(aviso).toHaveClass("ui-aviso", `ui-aviso--${tom}`);
    expect(aviso).toHaveTextContent("Título do avisoTexto do aviso.");
  });

  it("anuncio='nenhum' não cria região viva (para quem já tem uma fixa na tela)", () => {
    const { container } = render(
      <Aviso tom="sucesso" anuncio="nenhum">
        Célula salva.
      </Aviso>,
    );

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(container.querySelector(".ui-aviso")).toHaveTextContent(
      "Célula salva.",
    );
  });

  it("mostra a ação e o botão de fechar, quando pedidos", () => {
    const aoFechar = vi.fn();
    render(
      <Aviso
        tom="perigo"
        titulo="Não foi possível atualizar"
        acao={<Button>Tentar de novo</Button>}
        aoFechar={aoFechar}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Tentar de novo" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fechar aviso" }));
    expect(aoFechar).toHaveBeenCalledOnce();
  });

  it("sem aoFechar não tem botão de fechar", () => {
    render(<Aviso titulo="Informação" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
