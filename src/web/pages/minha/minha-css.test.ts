// CA5 (RIFA-014): o CSS da visão individual cabe em 360 px e é legível ao sol. Aqui, o que dá para provar
// lendo o CSS: só variáveis do tema (nenhuma cor nem medida solta), nenhuma largura fixa (as grades usam
// min(100%, …) e as colunas encolhem) e o contraste dos pares de texto e fundo que a tela usa, calculado a
// partir do tokens.css. A medida na tela de verdade (360 px sem rolagem lateral) está nas capturas do
// Playwright. E o pacote inicial do site leva só a moldura (minha-moldura.css): o resto (minha.css) vem
// junto com a VisaoIndividual, carregada à parte.
import { describe, expect, it } from "vitest";

/** O código da tela (sem os testes), para conferir quem importa cada CSS. */
const FONTES = import.meta.glob<string>(
  ["./**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}"],
  { query: "?raw", import: "default", eager: true },
);

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
const tokensCss = lerArquivo("../../tema/tokens.css");
const molduraCss = semComentarios(lerArquivo("./minha-moldura.css"));
const visaoCss = semComentarios(lerArquivo("./minha.css"));
/** O link de vendas (RIFA-046), que também vem com a VisaoIndividual. */
const linksCss = semComentarios(lerArquivo("./minha-links.css"));
/** Todo o CSS da tela: a moldura (pacote inicial), o da visão e o do link de vendas (pacote à parte). */
const minhaCss = `${molduraCss}\n${visaoCss}\n${linksCss}`;

/** As declarações dos dois arquivos: propriedade e valor. */
const DECLARACOES = [...minhaCss.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)].map(
  ([, propriedade, valor]) => ({ propriedade, valor: valor.trim() }),
);

