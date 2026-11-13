import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { MENSAGEM_SEM_CONEXAO } from "../../lib/api";
import { TITULO_SEM_CONEXAO } from "./ErrorState";
import {
  AppShell,
  Badge,
  Button,
  Card,
  classesBotao,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  PublicShell,
  Stat,
} from ".";

describe("Button", () => {
  it("é type=button por padrão e aplica a variante", () => {
    const aoClicar = vi.fn();
    render(
      <>
        <Button onClick={aoClicar}>Salvar</Button>
        <Button variante="perigo" tamanho="pequeno" type="submit" disabled>
          Excluir
        </Button>
      </>,
    );

    const salvar = screen.getByRole("button", { name: "Salvar" });
    expect(salvar).toHaveAttribute("type", "button");
    expect(salvar).toHaveClass("ui-button", "ui-button--primario");
    fireEvent.click(salvar);
    expect(aoClicar).toHaveBeenCalledOnce();

    const excluir = screen.getByRole("button", { name: "Excluir" });
    expect(excluir).toHaveAttribute("type", "submit");
    expect(excluir).toHaveClass("ui-button--perigo", "ui-button--pequeno");
    expect(excluir).toBeDisabled();
  });

  it("classesBotao dá cara de botão a links", () => {
    expect(classesBotao({ variante: "secundario" }, "extra")).toBe(
      "ui-button ui-button--secundario extra",
    );
  });
});

describe("Badge", () => {
  it("mostra o status com o tom pedido", () => {
    render(<Badge tom="sucesso">Pago</Badge>);
    expect(screen.getByText("Pago")).toHaveClass("ui-badge--sucesso");
  });

  it("usa o tom neutro por padrão", () => {
    render(<Badge>Rascunho</Badge>);
    expect(screen.getByText("Rascunho")).toHaveClass("ui-badge--neutro");
  });
});

