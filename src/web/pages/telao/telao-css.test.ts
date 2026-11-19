// CA2: letras do tamanho de ler a 8 m. No telao.css, o font-size só aparece nos textos, em em do .telao,
// que vale o --telao-texto-base do tema. Este teste calcula o texto-base pela fórmula do tokens.css
// (1920×1080 e 1280×720), confere cada tamanho (corpo ≥ 40 px e posições ≥ 64 px em 1920×1080) e, no
// telão renderizado, que nenhum texto com tamanho fica dentro de outro (o em não se multiplica). A
// medida na tela de verdade está nas capturas do Playwright.
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReferenciaCampanha } from "../../../shared/contracts/calculos";
import { renderizarRota, respostaJson } from "../../test/renderizar";
import { MARCA } from "../../tema/marca";
import { faseDoTelao } from "./textos";

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
const regrasDe = (css: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, seletor, corpo]) => ({
    seletores: seletor
      .split(",")
      .map((parte) => parte.trim().replace(/\s+/g, " ")),
    declaracoes: new Map(
      [...corpo.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map(
        ([, propriedade, valor]) => [propriedade, valor.trim()],
      ),
    ),
  }));
type Regras = ReturnType<typeof regrasDe>;

const REGRAS = regrasDe(telaoCss);

/** O valor de uma propriedade para um seletor exato (a última regra que o lista vence, como na cascata). */
function valorDe(
  seletor: string,
  propriedade: string,
  regras: Regras = REGRAS,
): string | undefined {
  return regras
    .filter(
      ({ seletores, declaracoes }) =>
        seletores.includes(seletor) && declaracoes.has(propriedade),
    )
    .at(-1)
    ?.declaracoes.get(propriedade);
}

