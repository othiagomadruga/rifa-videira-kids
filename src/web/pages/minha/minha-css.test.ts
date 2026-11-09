// CA5 (RIFA-014): o CSS da visão individual cabe em 360 px e é legível ao sol. Aqui, o que dá para provar
// lendo o CSS: só variáveis do tema (nenhuma cor nem medida solta), nenhuma largura fixa (as grades usam
// min(100%, …) e as colunas encolhem) e o contraste dos pares de texto e fundo que a tela usa, calculado a
// partir do tokens.css. A medida na tela de verdade (360 px sem rolagem lateral) está nas capturas do
// Playwright.
import { describe, expect, it } from "vitest";

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
const minhaCss = semComentarios(lerArquivo("./minha.css"));

/** As declarações do minha.css: propriedade e valor. */
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
    ["falha ao sair", "--cor-perigo", "--cor-superficie", 4.5],
  ] as const)("%s: contraste suficiente", (_nome, texto, fundo, minimo) => {
    expect(contraste(cor(texto), cor(fundo))).toBeGreaterThanOrEqual(minimo);
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
