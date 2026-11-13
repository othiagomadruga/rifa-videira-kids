// CA2: letras do tamanho de ler a 8 m. No telao.css, o font-size só aparece nos textos, em em do .telao,
// que vale o --telao-texto-base do tema. Este teste calcula o texto-base pela fórmula do tokens.css
// (1920×1080 e 1280×720), confere cada tamanho (corpo ≥ 40 px e posições ≥ 64 px em 1920×1080) e, no
// telão renderizado, que nenhum texto com tamanho fica dentro de outro (o em não se multiplica). A
// medida na tela de verdade está nas capturas do Playwright.
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderizarRota, respostaJson } from "../../test/renderizar";

// O Vitest esvazia todo import de CSS (até com ?raw): o texto vem do disco, pelo fs do Node.
type ModuloFs = { readFileSync(caminho: string, codificacao: "utf8"): string };
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

const semComentarios = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const tokensCss = semComentarios(lerArquivo("../../tema/tokens.css"));
const telaoCss = semComentarios(lerArquivo("./telao.css"));

/** --telao-texto-base numa tela: clamp(mínimo, min(Xvw, Yvh), máximo), em px (1rem = 16 px). */
function textoBase(largura: number, altura: number): number {
  const formula =
    /--telao-texto-base:\s*clamp\(\s*([\d.]+)rem,\s*min\(\s*([\d.]+)vw,\s*([\d.]+)vh\s*\),\s*([\d.]+)rem\s*\)/.exec(
      tokensCss,
    );
  if (!formula)
    throw new Error("A fórmula do --telao-texto-base mudou de forma");
  const [minimo, vw, vh, maximo] = formula.slice(1).map(Number);
  const pelaTela = Math.min((vw * largura) / 100, (vh * altura) / 100);
  return Math.min(Math.max(pelaTela, minimo * 16), maximo * 16);
}

