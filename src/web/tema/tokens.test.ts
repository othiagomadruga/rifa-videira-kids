// CA1 (RIFA-020): as cores da Videira estão no tema, com o contraste conferido (WCAG 2.x) a partir do próprio
// tokens.css: texto >= 4,5:1 (AA) e bordas e foco >= 3:1 no site; texto >= 7:1 (AAA) no telão. Os estados
// continuam distinguíveis e acessíveis; o degradê forte aguenta texto branco em todos os pontos; o centro dos
// brilhos do fundo ambiente não derruba o contraste do texto.
import { describe, expect, it } from "vitest";

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
const tokensCss = lerArquivo("./tokens.css");

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

const CLARO = variaveisDoBloco(":root");
const TELAO = new Map([...CLARO, ...variaveisDoBloco('[data-tema="telao"]')]);

function cor(tema: Map<string, string>, variavel: string): string {
  const valor = tema.get(variavel);
  if (!valor) throw new Error(`variável ${variavel} não existe`);
  const referencia = /^var\((--[\w-]+)\)$/.exec(valor);
  return referencia ? cor(tema, referencia[1]) : valor;
}

function canais(hex: string): [number, number, number] {
  return [1, 3, 5].map((inicio) =>
    Number.parseInt(hex.slice(inicio, inicio + 2), 16),
  ) as [number, number, number];
}

