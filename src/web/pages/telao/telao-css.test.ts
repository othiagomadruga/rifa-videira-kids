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
