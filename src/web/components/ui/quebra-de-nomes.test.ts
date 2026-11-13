// Nomes longos (célula, discipulador, rede, pessoa) quebram em vez de alargar a página (revisão da RIFA-014-web,
// feito na RIFA-020): uma palavra única muito longa num Aviso levava a página a 465 px numa tela de 360. Com
// overflow-wrap: anywhere (não break-word), a palavra pode quebrar em qualquer ponto E o tamanho mínimo do
// bloco deixa de ser o da palavra inteira, então itens de grade e de flex encolhem até caber. Aqui, o que dá para
// provar lendo o CSS (o jsdom não faz layout); a medida em 360 px de verdade está nas capturas do Playwright.
import { describe, expect, it } from "vitest";

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
    .replace(/\/\*[\s\S]*?\*\//g, "");

/** O corpo da regra que tem só este seletor (a primeira; não a de um grupo "a, b, c {"). */
function regra(arquivo: string, seletor: string): string {
  const css = lerCss(arquivo);
  const achado = new RegExp(
    `(^|\\})\\s*${seletor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`,
  ).exec(css);
  if (!achado) throw new Error(`${arquivo}: regra ${seletor} não encontrada`);
  return achado[2];
}

// Onde os componentes base mostram nomes (o título e o texto do aviso, o título e o conteúdo do cartão, os
// estados, o indicador, a barra de progresso, o diálogo, o cabeçalho da tela, os campos, a legenda da tabela e
// a do gráfico). O Badge fica de fora de propósito: ele é para status curto ("Em dia", "Aderiu"), não para nome.
const COM_NOMES: [arquivo: string, seletor: string][] = [
  ["./Aviso.css", ".ui-aviso__textos"],
  ["./Card.css", ".ui-card"],
  ["./Card.css", ".ui-card__titulo"],
  ["./Estados.css", ".ui-estado"],
  ["./Stat.css", ".ui-stat"],
  ["./IndicadorSituacao.css", ".ui-situacao__textos"],
  ["./ProgressBar.css", ".ui-progress__rotulo"],
  ["./Dialogo.css", ".ui-dialogo__painel"],
  ["./PageHeader.css", ".ui-page-header__textos"],
  ["./Campos.css", ".ui-campo"],
  ["./DataTable.css", ".ui-data-table__legenda"],
  ["./DataTable.css", ".ui-data-table__tabela td"],
  ["./GraficoLinhas.css", ".ui-grafico__legenda"],
  ["./GraficoLinhas.css", ".ui-grafico__legenda-item"],
  ["./SeletorArquivo.css", ".ui-seletor-arquivo__nome"],
];

describe("nomes longos quebram nos componentes base", () => {
  it.each(COM_NOMES)("%s %s: overflow-wrap: anywhere", (arquivo, seletor) => {
    expect(regra(arquivo, seletor)).toMatch(/overflow-wrap:\s*anywhere;/);
  });

  it("o título do cartão divide a linha com as ações (flex): pode encolher até caber", () => {
    expect(regra("./Card.css", ".ui-card__titulo")).toMatch(/min-width:\s*0;/);
  });

  it("os blocos de texto ao lado de ícone (aviso, indicador) ficam numa coluna que encolhe", () => {
    expect(regra("./Aviso.css", ".ui-aviso")).toMatch(
      /grid-template-columns:\s*auto minmax\(0, 1fr\) auto;/,
    );
    expect(regra("./IndicadorSituacao.css", ".ui-situacao")).toMatch(
      /grid-template-columns:\s*auto minmax\(0, 1fr\);/,
    );
  });

  it("RIFA-049: o rótulo do Stat ao lado do chip do ícone (flex) encolhe e quebra", () => {
    expect(regra("./Stat.css", ".ui-stat__topo")).toMatch(/min-width:\s*0;/);
    const rotulo = regra("./Stat.css", ".ui-stat__topo .ui-stat__rotulo");
    expect(rotulo).toMatch(/min-width:\s*0;/);
    expect(rotulo).toMatch(/overflow-wrap:\s*anywhere;/);
  });

  it("nenhum componente usa break-word (que não deixa o bloco encolher)", () => {
    for (const arquivo of [...new Set(COM_NOMES.map(([arquivo]) => arquivo))])
      expect(lerCss(arquivo), arquivo).not.toMatch(
        /overflow-wrap:\s*break-word|word-wrap:\s*break-word/,
      );
  });
});
