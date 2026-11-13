// RIFA-049 (P1.1, D25): os ícones SVG próprios. Todo nome desenha um <svg> só visual (aria-hidden, sem <title>, fora
// do foco) com o traço em currentColor; os desenhos são só dados (o `d` tem só comandos e números) e nada vira HTML.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Icone } from "./Icone";
import { ICONES, NOMES_ICONES, ehNomeDeIcone, type NomeIcone } from "./icones";

/** Só comandos de path do SVG (M, L, H, V, C, S, Q, T, A, Z, em maiúscula ou minúscula) e números. */
const SO_COMANDOS_E_NUMEROS = /^[MLHVCSQTAZmlhvcsqtaz\d\s.,-]+$/;

// Os nomes que o plano (RIFA-048) combinou com P2 e P3: o menu, as ações, a situação e a comemoração.
const NOMES_DO_PLANO: NomeIcone[] = [
  "visao-geral",
  "campanha",
  "hierarquia",
  "adesao",
  "pedidos",
  "suspeito",
  "ranking",
  "mapa",
  "bumbo",
  "conferencia",
  "acessos",
  "trilha",
  "copiar",
  "conversa",
  "qr",
  "baixar",
  "imprimir",
  "atualizar",
  "sair",
  "check",
  "alerta",
  "info",
  "fechar",
  "subiu",
  "trofeu",
  "sem-conexao",
];

describe("Icone", () => {
  it("tem todos os nomes combinados no plano (e os extras de P2 e P3)", () => {
    expect(NOMES_ICONES).toEqual(expect.arrayContaining(NOMES_DO_PLANO));
    for (const extra of ["menu", "chave", "link", "bussola", "pessoas"])
      expect(ehNomeDeIcone(extra), extra).toBe(true);
    expect(ehNomeDeIcone("↓")).toBe(false);
    expect(ehNomeDeIcone("toString")).toBe(false);
  });

  it.each(NOMES_ICONES)(
    "%s: um <svg> só visual, 24×24, traço em currentColor, sem <title>",
    (nome) => {
      const { container } = render(<Icone nome={nome} />);
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(container.children).toHaveLength(1);
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg).toHaveAttribute("focusable", "false");
      expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
      expect(svg).toHaveAttribute("stroke", "currentColor");
      expect(svg).toHaveAttribute("fill", "none");
      expect(svg).toHaveAttribute("stroke-width", "2");
      expect(svg).toHaveAttribute("data-icone", nome);
      expect(svg).toHaveClass("ui-icone");
      expect(svg?.querySelector("title")).toBeNull();
      // Nenhum nome acessível: quem diz o que é o botão ou o texto ao lado.
      expect(svg).not.toHaveAttribute("role");
      expect(svg).not.toHaveAttribute("aria-label");
      const caminhos = svg?.querySelectorAll("path") ?? [];
      expect(caminhos).toHaveLength(1);
      expect(caminhos[0].getAttribute("d")).toBe(ICONES[nome]);
    },
  );

  it.each(NOMES_ICONES)("%s: o `d` tem só comandos e números", (nome) => {
    const d = ICONES[nome];
    expect(d).toMatch(SO_COMANDOS_E_NUMEROS);
    expect(d).toMatch(/^M/);
    // Os números ficam dentro da grade de 24×24 (com a folga do traço).
    for (const numero of d.match(/-?\d*\.?\d+/g) ?? [])
      expect(
        Math.abs(Number(numero)),
        `${nome}: ${numero}`,
      ).toBeLessThanOrEqual(24);
  });

  it("o tamanho padrão acompanha o texto (CSS); `tamanho` troca o lado", () => {
    const { container, rerender } = render(<Icone nome="copiar" />);
    const svg = () => container.querySelector("svg") as SVGSVGElement;
    expect(svg().style.width).toBe("");
    rerender(<Icone nome="copiar" tamanho="1rem" className="extra" />);
    expect(svg().style.width).toBe("1rem");
    expect(svg().style.height).toBe("1rem");
    expect(svg()).toHaveClass("ui-icone", "extra");
  });

  it("nada de dangerouslySetInnerHTML nos componentes base (os ícones são elementos do React)", () => {
    const fontes = import.meta.glob<string>(
      ["./*.{ts,tsx}", "!./*.test.{ts,tsx}"],
      {
        query: "?raw",
        import: "default",
        eager: true,
      },
    );
    expect(Object.keys(fontes)).toEqual(
      expect.arrayContaining(["./Icone.tsx", "./icones.ts"]),
    );
    for (const [arquivo, fonte] of Object.entries(fontes))
      expect(fonte, arquivo).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
  });
});
