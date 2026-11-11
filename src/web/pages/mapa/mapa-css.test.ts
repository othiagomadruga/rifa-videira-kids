// RIFA-015: o CSS do Mapa. Aqui, o que dá para provar lendo o CSS (o jsdom não aplica CSS nem faz layout): a escala
// de cor (um tom só, do claro ao escuro, com o texto de cada faixa legível), a grade de 7 colunas cabendo em 390 px
// com quadrados tocáveis, nenhuma largura fixa, só variáveis do tema, o mesmo ponto de quebra da DataTable e o
// pacote à parte. A medida na tela de verdade (390 e 1366 px) está nas capturas do Playwright.
import { describe, expect, it } from "vitest";

/** O código da tela (sem os testes), para conferir quem importa o CSS e o contrato. */
const FONTES = import.meta.glob<string>(
  ["./**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}"],
  { query: "?raw", import: "default", eager: true },
);

// O Vitest esvazia todo import de CSS (até com ?raw): o texto vem do disco, pelo fs do Node.
type ModuloFs = { readFileSync(caminho: string, codificacao: "utf8"): string };
const { process } = globalThis as unknown as {
  process: { getBuiltinModule(nome: "node:fs"): ModuloFs };
};
// O caminho vai numa variável: com um texto fixo, o Vite trocaria o new URL(..., import.meta.url) pela URL do asset.
const lerArquivo = (relativo: string) =>
  process
    .getBuiltinModule("node:fs")
    .readFileSync(
      decodeURIComponent(new URL(relativo, import.meta.url).pathname),
      "utf8",
    );
const semComentarios = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const CSS = semComentarios(lerArquivo("./mapa.css"));
const TOKENS = semComentarios(lerArquivo("../../tema/tokens.css"));
/** Só o tema claro (o bloco :root): o Mapa não aparece no telão. */
const TOKENS_CLARO = TOKENS.slice(0, TOKENS.indexOf("[data-tema="));

type Declaracao = { propriedade: string; valor: string; blocos: string[] };

