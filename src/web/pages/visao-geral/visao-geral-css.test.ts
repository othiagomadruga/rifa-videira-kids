// RIFA-038: o CSS do cartão "Relatório da campanha" (as regras .visao-relatorio*). Aqui, o que dá para provar
// lendo o CSS (o jsdom não aplica CSS nem faz layout): nenhuma largura fixa (cabe em 390 px), as opções numa
// grade que vira uma coluna no celular, alvos de toque de 44 px, o nome do arquivo quebrando em vez de estourar
// a largura e só variáveis do tema nas cores. A medida na tela de verdade (390 e 1366 px) está nas capturas do
// Playwright; o movimento, no tema/movimento-css.test.ts (todo o CSS do site).
import { describe, expect, it } from "vitest";

// O Vitest esvazia todo import de CSS (até com ?raw): o texto vem do disco, pelo fs do Node.
type ModuloFs = { readFileSync(caminho: string, codificacao: "utf8"): string };
const { process } = globalThis as unknown as {
  process: { getBuiltinModule(nome: "node:fs"): ModuloFs };
};
// O caminho vai numa variável: com um texto fixo, o Vite trocaria o new URL(..., import.meta.url) pela URL do asset.
const ARQUIVO = "./visao-geral.css";
const CSS = process
  .getBuiltinModule("node:fs")
  .readFileSync(
    decodeURIComponent(new URL(ARQUIVO, import.meta.url).pathname),
    "utf8",
  )
  .replace(/\/\*[\s\S]*?\*\//g, "");

type Declaracao = { propriedade: string; valor: string; seletor: string };

/** As declarações das regras do relatório (o seletor é o bloco mais de dentro). */
function declaracoesDoRelatorio(): Declaracao[] {
  const saida: Declaracao[] = [];
  const blocos: string[] = [];
  let trecho = "";
  for (const caractere of CSS) {
    if (caractere === "{") {
      blocos.push(trecho.trim());
      trecho = "";
    } else if (caractere === ";" || caractere === "}") {
      const achado = /^\s*([\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(trecho);
      const seletor = blocos.at(-1) ?? "";
      if (achado && seletor.includes(".visao-relatorio"))
        saida.push({
          propriedade: achado[1],
          valor: achado[2].replace(/\s+/g, " "),
          seletor,
        });
      trecho = "";
      if (caractere === "}") blocos.pop();
    } else {
      trecho += caractere;
    }
  }
  return saida;
}

const DECLARACOES = declaracoesDoRelatorio();

const valor = (seletor: string, propriedade: string) =>
  DECLARACOES.find(
    (d) => d.seletor === seletor && d.propriedade === propriedade,
  )?.valor;

describe("CSS do relatório da campanha (RIFA-038)", () => {
  it("lê as regras do cartão", () => {
    expect(DECLARACOES.length).toBeGreaterThan(20);
  });

  it("nenhuma largura que passe de 390 px: as medidas de largura sem px e até 24rem (390 px)", () => {
    const larguras = DECLARACOES.filter((d) =>
      /^(width|min-width|max-width|flex|flex-basis|grid-template-columns)$/.test(
        d.propriedade,
      ),
    );
    expect(larguras.length).toBeGreaterThan(5);
    for (const { propriedade, valor: texto, seletor } of larguras) {
      const contexto = `${seletor} { ${propriedade}: ${texto} }`;
      expect(texto, contexto).not.toMatch(/\d+px|\d+vw/);
      for (const [, rem] of texto.matchAll(/(\d+(?:\.\d+)?)rem/g))
        expect(Number(rem), contexto).toBeLessThanOrEqual(24);
    }
  });

  it("as opções numa grade que vira uma coluna no celular; flex que encolhe com min-width 0", () => {
    expect(valor(".visao-relatorio__opcoes", "grid-template-columns")).toBe(
      "repeat(auto-fill, minmax(min(100%, 17rem), 1fr))",
    );
    for (const seletor of [
      ".visao-relatorio__corpo",
      ".visao-relatorio__tipos",
      ".visao-relatorio__opcao",
      ".visao-relatorio__opcao-textos",
      ".visao-relatorio__baixado",
    ])
      expect(valor(seletor, "min-width"), seletor).toBe("0");
    expect(valor(".visao-relatorio__acoes", "flex-wrap")).toBe("wrap");
  });

  it("alvos de toque de 44 px nas opções; o nome do arquivo quebra em qualquer ponto", () => {
    expect(valor(".visao-relatorio__opcao", "min-height")).toBe(
      "var(--alvo-toque)",
    );
    expect(valor(".visao-relatorio__arquivo", "overflow-wrap")).toBe(
      "anywhere",
    );
  });

  it("cores só pelas variáveis do tema", () => {
    for (const { propriedade, valor: texto, seletor } of DECLARACOES) {
      if (/color|background|border|shadow/.test(propriedade))
        expect(texto, `${seletor} { ${propriedade} }`).not.toMatch(
          /#[\da-f]{3,8}\b|rgb|hsl/i,
        );
    }
  });
});

describe("RIFA-051 (P3.5 e P3.6): os cartões de cima e a meta de hoje", () => {
  /** O corpo da regra com exatamente este seletor (fora das regras do relatório). */
  const regra = (seletor: string) => {
    const achado = new RegExp(
      `(^|\\})\\s*${seletor.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
    ).exec(CSS);
    if (!achado) throw new Error(`regra ${seletor} não encontrada`);
    return achado[2].replace(/\s+/g, " ");
  };

  it("os cartões de cima com a altura do mais alto da linha (A-05): stretch, não start", () => {
    expect(regra(".visao-cartoes")).toMatch(/align-items: stretch;/);
    expect(regra(".visao-cartoes")).not.toMatch(/align-items: start/);
  });

  it("a meta de hoje usa o Stat sem a moldura dele (o cartão já é a moldura), sem regra própria de número", () => {
    const semMoldura = regra(".visao-cartao__numero > .ui-stat");
    for (const declaracao of [
      "padding: 0;",
      "border: 0;",
      "background: none;",
      "box-shadow: none;",
    ])
      expect(semMoldura).toContain(declaracao);
    expect(CSS).not.toMatch(/\.visao-cartao__destaque|\.visao-cartao__rotulo/);
  });
});
