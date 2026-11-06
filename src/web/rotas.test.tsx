import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderizarRota, respostaJson } from "./test/renderizar";

// Rotas planejadas: caminho, título (h1) e a tarefa que vai construir a tela.
const TELAS = [
  ["/", "Ranking da campanha", "RIFA-010/011"],
  ["/telao", "Telão", "RIFA-011"],
  ["/entrar", "Entrar", "RIFA-007"],
  ["/coordenacao", "Visão geral", "RIFA-009"],
  // /coordenacao/campanha (RIFA-004) e /coordenacao/hierarquia (RIFA-005) já são telas de verdade:
  // ver pages/campanha/CampanhaPage.test.tsx e pages/hierarquia/HierarquiaPage.test.tsx.
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
});

describe("CA2: menu compacto (celular)", () => {
  function renderizarComMenuAberto() {
    renderizarRota("/coordenacao");
    const botao = screen.getByRole("button", { name: "Menu" });
    const menu = screen.getByRole("navigation", { name: "Coordenação" });
    fireEvent.click(botao);
    expect(botao).toHaveAttribute("aria-expanded", "true");
    return { botao, menu };
  }

  it("o botão abre o menu e, clicado de novo, fecha", () => {
    renderizarRota("/coordenacao");
    const botao = screen.getByRole("button", { name: "Menu" });
    const menu = screen.getByRole("navigation", { name: "Coordenação" });
    expect(botao).toHaveAttribute("aria-controls", menu.id);
    expect(botao).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(botao);
    expect(botao).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(botao);
    expect(botao).toHaveAttribute("aria-expanded", "false");
  });

  it("Esc fecha o menu e devolve o foco ao botão Menu", () => {
    const { botao, menu } = renderizarComMenuAberto();
    const link = within(menu).getByRole("link", { name: "Pedidos" });
    act(() => link.focus());

    fireEvent.keyDown(link, { key: "Escape" });

    expect(botao).toHaveAttribute("aria-expanded", "false");
    expect(botao).toHaveFocus();
  });

  it("toque fora fecha o menu; toque dentro não", () => {
    const { botao, menu } = renderizarComMenuAberto();

    fireEvent.pointerDown(within(menu).getByRole("link", { name: "Bumbo" }));
    fireEvent.pointerDown(botao);
    expect(botao).toHaveAttribute("aria-expanded", "true");

    fireEvent.pointerDown(screen.getByRole("main"));
    expect(botao).toHaveAttribute("aria-expanded", "false");
  });

  it("fecha quando o foco sai do menu para outro elemento da página", () => {
    const { botao, menu } = renderizarComMenuAberto();
    act(() => within(menu).getByRole("link", { name: "Bumbo" }).focus());
    act(() => within(menu).getByRole("link", { name: "Conferência" }).focus());
    expect(botao).toHaveAttribute("aria-expanded", "true");

    act(() => screen.getByRole("main").focus());

    expect(botao).toHaveAttribute("aria-expanded", "false");
  });

  it("fecha com Tab depois do último link, mesmo sem próximo elemento", async () => {
    const { botao, menu } = renderizarComMenuAberto();
    const bumbo = within(menu).getByRole("link", { name: "Bumbo" });
    const ultimo = within(menu).getByRole("link", { name: "Conferência" });
    act(() => bumbo.focus());

    // Tab dentro do menu: continua aberto.
    fireEvent.keyDown(bumbo, { key: "Tab" });
    act(() => ultimo.focus());
    await act(() => new Promise((resolver) => setTimeout(resolver, 0)));
    expect(botao).toHaveAttribute("aria-expanded", "true");

    // Tab no último link: o foco sai da página (focusout sem destino).
    fireEvent.keyDown(ultimo, { key: "Tab" });
    act(() => ultimo.blur());

    await waitFor(() =>
      expect(botao).toHaveAttribute("aria-expanded", "false"),
    );
  });

  it("escolher uma tela fecha o menu e leva o foco ao conteúdo", async () => {
    const { botao, menu } = renderizarComMenuAberto();

    fireEvent.click(within(menu).getByRole("link", { name: "Pedidos" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Pedidos" }),
    ).toBeInTheDocument();
    expect(botao).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("main")).toHaveFocus();
  });
});

// Regra do produto: o público (grupo de WhatsApp e telão) nunca vê valores em R$.
describe("Regra: telas públicas não mostram valores em R$", () => {
  it.each(["/", "/telao"])("%s não mostra R$", (caminho) => {
    renderizarRota(caminho);
    expect(document.body.textContent).not.toMatch(/R\$/);
  });

  it("o código das telas públicas não formata nem lê dinheiro", () => {
    const fontes = import.meta.glob<string>(
      [
        "./pages/ranking-publico/**/*.{ts,tsx}",
        "./pages/telao/**/*.{ts,tsx}",
        "!**/*.test.{ts,tsx}",
      ],
      { query: "?raw", import: "default", eager: true },
    );

    expect(Object.keys(fontes).length).toBeGreaterThan(0);
    // formatarMoeda e "R$": formatação; currency e BRL: Intl direto; _centavos:
    // campos de dinheiro do contrato (total_centavos, preco_bilhete_centavos...).
    for (const [arquivo, fonte] of Object.entries(fontes)) {
      expect(fonte, arquivo).not.toMatch(
        /formatarMoeda|R\$|currency|BRL|_centavos/,
      );
    }
  });
});