describe("Card e PageHeader", () => {
  it("Card mostra título (h2), ações e conteúdo", () => {
    render(
      <Card titulo="Ritmo de vendas" acoes={<Button>Atualizar</Button>}>
        <p>Conteúdo do cartão</p>
      </Card>,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Ritmo de vendas" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Atualizar" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Conteúdo do cartão")).toBeInTheDocument();
  });

  it("PageHeader mostra o h1, a descrição e muda o título da aba", () => {
    render(
      <PageHeader
        titulo="Pedidos"
        descricao="Vendas recebidas da Rifei."
        acoes={<Button>Exportar</Button>}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Pedidos" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Vendas recebidas da Rifei.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Exportar" }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Pedidos · Rifa Videira Kids");
  });
});

describe("Stat", () => {
  it("mostra rótulo, valor e a variação (com o sentido para leitores de tela)", () => {
    const { container } = render(
      <Stat
        rotulo="Bilhetes vendidos"
        valor="1.234"
        variacao={{ texto: "+12% na semana", sentido: "subiu" }}
      />,
    );

    expect(screen.getByText("Bilhetes vendidos")).toBeInTheDocument();
    expect(screen.getByText("1.234")).toHaveClass("ui-stat__valor");
    const variacao = container.querySelector(".ui-stat__variacao");
    expect(variacao).toHaveClass("ui-stat__variacao--positivo");
    expect(variacao).toHaveTextContent("Subiu: +12% na semana");
  });

  it("o tom pode contrariar o sentido (ex.: cancelamentos subindo)", () => {
    const { container } = render(
      <Stat
        rotulo="Cancelamentos"
        valor="9"
        variacao={{ texto: "+3", sentido: "subiu", tom: "negativo" }}
      />,
    );
    expect(container.querySelector(".ui-stat__variacao")).toHaveClass(
      "ui-stat__variacao--negativo",
    );
  });

  it("sem variação, mostra só rótulo e valor", () => {
    const { container } = render(<Stat rotulo="Células" valor="36" />);
    expect(screen.getByText("36")).toBeInTheDocument();
    expect(container.querySelector(".ui-stat__variacao")).toBeNull();
  });
});

describe("estados: vazio, erro e carregando", () => {
  it("EmptyState mostra título, descrição e ação", () => {
    render(
      <EmptyState
        titulo="Nenhum pedido ainda."
        descricao="As vendas aparecem aqui assim que a Rifei avisar."
        acao={<Button>Recarregar</Button>}
      />,
    );
    expect(screen.getByText("Nenhum pedido ainda.")).toBeInTheDocument();
    expect(
      screen.getByText("As vendas aparecem aqui assim que a Rifei avisar."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Recarregar" }),
    ).toBeInTheDocument();
  });

  it("ErrorState é um alerta e oferece tentar de novo", () => {
    const aoTentarDeNovo = vi.fn();
    render(
      <ErrorState
        mensagem={MENSAGEM_SEM_CONEXAO}
        aoTentarDeNovo={aoTentarDeNovo}
      />,
    );

    const alerta = screen.getByRole("alert");
    expect(alerta).toHaveTextContent("Não foi possível carregar os dados.");
    expect(alerta).toHaveTextContent(MENSAGEM_SEM_CONEXAO);
    fireEvent.click(
      within(alerta).getByRole("button", { name: "Tentar de novo" }),
    );
    expect(aoTentarDeNovo).toHaveBeenCalledOnce();
  });

  it("ErrorState conexao (RIFA-049): neutro, com o ícone e 'Sem conexão agora'; o botão e a dica não mudam", () => {
    const aoTentarDeNovo = vi.fn();
    const { container } = render(
      <ErrorState
        conexao
        mensagem={MENSAGEM_SEM_CONEXAO}
        aoTentarDeNovo={aoTentarDeNovo}
      />,
    );

    // Continua um alerta (o leitor de tela ouve), mas sem a cara de erro: nenhuma classe de perigo.
    const alerta = screen.getByRole("alert");
    expect(alerta).toHaveClass("ui-estado", "ui-estado--conexao");
    expect(alerta.className).not.toMatch(/--erro|perigo/);
    expect(alerta).toHaveTextContent(
      `${TITULO_SEM_CONEXAO}${MENSAGEM_SEM_CONEXAO}Tentar de novo`,
    );
    expect(TITULO_SEM_CONEXAO).toBe("Sem conexão agora");
    const icone = container.querySelector(".ui-estado__icone");
    expect(icone).toHaveAttribute("aria-hidden", "true");
    expect(icone?.querySelector("svg")).toHaveAttribute(
      "data-icone",
      "sem-conexao",
    );
    const botao = within(alerta).getByRole("button", {
      name: "Tentar de novo",
    });
    expect(botao).toHaveClass("ui-button--secundario");
    fireEvent.click(botao);
    expect(aoTentarDeNovo).toHaveBeenCalledOnce();
  });

  it("ErrorState conexao aceita outro título (o da tela); sem conexao, igual a antes (vermelho, sem ícone)", () => {
    const { container, rerender } = render(
      <ErrorState conexao titulo="Não foi possível carregar o ranking." />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /^Não foi possível carregar o ranking\.$/,
    );
    rerender(<ErrorState mensagem="Falhou." />);
    const alerta = screen.getByRole("alert");
    expect(alerta).toHaveClass("ui-estado", "ui-estado--erro");
    expect(alerta).toHaveTextContent(
      /^Não foi possível carregar os dados\.Falhou\.$/,
    );
    expect(container.querySelector(".ui-estado__icone")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("EmptyState com icone: o círculo de marca com o ícone, só visual; sem icone, o mesmo texto de antes", () => {
    const { container, rerender } = render(
      <EmptyState
        titulo="O ranking aparece com a primeira venda."
        icone="trofeu"
      />,
    );
    const icone = container.querySelector(".ui-estado__icone");
    expect(icone).toHaveAttribute("aria-hidden", "true");
    expect(icone?.querySelector("svg")).toHaveAttribute("data-icone", "trofeu");
    expect(container.firstElementChild).toHaveTextContent(
      /^O ranking aparece com a primeira venda\.$/,
    );

    rerender(
      <EmptyState titulo="Nenhum pedido ainda." descricao="Volte depois." />,
    );
    expect(container.querySelector(".ui-estado__icone")).toBeNull();
    expect(container.firstElementChild).toHaveClass(
      "ui-estado",
      "ui-estado--vazio",
    );
    expect(container.firstElementChild).toHaveTextContent(
      /^Nenhum pedido ainda\.Volte depois\.$/,
    );
  });

  it("ErrorState sem aoTentarDeNovo não mostra botão", () => {
    render(<ErrorState titulo="Falhou." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Falhou.");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("Loading é um status com texto", () => {
    render(<Loading />);
    expect(screen.getByRole("status")).toHaveTextContent("Carregando…");
  });
});

describe("layouts", () => {
  it("AppShell mostra a marca, a navegação da área e o conteúdo", () => {
    render(
      <MemoryRouter initialEntries={["/area/b"]}>
        <AppShell
          area="Coordenação"
          itens={[
            { para: "/area", rotulo: "Início", exato: true },
            { para: "/area/b", rotulo: "Tela B" },
          ]}
        >
          <p>Conteúdo da tela</p>
        </AppShell>
      </MemoryRouter>,
    );

    const menu = screen.getByRole("navigation", { name: "Coordenação" });
    expect(within(menu).getByRole("link", { name: "Tela B" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      within(menu).getByRole("link", { name: "Início" }),
    ).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("banner")).toHaveTextContent(
      "Rifa Videira KidsCoordenação",
    );
    expect(screen.getByRole("main")).toHaveTextContent("Conteúdo da tela");
    expect(
      screen.getByRole("link", { name: "Pular para o conteúdo" }),
    ).toHaveAttribute("href", "#conteudo");
  });

  it("PublicShell mostra a marca e o conteúdo, sem navegação", () => {
    render(
      <PublicShell>
        <p>Ranking</p>
      </PublicShell>,
    );
    expect(screen.getByRole("banner")).toHaveTextContent("Rifa Videira Kids");
    expect(screen.getByRole("main")).toHaveTextContent("Ranking");
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});
