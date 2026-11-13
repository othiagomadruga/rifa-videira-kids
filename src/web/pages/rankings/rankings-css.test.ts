// RIFA-051 (achado da revisão da RIFA-049): no cartão do ranking da coordenação (celular), o selo do troféu da
// ProgressBar na meta batida ficava espremido entre a pílula do % (acima) e o selo da situação (abaixo), com 3 a 4 px
// de folga. Aqui, o que dá para provar lendo o CSS (o jsdom não faz layout): o selo sai do trilho metade da diferença
// das alturas, e o vão acima (o da barra) e o de baixo (o da grade do cartão mais o respiro) deixam pelo menos 6 px.
// A medida na tela de verdade está na captura admin-rankings-390.
import { describe, expect, it } from "vitest";

// O Vitest esvazia todo import de CSS (até com ?raw): o texto vem do disco, pelo fs do Node.
type ModuloFs = { readFileSync(caminho: string, codificacao: "utf8"): string };
const { process } = globalThis as unknown as {
  process: { getBuiltinModule(nome: "node:fs"): ModuloFs };
};
// O caminho vai numa variável: com um texto fixo, o Vite trocaria o new URL(..., import.meta.url) pela URL do asset.
const lerCss = (relativo: string) =>
  process
    .getBuiltinModule("node:fs")
    .readFileSync(
      decodeURIComponent(new URL(relativo, import.meta.url).pathname),
      "utf8",
    )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ");

const RANKINGS = lerCss("./rankings.css");
const BARRA = lerCss("../../components/ui/ProgressBar.css");
const TOKENS = lerCss("../../tema/tokens.css");
const [CELULAR, TABELA] = RANKINGS.split("@media (min-width: 48rem)");

/** O corpo da primeira regra com exatamente este seletor no trecho. */
function regra(css: string, seletor: string): string {
  const achado = new RegExp(
    `(^|\\})\\s*${seletor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`,
  ).exec(css);
  if (!achado) throw new Error(`regra ${seletor} não encontrada`);
  return achado[2];
}

const REM = 16;
/** Um token de espaço em px (ex.: --espaco-3 → 12). */
function espaco(nome: string): number {
  const achado = new RegExp(`${nome}:\\s*([\\d.]+)rem;`).exec(TOKENS);
  if (!achado) throw new Error(`token ${nome} não encontrado`);
  return Number(achado[1]) * REM;
}
/** Uma medida em em de uma declaração da ProgressBar (ex.: height: 0.75em). */
function emDaBarra(seletor: string, propriedade: string): number {
  const achado = new RegExp(`${propriedade}:\\s*([\\d.]+)em;`).exec(
    regra(BARRA, seletor),
  );
  if (!achado) throw new Error(`${seletor} sem ${propriedade} em em`);
  return Number(achado[1]);
}
const tokenDe = (corpo: string, propriedade: string) =>
  new RegExp(`${propriedade}:\\s*var\\((--[\\w-]+)\\);`).exec(corpo)?.[1];

describe("o selo do troféu no cartão do ranking (celular) tem folga da pílula e do selo da situação", () => {
  // No cartão, o texto da barra é o do corpo: 16 px.
  const fonte = 16;
  const sobra =
    ((emDaBarra(".ui-progress__trofeu", "height") -
      emDaBarra(".ui-progress__trilho", "height")) *
      fonte) /
    2;

  it("o selo sai ~5 px para cima e para baixo do trilho (a medida da ProgressBar, que esta tela não muda)", () => {
    expect(sobra).toBeCloseTo(5, 0);
  });

  it("acima: o vão entre a pílula do % e o trilho deixa pelo menos 6 px depois do selo", () => {
    const vao = tokenDe(
      regra(CELULAR, ".rankings-linha__percentual .ui-progress"),
      "gap",
    );
    expect(vao).toBeDefined();
    expect(espaco(vao ?? "")).toBeGreaterThanOrEqual(6 + sobra);
  });

  it("abaixo: o vão da grade do cartão e o respiro da barra deixam pelo menos 6 px antes do selo da situação", () => {
    const vaoDaGrade = /gap:\s*var\((--[\w-]+)\)/.exec(
      regra(CELULAR, ".rankings-linha"),
    )?.[1];
    const respiro = tokenDe(
      regra(CELULAR, ".rankings-linha__percentual"),
      "padding-bottom",
    );
    expect(vaoDaGrade).toBeDefined();
    expect(respiro).toBeDefined();
    expect(
      espaco(vaoDaGrade ?? "") + espaco(respiro ?? ""),
    ).toBeGreaterThanOrEqual(6 + sobra);
  });

  it("na tabela (a partir de 48rem), o vão da barra volta ao da ProgressBar e a célula tem o recuo das outras", () => {
    expect(
      tokenDe(regra(TABELA, ".rankings-linha__percentual .ui-progress"), "gap"),
    ).toBe(tokenDe(regra(BARRA, ".ui-progress"), "gap"));
    // O recuo da célula vem do `.rankings-linha > *` da tabela, que vem depois do respiro do celular.
    expect(regra(TABELA, ".rankings-linha > *")).toMatch(
      /padding:\s*var\(--espaco-3\) var\(--espaco-4\);/,
    );
  });
});
