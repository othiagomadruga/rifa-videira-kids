// RIFA-014: o CSS da aba "Líderes, discipuladores e redes" (acessos-hierarquia.css) vem junto com ela, que é
// carregada à parte, e não pesa no pacote inicial do site; e, como o resto do site, usa só variáveis do tema.
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

describe("CSS da aba da hierarquia em Acessos", () => {
  const quemImporta = (css: string) =>
    Object.entries(FONTES)
      .filter(([, fonte]) => fonte.includes(`import "./${css}";`))
      .map(([arquivo]) => arquivo)
      .sort();

  it("só a aba (carregada à parte) importa acessos-hierarquia.css; a tela carrega a aba com lazy", () => {
    expect(quemImporta("acessos-hierarquia.css")).toEqual([
      "./AcessosHierarquia.tsx",
      "./DialogosHierarquia.tsx",
    ]);
    expect(quemImporta("acessos.css")).toEqual(["./AcessosPage.tsx"]);
    expect(FONTES["./AcessosPage.tsx"]).toMatch(
      /lazy\(\(\) =>\s*import\("\.\/AcessosHierarquia"\)/,
    );
    for (const [arquivo, fonte] of Object.entries(FONTES)) {
      if (arquivo === "./AcessosHierarquia.tsx") continue;
      expect(fonte, arquivo).not.toMatch(/from "\.\/AcessosHierarquia"/);
    }
  });

  it("as classes da aba ficam no CSS dela, e o CSS dela usa só variáveis do tema", () => {
    const daTela = semComentarios(lerArquivo("./acessos.css"));
    const daAba = semComentarios(lerArquivo("./acessos-hierarquia.css"));
    for (const classe of [
      "acessos-hierarquia",
      "acessos-celula",
      "acessos-acoes-linha",
      "acessos-gerados",
      "acessos-pendentes",
    ]) {
      expect(daAba).toContain(`.${classe}`);
      expect(daTela).not.toContain(`.${classe}`);
    }
    expect(daAba).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });
});
