// CA4 e CA5 (RIFA-020): as regras de movimento valem em TODO o CSS do site (lido do disco: o Vitest esvazia os
// imports de CSS). Com prefers-reduced-motion: reduce, nada se mexe porque toda animação e toda transição de
// movimento ficam em @media (prefers-reduced-motion: no-preference); os keyframes só mexem em transform e
// opacity (nada de layout shift); durações curtas (até 450 ms), menos o fundo ambiente, o brilho do esqueleto e o
// girar do carregando; nada pisca mais de 3 vezes por segundo (WCAG 2.3.1). No JS, só lib/movimento.ts anima.
import { describe, expect, it } from "vitest";

type ModuloFs = {
  readFileSync(caminho: string, codificacao: "utf8"): string;
  readdirSync(caminho: string, opcoes: { recursive: true }): string[];
};
const { process } = globalThis as unknown as {
  process: { getBuiltinModule(nome: "node:fs"): ModuloFs };
};
const fs = process.getBuiltinModule("node:fs");
// O caminho vai numa variável: com um texto fixo, o Vite trocaria o new URL(..., import.meta.url) pela URL do asset.
const caminho = (relativo: string) =>
  decodeURIComponent(new URL(relativo, import.meta.url).pathname);
const PASTA_WEB = caminho("../");

const semComentarios = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Todos os CSS do site: caminho relativo a src/web e o texto sem comentários. */
const CSS = fs
  .readdirSync(PASTA_WEB, { recursive: true })
  .filter((arquivo) => arquivo.endsWith(".css"))
  .map((arquivo) => ({
    arquivo,
    css: semComentarios(fs.readFileSync(`${PASTA_WEB}${arquivo}`, "utf8")),
  }));

type Declaracao = {
  arquivo: string;
  propriedade: string;
  valor: string;
  /** Os cabeçalhos dos blocos em volta, de fora para dentro (ex.: "@media (...)", ".ui-button"). */
  blocos: string[];
};

