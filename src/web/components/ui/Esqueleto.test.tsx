// RIFA-049 (P1.2, D25): o esqueleto do carregando. Cada bloco tem exatamente a altura pedida (nada pula quando o
// conteúdo chega), os blocos são só visuais e o leitor de tela continua ouvindo o carregando (um anúncio por tela).
// O brilho só sem prefers-reduced-motion: tema/movimento-css.test.ts e o teste abaixo, que lê o CSS.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Esqueleto } from "./Esqueleto";

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

describe("Esqueleto", () => {
  it("cada bloco tem a altura (e a largura) pedida, com o brilho do tema, e é só visual", () => {
    const { container } = render(
      <Esqueleto
        blocos={[{ altura: "8rem" }, { altura: "1.5rem", largura: "40%" }]}
      />,
    );
    const blocos = [
      ...container.querySelectorAll<HTMLElement>(".ui-esqueleto__bloco"),
    ];
    expect(blocos).toHaveLength(2);
    expect(blocos[0].style.height).toBe("8rem");
    expect(blocos[0].style.width).toBe("");
    expect(blocos[1].style.height).toBe("1.5rem");
    expect(blocos[1].style.width).toBe("40%");
    for (const bloco of blocos) {
      expect(bloco).toHaveClass("mov-esqueleto");
      expect(bloco).toHaveAttribute("aria-hidden", "true");
      expect(bloco).toBeEmptyDOMElement();
    }
  });

  it("o leitor de tela ouve o carregando (role=status, escondido só da vista)", () => {
    const { rerender } = render(<Esqueleto blocos={[{ altura: "2rem" }]} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/^Carregando…$/);
    expect(status).toHaveClass("visualmente-oculto");

    rerender(
      <Esqueleto
        blocos={[{ altura: "2rem" }]}
        texto="Carregando os seus números…"
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Carregando os seus números…",
    );
  });

  it("texto null: sem anúncio (outro esqueleto da tela já anuncia); cartao põe a moldura do Card", () => {
    const { container } = render(
      <>
        <Esqueleto blocos={[{ altura: "2rem" }]} />
        <Esqueleto blocos={[{ altura: "3rem" }]} texto={null} cartao />
      </>,
    );
    expect(screen.getAllByRole("status")).toHaveLength(1);
    const [primeiro, segundo] = container.querySelectorAll(".ui-esqueleto");
    expect(primeiro).not.toHaveClass("ui-esqueleto--cartao");
    expect(segundo).toHaveClass("ui-esqueleto--cartao");
  });

  it("CSS: o brilho do bloco só com no-preference; o esqueleto segura o texto escondido", () => {
    const movimento = lerCss("../../tema/movimento.css");
    // O ::after (o brilho) só existe dentro do @media do movimento liberado.
    const antesDoMedia = movimento.slice(
      0,
      movimento.indexOf("@media (prefers-reduced-motion: no-preference)"),
    );
    expect(antesDoMedia).not.toMatch(/\.mov-esqueleto::after/);
    expect(movimento).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.mov-esqueleto::after\s*\{[^}]*animation:\s*ui-brilho/,
    );
    expect(lerCss("./Esqueleto.css")).toMatch(
      /\.ui-esqueleto\s*\{[^}]*position:\s*relative;/,
    );
  });

  it("CSS: nas cores forçadas, o bloco ganha a borda do sistema (sem ela, o fundo some e o esqueleto não aparece)", () => {
    expect(lerCss("./Esqueleto.css")).toMatch(
      /@media \(forced-colors: active\)\s*\{\s*\.ui-esqueleto__bloco\s*\{\s*border:\s*1px solid GrayText;/,
    );
  });
});