function luminancia(hex: string): number {
  const [r, g, b] = canais(hex)
    .map((canal) => canal / 255)
    .map((canal) =>
      canal <= 0.04045 ? canal / 12.92 : ((canal + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a: string, b: string): number {
  const [clara, escura] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (clara + 0.05) / (escura + 0.05);
}

/** Os pontos (cor e posição de 0 a 1) de um degradê escrito com var() das cores da marca. */
function pontosDoDegrade(tema: Map<string, string>, variavel: string) {
  const valor = tema.get(variavel) ?? "";
  const pontos = [...valor.matchAll(/var\((--[\w-]+)\)(?:\s+([\d.]+)%)?/g)];
  return pontos.map(([, nome, posicao], indice) => ({
    cor: cor(tema, nome),
    posicao:
      posicao !== undefined
        ? Number(posicao) / 100
        : indice / Math.max(1, pontos.length - 1),
  }));
}

/** A cor do degradê na posição t (o navegador mistura em sRGB). */
function corNoDegrade(
  pontos: { cor: string; posicao: number }[],
  t: number,
): string {
  const depois = pontos.findIndex((ponto) => ponto.posicao >= t);
  if (depois <= 0) return pontos[Math.max(0, depois)].cor;
  const [a, b] = [pontos[depois - 1], pontos[depois]];
  const parte = (t - a.posicao) / (b.posicao - a.posicao);
  const [ca, cb] = [canais(a.cor), canais(b.cor)];
  return `#${ca
    .map((canal, i) =>
      Math.round(canal + (cb[i] - canal) * parte)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

describe("CA1: as cores da Videira no tema", () => {
  it("as cores da marca vêm do logo (amostradas do PNG do PO)", () => {
    expect(cor(CLARO, "--marca-marinho")).toBe("#1b203c");
    expect(cor(CLARO, "--marca-verde-agua")).toBe("#43bab8");
    expect(cor(CLARO, "--marca-azul")).toBe("#5983ba");
    expect(cor(CLARO, "--marca-roxo")).toBe("#5e297c");
    expect(cor(CLARO, "--kids-amarelo")).toBe("#fcd44d");
  });

  it("o texto é o marinho do logo, a ação é o roxo e a comemoração é o amarelo do Kids", () => {
    expect(cor(CLARO, "--cor-texto")).toBe(cor(CLARO, "--marca-marinho"));
    expect(cor(CLARO, "--cor-primaria")).toBe(cor(CLARO, "--marca-roxo"));
    expect(cor(CLARO, "--cor-comemoracao")).toBe(cor(CLARO, "--kids-amarelo"));
    expect(cor(TELAO, "--cor-comemoracao")).toBe(cor(CLARO, "--kids-amarelo"));
  });

  it("o degradê decorativo é o do símbolo: verde-água, azul e roxo, nessa ordem", () => {
    expect(
      pontosDoDegrade(CLARO, "--gradiente-marca").map(({ cor }) => cor),
    ).toEqual(["#43bab8", "#5983ba", "#5e297c"]);
  });

  it.each([
    ["claro", CLARO],
    ["telão", TELAO],
  ] as const)(
    "tema %s: toda cor de papel é um hex de 6 dígitos (os testes das telas leem estes valores)",
    (_nome, tema) => {
      const papeis = [...tema.keys()].filter(
        (nome) =>
          nome.startsWith("--cor-") && nome !== "--cor-brilho-esqueleto",
      );
      expect(papeis.length).toBeGreaterThan(30);
      for (const papel of papeis)
        expect(cor(tema, papel), papel).toMatch(/^#[0-9a-f]{6}$/);
    },
  );
});

// Texto sobre fundo, com o mínimo de cada par.
const TEXTO_CLARO: [string, string, number][] = [
  ["--cor-texto", "--cor-superficie", 7],
  ["--cor-texto", "--cor-fundo", 7],
  ["--cor-texto", "--cor-superficie-2", 7],
  ["--cor-texto-suave", "--cor-superficie", 4.5],
  ["--cor-texto-suave", "--cor-fundo", 4.5],
  ["--cor-texto-suave", "--cor-superficie-2", 4.5],
  ["--cor-texto-suave", "--cor-primaria-suave", 4.5],
  ["--cor-sobre-primaria", "--cor-primaria", 4.5],
  ["--cor-sobre-primaria", "--cor-primaria-forte", 4.5],
  ["--cor-primaria", "--cor-superficie", 4.5],
  ["--cor-primaria", "--cor-fundo", 4.5],
  ["--cor-primaria-forte", "--cor-primaria-suave", 4.5],
  ["--cor-texto", "--cor-primaria-suave", 4.5],
  ["--cor-sobre-comemoracao", "--cor-comemoracao", 4.5],
  ["--cor-texto", "--cor-comemoracao-suave", 4.5],
  ["--cor-neutro", "--cor-neutro-suave", 4.5],
  ["--cor-info", "--cor-info-suave", 4.5],
  ["--cor-info", "--cor-superficie", 4.5],
  ["--cor-sucesso", "--cor-sucesso-suave", 4.5],
  ["--cor-sucesso", "--cor-superficie", 4.5],
  ["--cor-texto", "--cor-sucesso-suave", 4.5],
  ["--cor-alerta", "--cor-alerta-suave", 4.5],
  ["--cor-alerta", "--cor-fundo", 4.5],
  ["--cor-perigo", "--cor-perigo-suave", 4.5],
  ["--cor-perigo", "--cor-superficie", 4.5],
  ["--cor-sobre-primaria", "--cor-perigo-forte", 4.5],
  // RIFA-049: o topo da barra lateral (a marca e "Coordenação") no fundo suave da marca.
  ["--cor-texto", "--cor-lateral-topo", 7],
  ["--cor-texto-suave", "--cor-lateral-topo", 4.5],
];

const BORDAS_CLARO: [string, string][] = [
  ["--cor-borda-forte", "--cor-superficie"],
  ["--cor-borda-forte", "--cor-fundo"],
  ["--cor-foco", "--cor-superficie"],
  ["--cor-foco", "--cor-fundo"],
  ["--cor-primaria", "--cor-superficie"],
  ["--cor-primaria", "--cor-primaria-suave"],
];

// RIFA-049: os ícones nos chips (Stat, estados, IndicadorSituacao, Aviso, troféu da barra): cor do ícone sobre o
// fundo do chip, 3:1 ou mais (objeto gráfico; o texto ao lado diz o que é).
const ICONES_CLARO: [string, string][] = [
  ["--cor-neutro", "--cor-neutro-suave"],
  ["--cor-primaria", "--cor-primaria-suave"],
  ["--cor-sucesso", "--cor-sucesso-suave"],
  ["--cor-alerta", "--cor-alerta-suave"],
  ["--cor-sucesso-suave", "--cor-sucesso"],
  ["--cor-alerta-suave", "--cor-alerta"],
  ["--cor-perigo-suave", "--cor-perigo"],
  ["--cor-neutro-suave", "--cor-neutro"],
  ["--cor-sobre-primaria", "--cor-info"],
  ["--cor-sobre-primaria", "--cor-sucesso"],
  ["--cor-sobre-primaria", "--cor-alerta"],
  ["--cor-sobre-primaria", "--cor-perigo"],
  ["--cor-sobre-comemoracao", "--cor-comemoracao"],
  ["--cor-primaria", "--cor-superficie"],
];

describe("CA1: tema claro (site): texto AA e bordas e foco com 3:1", () => {
  it.each(ICONES_CLARO)(
    "ícone %s sobre o chip %s: 3:1 ou mais",
    (icone, fundo) => {
      expect(
        contraste(cor(CLARO, icone), cor(CLARO, fundo)),
      ).toBeGreaterThanOrEqual(3);
    },
  );

  it.each(TEXTO_CLARO)("%s sobre %s: %d:1 ou mais", (texto, fundo, minimo) => {
    expect(
      contraste(cor(CLARO, texto), cor(CLARO, fundo)),
    ).toBeGreaterThanOrEqual(minimo);
  });

  it.each(BORDAS_CLARO)("%s sobre %s: 3:1 ou mais", (borda, fundo) => {
    expect(
      contraste(cor(CLARO, borda), cor(CLARO, fundo)),
    ).toBeGreaterThanOrEqual(3);
  });

  it("o degradê forte aguenta texto branco em todos os pontos (4,5:1) e se vê sobre o trilho da barra (3:1)", () => {
    const pontos = pontosDoDegrade(CLARO, "--gradiente-marca-forte");
    expect(pontos).toHaveLength(3);
    for (let passo = 0; passo <= 20; passo++) {
      const corNoPonto = corNoDegrade(pontos, passo / 20);
      expect(
        contraste(cor(CLARO, "--cor-sobre-primaria"), corNoPonto),
        corNoPonto,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contraste(corNoPonto, cor(CLARO, "--cor-trilho")),
        corNoPonto,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  // O estado nunca depende só da cor (ícone e texto dizem), mas as cores também se distinguem.
  it("os estados (sucesso, alerta, perigo, info) continuam distinguíveis entre si", () => {
    const estados = [
      "--cor-sucesso",
      "--cor-alerta",
      "--cor-perigo",
      "--cor-info",
    ].map((nome) => canais(cor(CLARO, nome)));
    for (const [i, a] of estados.entries())
      for (const b of estados.slice(i + 1)) {
        const distancia = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        expect(distancia).toBeGreaterThan(50);
      }
  });

  it.each(["--cor-ambiente-1", "--cor-ambiente-2", "--cor-ambiente-3"])(
    "no centro do brilho %s do fundo ambiente, o texto continua AA",
    (brilho) => {
      const fundo = cor(CLARO, brilho);
      expect(
        contraste(cor(CLARO, "--cor-texto"), fundo),
      ).toBeGreaterThanOrEqual(7);
      for (const texto of [
        "--cor-texto-suave",
        "--cor-primaria",
        "--cor-alerta",
      ])
        expect(
          contraste(cor(CLARO, texto), fundo),
          texto,
        ).toBeGreaterThanOrEqual(4.5);
    },
  );
});

describe("CA1: telão (lido a 8 m): texto AAA, 7:1 ou mais", () => {
  const TEXTOS = [
    "--cor-texto",
    "--cor-texto-suave",
    "--cor-primaria",
    "--cor-sucesso",
    "--cor-alerta",
    "--cor-perigo",
    "--cor-info",
  ];
  const FUNDOS = [
    "--cor-fundo",
    "--cor-superficie",
    "--cor-ambiente-1",
    "--cor-ambiente-2",
    "--cor-ambiente-3",
  ];

  it.each(TEXTOS.flatMap((texto) => FUNDOS.map((fundo) => [texto, fundo])))(
    "%s sobre %s",
    (texto, fundo) => {
      expect(
        contraste(cor(TELAO, texto), cor(TELAO, fundo)),
      ).toBeGreaterThanOrEqual(7);
    },
  );

  it.each([
    ["--cor-sobre-primaria", "--cor-primaria"],
    ["--cor-sobre-comemoracao", "--cor-comemoracao"],
    ["--cor-texto", "--cor-superficie-2"],
  ])("%s sobre %s (posições e pílulas)", (texto, fundo) => {
    expect(
      contraste(cor(TELAO, texto), cor(TELAO, fundo)),
    ).toBeGreaterThanOrEqual(7);
  });

  it("bordas do pódio e do 1º lugar se veem na superfície (3:1)", () => {
    for (const borda of [
      "--cor-primaria",
      "--cor-comemoracao",
      "--cor-borda-forte",
    ])
      expect(
        contraste(cor(TELAO, borda), cor(TELAO, "--cor-superficie")),
        borda,
      ).toBeGreaterThanOrEqual(3);
  });

  it("o selo da marca é claro (o logo da Videira é marinho e foi feito para fundo branco)", () => {
    expect(
      contraste(cor(CLARO, "--marca-marinho"), cor(TELAO, "--cor-selo-marca")),
    ).toBeGreaterThanOrEqual(7);
  });
});