/** As declarações, com os blocos em volta (ex.: "@media (min-width: 48rem)", ".mapa-uf"). */
function declaracoes(css: string): Declaracao[] {
  const saida: Declaracao[] = [];
  const blocos: string[] = [];
  let trecho = "";
  for (const caractere of css) {
    if (caractere === "{") {
      blocos.push(trecho.trim());
      trecho = "";
    } else if (caractere === ";" || caractere === "}") {
      const achado = /^\s*([\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(trecho);
      if (achado && blocos.length > 0)
        saida.push({
          propriedade: achado[1],
          valor: achado[2].replace(/\s+/g, " "),
          blocos: [...blocos],
        });
      trecho = "";
      if (caractere === "}") blocos.pop();
    } else {
      trecho += caractere;
    }
  }
  return saida;
}

const DECLARACOES = declaracoes(CSS);

/** O valor de uma propriedade na regra que tem só este seletor (fora de @media). */
function valor(seletor: string, propriedade: string): string | undefined {
  return DECLARACOES.find(
    (d) =>
      d.blocos.length === 1 &&
      d.blocos[0] === seletor &&
      d.propriedade === propriedade,
  )?.valor;
}

/** O valor de uma variável do tema claro, seguindo var(--outra). */
function token(nome: string): string {
  const achado = new RegExp(`${nome}:\\s*([^;]+);`).exec(TOKENS_CLARO);
  if (!achado) throw new Error(`variável ${nome} não está no tema`);
  const bruto = achado[1].trim();
  const referencia = /^var\((--[\w-]+)\)$/.exec(bruto);
  return referencia ? token(referencia[1]) : bruto;
}

const emPx = (rem: string) => {
  const achado = /^([\d.]+)rem$/.exec(rem);
  if (!achado) throw new Error(`medida inesperada: ${rem}`);
  return Number(achado[1]) * 16;
};
const medida = (expressao: string) =>
  emPx(
    /^var\((--[\w-]+)\)$/.test(expressao)
      ? token(expressao.slice(4, -1))
      : expressao,
  );

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => {
  const achado = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!achado) throw new Error(`cor inesperada: ${hex}`);
  const n = parseInt(achado[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
/** color-mix(in srgb, A p%, B): a média dos canais (gama sRGB), como o navegador faz. */
const misturar = (a: Rgb, p: number, b: Rgb): Rgb =>
  a.map((canal, i) => canal * p + b[i] * (1 - p)) as Rgb;
const luminancia = ([r, g, b]: Rgb) => {
  const linear = (canal: number) => {
    const c = canal / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
};
const contraste = (a: Rgb, b: Rgb) => {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (escuro + 0.05);
};

/** A cor de cada faixa (1 a 5), calculada das definições --mapa-faixa-N do mapa.css. */
function corDaFaixa(faixa: number): Rgb {
  const definicao = valor(".mapa-tela", `--mapa-faixa-${faixa}`);
  expect(definicao, `--mapa-faixa-${faixa}`).toBeDefined();
  const mistura =
    /^color-mix\( ?in srgb, var\((--[\w-]+)\) (\d+)%, var\((--[\w-]+)\) ?\)$/.exec(
      definicao ?? "",
    );
  if (mistura)
    return misturar(
      rgb(token(mistura[1])),
      Number(mistura[2]) / 100,
      rgb(token(mistura[3])),
    );
  const direta = /^var\((--[\w-]+)\)$/.exec(definicao ?? "");
  if (!direta) throw new Error(`faixa ${faixa}: ${definicao}`);
  return rgb(token(direta[1]));
}

/** A cor e a tinta (texto) que a regra [data-faixa="N"] dá ao quadrado. */
function papeisDaFaixa(faixa: number) {
  const seletor = `.mapa-tela [data-faixa="${faixa}"]`;
  return {
    cor: valor(seletor, "--mapa-cor"),
    tinta: valor(seletor, "--mapa-tinta"),
  };
}

describe("RIFA-015: a escala de cor do mapa", () => {
  it("um tom só (o roxo da Videira) sobre a superfície, do claro ao escuro, e cada faixa ligada à sua cor", () => {
    for (let faixa = 1; faixa <= 4; faixa++)
      expect(valor(".mapa-tela", `--mapa-faixa-${faixa}`)).toMatch(
        /^color-mix\( ?in srgb, var\(--marca-roxo\) \d+%, var\(--cor-superficie\) ?\)$/,
      );
    expect(valor(".mapa-tela", "--mapa-faixa-5")).toBe("var(--marca-roxo)");
    const luminancias = [1, 2, 3, 4, 5].map((f) => luminancia(corDaFaixa(f)));
    for (let i = 1; i < luminancias.length; i++)
      expect(luminancias[i], `faixa ${i + 1}`).toBeLessThan(luminancias[i - 1]);
    // Faixas vizinhas se distinguem (não só a 1 e a 5).
    for (let faixa = 1; faixa < 5; faixa++)
      expect(
        contraste(corDaFaixa(faixa), corDaFaixa(faixa + 1)),
        `faixas ${faixa} e ${faixa + 1}`,
      ).toBeGreaterThanOrEqual(1.3);
    for (let faixa = 1; faixa <= 5; faixa++)
      expect(papeisDaFaixa(faixa).cor).toBe(`var(--mapa-faixa-${faixa})`);
    expect(papeisDaFaixa(0).cor).toBe("var(--cor-superficie)");
  });

  it("o texto de cada faixa tem contraste AA (4,5:1): marinho nas claras, branco nas escuras", () => {
    for (let faixa = 1; faixa <= 5; faixa++) {
      const { tinta } = papeisDaFaixa(faixa);
      const nomeTinta = /^var\((--[\w-]+)\)$/.exec(tinta ?? "")?.[1] ?? "";
      expect(
        contraste(corDaFaixa(faixa), rgb(token(nomeTinta))),
        `faixa ${faixa} com ${nomeTinta}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(papeisDaFaixa(3).tinta).toBe("var(--cor-texto)");
    expect(papeisDaFaixa(4).tinta).toBe("var(--cor-sobre-primaria)");
  });

  it("sem venda: a superfície com borda tracejada (3:1) e texto suave (4,5:1); a faixa 1 se distingue dela", () => {
    const superficie = rgb(token("--cor-superficie"));
    expect(papeisDaFaixa(0).tinta).toBe("var(--cor-texto-suave)");
    expect(
      contraste(superficie, rgb(token("--cor-texto-suave"))),
    ).toBeGreaterThanOrEqual(4.5);
    expect(valor('.mapa-uf[data-faixa="0"]', "border")).toBe(
      "1px dashed var(--cor-borda-forte)",
    );
    expect(
      contraste(superficie, rgb(token("--cor-borda-forte"))),
    ).toBeGreaterThanOrEqual(3);
    expect(contraste(superficie, corDaFaixa(1))).toBeGreaterThanOrEqual(1.15);
    // A legenda usa as mesmas cores e o mesmo tracejado.
    expect(valor(".mapa-legenda__amostra", "background")).toBe(
      "var(--mapa-cor)",
    );
    expect(valor('.mapa-legenda__amostra[data-faixa="0"]', "border")).toBe(
      "1px dashed var(--cor-borda-forte)",
    );
    expect(valor(".mapa-uf", "background")).toBe("var(--mapa-cor)");
    expect(valor(".mapa-uf", "color")).toBe("var(--mapa-tinta)");
  });
});

describe("RIFA-015: a grade cabe em 390 px, com quadrados tocáveis", () => {
  it("7 colunas iguais; cada data-linha e data-coluna vai para a sua linha e coluna", () => {
    expect(valor(".mapa-grade", "grid-template-columns")).toBe(
      "repeat(7, minmax(0, 1fr))",
    );
    for (let linha = 0; linha < 8; linha++)
      expect(valor(`.mapa-grade [data-linha="${linha}"]`, "grid-row")).toBe(
        String(linha + 1),
      );
    for (let coluna = 0; coluna < 7; coluna++)
      expect(
        valor(`.mapa-grade [data-coluna="${coluna}"]`, "grid-column"),
      ).toBe(String(coluna + 1));
    // O quadro fica no canto livre da grade (grade.ts: nenhuma UF nas linhas 5 a 8 das colunas 1 a 3).
    expect(valor(".mapa-quadro", "grid-row")).toBe("5 / span 4");
    expect(valor(".mapa-quadro", "grid-column")).toBe("1 / span 3");
    expect(valor(".mapa-quadro", "contain")).toBe("size");
    expect(valor(".mapa-uf", "aspect-ratio")).toBe("1");
  });

  it("em 390 px, cada quadrado fica com pelo menos 44 px (o alvo de toque do tema)", () => {
    const margem = medida(token("--margem-pagina"));
    const padding = medida(valor(".mapa-brasil", "padding") ?? "");
    const borda = Number(
      /^(\d+)px/.exec(valor(".mapa-brasil", "border") ?? "")?.[1],
    );
    const espaco = medida(valor(".mapa-grade", "gap") ?? "");
    const largura = 390 - 2 * margem - 2 * padding - 2 * borda;
    const quadrado = (largura - 6 * espaco) / 7;
    expect(quadrado).toBeGreaterThanOrEqual(medida(token("--alvo-toque")));
  });

  it("usa só variáveis do tema que existem (e as próprias --mapa-*), nenhuma cor solta", () => {
    const usadas = [...CSS.matchAll(/var\((--[\w-]+)/g)].map(([, n]) => n);
    expect(usadas.length).toBeGreaterThan(20);
    for (const nome of usadas) {
      if (nome.startsWith("--mapa-"))
        expect(CSS, nome).toMatch(new RegExp(`${nome}:`));
      else expect(TOKENS, nome).toContain(`${nome}:`);
    }
    expect(CSS).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  it("nenhuma largura fixa (só percentuais, variáveis, a amostra de 1rem da legenda e tetos de max-width) nem medida em px fora das bordas", () => {
    for (const { propriedade, valor: v, blocos } of DECLARACOES) {
      const onde = `${blocos.join(" > ")} { ${propriedade}: ${v} }`;
      // max-width pode ter rem (um teto não alarga a página); largura e altura, não.
      if (/^(min-)?(width|height)$/.test(propriedade))
        expect(/^(\d+%|0|none|auto|var\(--[\w-]+\)|1rem)$/.test(v), onde).toBe(
          true,
        );
      if (/^max-(width|height)$/.test(propriedade))
        expect(/^(\d+%|none|var\(--[\w-]+\)|[\d.]+rem)$/.test(v), onde).toBe(
          true,
        );
      if (!/^border/.test(propriedade))
        expect(/\d+px/.test(v), onde).toBe(false);
      if (propriedade === "grid-template-columns")
        expect(
          [
            "repeat(7, minmax(0, 1fr))",
            "repeat(auto-fit, minmax(min(100%, 9rem), 1fr))",
          ],
          onde,
        ).toContain(v);
      // flex com base em rem só se puder encolher (flex: 1 1 ... ou 0 1 ...).
      if (propriedade === "flex" && /rem/.test(v))
        expect(v, onde).toMatch(/^[01] 1 [\d.]+rem$/);
    }
  });

  it("no celular, nada deixa de quebrar a linha: white-space só na tabela (a partir de 48rem)", () => {
    const semQuebra = DECLARACOES.filter(
      (d) => d.propriedade === "white-space" && d.valor !== "normal",
    );
    expect(semQuebra.length).toBeGreaterThan(0);
    for (const d of semQuebra)
      expect(d.blocos).toContain("@media (min-width: 48rem)");
  });

  it("o mesmo ponto de quebra da DataTable (48rem) e o movimento só sem a preferência por menos movimento", () => {
    const medias = [...CSS.matchAll(/@media\s*([^{]+)\{/g)].map(([, m]) =>
      m.trim(),
    );
    expect(medias).toEqual([
      "(min-width: 48rem)",
      "(prefers-reduced-motion: no-preference)",
    ]);
    const animacao = DECLARACOES.find((d) => d.propriedade === "animation");
    expect(animacao?.blocos).toEqual([
      "@media (prefers-reduced-motion: no-preference)",
      ".mapa-uf",
    ]);
    // A cascata do norte para o sul: o atraso vem da linha da grade.
    expect(
      DECLARACOES.find((d) => d.propriedade === "animation-delay")?.valor,
    ).toBe("calc(var(--mapa-linha, 0) * 35ms)");
  });

  it("os textos que podem ser longos (nomes de estado, valores) quebram em qualquer ponto, e o bloco encolhe", () => {
    expect(valor(".mapa-celula", "overflow-wrap")).toBe("anywhere");
    expect(valor(".mapa-celula", "min-width")).toBe("0");
    expect(valor(".mapa-quadro", "overflow-wrap")).toBe("anywhere");
    expect(valor(".mapa-tela", "min-width")).toBe("0");
    expect(valor(".mapa-grade", "min-width")).toBe("0");
    // Todo bloco de célula das tabelas usa a classe que quebra.
    const tabelaDdd = FONTES["./TabelaDdd.tsx"];
    expect(tabelaDdd).toMatch(/className=\{`mapa-celula/);
    const mapa = FONTES["./MapaDoBrasil.tsx"];
    const colunas = mapa.match(/chave: "/g)?.length ?? 0;
    expect(colunas).toBe(5);
    expect(mapa.match(/className="mapa-celula\b/g)?.length).toBe(colunas);
  });
});

describe("RIFA-015: o Mapa carrega à parte e o contrato entra só por tipos", () => {
  it("só o MapaDeVendas (carregado com lazy) importa o CSS; ninguém importa o MapaDeVendas direto", () => {
    const quemImporta = Object.entries(FONTES)
      .filter(([, fonte]) => fonte.includes('import "./mapa.css";'))
      .map(([arquivo]) => arquivo);
    expect(quemImporta).toEqual(["./MapaDeVendas.tsx"]);
    expect(FONTES["./MapaPage.tsx"]).toMatch(
      /lazy\(\(\) =>\s*import\("\.\/MapaDeVendas"\)/,
    );
    for (const [arquivo, fonte] of Object.entries(FONTES))
      expect(fonte, arquivo).not.toMatch(/from "\.\/MapaDeVendas"/);
    const telas = lerArquivo("../coordenacao/telas.ts");
    expect(telas).toContain('from "../mapa/MapaPage"');
    expect(telas).not.toContain("MapaDeVendas");
  });

  it("o contrato entra só por tipos, menos os módulos sem zod (ddd.ts e calculos.ts)", () => {
    const codigo = Object.entries(FONTES).filter(
      ([arquivo]) => arquivo !== "./teste-apoio.ts",
    );
    expect(codigo.length).toBeGreaterThan(5);
    for (const [arquivo, fonte] of codigo) {
      for (const [importacao] of fonte.matchAll(
        /import[^;]*from "[./]*shared\/contracts[^"]*";/g,
      )) {
        if (/^import type /.test(importacao)) continue;
        expect(importacao, arquivo).toMatch(
          /from "\.\.\/\.\.\/\.\.\/shared\/contracts\/(ddd|calculos)";$/,
        );
      }
    }
  });
});
