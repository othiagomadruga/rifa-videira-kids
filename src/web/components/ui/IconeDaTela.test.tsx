// RIFA-053: o ícone grande das telas abertas mora em components/ui (antes, em pages/entrar), usado pelo /entrar, pelo
// /acesso e, pelo `icone` do PageHeader, pela 404 e pelo erro de rota. Só visual: o círculo é aria-hidden, com o
// Icone dentro; o título diz o que é a tela.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IconeDaTela, PageHeader } from ".";

type ModuloFs = { readFileSync(caminho: string, codificacao: "utf8"): string };
const { process } = globalThis as unknown as {
  process: { getBuiltinModule(nome: "node:fs"): ModuloFs };
};
// O caminho vai numa variável: com um texto fixo, o Vite trocaria o new URL(..., import.meta.url) pela URL do asset.
const lerCss = (relativo: string) =>
  process
    .getBuiltinModule("node:fs")
    .readFileSync(
      decodeURIComponent(new URL(relativo, import.meta.url).pathname),
      "utf8",
    )
    .replace(/\/\*[\s\S]*?\*\//g, "");

describe("IconeDaTela", () => {
  it("o círculo só visual, com o desenho pedido", () => {
    const { container } = render(<IconeDaTela nome="chave" />);
    const circulo = container.firstElementChild;
    expect(circulo).toHaveClass("ui-icone-da-tela");
    expect(circulo).toHaveAttribute("aria-hidden", "true");
    expect(circulo?.children).toHaveLength(1);
    expect(circulo?.querySelector("svg")).toHaveAttribute(
      "data-icone",
      "chave",
    );
    expect(circulo).toHaveTextContent(/^$/);
  });

  it("CSS: o roxo da marca no círculo suave, de 3,5rem, sem encolher numa linha flex", () => {
    const css = lerCss("./IconeDaTela.css");
    const regra = /\.ui-icone-da-tela\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    for (const declaracao of [
      "width: 3.5rem;",
      "height: 3.5rem;",
      "border-radius: 50%;",
      "background: var(--cor-primaria-suave);",
      "color: var(--cor-primaria);",
      "flex: none;",
    ])
      expect(regra).toContain(declaracao);
  });
});

describe("PageHeader com o ícone da tela (RIFA-053)", () => {
  it("o ícone fica no cabeçalho, antes do título (só visual: o nome do h1 e o título da aba não mudam)", () => {
    const { container } = render(
      <PageHeader
        icone="bussola"
        titulo="Página não encontrada"
        descricao="Não existe nada aqui."
      />,
    );
    const cabecalho = container.querySelector("header");
    expect(cabecalho).toHaveClass(
      "ui-page-header",
      "ui-page-header--com-icone",
    );
    const titulo = screen.getByRole("heading", {
      level: 1,
      name: "Página não encontrada",
    });
    const icone = cabecalho?.querySelector(".ui-icone-da-tela");
    expect(icone?.querySelector("svg")).toHaveAttribute(
      "data-icone",
      "bussola",
    );
    // No mesmo bloco do traço e do título, antes deles.
    expect(icone?.parentElement).toBe(titulo.parentElement);
    expect(titulo.parentElement?.firstElementChild).toBe(icone);
    expect(document.title).toBe("Página não encontrada · Rifa Videira Kids");
  });

  it("sem o ícone, nada muda (as telas de trabalho)", () => {
    const { container } = render(<PageHeader titulo="Pedidos" />);
    expect(container.querySelector("header")?.className).toBe("ui-page-header");
    expect(container.querySelector(".ui-icone-da-tela")).toBeNull();
  });

  it("CSS: o ícone na coluna da esquerda, ao lado do traço e do título; o resto na da direita", () => {
    const css = lerCss("./PageHeader.css").replace(/\s+/g, " ");
    expect(css).toContain(
      ".ui-page-header--com-icone .ui-page-header__textos { grid-template-columns: auto minmax(0, 1fr);",
    );
    expect(css).toMatch(
      /\.ui-page-header--com-icone \.ui-page-header__textos::before, \.ui-page-header--com-icone \.ui-page-header__titulo, \.ui-page-header--com-icone \.ui-page-header__descricao \{ grid-column: 2; \}/,
    );
    expect(css).toMatch(
      /\.ui-page-header--com-icone \.ui-icone-da-tela \{ grid-column: 1; grid-row: 1 \/ span 2;/,
    );
  });
});
