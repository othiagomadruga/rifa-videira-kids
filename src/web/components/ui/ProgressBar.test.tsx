import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "./ProgressBar";

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

describe("ProgressBar", () => {
  it("expõe o percentual da meta com aria-valuenow/min/max e um nome", () => {
    render(<ProgressBar rotulo="Meta da campanha" valor={350} meta={1000} />);

    const barra = screen.getByRole("progressbar", { name: "Meta da campanha" });
    expect(barra).toHaveAttribute("aria-valuemin", "0");
    expect(barra).toHaveAttribute("aria-valuemax", "100");
    expect(barra).toHaveAttribute("aria-valuenow", "35");
    expect(barra).toHaveAttribute("aria-valuetext", "35%");
    expect(screen.getByText("35%")).toBeInTheDocument();
  });

  it("não expõe o valor bruto (ex.: centavos), só o percentual", () => {
    render(
      <ProgressBar rotulo="Arrecadado" valor={1_234_500} meta={5_000_000} />,
    );

    const barra = screen.getByRole("progressbar", { name: "Arrecadado" });
    expect(barra).toHaveAttribute("aria-valuenow", "24");
    expect(barra).toHaveAttribute("aria-valuetext", "24%");
    expect(document.body.textContent).not.toMatch(/1234500|1\.234\.500/);
  });

  it("acima da meta: barra cheia, texto com o percentual real", () => {
    const { container } = render(
      <ProgressBar rotulo="Célula Ágape" valor={120} meta={100} />,
    );

    const barra = screen.getByRole("progressbar", { name: "Célula Ágape" });
    expect(barra).toHaveAttribute("aria-valuenow", "100");
    expect(barra).toHaveAttribute("aria-valuetext", "120%");
    expect(container.querySelector(".ui-progress")).toHaveAttribute(
      "data-completa",
    );
    // RIFA-049: o selo do troféu no fim do trilho, só visual, fora da barra (o progressbar continua só com a barra).
    const trofeu = container.querySelector(".ui-progress__trofeu");
    expect(trofeu).toHaveAttribute("aria-hidden", "true");
    expect(trofeu?.querySelector("svg")).toHaveAttribute(
      "data-icone",
      "trofeu",
    );
    expect(barra).not.toContainElement(trofeu as HTMLElement);
    expect(screen.getByText("120%")).toHaveClass("ui-progress__valor");
  });

  it("abaixo da meta: sem troféu e sem data-completa", () => {
    const { container } = render(
      <ProgressBar rotulo="Célula Betel" valor={99} meta={100} />,
    );
    expect(container.querySelector(".ui-progress__trofeu")).toBeNull();
    expect(container.querySelector(".ui-progress")).not.toHaveAttribute(
      "data-completa",
    );
  });

  it("mostrarValor={false} (RIFA-049): o % some da vista, mas o leitor de tela ouve (aria-valuetext) e o rótulo continua ligado", () => {
    const { container } = render(
      <ProgressBar
        rotulo="Vendidos: 136 de 120 bilhetes"
        valor={136}
        meta={120}
        mostrarValor={false}
      />,
    );
    const barra = screen.getByRole("progressbar", {
      name: "Vendidos: 136 de 120 bilhetes",
    });
    expect(barra).toHaveAttribute("aria-valuenow", "100");
    expect(barra).toHaveAttribute("aria-valuetext", "113%");
    expect(container.querySelector(".ui-progress__valor")).toBeNull();
    expect(container).not.toHaveTextContent("113%");
    // O troféu continua (a meta batida não depende do número ao lado).
    expect(container.querySelector(".ui-progress__trofeu")).not.toBeNull();
  });

  it("CSS: na meta batida, o degradê da marca (nada de verde liso) e o brilho só uma vez, só sem reduce", () => {
    const css = lerCss("./ProgressBar.css");
    expect(css).not.toMatch(/--cor-progresso-completo|--cor-sucesso/);
    const brilho =
      /@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*\.ui-progress\[data-completa\] \.ui-progress__barra::after\s*\{([^}]*)\}/.exec(
        css,
      )?.[1];
    expect(brilho).toMatch(/animation:\s*ui-brilho 450ms [^;]* 1 both;/);
    // Fora do @media do movimento, a barra não tem ::after (com reduce, nenhum brilho).
    const foraDoMedia = css.slice(
      0,
      css.indexOf("@media (prefers-reduced-motion: no-preference)"),
    );
    expect(foraDoMedia).not.toMatch(/::after/);
    // O selo do troféu é absoluto: a altura da barra não muda.
    expect(css).toMatch(/\.ui-progress__trofeu\s*\{[^}]*position:\s*absolute;/);
  });

  it("perto da meta não arredonda para 100%", () => {
    render(<ProgressBar rotulo="Quase" valor={9_999} meta={10_000} />);

    const barra = screen.getByRole("progressbar", { name: "Quase" });
    expect(barra).toHaveAttribute("aria-valuenow", "99");
    expect(barra).toHaveAttribute("aria-valuetext", "99%");
  });

  it("meta zero ou valor negativo ficam em 0%", () => {
    render(
      <>
        <ProgressBar rotulo="Sem meta" valor={50} meta={0} />
        <ProgressBar rotulo="Negativo" valor={-5} meta={10} />
      </>,
    );

    for (const nome of ["Sem meta", "Negativo"]) {
      const barra = screen.getByRole("progressbar", { name: nome });
      expect(barra).toHaveAttribute("aria-valuenow", "0");
      expect(barra).toHaveAttribute("aria-valuetext", "0%");
    }
  });

  it("aceita um texto próprio para o valor", () => {
    render(
      <ProgressBar
        rotulo="Bilhetes"
        valor={300}
        meta={1000}
        textoValor="300 de 1.000"
      />,
    );

    const barra = screen.getByRole("progressbar", { name: "Bilhetes" });
    expect(barra).toHaveAttribute("aria-valuenow", "30");
    expect(barra).toHaveAttribute("aria-valuetext", "300 de 1.000");
  });
});
