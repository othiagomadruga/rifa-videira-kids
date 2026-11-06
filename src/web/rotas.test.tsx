import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderizarRota, respostaJson } from "./test/renderizar";

// Rotas planejadas: caminho, título (h1) e a tarefa que vai construir a tela.
const TELAS = [
  ["/", "Ranking da campanha", "RIFA-010/011"],
  ["/telao", "Telão", "RIFA-011"],
  ["/entrar", "Entrar", "RIFA-007"],
  ["/coordenacao", "Visão geral", "RIFA-009"],
  ["/coordenacao/campanha", "Campanha", "RIFA-004"],
  ["/coordenacao/hierarquia", "Hierarquia", "RIFA-005"],
  ["/coordenacao/adesao", "Adesão", "RIFA-006"],
  ["/coordenacao/pedidos", "Pedidos", "RIFA-003"],
  ["/coordenacao/rankings", "Rankings", "RIFA-010"],
  ["/coordenacao/bumbo", "Bumbo", "RIFA-011"],
  ["/coordenacao/conferencia", "Conferência", "RIFA-012"],
] as const;

// Menu da coordenação: texto do link e para onde leva (o título da tela é o mesmo texto).
const MENU_COORDENACAO = [
  ["Visão geral", "/coordenacao"],
  ["Campanha", "/coordenacao/campanha"],
  ["Hierarquia", "/coordenacao/hierarquia"],
  ["Adesão", "/coordenacao/adesao"],
  ["Pedidos", "/coordenacao/pedidos"],
  ["Rankings", "/coordenacao/rankings"],
  ["Bumbo", "/coordenacao/bumbo"],
  ["Conferência", "/coordenacao/conferencia"],
] as const;

function tituloDaPagina(nome: string) {
  return screen.getByRole("heading", { level: 1, name: nome });
}

describe("CA1: cada rota mostra a tela certa", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(TELAS)(
    "%s mostra o título %s e o aviso da %s",
    (caminho, titulo, tarefa) => {
      renderizarRota(caminho);

      expect(tituloDaPagina(titulo)).toBeInTheDocument();
      expect(screen.getByText(`Em construção (${tarefa})`)).toBeInTheDocument();
      expect(document.title).toBe(`${titulo} · Rifa Videira Kids`);
    },
  );

  it("/status mostra a página de status da API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respostaJson({ ok: true, db: "ok", latenciaMs: 1 })),
    );

    renderizarRota("/status");

    expect(tituloDaPagina("Status do sistema")).toBeInTheDocument();
    expect(await screen.findByText("API ok")).toBeInTheDocument();
  });

  it("rota desconhecida mostra a 404 com link para o início", () => {
    renderizarRota("/rota-que-nao-existe");

    expect(tituloDaPagina("Página não encontrada")).toBeInTheDocument();
    expect(screen.getByText("/rota-que-nao-existe")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Voltar ao início" }),
    ).toHaveAttribute("href", "/");
  });

  it("rota desconhecida dentro da coordenação mostra a 404 sem perder o menu", () => {
    renderizarRota("/coordenacao/nao-existe");

    expect(tituloDaPagina("Página não encontrada")).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Coordenação" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Voltar ao início" }),
    ).toHaveAttribute("href", "/coordenacao");
  });

  it("/telao não tem navegação, menu nem links", () => {
    renderizarRota("/telao");

    expect(tituloDaPagina("Telão")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("telas abertas (/, /entrar) não têm a navegação da coordenação", () => {
    for (const caminho of ["/", "/entrar"]) {
      const { unmount } = renderizarRota(caminho);
      expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
      unmount();
    }
  });
});

describe("CA2: navegação da coordenação", () => {
  it("tem um link para cada tela filha", () => {
    renderizarRota("/coordenacao");
    const menu = screen.getByRole("navigation", { name: "Coordenação" });

    const links = within(menu).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(
      MENU_COORDENACAO.map(([rotulo]) => rotulo),
    );
    for (const [rotulo, caminho] of MENU_COORDENACAO) {
      expect(within(menu).getByRole("link", { name: rotulo })).toHaveAttribute(
        "href",
        caminho,
      );
    }
  });

  it("cada link leva à tela e só ele fica marcado com aria-current", async () => {
    // Começa na última tela para que o primeiro clique também seja uma navegação.
    const { roteador } = renderizarRota("/coordenacao/conferencia");
    const menu = screen.getByRole("navigation", { name: "Coordenação" });

    for (const [rotulo, caminho] of MENU_COORDENACAO) {
      fireEvent.click(within(menu).getByRole("link", { name: rotulo }));

      expect(
        await screen.findByRole("heading", { level: 1, name: rotulo }),
      ).toBeInTheDocument();
      expect(roteador.state.location.pathname).toBe(caminho);
      const atuais = within(menu)
        .getAllByRole("link")
        .filter((link) => link.getAttribute("aria-current") === "page");
      expect(atuais).toHaveLength(1);
      expect(atuais[0]).toHaveAccessibleName(rotulo);
    }
  });

  it("menu compacto: o botão abre e fecha o menu, e escolher uma tela fecha", async () => {
    renderizarRota("/coordenacao");
    const botao = screen.getByRole("button", { name: "Menu" });
    const menu = screen.getByRole("navigation", { name: "Coordenação" });

    expect(botao).toHaveAttribute("aria-controls", menu.id);
    expect(botao).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(botao);
    expect(botao).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(within(menu).getByRole("link", { name: "Pedidos" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Pedidos" }),
    ).toBeInTheDocument();
    expect(botao).toHaveAttribute("aria-expanded", "false");
  });
});

// Regra do produto: o público (grupo de WhatsApp e telão) nunca vê valores em R$.
describe("Regra: telas públicas não mostram valores em R$", () => {
  it.each(["/", "/telao"])("%s não mostra R$", (caminho) => {
    renderizarRota(caminho);
    expect(document.body.textContent).not.toMatch(/R\$/);
  });

  it("o código das telas públicas não usa formatarMoeda nem R$", () => {
    const fontes = import.meta.glob<string>(
      [
        "./pages/ranking-publico/**/*.{ts,tsx}",
        "./pages/telao/**/*.{ts,tsx}",
        "!**/*.test.{ts,tsx}",
      ],
      { query: "?raw", import: "default", eager: true },
    );

    expect(Object.keys(fontes).length).toBeGreaterThan(0);
    for (const [arquivo, fonte] of Object.entries(fontes)) {
      expect(fonte, arquivo).not.toMatch(/formatarMoeda|R\$/);
    }
  });
});
