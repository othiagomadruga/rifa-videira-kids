import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { GraficoLinhas } from "./GraficoLinhas";
import { indicesDoEixoX, marcasDoEixoY } from "./escalaGrafico";

type Props = ComponentProps<typeof GraficoLinhas>;

const PROPS: Props = {
  titulo: "Vendas acumuladas",
  descricao: "O realizado está abaixo do esperado.",
  rotulosX: ["01/12", "02/12", "03/12", "04/12", "05/12"],
  rotulosPonto: ["Dia 1", "Dia 2", "Dia 3", "Dia 4", "Dia 5"],
  tituloColunaX: "Dia",
  series: [
    {
      rotulo: "Realizado",
      estilo: "destaque",
      valores: [3, 8, 12, null, null],
    },
    {
      rotulo: "Esperado",
      estilo: "referencia",
      valores: [5, 10, 15, 20, 25],
      rotuloFinal: "Meta 25",
    },
  ],
  extras: [{ rotulo: "No dia", valores: [3, 5, 4, null, null] }],
  formatarValor: (valor) => `${valor} u`,
  indiceAtual: 2,
  rotuloAtual: "hoje",
};

function renderizar(props: Partial<Props> = {}) {
  const resultado = render(<GraficoLinhas {...PROPS} {...props} />);
  const grafico = screen.getByRole("img", {
    name: props.titulo ?? PROPS.titulo,
  });
  const anuncio = () =>
    resultado.container.querySelector("[aria-live]")?.textContent ?? "";
  const dica = () =>
    resultado.container.querySelector<HTMLElement>(".ui-grafico__dica");
  const rotulosDiretos = () =>
    [...resultado.container.querySelectorAll(".ui-grafico__rotulo")].map(
      (rotulo) => rotulo.textContent,
    );
  return { ...resultado, grafico, anuncio, dica, rotulosDiretos };
}

function abrirTabela() {
  const resumo = screen.getByText("Ver os dados em tabela");
  const detalhes = resumo.closest("details");
  if (!detalhes) throw new Error("sem <details>");
  detalhes.open = true;
  return screen.getByRole("table", { name: PROPS.titulo });
}

