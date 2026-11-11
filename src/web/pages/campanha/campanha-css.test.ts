// CA8 (D20): o CSS da tela Campanha (com o resumo das regras, as chaves e as mensagens) cabe em 390 px sem rolagem
// lateral. Aqui, o que dá para provar lendo o CSS (o jsdom não faz layout): só variáveis do tema que existem,
// nenhuma largura fixa nem medida em px (fora as bordas finas), nada que impeça a quebra de linha e os textos
// longos (o link da pré-visualização) quebrando em qualquer ponto. A medida na tela de verdade está nas capturas.
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

const CSS = lerArquivo("./campanha.css").replace(/\/\*[\s\S]*?\*\//g, "");
const TOKENS = lerArquivo("../../tema/tokens.css");

/** As declarações "propriedade: valor" do arquivo. */
const declaracoes = [...CSS.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)].map(
  ([, propriedade, valor]) => ({ propriedade, valor: valor.trim() }),
);

describe("CA8: o CSS da Campanha em 390 px", () => {
  it("usa só variáveis do tema que existem (nenhuma cor solta)", () => {
    const usadas = [...CSS.matchAll(/var\((--[\w-]+)\)/g)].map(([, n]) => n);
    expect(usadas.length).toBeGreaterThan(10);
    for (const nome of usadas) expect(TOKENS, nome).toContain(`${nome}:`);
    expect(CSS).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  it("nenhuma largura fixa nem medida em px (as bordas são a exceção), e nada de nowrap", () => {
    for (const { propriedade, valor } of declaracoes) {
      if (/(^|-)width$/.test(propriedade))
        expect(valor, `${propriedade}: ${valor}`).toMatch(
          /^(100%|0|none|var\(--[\w-]+\)|1(\.\d+)?r?em)$/,
        );
      if (!/^border/.test(propriedade))
        expect(/\d+px/.test(valor), `${propriedade}: ${valor}`).toBe(false);
      if (propriedade === "white-space")
        expect(valor, propriedade).not.toBe("nowrap");
    }
  });

  it("a pré-visualização mantém as quebras do modelo e quebra o link em qualquer ponto", () => {
    const regra = /\.campanha-previa__texto\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? "";
    expect(regra).toMatch(/white-space:\s*pre-wrap/);
    expect(regra).toMatch(/overflow-wrap:\s*anywhere/);
    const valor = /\.campanha-regra__valor\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? "";
    expect(valor).toMatch(/overflow-wrap:\s*anywhere/);
  });
});