/** As regras do telao.css que mudam o font-size: seletor e valor. */
const TAMANHOS = [...telaoCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(
  ([, seletor, corpo]) =>
    [...corpo.matchAll(/font-size:\s*([^;]+);/g)].map(([, valor]) => ({
      seletor: seletor.trim(),
      valor: valor.trim(),
    })),
);

/** Em de cada regra de texto (todas, menos a do próprio .telao). */
const EMS = TAMANHOS.filter(({ seletor }) => seletor !== ".telao").map(
  ({ seletor, valor }) => {
    const em = /^([\d.]+)em$/.exec(valor);
    if (!em) throw new Error(`${seletor}: font-size fora de em (${valor})`);
    return { seletor, em: Number(em[1]) };
  },
);

describe("CA2: o tamanho das letras do telão", () => {
  it("o texto-base acompanha a tela: ~46 px em 1920×1080 e ~31 px em 1280×720", () => {
    expect(textoBase(1920, 1080)).toBeCloseTo(45.9, 1);
    expect(textoBase(1280, 720)).toBeCloseTo(30.6, 1);
  });

  it("o .telao usa o texto-base e os textos usam em dele (nada em px, rem ou vw)", () => {
    expect(TAMANHOS.find(({ seletor }) => seletor === ".telao")?.valor).toBe(
      "var(--telao-texto-base)",
    );
    expect(EMS.length).toBeGreaterThan(10);
  });

  it("em 1920×1080, todo texto tem 40 px ou mais e as posições, 64 px ou mais", () => {
    const base = textoBase(1920, 1080);
    for (const { seletor, em } of EMS)
      expect({ seletor, px: em * base >= 40 }).toEqual({ seletor, px: true });
    const posicao = EMS.find(({ seletor }) => seletor === ".telao__posicao");
    expect((posicao?.em ?? 0) * base).toBeGreaterThanOrEqual(64);
  });
});

describe("CA2: no telão renderizado, o em não se multiplica", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("nenhum elemento com font-size fica dentro de outro (além do .telao)", async () => {
    const referencia = {
      data: "2026-12-04",
      fase: "durante",
      data_inicio: "2026-11-23",
      data_fim: "2026-12-16",
      duracao_dias: 24,
      dia_campanha: 12,
      dias_restantes: 13,
      dias_para_inicio: null,
      periodo: {
        ordem: 2,
        nome: "Semana 2",
        data_inicio: "2026-12-03",
        data_fim: "2026-12-09",
        dias: 7,
        dia_no_periodo: 2,
        dias_restantes: 6,
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (entrada: RequestInfo | URL) => {
        const divisao = new URL(
          String(entrada),
          "http://localhost",
        ).searchParams.get("divisao");
        return respostaJson({
          nivel: "celula",
          divisao,
          janela: {
            tipo: "atual",
            ordem: 2,
            nome: "Semana 2",
            data_inicio: "2026-12-03",
            data_fim: "2026-12-09",
          },
          criterio: "percentual_meta",
          referencia,
          // Com o % e com mais nomes do que cabem (a linha "e mais"), para todos os textos aparecerem.
          itens:
            divisao === "jovens"
              ? [1, 2, 3, 3, 3, 3].map((posicao, indice) => ({
                  posicao,
                  nome: `Célula ${indice + 1}`,
                  divisao,
                  percentual_meta_bp: 9000 - indice * 100,
                }))
              : [],
          atualizado_em: "2026-12-04T18:30:00.000Z",
        });
      }),
    );
    renderizarRota("/telao");
    await screen.findByText(/^Atualizado às/);

    const raiz = document.querySelector(".telao");
    const seletores = EMS.map(({ seletor }) => seletor);
    const comTamanho = seletores.flatMap((seletor) => [
      ...document.querySelectorAll(seletor),
    ]);
    // Os textos de verdade apareceram: posições, nomes, %, legenda, "e mais", fase, relógio...
    for (const seletor of [
      ".telao__posicao",
      ".telao__nome",
      ".telao__percentual",
      ".telao__legenda",
      ".telao__resto",
      ".telao__sem-vendas",
      ".telao__fase-destaque",
      ".telao__relogio",
      ".telao__atualizado",
      ".telao__janela",
      ".telao__divisao-titulo",
    ])
      expect(document.querySelector(seletor), seletor).not.toBeNull();
    for (const elemento of comTamanho) {
      let acima = elemento.parentElement;
      while (acima && acima !== raiz) {
        expect(
          seletores.filter((seletor) => acima?.matches(seletor)),
          elemento.className,
        ).toEqual([]);
        acima = acima.parentElement;
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// RIFA-050 (A-24): a lista escala pela quantidade de itens (data-itens), a fase é o herói do topo, a pílula só fica
// amarela quando o número termina de contar e as cores novas (o "↑ subiu" e o ícone da falha) são do tema do telão.
// ---------------------------------------------------------------------------------------------------

/** Cada regra do telao.css: os seletores (um por item da lista) e as declarações. */
const REGRAS = [...telaoCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
  ([, seletor, corpo]) => ({
    seletores: seletor
      .split(",")
      .map((parte) => parte.trim().replace(/\s+/g, " ")),
    declaracoes: new Map(
      [...corpo.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map(
        ([, propriedade, valor]) => [propriedade, valor.trim()],
      ),
    ),
  }),
);

/** O valor de uma propriedade para um seletor exato (a última regra que o lista vence, como na cascata). */
function valorDe(seletor: string, propriedade: string): string | undefined {
  return REGRAS.filter(
    ({ seletores, declaracoes }) =>
      seletores.includes(seletor) && declaracoes.has(propriedade),
  )
    .at(-1)
    ?.declaracoes.get(propriedade);
}

const emDe = (seletor: string, propriedade = "font-size") => {
  const valor = valorDe(seletor, propriedade);
  const em = valor === undefined ? null : /^([\d.]+)em$/.exec(valor);
  if (!em)
    throw new Error(`${seletor} { ${propriedade} } fora de em: ${valor}`);
  return Number(em[1]);
};

const comItens = (n: number, resto: string) =>
  `.telao__disputa[data-itens="${n}"] ${resto}`;

describe("RIFA-050 (P2.1): o telão escala pela quantidade de itens (data-itens)", () => {
  it("até 3 itens (o limite público): posição 1,8em, nome e % 1,45em, o 1º com 1,6em, e a linha do 1º com 1,2×", () => {
    for (const n of [1, 2, 3]) {
      expect(emDe(comItens(n, ".telao__posicao"))).toBe(1.8);
      expect(emDe(comItens(n, ".telao__nome"))).toBe(1.45);
      expect(emDe(comItens(n, ".telao__percentual"))).toBe(1.45);
      expect(
        emDe(comItens(n, ".telao__item[data-primeiro] .telao__nome")),
      ).toBe(1.6);
      expect(
        emDe(comItens(n, ".telao__item[data-primeiro] .telao__percentual")),
      ).toBe(1.6);
      expect(valorDe(comItens(n, ".telao__lista"), "grid-template-rows")).toBe(
        "minmax(0, 1.2fr) repeat(2, minmax(0, 1fr))",
      );
      // O "↑ subiu" inteiro, embaixo do nome.
      expect(valorDe(comItens(n, ".telao__celula"), "flex-direction")).toBe(
        "column",
      );
      expect(valorDe(comItens(n, ".telao__subiu-texto"), "display")).toBe(
        "inline",
      );
    }
  });

  it("até 5 itens: nome e % maiores que a base (5 linhas iguais); acima, os tamanhos de base (4 linhas e o 'e mais')", () => {
    const base = emDe(".telao__nome");
    expect(base).toBe(1.1);
    expect(emDe(".telao__percentual")).toBe(base);
    expect(emDe(".telao__posicao")).toBe(1.5);
    expect(valorDe(".telao__lista", "grid-template-rows")).toBe(
      "repeat(4, minmax(0, 1fr))",
    );
    for (const n of [4, 5]) {
      expect(emDe(comItens(n, ".telao__nome"))).toBeGreaterThan(base);
      expect(emDe(comItens(n, ".telao__percentual"))).toBe(
        emDe(comItens(n, ".telao__nome")),
      );
      expect(valorDe(comItens(n, ".telao__lista"), "grid-template-rows")).toBe(
        "repeat(5, minmax(0, 1fr))",
      );
    }
    // Com mais itens, o "↑ subiu" é só a seta, ao lado do nome.
    expect(valorDe(".telao__subiu-texto", "display")).toBe("none");
  });

  it("a disputa e as divisões esticam até o fim da tela; o nome continua em até 2 linhas; a lista (não o item) corta as partículas", () => {
    expect(valorDe(".telao__disputa", "grid-template-rows")).toBe(
      "auto minmax(0, 1fr)",
    );
    expect(valorDe(".telao__divisao", "grid-template-rows")).toBe(
      "auto minmax(0, 1fr) auto",
    );
    expect(valorDe(".telao__nome", "line-clamp")).toBe("2");
    expect(valorDe(".telao__nome", "-webkit-line-clamp")).toBe("2");
    // Com a linha justa (1 a 1,05), o overflow: hidden do corte cortaria as pernas do g, p, q, j, y e o acento de
    // uma maiúscula na 1ª linha ("Ágape"): o padding em cima e embaixo dá esse lugar dentro da caixa (revisão).
    expect(valorDe(".telao__nome", "overflow")).toBe("hidden");
    expect(emDe(".telao__nome", "padding-block")).toBeGreaterThanOrEqual(0.1);
    expect(
      REGRAS.filter(
        ({ seletores, declaracoes }) =>
          seletores.some((seletor) => seletor.endsWith(".telao__nome")) &&
          [...declaracoes.keys()].some((propriedade) =>
            propriedade.startsWith("padding"),
          ),
      ),
    ).toHaveLength(1);
    // O corte fica na lista: no item que o FLIP desliza, o Chrome contaria a troca de lugar como layout shift.
    expect(valorDe(".telao__lista", "overflow")).toBe("clip");
    expect(valorDe(".telao__item", "overflow")).toBeUndefined();
    // 1º lugar: a borda amarela de 3 px.
    expect(valorDe(".telao__item[data-primeiro]", "border")).toBe(
      "3px solid var(--cor-comemoracao)",
    );
    // A disputa não volta a ficar centralizada no meio da tela (era assim que ocupava só 38%).
    expect(valorDe(".telao__disputa", "align-content")).toBeUndefined();
  });

  it("o esqueleto do carregando usa a grade da disputa (sem altura fixa nas linhas)", () => {
    expect(valorDe(".telao__esqueleto-item", "height")).toBeUndefined();
    expect(emDe(".telao__esqueleto-janela", "height")).toBe(1.2);
    expect(emDe(".telao__esqueleto-topo", "height")).toBe(1.5);
    // Nas cores forçadas (o fundo some), a borda mostra o desenho.
    expect(telaoCss).toMatch(
      /@media \(forced-colors: active\)\s*\{\s*\.telao__esqueleto-janela,\s*\.telao__esqueleto-topo,\s*\.telao__esqueleto-item\s*\{\s*border: 1px solid GrayText;/,
    );
  });
});

describe("RIFA-050 (P2.2): a fase em destaque no topo", () => {
  it("'Dia 12 de 24' com 2em, na fonte dos títulos, e o lugar reservado desde o carregando cabe as duas linhas", () => {
    const destaque = emDe(".telao__fase-destaque");
    expect(destaque).toBe(2);
    expect(valorDe(".telao__fase-destaque", "font-family")).toBe(
      "var(--fonte-titulo)",
    );
    const alturaDestaque =
      destaque * Number(valorDe(".telao__fase-destaque", "line-height"));
    // O detalhe herda a altura de linha do .telao.
    const alturaDetalhe =
      emDe(".telao__fase-detalhe") * Number(valorDe(".telao", "line-height"));
    expect(emDe(".telao__fase", "min-height")).toBeGreaterThanOrEqual(
      Number((alturaDestaque + alturaDetalhe).toFixed(2)),
    );
  });
});

describe("RIFA-050 (P2.4): a pílula da meta batida", () => {
  it("só fica amarela quando o número termina de contar (:has(.mov-contagem)); a regra antiga, que pintava antes, saiu", () => {
    expect(
      valorDe(
        ".telao__item[data-meta-batida] .telao__percentual:not(:has(.mov-contagem))",
        "background",
      ),
    ).toBe("var(--cor-comemoracao)");
    expect(
      valorDe(
        ".telao__item[data-meta-batida] .telao__percentual",
        "background",
      ),
    ).toBeUndefined();
  });
});

describe("RIFA-050: as cores novas são do tema do telão, com o contraste do telão", () => {
  const TELAO = (() => {
    const inicio = tokensCss.indexOf('[data-tema="telao"] {');
    const bloco = tokensCss.slice(inicio, tokensCss.indexOf("}", inicio));
    return new Map(
      [...bloco.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((par) => [
        par[1],
        par[2].trim(),
      ]),
    );
  })();
  const cor = (nome: string): string => {
    const valor = TELAO.get(nome);
    if (!valor) throw new Error(`${nome} não está no tema do telão`);
    const referencia = /^var\((--[\w-]+)\)$/.exec(valor);
    return referencia ? cor(referencia[1]) : valor;
  };
  const luminancia = (hex: string) => {
    const [r, g, b] = [1, 3, 5]
      .map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contraste = (a: string, b: string) => {
    const [clara, escura] = [luminancia(cor(a)), luminancia(cor(b))].sort(
      (x, y) => y - x,
    );
    return (clara + 0.05) / (escura + 0.05);
  };

  it('o "↑ subiu" (texto): o verde-água sobre o fundo suave dele, 7:1 ou mais (AAA)', () => {
    expect(valorDe(".telao__subiu", "color")).toBe("var(--cor-primaria)");
    expect(valorDe(".telao__subiu", "background")).toBe(
      "var(--cor-primaria-suave)",
    );
    expect(
      contraste("--cor-primaria", "--cor-primaria-suave"),
    ).toBeGreaterThanOrEqual(7);
  });

  it("o ícone da falha (objeto gráfico) sobre o círculo dele, 3:1 ou mais", () => {
    expect(valorDe(".telao__mensagem-icone", "color")).toBe(
      "var(--cor-alerta)",
    );
    expect(valorDe(".telao__mensagem-icone", "background")).toBe(
      "var(--cor-alerta-suave)",
    );
    expect(
      contraste("--cor-alerta", "--cor-alerta-suave"),
    ).toBeGreaterThanOrEqual(3);
  });
});
