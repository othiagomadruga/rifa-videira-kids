// RIFA-014: o CSS da aba "Líderes, discipuladores e redes" (acessos-hierarquia.css) vem junto com ela, que é
// carregada à parte, e não pesa no pacote inicial do site; e, como o resto do site, usa só variáveis do tema.
// RIFA-039: o mesmo para a aba "Webhook da Rifei" (acessos-webhook.css), que também cabe em 390 px (o que dá para
// provar lendo o CSS; a medida na tela de verdade está nas capturas).
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

describe("CSS da aba do webhook em Acessos (RIFA-039)", () => {
  const css = semComentarios(lerArquivo("./acessos-webhook.css"));
  const tokens = lerArquivo("../../tema/tokens.css");

  it("só a aba (carregada à parte) importa acessos-webhook.css; a tela carrega a aba com lazy", () => {
    const quemImporta = Object.entries(FONTES)
      .filter(([, fonte]) => fonte.includes('import "./acessos-webhook.css";'))
      .map(([arquivo]) => arquivo);
    // RIFA-070 (D32): a aba Conexão com a Rifei, também carregada à parte, usa o mesmo CSS.
    expect(quemImporta).toEqual(["./ConexaoRifei.tsx", "./WebhookRifei.tsx"]);
    expect(FONTES["./AcessosPage.tsx"]).toMatch(
      /lazy\(\(\) =>\s*import\("\.\/ConexaoRifei"\)/,
    );
    expect(FONTES["./AcessosPage.tsx"]).toMatch(
      /lazy\(\(\) =>\s*import\("\.\/WebhookRifei"\)/,
    );
    for (const [arquivo, fonte] of Object.entries(FONTES)) {
      if (arquivo === "./WebhookRifei.tsx") continue;
      expect(fonte, arquivo).not.toMatch(/from "\.\/WebhookRifei"/);
    }
  });

  it("usa só variáveis do tema que existem, nenhuma largura fixa nem medida em px (só as bordas finas)", () => {
    const usadas = [...css.matchAll(/var\((--[\w-]+)\)/g)].map(([, n]) => n);
    expect(usadas.length).toBeGreaterThan(5);
    for (const nome of usadas) expect(tokens, nome).toContain(`${nome}:`);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    for (const [, propriedade, valor] of css.matchAll(
      /([\w-]+)\s*:\s*([^;{}]+);/g,
    )) {
      if (/(^|-)width$/.test(propriedade))
        expect(
          /^(0|100%|var\(--[\w-]+\))$/.test(valor.trim()),
          `${propriedade}: ${valor}`,
        ).toBe(true);
      if (!/^border/.test(propriedade))
        expect(/\d+px/.test(valor), `${propriedade}: ${valor}`).toBe(false);
      expect(`${propriedade}: ${valor}`).not.toMatch(/white-space:\s*nowrap/);
    }
  });

  it("em 390 px nada estica a página: os blocos encolhem e a URL e o token quebram em qualquer ponto", () => {
    for (const classe of [
      ".acessos-webhook {",
      ".acessos-webhook__corpo,",
      ".acessos-webhook__campo {",
    ]) {
      const inicio = css.indexOf(`\n${classe}`);
      expect(inicio, classe).toBeGreaterThanOrEqual(0);
      expect(css.slice(inicio, css.indexOf("}", inicio))).toMatch(
        /min-width:\s*0/,
      );
    }
    const daTela = semComentarios(lerArquivo("./acessos.css"));
    const url = daTela.slice(daTela.indexOf(".acessos-url {"));
    expect(url.slice(0, url.indexOf("}"))).toMatch(/word-break:\s*break-all/);
    expect(FONTES["./WebhookRifei.tsx"]).toContain('className="acessos-url"');
    // Movimento, se houver um dia, só com no-preference (tema/movimento-css.test.ts confere o site todo).
    expect(css).not.toMatch(/animation|transition/);
  });
});
