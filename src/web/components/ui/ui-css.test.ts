// RIFA-040: o CSS dos componentes base que o jsdom não confere (ele não faz layout). A barra lateral do computador
// (AppShell) em tela baixa: com o menu do admin, em 1366×768 e 1280×720, ela é mais alta que a janela; o topo
// encolhia e "Coordenação" ficava por cima de "Visão geral". E a caixa com rolagem da DataTable segura o que é
// absoluto numa célula (o texto escondido dos botões), para a página não rolar na horizontal. A medida na tela de
// verdade está nas capturas do Playwright.
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
const semComentarios = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

type Declaracao = { propriedade: string; valor: string; blocos: string[] };

/** As declarações, com os blocos em volta (ex.: "@media (min-width: 64rem)", ".ui-app-shell__topo"). */
function declaracoes(css: string): Declaracao[] {
  const saida: Declaracao[] = [];
  const blocos: string[] = [];
  let trecho = "";
  for (const caractere of semComentarios(css)) {
    if (caractere === "{") {
      blocos.push(trecho.trim().replace(/\s+/g, " "));
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

/** As declarações de uma regra (o seletor exato, entre os da lista) dentro de um @media, como propriedade → valor. */
function regra(
  css: string,
  media: string,
  seletor: string,
): Record<string, string> {
  const achadas = declaracoes(css).filter(
    ({ blocos }) =>
      blocos.length === 2 &&
      blocos[0] === media &&
      blocos[1].split(/\s*,\s*/).includes(seletor),
  );
  expect(achadas.length, `${media} ${seletor}`).toBeGreaterThan(0);
  return Object.fromEntries(
    achadas.map(({ propriedade, valor }) => [propriedade, valor]),
  );
}

/** Encolhe na coluna flex? (`flex-shrink` ou o 2º número do atalho `flex`; o padrão do CSS é 1.) */
function encolhe(declarado: Record<string, string>): boolean {
  if (declarado["flex-shrink"] !== undefined)
    return Number(declarado["flex-shrink"]) > 0;
  const flex = declarado.flex?.trim();
  if (flex === "none") return false;
  const numeros = flex?.split(/\s+/).filter((parte) => /^\d/.test(parte));
  return numeros && numeros.length >= 2 ? Number(numeros[1]) > 0 : true;
}

const COMPUTADOR = "@media (min-width: 64rem)";

describe("AppShell: a barra lateral do computador em tela baixa (1366×768, 1280×720)", () => {
  const css = lerArquivo("./AppShell.css");

  it("é uma coluna da altura da janela que rola por inteiro quando não cabe", () => {
    const lateral = regra(css, COMPUTADOR, ".ui-app-shell__lateral");
    expect(lateral).toMatchObject({
      display: "flex",
      "flex-direction": "column",
      height: "100dvh",
      "overflow-y": "auto",
    });
    // A mesma regra vale com o menu aberto (o estado do celular não pode desfazê-la no computador).
    expect(
      regra(
        css,
        COMPUTADOR,
        ".ui-app-shell[data-menu-aberto] .ui-app-shell__lateral",
      ),
    ).toEqual(lateral);
  });

  it("o topo (a marca com 'Coordenação') nunca encolhe: o que sobra rola, sem nada por cima dos itens do menu", () => {
    const topo = regra(css, COMPUTADOR, ".ui-app-shell__topo");
    // Com min-height: 0, só o flex-shrink: 0 segura a altura do conteúdo (o min-height: auto não vale mais).
    expect(topo["min-height"]).toBe("0");
    expect(encolhe(topo)).toBe(false);
  });

  it("o painel (o menu e a conta) também não encolhe: a barra rola em vez de espremer os itens", () => {
    const painel = regra(css, COMPUTADOR, ".ui-app-shell__painel");
    expect(painel.flex).toBe("1 0 auto");
    expect(encolhe(painel)).toBe(false);
  });

  it("o leitor de 'encolhe' entende os jeitos de escrever (a regra acima não passa por acaso)", () => {
    expect(encolhe({})).toBe(true);
    expect(encolhe({ "flex-shrink": "0" })).toBe(false);
    expect(encolhe({ "flex-shrink": "1" })).toBe(true);
    expect(encolhe({ flex: "none" })).toBe(false);
    expect(encolhe({ flex: "1 0 auto" })).toBe(false);
    expect(encolhe({ flex: "1 1 auto" })).toBe(true);
    expect(encolhe({ flex: "1" })).toBe(true);
  });
});

describe("DataTable: a caixa com rolagem segura o que é absoluto numa célula", () => {
  it("a partir de 48rem, a caixa rola na horizontal e é o bloco de referência (position: relative)", () => {
    const caixa = regra(
      lerArquivo("./DataTable.css"),
      "@media (min-width: 48rem)",
      ".ui-data-table",
    );
    expect(caixa).toMatchObject({
      "overflow-x": "auto",
      position: "relative",
    });
    // O texto escondido dos botões (base.css) é absoluto: sem a caixa como referência, ele saía dela e a página
    // inteira rolava na horizontal quando a tabela era mais larga que a caixa.
    expect(semComentarios(lerArquivo("../../tema/base.css"))).toMatch(
      /\.visualmente-oculto\s*\{[^}]*position:\s*absolute/,
    );
  });
});

describe("Button: o indisponível não reage ao mouse (RIFA-045)", () => {
  // Os seletores com :hover ou :active do Button.css (cada um da lista separada por vírgulas, sem repetir).
  const seletores = [
    ...new Set(
      declaracoes(lerArquivo("./Button.css")).flatMap(({ blocos }) =>
        blocos
          .at(-1)!
          .split(/\s*,\s*/)
          .filter((seletor) => /:(hover|active)/.test(seletor)),
      ),
    ),
  ];

  /** O seletor pula o desabilitado de verdade e o indisponível com aria-disabled (que continua focável). */
  const pulaOIndisponivel = (seletor: string) =>
    seletor.includes(":not(:disabled)") &&
    seletor.includes(':not([aria-disabled="true"])');

  it('com aria-disabled="true" (ex.: "Baixando…", "Carregar mais" carregando), nem o passar do mouse nem o pressionar mudam o botão', () => {
    // Os quatro :hover das variantes, o subir 1 px no mouse e o afundar ao pressionar.
    expect(seletores.length).toBeGreaterThanOrEqual(6);
    expect(seletores.filter((seletor) => !pulaOIndisponivel(seletor))).toEqual(
      [],
    );
    // Sem pointer-events: none, o mouse continua chegando ao botão e a dica dele aparece (Dica.test.tsx, CA1).
    expect(
      declaracoes(lerArquivo("./Button.css")).filter(
        ({ propriedade }) => propriedade === "pointer-events",
      ),
    ).toEqual([]);
  });

  it("o leitor de seletores não passa por acaso (um :hover sem a exceção é pego)", () => {
    expect(pulaOIndisponivel(".ui-button--primario:hover:not(:disabled)")).toBe(
      false,
    );
    expect(
      pulaOIndisponivel(
        '.ui-button--primario:hover:not(:disabled):not([aria-disabled="true"])',
      ),
    ).toBe(true);
  });
});
