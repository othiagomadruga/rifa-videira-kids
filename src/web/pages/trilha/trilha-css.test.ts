// RIFA-024: o CSS da Trilha cabe em 390 px sem rolagem lateral e vem só com a lista, carregada à parte. Aqui, o
// que dá para provar lendo o CSS (o jsdom não faz layout): só variáveis do tema, nenhuma largura fixa, nada que
// impeça a quebra de linha no celular, os textos longos quebrando em qualquer ponto e o mesmo ponto de quebra da
// DataTable (48rem). A medida na tela de verdade (390 px) está nas capturas do Playwright.
import { describe, expect, it } from "vitest";

/** O código da tela (sem os testes), para conferir quem importa o CSS. */
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

const CSS = semComentarios(lerArquivo("./trilha.css"));
const TOKENS = lerArquivo("../../tema/tokens.css");

type Declaracao = { propriedade: string; valor: string; blocos: string[] };

/** As declarações, com os blocos em volta (ex.: "@media (min-width: 48rem)", ".trilha-quando"). */
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
          valor: achado[2],
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
const naTabela = ({ blocos }: Declaracao) =>
  blocos.includes("@media (min-width: 48rem)");

/** O corpo da regra que tem só este seletor. */
function regra(seletor: string): string {
  const inicio = CSS.indexOf(`\n${seletor} {`);
  expect(inicio, seletor).toBeGreaterThanOrEqual(0);
  return CSS.slice(inicio, CSS.indexOf("}", inicio));
}

describe("RIFA-024: sem rolagem lateral em 390 px (CSS da Trilha)", () => {
  it("usa só variáveis do tema que existem (nenhuma cor nem medida solta)", () => {
    const usadas = [...CSS.matchAll(/var\((--[\w-]+)\)/g)].map(([, n]) => n);
    expect(usadas.length).toBeGreaterThan(5);
    for (const nome of usadas) expect(TOKENS, nome).toContain(`${nome}:`);
    expect(CSS).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  it("nenhuma largura fixa nem medida em px (as bordas finas são a exceção)", () => {
    for (const { propriedade, valor } of DECLARACOES) {
      if (/(^|-)width$/.test(propriedade)) {
        expect(
          /^(100%|0|none|var\(--[\w-]+\))$/.test(valor),
          `${propriedade}: ${valor}`,
        ).toBe(true);
      }
      if (!/^border/.test(propriedade)) {
        expect(/\d+px/.test(valor), `${propriedade}: ${valor}`).toBe(false);
      }
      expect(propriedade, `${propriedade}: ${valor}`).not.toMatch(
        /^(flex-basis|grid-template-columns)$/,
      );
    }
  });

  it("no celular, nada deixa de quebrar a linha: white-space: nowrap só na tabela (a partir de 48rem)", () => {
    const semQuebra = DECLARACOES.filter(
      ({ propriedade, valor }) =>
        propriedade === "white-space" && valor !== "normal",
    );
    expect(semQuebra.length).toBeGreaterThan(0);
    for (const declaracao of semQuebra) expect(naTabela(declaracao)).toBe(true);
  });

  it("o mesmo ponto de quebra da DataTable (cartões abaixo de 48rem): nenhum outro @media de largura", () => {
    const medias = [...CSS.matchAll(/@media\s*([^{]+)\{/g)].map(([, m]) =>
      m.trim(),
    );
    for (const media of medias) {
      expect(media).toMatch(
        /^\(min-width: 48rem\)$|^\(prefers-reduced-motion: no-preference\)$/,
      );
    }
    const doDataTable = lerArquivo("../../components/ui/DataTable.css");
    expect(doDataTable).toContain("@media (min-width: 48rem)");
  });

  it("os textos que podem ser longos (resumo, nomes, alvo) quebram em qualquer ponto, e o bloco encolhe", () => {
    const celula = regra(".trilha-celula");
    expect(celula).toMatch(/overflow-wrap:\s*anywhere/);
    expect(celula).toMatch(/min-width:\s*0/);
    expect(regra(".trilha")).toMatch(/min-width:\s*0/);
    // Todo bloco de célula da tabela usa a classe que quebra.
    const fonte = FONTES["./TrilhaDeAuditoria.tsx"];
    expect(fonte).toContain("`trilha-celula ${classe}");
    for (const classe of [
      "trilha-quando",
      "trilha-quem",
      "trilha-acao",
      "trilha-alvo",
      "trilha-texto-longo",
    ]) {
      expect(fonte).toContain(`bloco(registro, "${classe}")`);
    }
  });

  it("o resumo fica abaixo do rótulo no celular (não espremido na metade da largura)", () => {
    const resumo = regra(".trilha td:has(> .trilha-texto-longo)");
    expect(resumo).toMatch(/flex-direction:\s*column/);
    expect(regra(".trilha td:has(> .trilha-texto-longo)::before")).toMatch(
      /max-width:\s*none/,
    );
  });
});

describe("RIFA-024: a Trilha carrega à parte", () => {
  it("só a lista (carregada com lazy) importa trilha.css; ninguém importa a lista direto", () => {
    const quemImporta = Object.entries(FONTES)
      .filter(([, fonte]) => fonte.includes('import "./trilha.css";'))
      .map(([arquivo]) => arquivo);
    expect(quemImporta).toEqual(["./TrilhaDeAuditoria.tsx"]);
    expect(FONTES["./TrilhaPage.tsx"]).toMatch(
      /lazy\(\(\) =>\s*import\("\.\/TrilhaDeAuditoria"\)/,
    );
    for (const [arquivo, fonte] of Object.entries(FONTES)) {
      expect(fonte, arquivo).not.toMatch(/from "\.\/TrilhaDeAuditoria"/);
    }
    const telas = lerArquivo("../coordenacao/telas.ts");
    expect(telas).toContain('from "../trilha/TrilhaPage"');
    expect(telas).not.toContain("TrilhaDeAuditoria");
  });
});
