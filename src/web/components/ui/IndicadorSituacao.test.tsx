import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IndicadorSituacao } from "./IndicadorSituacao";

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

    // O caractere de antes ("↓"; as telas passam "caiu" desde a RIFA-053) ainda vira o desenho, igual em todo celular.
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

  it.each([
    "toString",
    "constructor",
    "hasOwnProperty",
    "__proto__",
    "valueOf",
  ])(
    "RIFA-053: %s (um nome do protótipo de um objeto) não vira ícone: fica como texto, sem quebrar",
    (nome) => {
      const { container } = render(
        <IndicadorSituacao tom="neutro" titulo="Sem meta" icone={nome} />,
      );
      const chip = iconeDe(container.firstElementChild);
      expect(chip?.querySelector("svg")).toBeNull();
      expect(chip).toHaveTextContent(new RegExp(`^${nome}$`));
      expect(chip).toHaveAttribute("aria-hidden", "true");
    },
  );
});

// RIFA-049 (P1.10, A-10): a situação fica mais leve que o aviso. Sem a faixa de 4 px (ela é do Aviso, o alerta), com
// fundo suave e borda de 1 px; a regra das cores forçadas continua (a borda aparece no alto contraste do Windows).
describe("IndicadorSituacao: CSS", () => {
  const css = lerCss("./IndicadorSituacao.css");

  it("sem a faixa de 4 px; o Aviso continua com a dele", () => {
    expect(css).not.toMatch(/border-left|4px/);
    expect(css).toMatch(/\.ui-situacao\s*\{[^}]*border:\s*1px solid/);
    expect(lerCss("./Aviso.css")).toMatch(/border-left-width:\s*4px;/);
  });

  it("a regra das cores forçadas continua", () => {
    expect(css).toMatch(
      /@media \(forced-colors: active\)\s*\{\s*\.ui-situacao\s*\{\s*border:\s*1px solid CanvasText;/,
    );
  });
});