function variaveisDoBloco(seletor: string): Map<string, string> {
  const inicio = tokensCss.indexOf(`${seletor} {`);
  if (inicio < 0) throw new Error(`bloco ${seletor} não encontrado`);
  const bloco = tokensCss.slice(inicio, tokensCss.indexOf("}", inicio));
  return new Map(
    [...bloco.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((par) => [
      par[1],
      par[2].trim(),
    ]),
  );
}

const TEMA = variaveisDoBloco(":root");

function cor(variavel: string): string {
  const valor = TEMA.get(variavel);
  if (!valor) throw new Error(`variável ${variavel} não existe`);
  const referencia = /^var\((--[\w-]+)\)$/.exec(valor);
  return referencia ? cor(referencia[1]) : valor;
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
  const [clara, escura] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (clara + 0.05) / (escura + 0.05);
}

describe("CA5: o CSS da visão individual", () => {
  it("usa só variáveis do tema que existem (nenhuma cor solta)", () => {
    const usadas = [...minhaCss.matchAll(/var\((--[\w-]+)\)/g)].map(
      ([, nome]) => nome,
    );
    expect(usadas.length).toBeGreaterThan(30);
    for (const nome of usadas) expect(TEMA.has(nome), nome).toBe(true);
    expect(minhaCss).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  it("nenhuma largura fixa: as grades encolhem até a tela (min(100%, …)) e nada usa px", () => {
    for (const { propriedade, valor } of DECLARACOES) {
      if (/^(min-|max-)?width$/.test(propriedade)) {
        expect(
          /^(100%|var\(--[\w-]+\)|\d+(\.\d+)?ch|0)$/.test(valor),
          `${propriedade}: ${valor}`,
        ).toBe(true);
      }
      if (propriedade === "grid-template-columns") {
        expect(
          /minmax\(min\(100%,|minmax\(0,/.test(valor),
          `${propriedade}: ${valor}`,
        ).toBe(true);
      }
      // Bordas finas em px são a única medida em px aceita.
      if (!/^border/.test(propriedade)) {
        expect(/\d+px/.test(valor), `${propriedade}: ${valor}`).toBe(false);
      }
    }
  });

  it("textos longos (nomes de células, redes e pessoas) quebram em vez de alargar a página", () => {
    for (const seletor of [
      ".minha-vizinhos dd",
      ".minha-primeiros__nome",
      ".minha-grupo__titulo",
      ".minha-links__nome",
      ".minha-links__detalhe",
      ".minha-links__explicacao",
    ]) {
      const inicio = minhaCss.indexOf(`${seletor} {`);
      expect(inicio, seletor).toBeGreaterThanOrEqual(0);
      expect(minhaCss.slice(inicio, minhaCss.indexOf("}", inicio))).toMatch(
        /overflow-wrap:\s*anywhere/,
      );
    }
  });

  // Os pares de texto e fundo da tela (o fundo de cada bloco e o texto que fica sobre ele). Legível ao sol:
  // o texto principal sobre os fundos neutros tem 7:1 ou mais (AAA); os pares com as cores da marca e dos
  // estados, ao menos o AA do projeto (4,5:1), para o tema poder mudar de cor sem quebrar a tela.
  it.each([
    ["texto no cartão", "--cor-texto", "--cor-superficie", 7],
    [
      "texto no fundo da página e das posições",
      "--cor-texto",
      "--cor-fundo",
      7,
    ],
    ["frase sem posição", "--cor-texto", "--cor-superficie-2", 7],
    ["texto suave no cartão", "--cor-texto-suave", "--cor-superficie", 4.5],
    ["texto suave nas posições", "--cor-texto-suave", "--cor-fundo", 4.5],
    ["meta de hoje", "--cor-primaria-forte", "--cor-primaria-suave", 4.5],
    [
      "texto na meta de hoje e no 'você'",
      "--cor-texto",
      "--cor-primaria-suave",
      4.5,
    ],
    ["meta de hoje batida", "--cor-sucesso", "--cor-sucesso-suave", 4.5],
    ["texto na meta batida", "--cor-texto", "--cor-sucesso-suave", 4.5],
    ["falha da atualização", "--cor-alerta", "--cor-alerta-suave", 4.5],
    ["célula sem link de vendas", "--cor-alerta", "--cor-alerta-suave", 4.5],
    [
      "texto suave nos outros links",
      "--cor-texto-suave",
      "--cor-superficie-2",
      4.5,
    ],
    ["falha ao sair", "--cor-perigo", "--cor-superficie", 4.5],
    // RIFA-051: o selo "Meta batida" (amarelo do Kids, texto marinho) e a meta de hoje mais leve (o dia como rótulo
    // suave; coberta, o fundo neutro com o texto escuro).
    ["selo 'Meta batida'", "--cor-sobre-comemoracao", "--cor-comemoracao", 7],
    ["dia da meta de hoje", "--cor-texto-suave", "--cor-primaria-suave", 4.5],
    [
      "dia da meta de hoje coberta",
      "--cor-texto-suave",
      "--cor-superficie-2",
      4.5,
    ],
    ["meta de hoje coberta", "--cor-texto", "--cor-superficie-2", 7],
  ] as const)("%s: contraste suficiente", (_nome, texto, fundo, minimo) => {
    expect(contraste(cor(texto), cor(fundo))).toBeGreaterThanOrEqual(minimo);
  });

  it("o ícone de check da meta de hoje coberta se vê no fundo neutro (3:1)", () => {
    expect(
      contraste(cor("--cor-sucesso"), cor("--cor-superficie-2")),
    ).toBeGreaterThanOrEqual(3);
  });

  it("as bordas que marcam o destaque e o 'você' se veem (3:1)", () => {
    expect(
      contraste(cor("--cor-primaria"), cor("--cor-superficie")),
    ).toBeGreaterThanOrEqual(3);
    expect(
      contraste(cor("--cor-primaria"), cor("--cor-primaria-suave")),
    ).toBeGreaterThanOrEqual(3);
  });
});

/** As declarações da regra com exatamente este seletor (a primeira), como texto. */
function regra(css: string, seletor: string): string {
  const inicio = css.indexOf(`${seletor} {`);
  if (inicio < 0) throw new Error(`regra ${seletor} não encontrada`);
  return css.slice(inicio, css.indexOf("}", inicio));
}

describe("RIFA-051: nada pula e nada vaza", () => {
  it("o topo tem a altura do 'Sair' desde o primeiro quadro (o botão só aparece quando a sessão chega)", () => {
    expect(regra(molduraCss, ".minha-moldura__barra")).toMatch(
      /min-height:\s*var\(--alvo-toque\);/,
    );
  });

  it("a linha do papel na marca reservada só no CSS: a altura do nome e do papel (line-height 1.2), sem texto de mentira", () => {
    expect(regra(molduraCss, ".minha-moldura__topo .ui-marca__textos")).toMatch(
      /min-height:\s*calc\(1\.2em \+ 1\.2 \* var\(--texto-sm\)\);/,
    );
  });

  it("o esqueleto dos cartões de cima usa a mesma grade dos cartões que chegam", () => {
    const colunas = (bloco: string) =>
      /grid-template-columns:\s*([^;]+);/.exec(bloco)?.[1];
    expect(colunas(regra(molduraCss, ".minha-moldura__esqueleto"))).toBe(
      colunas(regra(visaoCss, ".minha-cartoes")),
    );
    expect(
      regra(
        molduraCss,
        ".minha-moldura__esqueleto > .minha-moldura__esqueleto-destaque",
      ),
    ).toMatch(/border:\s*2px solid var\(--cor-primaria\);/);
  });

  it("o esqueleto do destaque no tamanho do que vem também no computador (revisão da RIFA-051)", () => {
    const cabecalho = lerArquivo("./Cabecalho.tsx");
    // O número do esqueleto tem a altura do número grande: o mesmo clamp do font-size (line-height 1).
    const tamanhoDoNumero = /font-size:\s*([^;]+);/.exec(
      regra(visaoCss, ".minha-destaque__numero"),
    )?.[1];
    expect(tamanhoDoNumero).toBeTruthy();
    expect(regra(visaoCss, ".minha-destaque__numero")).toMatch(
      /line-height:\s*1;/,
    );
    expect(cabecalho).toContain(`"${tamanhoDoNumero}"`);
    // A fase, a situação e a projeção: a variável no Cabecalho (com a medida do celular de reserva) e o valor do
    // computador em minha-moldura.css, a partir de 64rem.
    const computador =
      /@media \(min-width: 64rem\)\s*\{\s*\.minha-moldura__esqueleto-destaque\s*\{([^}]*)\}/.exec(
        molduraCss,
      )?.[1] ?? "";
    for (const nome of ["fase", "situacao", "projecao"]) {
      expect(cabecalho).toMatch(
        new RegExp(`altura: "var\\(--minha-esqueleto-${nome}, [\\d.]+rem\\)"`),
      );
      expect(computador).toMatch(
        new RegExp(`--minha-esqueleto-${nome}:\\s*[\\d.]+rem;`),
      );
    }
  });

  it("os dois cartões de cima com a mesma altura no computador, e o destaque recorta as partículas da comemoração", () => {
    expect(regra(visaoCss, ".minha-cartoes")).toMatch(
      /align-items:\s*stretch;/,
    );
    expect(regra(visaoCss, ".minha-destaque__cartao")).toMatch(
      /overflow:\s*clip;/,
    );
  });

  it("o destaque não tem borda própria (é o Card 'destaque') e a meta de hoje não tem a faixa da esquerda (que é do aviso)", () => {
    expect(regra(visaoCss, ".minha-destaque")).not.toMatch(/border/);
    expect(regra(visaoCss, ".minha-destaque__cartao")).not.toMatch(/border/);
    expect(regra(visaoCss, ".minha-hoje")).not.toMatch(/border-left/);
    expect(visaoCss).not.toMatch(/\.minha-hoje[^{]*\{[^}]*border-left/);
  });

  it("o número grande na fonte dos títulos e o selo no amarelo do Kids, com o texto marinho", () => {
    expect(regra(visaoCss, ".minha-destaque__numero")).toMatch(
      /font-family:\s*var\(--fonte-titulo\);/,
    );
    const selo = regra(visaoCss, ".minha-destaque__selo");
    expect(selo).toMatch(/background:\s*var\(--cor-comemoracao\);/);
    expect(selo).toMatch(/color:\s*var\(--cor-sobre-comemoracao\);/);
  });
});

describe("CSS no pacote inicial: só a moldura da visão individual", () => {
  /** Quem importa este CSS (os arquivos da pasta, pelo import de lado a lado). */
  const quemImporta = (css: string) =>
    Object.entries(FONTES)
      .filter(([, fonte]) => fonte.includes(`import "./${css}";`))
      .map(([arquivo]) => arquivo)
      .sort();

  it("a moldura e o cabeçalho (que aparecem enquanto a tela carrega) importam só minha-moldura.css", () => {
    expect(quemImporta("minha-moldura.css")).toEqual([
      "./Cabecalho.tsx",
      "./MinhaLayout.tsx",
    ]);
  });

  it("o resto do CSS (minha.css) vem só com a VisaoIndividual, que é carregada à parte", () => {
    expect(quemImporta("minha.css")).toEqual(["./VisaoIndividual.tsx"]);
    // O do link de vendas, com o cartão dele, que só a VisaoIndividual importa.
    expect(quemImporta("minha-links.css")).toEqual(["./LinksDeVendas.tsx"]);
    for (const [arquivo, fonte] of Object.entries(FONTES))
      if (arquivo !== "./VisaoIndividual.tsx")
        expect(fonte, arquivo).not.toMatch(/from "\.\/LinksDeVendas"/);
    expect(FONTES["./MinhaPage.tsx"]).toMatch(
      /lazy\(\(\) =>\s*import\("\.\/VisaoIndividual"\)/,
    );
    // Nenhum arquivo do pacote inicial importa a VisaoIndividual sem ser pelo lazy.
    for (const [arquivo, fonte] of Object.entries(FONTES)) {
      expect(fonte, arquivo).not.toMatch(/from "\.\/VisaoIndividual"/);
    }
  });

  it("cada arquivo tem só as classes da sua parte", () => {
    const classes = (css: string) =>
      new Set([...css.matchAll(/\.(minha-[\w-]+)/g)].map(([, nome]) => nome));
    for (const nome of classes(molduraCss))
      expect(nome).toMatch(/^minha-(moldura|cabecalho)/);
    for (const nome of classes(visaoCss))
      expect(nome).not.toMatch(/^minha-(moldura|cabecalho|links)/);
    for (const nome of classes(linksCss)) expect(nome).toMatch(/^minha-links/);
  });
});