const emDe = (
  seletor: string,
  propriedade = "font-size",
  regras: Regras = REGRAS,
) => {
  const valor = valorDe(seletor, propriedade, regras);
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

  it("RIFA-061 (D27): a lista única na largura toda; com mais de 5 itens, duas colunas da mesma lista, de cima para baixo", () => {
    // No telão deitado (antes do @media do celular em pé, que empilha tudo numa coluna).
    const deitado = regrasDe(
      telaoCss.slice(0, telaoCss.indexOf("@media (max-aspect-ratio: 1/1)")),
    );
    expect(
      valorDe(".telao__divisoes[data-unica]", "grid-template-columns", deitado),
    ).toBe("minmax(0, 1fr)");
    const duas = '.telao__lista[data-colunas="2"]';
    expect(valorDe(duas, "grid-template-columns", deitado)).toBe(
      "repeat(2, minmax(0, 1fr))",
    );
    expect(valorDe(duas, "grid-auto-flow", deitado)).toBe("column");
    // As linhas de cada coluna pelos itens dela, iguais: 4 (a de 5 é a de sempre). Nada de 3 linhas em duas colunas
    // (a escala de até 3 itens cortaria o nome na meia tela: itensDaEscala dá pelo menos 4; revisão).
    expect(valorDe(comItens(4, duas), "grid-template-rows", deitado)).toBe(
      "repeat(4, minmax(0, 1fr))",
    );
    expect(telaoCss).not.toContain(
      '[data-itens="3"] .telao__lista[data-colunas',
    );
    // Em pé, uma coluna só (a página rola).
    expect(valorDe(duas, "grid-template-columns")).toBe("minmax(0, 1fr)");
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
    // Com a linha justa (1 a 1,05), o overflow: hidden do corte cortaria as pernas do g, p, q, j, y ("Ágape") e o
    // acento de uma maiúscula na 1ª linha: o padding dá esse lugar dentro da caixa, mais embaixo (revisão).
    expect(valorDe(".telao__nome", "overflow")).toBe("hidden");
    const [emCima, embaixo] = (valorDe(".telao__nome", "padding-block") ?? "")
      .split(" ")
      .map((valor) => Number(/^([\d.]+)em$/.exec(valor)?.[1] ?? 0));
    expect(emCima).toBeGreaterThanOrEqual(0.04);
    expect(embaixo).toBeGreaterThanOrEqual(0.1);
    // O chip embaixo de um nome de 2 linhas só cabe com o ícone na altura da letra.
    expect(valorDe(".telao__subiu .ui-icone", "height")).toBe("1em");
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

// ---------------------------------------------------------------------------------------------------
// RIFA-057: o topo em todas as fases (antes do início, durante, encerrada) e no carregando, no vazio e na falha. Cada
// parte fica na coluna dela, nada por cima de nada, e a conta da largura fecha: a marca numa linha, a hora na largura
// reservada e o destaque mais longo de cada fase cabem lado a lado. Tudo em em do texto-base, então a conta é a
// mesma em 1920×1080 e em 1280×720 (e em qualquer telão deitado: a largura da tela, em em, quase não muda).
// ---------------------------------------------------------------------------------------------------

/** As regras do telão deitado: fora dos @media (o celular em pé empilha o topo; movimento e cores forçadas à parte). */
const DEITADO = regrasDe(
  telaoCss.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, ""),
);
const deitado = (seletor: string, propriedade: string) =>
  valorDe(seletor, propriedade, DEITADO);
const emDeitado = (seletor: string, propriedade = "font-size") =>
  emDe(seletor, propriedade, DEITADO);

/**
 * Larguras medidas no Chromium das capturas (RIFA-057), em em da própria fonte. Os destaques e o nome da marca são da
 * Outfit 800, que vem com o site (a mesma largura em toda máquina); a linha da atualização é da fonte do sistema, que
 * muda de máquina para máquina (a do Chromium das capturas está entre as largas). Texto novo no topo: meça de novo.
 */
const LARGURA_MEDIDA: Record<string, number> = {
  "Dia 24 de 24": 5.73,
  "Começa em 120 dias": 9.37,
  "Campanha encerrada": 10.17,
  "Projeto Videira Kids": 7.7,
  "Atualizado às 15:30": 9.17,
};

const DURANTE_NO_TOPO: ReferenciaCampanha = {
  data: "2026-12-16",
  fase: "durante",
  data_inicio: "2026-11-23",
  data_fim: "2026-12-16",
  duracao_dias: 24,
  dia_campanha: 24,
  dias_restantes: 1,
  dias_para_inicio: null,
  periodo: null,
};

/** O destaque mais longo de cada fase, como o telão escreve (textos.ts). */
const DESTAQUE_MAIS_LONGO = {
  durante: faseDoTelao(DURANTE_NO_TOPO).destaque,
  antes: faseDoTelao({
    ...DURANTE_NO_TOPO,
    fase: "antes",
    dia_campanha: null,
    dias_restantes: 24,
    dias_para_inicio: 120,
  }).destaque,
  encerrada: faseDoTelao({
    ...DURANTE_NO_TOPO,
    fase: "encerrada",
    dia_campanha: null,
    dias_restantes: 0,
  }).destaque,
};

const TAMANHO_DO_DESTAQUE = {
  durante: () => emDeitado(".telao__fase-destaque"),
  antes: () =>
    emDeitado('.telao__fase[data-fase="antes"] .telao__fase-destaque'),
  encerrada: () =>
    emDeitado('.telao__fase[data-fase="encerrada"] .telao__fase-destaque'),
};

const marcaCss = semComentarios(lerArquivo("../../components/ui/Marca.css"));

/** A largura da marca no telão: o logo no selo claro, o espaço e o nome numa linha. */
function larguraDaMarca(): number {
  const selo =
    /\[data-tema="telao"\] \.ui-marca__selo\s*\{[^}]*padding:\s*[\d.]+em\s+([\d.]+)em;/.exec(
      marcaCss,
    );
  if (!selo) throw new Error("O selo da marca no telão mudou de forma");
  const logo =
    (emDeitado(".telao .ui-marca", "--marca-altura") * MARCA.logo.largura) /
    MARCA.logo.altura;
  return (
    logo +
    2 * Number(selo[1]) +
    emDeitado(".telao .ui-marca", "gap") +
    LARGURA_MEDIDA[MARCA.produto] * emDeitado(".telao .ui-marca__nome")
  );
}

/** A largura do conteúdo do telão, em em: a tela menos o padding dos lados. */
function larguraDoConteudo(largura: number, altura: number): number {
  const [, lados] = (deitado(".telao", "padding") ?? "").split(" ");
  const padding = Number(/^([\d.]+)em$/.exec(lados ?? "")?.[1]);
  if (!padding) throw new Error("O padding do .telao mudou de forma");
  return largura / textoBase(largura, altura) - 2 * padding;
}

describe("RIFA-057: o topo do telão, em todas as fases", () => {
  it("cada parte na coluna dela: as laterais nunca ficam menores que o conteúdo e o meio encolhe e corta, sem passar para o lado", () => {
    expect(deitado(".telao__topo", "grid-template-columns")).toBe(
      "minmax(max-content, 1fr) auto minmax(max-content, 1fr)",
    );
    // O meio (a fase) pode ficar menor que o destaque, mas aí corta na borda dele, nunca cobre o selo do Kids.
    expect(deitado(".telao__fase", "min-width")).toBe("0");
    expect(deitado(".telao__fase", "overflow-x")).toBe("clip");
    expect(deitado(".telao__fase", "grid-template-columns")).toBe(
      "minmax(0, 1fr)",
    );
    // A marca numa linha só (com a fase longa, ela quebrava em 3).
    expect(deitado(".telao .ui-marca__nome", "white-space")).toBe("nowrap");
    // A hora é uma grade de largura fixa: o selo do Kids e o relógio numa linha, a atualização embaixo, à direita.
    expect(deitado(".telao__hora", "display")).toBe("grid");
    expect(deitado(".telao__hora", "justify-items")).toBe("end");
    expect(deitado(".telao__atualizado", "text-align")).toBe("right");
    expect(emDeitado(".telao__hora", "width")).toBeGreaterThan(0);
  });

  it("nada no topo se posiciona por cima de outra parte (só a faixa do degradê, embaixo, é absoluta)", () => {
    const doTopo =
      /telao__topo|telao__marca|ui-marca|telao__fase|telao__hora|telao__kids|telao__relogio|telao__atualizado/;
    const regras = REGRAS.filter(({ seletores }) =>
      seletores.some((seletor) => doTopo.test(seletor)),
    );
    expect(regras.length).toBeGreaterThan(8);
    for (const { seletores, declaracoes } of regras) {
      const nome = seletores.join(", ");
      if (nome === ".telao__topo::after") {
        expect(declaracoes.get("position")).toBe("absolute");
        expect(declaracoes.get("bottom")).toBe("0");
        continue;
      }
      expect({ nome, position: declaracoes.get("position") ?? "" }).toEqual({
        nome,
        position: expect.not.stringMatching(/absolute|fixed|sticky/),
      });
      for (const [propriedade, valor] of declaracoes) {
        expect({ nome, propriedade }).toEqual({
          nome,
          propriedade: expect.not.stringMatching(
            /^(transform|translate|inset|top|right|bottom|left)$/,
          ),
        });
        if (propriedade.startsWith("margin"))
          expect({ nome, propriedade, valor }).toEqual({
            nome,
            propriedade,
            valor: expect.not.stringMatching(/-/),
          });
      }
    }
  });

  it("os destaques que o telão escreve são os medidos (texto novo no topo: meça de novo)", () => {
    expect(DESTAQUE_MAIS_LONGO).toEqual({
      durante: "Dia 24 de 24",
      antes: "Começa em 120 dias",
      encerrada: "Campanha encerrada",
    });
    expect(MARCA.produto).toBe("Projeto Videira Kids");
  });

  it.each([
    [1920, 1080],
    [1280, 720],
  ])(
    "em %i×%i, a marca, o destaque mais longo de cada fase e a hora cabem lado a lado, com folga",
    (largura, altura) => {
      const conteudo = larguraDoConteudo(largura, altura);
      const espaco = emDeitado(".telao__topo", "gap");
      const hora = emDeitado(".telao__hora", "width");
      const marca = larguraDaMarca();
      // Conferência das medidas: a marca tem ~12,4em (569 px em 1920×1080) e o conteúdo ~38,6em.
      expect(marca).toBeCloseTo(12.4, 1);
      expect(conteudo).toBeCloseTo(38.6, 1);
      // A folga cobre a fonte de reserva (antes de a Outfit chegar) e o arredondamento.
      const FOLGA = 0.4;
      for (const fase of ["durante", "antes", "encerrada"] as const) {
        const destaque =
          TAMANHO_DO_DESTAQUE[fase]() *
          LARGURA_MEDIDA[DESTAQUE_MAIS_LONGO[fase]];
        expect({
          fase,
          cabe: marca + espaco + destaque + espaco + hora + FOLGA <= conteudo,
        }).toEqual({ fase, cabe: true });
      }
      // Durante, "Dia 24 de 24" fica no meio da tela: as duas laterais iguais, cada uma com o conteúdo dela.
      const durante =
        TAMANHO_DO_DESTAQUE.durante() *
        LARGURA_MEDIDA[DESTAQUE_MAIS_LONGO.durante];
      expect(durante + 2 * espaco + 2 * Math.max(marca, hora)).toBeLessThan(
        conteudo,
      );
    },
  );

  it("a hora cabe a linha 'Atualizado às 15:30' e, na linha de cima, o selo do Kids e o relógio (nada anda quando os dados chegam)", () => {
    const hora = emDeitado(".telao__hora", "width");
    expect(
      LARGURA_MEDIDA["Atualizado às 15:30"] * emDeitado(".telao__atualizado"),
    ).toBeLessThan(hora);
    // "15:30" com algarismos de mesma largura (~0,65em cada, em negrito): bem menos que a coluna.
    expect(
      emDeitado(".telao__kids", "width") +
        emDeitado(".telao__hora-linha", "gap") +
        5 * 0.65 * emDeitado(".telao__relogio"),
    ).toBeLessThan(hora);
  });

  it("o destaque continua o herói: 2em durante; antes e depois, menor, mas maior que o relógio", () => {
    expect(TAMANHO_DO_DESTAQUE.durante()).toBe(2);
    for (const fase of ["antes", "encerrada"] as const) {
      expect(TAMANHO_DO_DESTAQUE[fase]()).toBeLessThan(2);
      expect(TAMANHO_DO_DESTAQUE[fase]()).toBeGreaterThan(
        emDeitado(".telao__relogio"),
      );
    }
  });

  it("a altura reservada do topo cabe a fase e a hora com a linha da atualização em duas ('· sem conexão')", () => {
    const linhaDaHora = Math.max(
      emDeitado(".telao__kids", "height"),
      emDeitado(".telao__relogio") *
        Number(deitado(".telao__relogio", "line-height")),
    );
    const duasLinhas =
      2 *
      emDeitado(".telao__atualizado") *
      Number(deitado(".telao__atualizado", "line-height"));
    expect(emDeitado(".telao__fase", "min-height")).toBeGreaterThanOrEqual(
      Number((linhaDaHora + duasLinhas).toFixed(2)),
    );
  });
});
