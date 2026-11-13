import { render, screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App";
import { ErroApi } from "../../lib/api";
import { ErroRota } from "./ErroRota";

function renderizarTelaQueQuebra(erro: unknown) {
  function TelaQueQuebra(): never {
    throw erro;
  }
  const roteador = createMemoryRouter([
    { path: "/", Component: TelaQueQuebra, ErrorBoundary: ErroRota },
  ]);
  render(<App roteador={roteador} />);
}

describe("ErroRota", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tela que quebra mostra um erro amigável, sem detalhes internos", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    renderizarTelaQueQuebra(new Error("Cannot read properties of undefined"));

    expect(
      screen.getByRole("heading", { level: 1, name: "Algo deu errado" }),
    ).toBeInTheDocument();
    const alerta = screen.getByRole("alert");
    expect(alerta).toHaveTextContent("Esta tela encontrou um erro inesperado.");
    expect(alerta).toHaveTextContent(
      "Ocorreu um erro inesperado. Tente de novo.",
    );
    expect(alerta).not.toHaveTextContent("Cannot read properties");
    expect(
      screen.getByRole("button", { name: "Tentar de novo" }),
    ).toBeInTheDocument();
    // RIFA-050: o alerta grande acima do título, só visual (o título e o botão não mudam).
    const icone = document.querySelector(".icone-da-tela");
    expect(icone).toHaveAttribute("aria-hidden", "true");
    expect(icone?.querySelector("svg")).toHaveAttribute("data-icone", "alerta");
  });

  it("com ErroApi, mostra a mensagem da API", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    renderizarTelaQueQuebra(
      new ErroApi({ codigo: "NAO_AUTORIZADO", mensagem: "Entre de novo." }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Entre de novo.");
  });
});
