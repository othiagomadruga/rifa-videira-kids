// RIFA-050 (P2.7): a 404 ganha a bússola acima do título, só visual; o título, o endereço e o "Voltar ao início" não
// mudam (nas telas abertas e na coordenação). A dica do botão é conferida em pages/dicas-fora-da-coordenacao.test.tsx.
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ADMIN_DE_TESTE, renderizarRota } from "../../test/renderizar";

describe("404 (NaoEncontradaPage)", () => {
  it.each([
    ["/pagina-que-nao-existe", undefined, "/"],
    ["/coordenacao/tela-que-nao-existe", ADMIN_DE_TESTE, "/coordenacao"],
  ])(
    "%s: a bússola (aria-hidden) acima do título e o botão de sempre",
    async (caminho, usuario, inicio) => {
      renderizarRota(caminho, usuario ? { usuario } : {});

      const titulo = await screen.findByRole("heading", {
        level: 1,
        name: "Página não encontrada",
      });
      expect(screen.getByText(caminho)).toBeInTheDocument();
      const icone = document.querySelector(".icone-da-tela");
      expect(icone).toHaveAttribute("aria-hidden", "true");
      expect(icone?.querySelector("svg")).toHaveAttribute(
        "data-icone",
        "bussola",
      );
      expect(
        (icone?.compareDocumentPosition(titulo) ?? 0) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      const voltar = screen.getByRole("link", { name: "Voltar ao início" });
      expect(voltar).toHaveAttribute("href", inicio);
    },
  );
});
