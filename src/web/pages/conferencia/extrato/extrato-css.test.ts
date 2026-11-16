// RIFA-059: o CSS da seção do extrato cabe em 390 px sem rolagem lateral e vem só com ela (no pacote à parte). Aqui, o
// que dá para provar lendo o CSS (o jsdom não faz layout): só variáveis do tema, nenhuma largura fixa, os textos
// longos (a descrição do banco, os números dos pedidos) quebrando em qualquer ponto e só o componente da seção
// importando o CSS. A medida na tela de verdade (390 e 1366 px) está nas capturas do Playwright.
import { describe, expect, it } from "vitest";

/** O código da pasta da Conferência (sem os testes), para conferir quem importa o CSS. */
const FONTES = import.meta.glob<string>(
  ["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}", "!../**/teste-apoio.ts"],
  { query: "?raw", import: "default", eager: true },
);

// O Vitest esvazia todo import de CSS (até com ?raw): o texto vem do disco, pelo fs do Node.
type ModuloFs = { readFileSync(caminho: string, codificacao: "utf8"): string };
const { process } = globalThis as unknown as {
  process: { getBuiltinModule(nome: "node:fs"): ModuloFs };
};
// O caminho vai numa variável: com um texto fixo, o Vite trocaria o new URL(..., import.meta.url) pela URL do asset.
const arquivo = "./extrato.css";
const CSS = process
  .getBuiltinModule("node:fs")
  .readFileSync(
    decodeURIComponent(new URL(arquivo, import.meta.url).pathname),
    "utf8",
  )
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** O corpo da regra com exatamente este seletor (a primeira). */
function regra(seletor: string): string {
  const achado = new RegExp(
    `(?:^|\\})\\s*${seletor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
  ).exec(CSS);
  if (!achado) throw new Error(`regra ${seletor} não encontrada`);
  return achado[1];
}

describe("extrato.css", () => {
  it("cores, espaços e tamanhos só pelas variáveis do tema; nenhuma largura fixa", () => {
    expect(CSS).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
    // Só o min-width: 0 (deixa o bloco encolher na grade e no flex).
    expect(CSS).not.toMatch(
      /(?:^|[\s;{])(?:(?:width|max-width|flex-basis)\s*:|min-width\s*:(?!\s*0;))/,
    );
    // Só a borda fina (1px), como no resto da Conferência.
    expect(CSS).not.toMatch(/\b(?!1px)\d+px\b/);
    expect(CSS).not.toMatch(/white-space\s*:\s*nowrap/);
  });

  it("a descrição do banco, os números dos pedidos e os ambíguos quebram em qualquer ponto", () => {
    for (const seletor of [
      ".extrato-pix",
      ".extrato-codigo",
      ".extrato-codigos",
      ".extrato-suave",
      ".extrato-ambiguo",
      ".extrato-candidato",
    ])
      expect(regra(seletor), seletor).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("as duas colunas só a partir de 48rem (o ponto de quebra da DataTable)", () => {
    expect(CSS).toMatch(
      /@media \(min-width: 48rem\)\s*\{\s*\.extrato-opcoes,\s*\.extrato-campos\s*\{/,
    );
  });

  it("só o componente da seção importa o CSS (vem no pacote à parte, nunca no inicial)", () => {
    const quem = Object.entries(FONTES)
      .filter(
        ([, codigo]) =>
          codigo.includes('"./extrato.css"') ||
          codigo.includes("extrato/extrato.css"),
      )
      .map(([caminho]) => caminho);
    expect(quem).toEqual(["./ExtratoDoBanco.tsx"]);
    expect(FONTES["../ConferenciaPage.tsx"]).toMatch(
      /lazy\(\(\) =>\s*import\("\.\/extrato\/ExtratoDoBanco"\)/,
    );
  });
});