/** As declarações de um CSS, com os blocos em que estão (um leitor simples: o CSS do site não tem strings com chaves). */
function declaracoes(arquivo: string, css: string): Declaracao[] {
  const saida: Declaracao[] = [];
  const blocos: string[] = [];
  let trecho = "";
  for (const caractere of css) {
    if (caractere === "{") {
      blocos.push(trecho.trim());
      trecho = "";
    } else if (caractere === ";" || caractere === "}") {
      const declaracao = /^\s*([\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(trecho);
      if (declaracao && blocos.length > 0)
        saida.push({
          arquivo,
          propriedade: declaracao[1],
          valor: declaracao[2],
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

const TODAS = CSS.flatMap(({ arquivo, css }) => declaracoes(arquivo, css));

const SEM_PREFERENCIA = /@media[^{]*prefers-reduced-motion:\s*no-preference/;
const dentroDoMovimentoLiberado = ({ blocos }: Declaracao) =>
  blocos.some((bloco) => SEM_PREFERENCIA.test(bloco));
const emKeyframes = ({ blocos }: Declaracao) =>
  blocos.some((bloco) => bloco.startsWith("@keyframes"));

// Durações do tema (tokens.css), para resolver var(--duracao-*) e var(--transicao).
const tokens = semComentarios(
  fs.readFileSync(`${PASTA_WEB}tema/tokens.css`, "utf8"),
);
function resolverTempo(valor: string): string {
  return valor.replace(/var\((--[\w-]+)\)/g, (texto, nome: string) => {
    const definicao = new RegExp(`${nome}:\\s*([^;]+);`).exec(tokens);
    return definicao ? resolverTempo(definicao[1].trim()) : texto;
  });
}

/** "450ms" → 450, "1.6s" → 1600. */
function emMs(tempo: string): number {
  const achado = /^([\d.]+)(ms|s)$/.exec(tempo);
  if (!achado) throw new Error(`tempo inválido: ${tempo}`);
  return Number(achado[1]) * (achado[2] === "s" ? 1000 : 1);
}

type Animacao = {
  nome: string;
  duracaoMs: number;
  repeticoes: number;
  declaracao: Declaracao;
};

/** As animações de uma declaração `animation` (a lista separada por vírgulas). */
function animacoes(declaracao: Declaracao): Animacao[] {
  return resolverTempo(declaracao.valor)
    .split(/,(?![^(]*\))/)
    .map((uma) => {
      const partes = uma.trim().split(/\s+(?![^(]*\))/);
      const tempos = partes.filter((parte) => /^[\d.]+(ms|s)$/.test(parte));
      const repeticao = partes.find((parte) =>
        /^(infinite|\d+(\.\d+)?)$/.test(parte),
      );
      const nome = partes.find((parte) => /^ui-[\w-]+$/.test(parte)) ?? "";
      return {
        nome,
        duracaoMs: emMs(tempos[0] ?? "0ms"),
        repeticoes:
          repeticao === "infinite"
            ? Number.POSITIVE_INFINITY
            : Number(repeticao ?? 1),
        declaracao,
      };
    });
}

const ANIMACOES = TODAS.filter(
  (d) =>
    (d.propriedade === "animation" || d.propriedade === "animation-name") &&
    d.valor !== "none",
);

/** Só estas podem ser contínuas: o fundo ambiente, o brilho do esqueleto e o girar do carregando. */
const CONTINUAS = new Set([
  "ui-deriva-a",
  "ui-deriva-b",
  "ui-brilho",
  "ui-girar",
]);

const onde = (d: Declaracao) =>
  `${d.arquivo}: ${d.blocos.join(" > ")} { ${d.propriedade}: ${d.valor} }`;

describe("CA4: com prefers-reduced-motion: reduce, nada se mexe (todo o CSS do site)", () => {
  it("lê os CSS do site, inclusive os do movimento", () => {
    const arquivos = CSS.map(({ arquivo }) => arquivo);
    expect(arquivos).toEqual(
      expect.arrayContaining([
        "tema/movimento.css",
        "components/ui/PublicShell.css",
        "pages/ranking-publico/ranking-publico.css",
        "pages/telao/telao.css",
      ]),
    );
    expect(ANIMACOES.length).toBeGreaterThan(10);
  });

  it("toda animação fica em @media (prefers-reduced-motion: no-preference)", () => {
    for (const declaracao of ANIMACOES)
      expect(dentroDoMovimentoLiberado(declaracao), onde(declaracao)).toBe(
        true,
      );
  });

  it("fora dele, as transições só mudam cor e sombra (nada se desloca nem muda de tamanho)", () => {
    const movimento =
      /\b(all|transform|translate|scale|rotate|width|height|top|right|bottom|left|inset|margin|padding)\b/;
    const transicoes = TODAS.filter(
      (d) =>
        (d.propriedade === "transition" ||
          d.propriedade === "transition-property") &&
        !dentroDoMovimentoLiberado(d),
    );
    expect(transicoes.length).toBeGreaterThan(0);
    for (const declaracao of transicoes)
      expect(movimento.test(declaracao.valor), onde(declaracao)).toBe(false);
  });

  it("a rede de segurança do base.css continua: com reduce, durações zeradas em tudo", () => {
    const base = CSS.find(({ arquivo }) => arquivo === "tema/base.css")?.css;
    expect(base).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*animation-duration: 0\.01ms !important;[^}]*transition-duration: 0\.01ms !important;/,
    );
  });
});

describe("CA5: só transform e opacity, curto e sem piscar", () => {
  it("os keyframes só mexem em transform e opacity (nada de layout shift)", () => {
    const nosKeyframes = TODAS.filter(emKeyframes);
    expect(nosKeyframes.length).toBeGreaterThan(10);
    for (const declaracao of nosKeyframes)
      expect(["transform", "opacity"], onde(declaracao)).toContain(
        declaracao.propriedade,
      );
  });

  it("as animações que acabam duram até 450 ms; as contínuas são só as do fundo, do esqueleto e do carregando", () => {
    const todas = ANIMACOES.filter(
      (d) => d.propriedade === "animation",
    ).flatMap(animacoes);
    expect(todas.length).toBeGreaterThan(10);
    for (const animacao of todas) {
      const contexto = onde(animacao.declaracao);
      if (Number.isFinite(animacao.repeticoes))
        expect(animacao.duracaoMs, contexto).toBeLessThanOrEqual(450);
      else expect(CONTINUAS.has(animacao.nome), contexto).toBe(true);
    }
  });

  it("nada repete mais de 3 vezes por segundo (WCAG 2.3.1)", () => {
    const repetidas = ANIMACOES.filter((d) => d.propriedade === "animation")
      .flatMap(animacoes)
      .filter((animacao) => animacao.repeticoes > 1);
    expect(repetidas.length).toBeGreaterThan(0);
    for (const animacao of repetidas)
      expect(
        1000 / animacao.duracaoMs,
        onde(animacao.declaracao),
      ).toBeLessThanOrEqual(3);
  });

  // B1 da revisão: animação de CSS recomeça quando o React move o nó (troca de lugar no ranking). O pulso de
  // item que muda de lugar é pelo usePulsoDaMeta; o ui-pulsar de CSS fica só na ProgressBar.
  it("o pulso de CSS (ui-pulsar) só fica na ProgressBar", () => {
    const comPulso = ANIMACOES.filter((d) =>
      animacoes(d).some((animacao) => animacao.nome === "ui-pulsar"),
    );
    expect(comPulso.length).toBeGreaterThan(0);
    for (const declaracao of comPulso)
      expect(declaracao.arquivo, onde(declaracao)).toBe(
        "components/ui/ProgressBar.css",
      );
  });

  // A largura da barra de progresso é a exceção (docs/frontend.md): a barra fica num trilho de tamanho fixo e
  // com overflow hidden, então mudar a largura dela não empurra nada (e o scaleX achataria as pontas redondas).
  it("dentro dele, as transições animam só transform, opacity, cores e sombra (exceção: a largura da barra de progresso)", () => {
    const permitidas = new Set([
      "transform",
      "opacity",
      "color",
      "background-color",
      "border-color",
      "outline-color",
      "box-shadow",
    ]);
    const transicoes = TODAS.filter(
      (d) =>
        (d.propriedade === "transition" ||
          d.propriedade === "transition-property") &&
        dentroDoMovimentoLiberado(d),
    );
    expect(transicoes.length).toBeGreaterThan(2);
    const animadas = transicoes.flatMap((declaracao) =>
      declaracao.valor.split(/,(?![^(]*\))/).map((parte) => ({
        declaracao,
        propriedade: parte.trim().split(/\s+/)[0],
      })),
    );
    for (const { declaracao, propriedade } of animadas) {
      const excecao =
        propriedade === "width" &&
        declaracao.blocos.at(-1) === ".ui-progress__barra";
      expect(
        permitidas.has(propriedade) || excecao,
        `${onde(declaracao)} (${propriedade})`,
      ).toBe(true);
    }
    // A exceção existe mesmo (se a barra mudar para scaleX, tire-a daqui).
    expect(
      animadas.some(
        ({ declaracao, propriedade }) =>
          propriedade === "width" &&
          declaracao.blocos.at(-1) === ".ui-progress__barra",
      ),
    ).toBe(true);
  });

  it("as transições de movimento duram até 450 ms", () => {
    const transicoes = TODAS.filter(
      (d) => d.propriedade === "transition" && dentroDoMovimentoLiberado(d),
    );
    expect(transicoes.length).toBeGreaterThan(0);
    for (const declaracao of transicoes)
      for (const tempo of resolverTempo(declaracao.valor).match(
        /[\d.]+m?s\b/g,
      ) ?? [])
        expect(emMs(tempo), onde(declaracao)).toBeLessThanOrEqual(450);
  });
});

describe("CA4: no JS, só lib/movimento.ts anima", () => {
  const FONTES = import.meta.glob<string>(
    ["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}", "!../test/**"],
    { query: "?raw", import: "default", eager: true },
  );

  it("element.animate e startViewTransition só passam por lib/movimento.ts (que respeita o reduce)", () => {
    expect(Object.keys(FONTES).length).toBeGreaterThan(50);
    for (const [arquivo, fonte] of Object.entries(FONTES)) {
      if (arquivo === "../lib/movimento.ts") continue;
      expect(fonte, arquivo).not.toMatch(/\.animate\(|startViewTransition/);
    }
  });
});