describe("GraficoLinhas", () => {
  it("é uma imagem com título e descrição (e as instruções do teclado), e a legenda nomeia cada série", () => {
    const { grafico } = renderizar();

    expect(grafico.tagName.toLowerCase()).toBe("svg");
    expect(grafico).toHaveAccessibleDescription(
      "O realizado está abaixo do esperado. Com o gráfico em foco, as setas percorrem os pontos; a tabela abaixo traz todos os valores.",
    );
    expect(grafico).toHaveAttribute("tabindex", "0");
    const legenda = screen.getByRole("list", { name: "Legenda" });
    expect(
      within(legenda)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Realizado", "Esperado"]);
  });

  it("linha de referência tracejada, destaque cheio por cima, com área e marcador no último ponto", () => {
    const { container } = renderizar();

    const linhas = [
      ...container.querySelectorAll("svg[role=img] path.ui-grafico__linha"),
    ];
    // A referência é desenhada antes (por baixo); o destaque, por último (por cima).
    expect(linhas.map((linha) => linha.getAttribute("class"))).toEqual([
      "ui-grafico__linha ui-grafico__linha--referencia",
      "ui-grafico__linha ui-grafico__linha--destaque",
    ]);
    expect(container.querySelectorAll(".ui-grafico__area-serie")).toHaveLength(
      1,
    );
    expect(
      container.querySelectorAll(".ui-grafico__marcador--destaque"),
    ).toHaveLength(1);
  });

  it("rótulo direto só no fim de cada linha; um que encostaria noutro sai", () => {
    const { rotulosDiretos, unmount } = renderizar();
    expect(rotulosDiretos()).toEqual(["12 u", "Meta 25"]);
    unmount();

    // As duas linhas terminam no mesmo ponto: fica só o rótulo do destaque.
    const juntas = renderizar({
      series: [
        { rotulo: "Realizado", estilo: "destaque", valores: [5, 10, 25] },
        {
          rotulo: "Esperado",
          estilo: "referencia",
          valores: [5, 10, 25],
          rotuloFinal: "Meta 25",
        },
      ],
      rotulosX: ["a", "b", "c"],
      rotulosPonto: ["A", "B", "C"],
      extras: [],
      indiceAtual: null,
    });
    expect(juntas.rotulosDiretos()).toEqual(["25 u"]);
    juntas.unmount();

    // O realizado termina logo acima da meta (passou dela): o rótulo da meta vai para baixo do ponto,
    // para não cair em cima da ponta da linha de destaque.
    const { container } = renderizar({
      series: [
        { rotulo: "Realizado", estilo: "destaque", valores: [10, 20, 39, 41] },
        {
          rotulo: "Esperado",
          estilo: "referencia",
          valores: [8, 16, 30, 40],
          rotuloFinal: "Meta 40",
        },
      ],
      rotulosX: ["a", "b", "c", "d"],
      rotulosPonto: ["A", "B", "C", "D"],
      extras: [],
      indiceAtual: null,
    });
    const [destaque, meta] = [
      ...container.querySelectorAll(".ui-grafico__rotulo"),
    ].map((rotulo) => ({
      texto: rotulo.textContent,
      y: Number(rotulo.getAttribute("y")),
    }));
    expect([destaque.texto, meta.texto]).toEqual(["41 u", "Meta 40"]);
    expect(meta.y - destaque.y).toBeGreaterThanOrEqual(20);
  });

  it("eixos: marcas redondas no Y (com o formato do eixo) e o primeiro e o último dia no X", () => {
    const { container } = renderizar({
      formatarEixo: (valor) => `${valor}`,
    });

    const textos = [
      ...container.querySelectorAll(".ui-grafico__texto-eixo"),
    ].map((texto) => texto.textContent);
    // Máximo 25: marcas de 10 em 10 até 30; no X, cabem os cinco dias.
    expect(textos).toEqual([
      "0",
      "10",
      "20",
      "30",
      "01/12",
      "02/12",
      "03/12",
      "04/12",
      "05/12",
    ]);
  });

  it("a tabela traz todos os pontos, com o ponto atual marcado e os vazios como 'sem dado'", () => {
    renderizar();
    const tabela = abrirTabela();

    const [cabecalho, ...linhas] = within(tabela).getAllByRole("row");
    expect(
      within(cabecalho)
        .getAllByRole("columnheader")
        .map((celula) => celula.textContent),
    ).toEqual(["Dia", "Realizado", "Esperado", "No dia"]);
    expect(linhas).toHaveLength(5);
    expect(linhas[2]).toHaveAttribute("aria-current", "true");
    expect(within(linhas[2]).getByRole("rowheader")).toHaveTextContent(
      "Dia 3 (hoje)",
    );
    expect(
      within(linhas[2])
        .getAllByRole("cell")
        .map((celula) => celula.textContent),
    ).toEqual(["12 u", "15 u", "4 u"]);
    expect(within(linhas[3]).getAllByRole("cell")[0]).toHaveTextContent(
      "sem dado",
    );
    expect(
      linhas.filter((linha) => linha.hasAttribute("aria-current")),
    ).toHaveLength(1);
  });

  it("teclado: o foco mostra a mira no ponto atual e anuncia; setas, Home e End percorrem; Esc e a saída do foco escondem", () => {
    const { grafico, anuncio, dica } = renderizar();
    expect(dica()).toBeNull();

    fireEvent.focus(grafico);
    expect(anuncio()).toBe(
      "Dia 3 (hoje): Realizado 12 u; Esperado 15 u; No dia 4 u.",
    );
    expect(dica()).toHaveTextContent("Dia 3 (hoje)");
    expect(dica()).toHaveAttribute("aria-hidden", "true");

    fireEvent.keyDown(grafico, { key: "ArrowLeft" });
    expect(anuncio()).toMatch(/^Dia 2: Realizado 8 u; Esperado 10 u;/);

    fireEvent.keyDown(grafico, { key: "End" });
    expect(anuncio()).toBe(
      "Dia 5: Realizado sem dado; Esperado 25 u; No dia sem dado.",
    );
    // No fim, a seta para a direita não sai do gráfico.
    fireEvent.keyDown(grafico, { key: "ArrowRight" });
    expect(anuncio()).toMatch(/^Dia 5:/);

    fireEvent.keyDown(grafico, { key: "Home" });
    expect(anuncio()).toMatch(/^Dia 1: Realizado 3 u;/);
    fireEvent.keyDown(grafico, { key: "ArrowLeft" });
    expect(anuncio()).toMatch(/^Dia 1:/);

    fireEvent.keyDown(grafico, { key: "Escape" });
    expect(dica()).toBeNull();
    expect(anuncio()).toBe("");

    fireEvent.keyDown(grafico, { key: "ArrowRight" });
    expect(anuncio()).toMatch(/^Dia 4:/);
    fireEvent.blur(grafico);
    expect(dica()).toBeNull();
  });

  it("as setas não rolam a página; outras teclas seguem normais", () => {
    const { grafico } = renderizar();
    fireEvent.focus(grafico);

    expect(fireEvent.keyDown(grafico, { key: "ArrowLeft" })).toBe(false);
    expect(fireEvent.keyDown(grafico, { key: "Tab" })).toBe(true);
  });

  it("ponteiro: a mira segue o ponteiro, sem anunciar; o mouse saindo esconde, o toque não", () => {
    const { grafico, dica, anuncio } = renderizar();

    // Sem medida (jsdom), o gráfico tem 640 px: o canto direito é o último ponto.
    fireEvent.pointerMove(grafico, { clientX: 639 });
    expect(dica()).toHaveTextContent("Dia 5");
    expect(anuncio()).toBe("");
    fireEvent.pointerLeave(grafico, { pointerType: "mouse" });
    expect(dica()).toBeNull();

    fireEvent.pointerDown(grafico, { clientX: 0, pointerType: "touch" });
    expect(dica()).toHaveTextContent("Dia 1");
    fireEvent.pointerLeave(grafico, { pointerType: "touch" });
    expect(dica()).toHaveTextContent("Dia 1");
  });

  it("a dica fica dentro do gráfico: à direita da mira, ou à esquerda quando não cabe", () => {
    const { container, grafico, dica } = renderizar();
    const posicoes = () => ({
      mira: Number(
        container.querySelector(".ui-grafico__mira-linha")?.getAttribute("x1"),
      ),
      esquerda: Number.parseFloat(dica()?.style.left ?? ""),
      largura: Number.parseFloat(dica()?.style.width ?? ""),
    });

    fireEvent.pointerMove(grafico, { clientX: 0 });
    const inicio = posicoes();
    expect(inicio.esquerda).toBeGreaterThan(inicio.mira);
    expect(inicio.esquerda + inicio.largura).toBeLessThanOrEqual(640);

    fireEvent.pointerMove(grafico, { clientX: 639 });
    const fim = posicoes();
    expect(fim.esquerda).toBeGreaterThanOrEqual(0);
    expect(fim.esquerda + fim.largura).toBeLessThan(fim.mira);
  });

  it("no celular (322 px), a dica fica mais estreita, ao lado da mira, sem cobri-la", () => {
    const medida = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue(DOMRect.fromRect({ width: 322, height: 220 }));
    try {
      const { container, grafico, dica } = renderizar();
      expect(grafico).toHaveAttribute("width", "322");

      const mira = () =>
        Number(
          container
            .querySelector(".ui-grafico__mira-linha")
            ?.getAttribute("x1"),
        );
      for (const indice of [0, 1, 2, 3, 4]) {
        fireEvent.keyDown(grafico, { key: "Home" });
        for (let passo = 0; passo < indice; passo++)
          fireEvent.keyDown(grafico, { key: "ArrowRight" });
        const esquerda = Number.parseFloat(dica()?.style.left ?? "");
        const largura = Number.parseFloat(dica()?.style.width ?? "");
        expect(esquerda).toBeGreaterThanOrEqual(0);
        expect(esquerda + largura).toBeLessThanOrEqual(322);
        expect(largura).toBeGreaterThanOrEqual(140);
        const cobre = esquerda < mira() && mira() < esquerda + largura;
        expect(cobre, `ponto ${indice}`).toBe(false);
      }
    } finally {
      medida.mockRestore();
    }
  });

  it("sem pontos: sem foco nem mira, e a tabela vazia", () => {
    const { grafico, dica } = renderizar({
      rotulosX: [],
      rotulosPonto: [],
      series: [{ rotulo: "Realizado", estilo: "destaque", valores: [] }],
      extras: [],
      indiceAtual: null,
    });

    expect(grafico).not.toHaveAttribute("tabindex");
    fireEvent.keyDown(grafico, { key: "ArrowRight" });
    expect(dica()).toBeNull();
  });
});

describe("escalas do gráfico", () => {
  it("marcas do Y: de 0 a um valor redondo, com passo 1, 2 ou 5 × 10ⁿ inteiro", () => {
    expect(marcasDoEixoY(360)).toEqual([0, 100, 200, 300, 400]);
    expect(marcasDoEixoY(139)).toEqual([0, 50, 100, 150]);
    expect(marcasDoEixoY(7)).toEqual([0, 2, 4, 6, 8]);
    expect(marcasDoEixoY(3)).toEqual([0, 1, 2, 3]);
    expect(marcasDoEixoY(400)).toEqual([0, 100, 200, 300, 400]);
    // Centavos: R$ 72.000,00 → marcas de R$ 20.000 (reais inteiros).
    expect(marcasDoEixoY(7_200_000)).toEqual([
      0, 2_000_000, 4_000_000, 6_000_000, 8_000_000,
    ]);
    // Sem dados: de 0 a 1.
    expect(marcasDoEixoY(0)).toEqual([0, 1]);
    expect(marcasDoEixoY(Number.NaN)).toEqual([0, 1]);
  });

  it("rótulos do X: o primeiro, a cada passo e sempre o último, sem se encostarem (as pontas pedem mais espaço)", () => {
    // 24 dias no celular (241 px úteis, rótulos "dd/mm" de ~40 px): 23/11, 30/11, 07/12 e 16/12.
    expect(indicesDoEixoX(24, 241)).toEqual([0, 7, 14, 23]);
    expect(indicesDoEixoX(24, 900)).toEqual([
      0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 23,
    ]);
    expect(indicesDoEixoX(2, 30)).toEqual([0, 1]);
    expect(indicesDoEixoX(1, 300)).toEqual([0]);
    expect(indicesDoEixoX(0, 300)).toEqual([]);

    // O 1º rótulo é alinhado pelo início e o último pelo fim: entre eles e o vizinho, 1,5 rótulo + folga.
    const distanciaNaPonta = 1.5 * 40 + 12;
    for (const [total, largura] of [
      [24, 241],
      [24, 900],
      [31, 500],
      [10, 120],
    ]) {
      const indices = indicesDoEixoX(total, largura);
      expect(indices[0]).toBe(0);
      expect(indices.at(-1)).toBe(total - 1);
      const px = largura / (total - 1);
      for (let i = 1; i < indices.length; i++) {
        expect((indices[i] - indices[i - 1]) * px).toBeGreaterThanOrEqual(
          distanciaNaPonta,
        );
      }
    }
  });
});

// Contraste das cores do gráfico nos dois temas (o claro e o do telão), a partir dos tokens do tema e
// dos papéis declarados no CSS do gráfico. Marcas: 3:1 sobre a superfície; textos: 4,5:1.
describe("GraficoLinhas: contraste nos dois temas", () => {
  // O Vitest esvazia todo import de CSS (até com ?raw): o texto vem do disco, pelo fs do Node.
  type ModuloFs = {
    readFileSync(caminho: string, codificacao: "utf8"): string;
  };
  const { process } = globalThis as unknown as {
    process: { getBuiltinModule(nome: "node:fs"): ModuloFs };
  };
  const lerArquivo = (relativo: string) =>
    process
      .getBuiltinModule("node:fs")
      .readFileSync(
        decodeURIComponent(new URL(relativo, import.meta.url).pathname),
        "utf8",
      );
  const tokensCss = lerArquivo("../../tema/tokens.css");
  const graficoCss = lerArquivo("./GraficoLinhas.css");

  function variaveisDoBloco(css: string, seletor: string): Map<string, string> {
    const inicio = css.indexOf(`${seletor} {`);
    if (inicio < 0) throw new Error(`bloco ${seletor} não encontrado`);
    const bloco = css.slice(inicio, css.indexOf("}", inicio));
    return new Map(
      [...bloco.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((par) => [
        par[1],
        par[2].trim(),
      ]),
    );
  }

  const claro = variaveisDoBloco(tokensCss, ":root");
  const telao = new Map([
    ...claro,
    ...variaveisDoBloco(tokensCss, '[data-tema="telao"]'),
  ]);
  const papeis = variaveisDoBloco(graficoCss, ".ui-grafico");

  function resolver(tema: Map<string, string>, valor: string): string {
    const referencia = /^var\((--[\w-]+)\)$/.exec(valor);
    if (!referencia) return valor;
    const proximo = tema.get(referencia[1]);
    if (!proximo) throw new Error(`variável ${referencia[1]} não existe`);
    return resolver(tema, proximo);
  }

  function luminancia(hex: string): number {
    const [r, g, b] = [1, 3, 5]
      .map((inicio) => Number.parseInt(hex.slice(inicio, inicio + 2), 16) / 255)
      .map((canal) =>
        canal <= 0.04045 ? canal / 12.92 : ((canal + 0.055) / 1.055) ** 2.4,
      );
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contraste(a: string, b: string): number {
    const [clara, escura] = [luminancia(a), luminancia(b)].sort(
      (x, y) => y - x,
    );
    return (clara + 0.05) / (escura + 0.05);
  }

  it.each([
    ["claro", claro],
    ["telão", telao],
  ] as const)("tema %s", (_nome, tema) => {
    const superficie = resolver(tema, "var(--cor-superficie)");
    const cor = (papel: string) => {
      const valor = papeis.get(papel);
      if (!valor) throw new Error(`papel ${papel} não declarado`);
      return resolver(tema, valor);
    };

    for (const valor of [superficie, cor("--grafico-destaque")]) {
      expect(valor).toMatch(/^#[0-9a-f]{6}$/i);
    }
    // Linhas e marcadores (WCAG 1.4.11).
    expect(
      contraste(cor("--grafico-destaque"), superficie),
    ).toBeGreaterThanOrEqual(3);
    expect(
      contraste(cor("--grafico-referencia"), superficie),
    ).toBeGreaterThanOrEqual(3);
    // Textos dos eixos, da dica e dos rótulos diretos.
    expect(
      contraste(cor("--grafico-texto"), superficie),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contraste(resolver(tema, "var(--cor-texto)"), superficie),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
