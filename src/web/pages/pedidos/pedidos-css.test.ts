// RIFA-025, CA5: o CSS da tela Pedidos e do alerta cabe em 390 px sem rolagem lateral, e cada um vem com quem o usa
// (as abas, num pacote à parte; o alerta, no pacote inicial). Aqui, o que dá para provar lendo o CSS (o jsdom não
// faz layout): só variáveis do tema, nenhuma largura fixa, nada que impeça a quebra de linha no celular, os textos
// longos quebrando em qualquer ponto e o mesmo ponto de quebra da DataTable (48rem). A medida na tela de verdade
// (390 px, sem rolagem lateral) está nas capturas do Playwright.
import { describe, expect, it } from "vitest";

/** O código da tela (sem os testes), para conferir quem importa o CSS. */
const FONTES = import.meta.glob<string>(
  ["./**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}", "!./teste-apoio.ts"],
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

const ARQUIVOS = ["./pedidos.css", "./alerta-webhook.css"] as const;
const CSS = Object.fromEntries(
  ARQUIVOS.map((arquivo) => [arquivo, semComentarios(lerArquivo(arquivo))]),
) as Record<(typeof ARQUIVOS)[number], string>;
const TOKENS = lerArquivo("../../tema/tokens.css");

type Declaracao = { propriedade: string; valor: string; blocos: string[] };

/** As declarações, com os blocos em volta (ex.: "@media (min-width: 48rem)", ".pedidos-quando"). */
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

const naTabela = ({ blocos }: Declaracao) =>
  blocos.includes("@media (min-width: 48rem)");

/** O corpo da regra que tem só este seletor. */
function regra(css: string, seletor: string): string {
  const inicio = css.indexOf(`\n${seletor} {`);
  expect(inicio, seletor).toBeGreaterThanOrEqual(0);
  return css.slice(inicio, css.indexOf("}", inicio));
}

describe.each(ARQUIVOS)(
  "CA5: sem rolagem lateral em 390 px (%s)",
  (arquivo) => {
    const css = CSS[arquivo];
    const todas = declaracoes(css);

    it("usa só variáveis do tema que existem (nenhuma cor nem medida solta)", () => {
      const usadas = [...css.matchAll(/var\((--[\w-]+)\)/g)].map(([, n]) => n);
      expect(usadas.length).toBeGreaterThan(3);
      // As variáveis locais (--total-cor, --detalhe-cor) são definidas no próprio arquivo.
      for (const nome of usadas)
        expect(`${TOKENS}\n${css}`, nome).toContain(`${nome}:`);
      expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    });

    // Larguras: só relativas, variáveis do tema ou um ícone de até 2em (o "!" do selo).
    it("nenhuma largura fixa nem medida em px (as bordas finas são a exceção); colunas de grade sempre com min(100%, ...)", () => {
      for (const { propriedade, valor } of todas) {
        if (/(^|-)width$/.test(propriedade)) {
          expect(
            /^(100%|0|none|\d+%|var\(--[\w-]+\)|1(\.\d+)?r?em)$/.test(valor),
            `${propriedade}: ${valor}`,
          ).toBe(true);
        }
        if (!/^border/.test(propriedade)) {
          expect(/\d+px/.test(valor), `${propriedade}: ${valor}`).toBe(false);
        }
        if (propriedade === "grid-template-columns") {
          expect(valor, valor).toMatch(/min\(100%,/);
        }
      }
    });

    it("no celular, nada deixa de quebrar a linha: white-space: nowrap só na tabela (a partir de 48rem)", () => {
      for (const declaracao of todas.filter(
        ({ propriedade, valor }) =>
          propriedade === "white-space" && valor !== "normal",
      ))
        expect(naTabela(declaracao)).toBe(true);
    });

    it("o mesmo ponto de quebra da DataTable (cartões abaixo de 48rem): nenhum outro @media de largura", () => {
      for (const [, media] of css.matchAll(/@media\s*([^{]+)\{/g)) {
        expect(media.trim()).toMatch(
          /^\(min-width: 48rem\)$|^\(prefers-reduced-motion: no-preference\)$/,
        );
      }
    });
  },
);

describe("CA5: textos longos (id do pedido, célula, slug, erro e avisos) quebram em qualquer ponto", () => {
  const css = CSS["./pedidos.css"];

  it("o bloco de cada célula quebra e encolhe; a largura percentual só existe na tabela", () => {
    const celula = regra(css, ".pedidos-celula");
    expect(celula).toMatch(/overflow-wrap:\s*anywhere/);
    expect(celula).toMatch(/min-width:\s*0/);
    expect(regra(css, ".pedidos")).toMatch(/min-width:\s*0/);
    for (const declaracao of declaracoes(css).filter(
      ({ propriedade, valor }) =>
        propriedade === "width" && /%$/.test(valor) && valor !== "100%",
    ))
      expect(naTabela(declaracao)).toBe(true);
    // Todo bloco de célula das duas tabelas passa pela classe que quebra.
    for (const arquivo of ["./ListaPedidos.tsx", "./EntregasWebhook.tsx"]) {
      expect(FONTES[arquivo], arquivo).toMatch(/`pedidos-celula\$\{/);
      expect(FONTES[arquivo], arquivo).not.toMatch(
        /<DataTable[\s\S]*mostrarLegenda/,
      );
    }
  });

  it("erro e avisos ficam abaixo do rótulo no celular (não espremidos na metade da largura)", () => {
    expect(regra(css, ".pedidos td:has(> .pedidos-texto-longo)")).toMatch(
      /flex-direction:\s*column/,
    );
    expect(
      regra(css, ".pedidos td:has(> .pedidos-texto-longo)::before"),
    ).toMatch(/max-width:\s*none/);
  });

  it("o selo 'suspeito' segura o texto escondido dentro da caixa com rolagem e tem o alvo de toque", () => {
    const selo = regra(css, ".pedidos-selo");
    expect(selo).toMatch(/position:\s*relative/);
    expect(selo).toMatch(/min-height:\s*var\(--alvo-toque\)/);
  });

  it("a região viva vazia do alerta sai do fluxo sem sumir da árvore de acessibilidade (sem display: none)", () => {
    const vazia = regra(CSS["./alerta-webhook.css"], ".alerta-webhook:empty");
    expect(vazia).toMatch(/position:\s*absolute/);
    expect(vazia).not.toMatch(/display:\s*none/);
  });
});

/**
 * Especificidade de um seletor simples, como um número (ids × 10000 + classes, atributos e pseudoclasses × 100 +
 * elementos); um :is() vale o mais específico dos argumentos. Basta para os seletores destes arquivos.
 */
function especificidade(seletor: string): number {
  let total = 0;
  const resto = seletor.replace(/:is\(([^()]*)\)/g, (_, lista: string) => {
    total += Math.max(
      ...lista.split(",").map((parte) => especificidade(parte.trim())),
    );
    return " ";
  });
  const ids = resto.match(/#[\w-]+/g) ?? [];
  // Classes, atributos e pseudoclasses (":hover"); o pseudoelemento ("::before") conta como elemento.
  const classes = resto.match(/\.[\w-]+|\[[^\]]+\]|(?<!:):(?!:)[\w-]+/g) ?? [];
  const elementos =
    resto
      .replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|(?<!:):(?!:)[\w-]+/g, " ")
      .match(/[a-z][\w-]*/gi) ?? [];
  return total + ids.length * 10000 + classes.length * 100 + elementos.length;
}

describe("RIFA-040: com a coluna das ações do admin, a tabela cabe em 1366 px", () => {
  const TABELA = "@media (min-width: 48rem)";
  const DATA_TABLE = declaracoes(
    semComentarios(lerArquivo("../../components/ui/DataTable.css")),
  );
  /** Os seletores de uma regra (a lista separada por vírgula, sem as quebras de linha). */
  const seletores = (bloco: string) =>
    bloco.replace(/\s+/g, " ").split(/\s*,\s*/);

  it("o leitor de especificidade conta como o navegador (a comparação abaixo não passa por acaso)", () => {
    expect(especificidade(".ui-data-table__tabela td")).toBe(101);
    expect(especificidade(".ui-data-table__tabela td[data-principal]")).toBe(
      201,
    );
    expect(especificidade(".pedidos-selo::before")).toBe(101);
    expect(
      especificidade(
        ".pedidos .ui-data-table__tabela :is(th, td, td[data-principal])",
      ),
    ).toBe(301);
  });

  it("as células da tabela têm 12 px dos lados (e não os 16 px da DataTable), na frente das regras dela", () => {
    const nossas = declaracoes(CSS["./pedidos.css"]).filter(
      ({ propriedade, blocos }) =>
        blocos[0] === TABELA && /^padding-(left|right)$/.test(propriedade),
    );
    expect(
      nossas.map(({ propriedade, valor }) => `${propriedade}: ${valor}`),
    ).toEqual([
      "padding-right: var(--espaco-3)",
      "padding-left: var(--espaco-3)",
    ]);
    const nosso = nossas[0].blocos[1];
    expect(nosso).toBe(
      ".pedidos .ui-data-table__tabela :is(th, td, td[data-principal])",
    );
    // Toda regra da DataTable que dá o espaço das células (padding) perde para a nossa, seja qual for a ordem do
    // CSS (pedidos.css vem num pacote à parte).
    const daDataTable = DATA_TABLE.filter(
      ({ propriedade, blocos }) =>
        blocos[0] === TABELA && /^padding/.test(propriedade),
    ).flatMap(({ blocos }) => seletores(blocos[1]));
    expect(daDataTable).toEqual(
      expect.arrayContaining([
        ".ui-data-table__tabela th",
        ".ui-data-table__tabela td",
        ".ui-data-table__tabela td[data-principal]",
      ]),
    );
    for (const seletor of daDataTable)
      expect(especificidade(nosso), seletor).toBeGreaterThan(
        especificidade(seletor),
      );
  });

  it("'Aprovado em ...' quebra a linha; só a data e hora do pedido e o valor ficam numa linha só", () => {
    const naoQuebram = declaracoes(CSS["./pedidos.css"])
      .filter(
        ({ propriedade, valor }) =>
          propriedade === "white-space" && valor === "nowrap",
      )
      .flatMap(({ blocos }) => seletores(blocos[1]));
    expect(naoQuebram).toEqual([".pedidos-quando", ".pedidos-valor"]);
    expect(regra(CSS["./pedidos.css"], "  .pedidos-quando__mudou")).toMatch(
      /white-space:\s*normal/,
    );
  });
});

describe("pacotes: a tela carrega à parte; o alerta, no pacote inicial", () => {
  it("só TelaPedidos (carregada com lazy) importa pedidos.css; ninguém importa TelaPedidos direto", () => {
    const quemImporta = (css: string) =>
      Object.entries(FONTES)
        .filter(([, fonte]) => fonte.includes(`import "./${css}";`))
        .map(([arquivo]) => arquivo);
    expect(quemImporta("pedidos.css")).toEqual(["./TelaPedidos.tsx"]);
    expect(quemImporta("alerta-webhook.css")).toEqual(["./AlertaWebhook.tsx"]);
    expect(FONTES["./PedidosPage.tsx"]).toMatch(
      /lazy\(\(\) =>\s*import\("\.\/TelaPedidos"\)/,
    );
    for (const [arquivo, fonte] of Object.entries(FONTES)) {
      expect(fonte, arquivo).not.toMatch(/from "\.\/TelaPedidos"/);
    }
    const telas = lerArquivo("../coordenacao/telas.ts");
    expect(telas).toContain('from "../pedidos/PedidosPage"');
    expect(telas).not.toContain("TelaPedidos");
  });

  it("a Visão geral usa só o alerta (não puxa a tela Pedidos para o pacote inicial)", () => {
    const visao = lerArquivo("../visao-geral/VisaoGeralPage.tsx");
    expect(visao).toContain('from "../pedidos/AlertaWebhook"');
    expect(visao).not.toMatch(/from "\.\.\/pedidos\/(?!AlertaWebhook")/);
    // O alerta não importa nada da parte que vem à parte.
    for (const arquivo of [
      "./AlertaWebhook.tsx",
      "./alerta-webhook.ts",
      "./useEstadoWebhook.ts",
    ]) {
      expect(FONTES[arquivo], arquivo).not.toMatch(
        /from "\.\/(TelaPedidos|ListaPedidos|EntregasWebhook|pedidos-api|textos|usePaginas)"/,
      );
    }
  });

  it("o contrato entra só por tipos (os valores poriam o zod no pacote do site)", () => {
    for (const [arquivo, fonte] of Object.entries(FONTES)) {
      for (const [importacao] of fonte.matchAll(
        /import[^;]*from "[./]*shared\/contracts[^"]*";/g,
      ))
        expect(importacao, arquivo).toMatch(/^import type /);
    }
  });
});

describe("RIFA-051 (P3.5, A-09): os totais com a cara do Stat", () => {
  const css = CSS["./pedidos.css"];
  const stat = semComentarios(lerArquivo("../../components/ui/Stat.css"));
  const declaracao = (corpo: string, propriedade: string) =>
    new RegExp(`${propriedade}:\\s*([^;]+);`).exec(corpo)?.[1].trim();

  it("o cartão do total sem a borda colorida de cima (nem as classes por status): o tom fica no chip", () => {
    const total = regra(css, ".pedidos-total");
    expect(total).not.toMatch(/border-top/);
    expect(total).toMatch(/border:\s*1px solid var\(--cor-borda\);/);
    expect(css).not.toMatch(/\.pedidos-total--/);
    for (const tom of ["sucesso", "marca", "neutro"])
      expect(regra(css, `.pedidos-total__icone--${tom}`)).toContain(
        `var(--cor-${tom === "marca" ? "primaria" : tom}-suave)`,
      );
  });

  it("o número de pedidos com a fonte, o peso e o tamanho do valor do Stat", () => {
    const principal = regra(css, ".pedidos-total__principal");
    const valor = regra(stat, ".ui-stat__valor");
    for (const propriedade of ["font-family", "font-size", "font-weight"])
      expect(declaracao(principal, propriedade), propriedade).toBe(
        declaracao(valor, propriedade),
      );
  });

  it("o chip tem o tamanho do chip do Stat (2rem) sem largura fixa: o ícone de 1rem e o respiro de --espaco-2 em volta", () => {
    const chip = regra(css, ".pedidos-total__icone");
    expect(chip).toMatch(/padding:\s*var\(--espaco-2\);/);
    expect(chip).toMatch(/border-radius:\s*50%;/);
    expect(regra(css, ".pedidos-total__icone .ui-icone")).toMatch(
      /width:\s*1rem;/,
    );
    expect(TOKENS).toMatch(/--espaco-2:\s*0\.5rem;/);
    expect(regra(stat, ".ui-stat__icone")).toMatch(/width:\s*2rem;/);
  });
});

describe("RIFA-051 (P3.7, A-04): os filtros recolhidos no celular", () => {
  const todas = declaracoes(CSS["./pedidos.css"]);
  const de = (seletor: string, noComputador = false) =>
    todas.filter(
      (d) => d.blocos.at(-1) === seletor && naTabela(d) === noComputador,
    );
  const valor = (seletor: string, propriedade: string, noComputador = false) =>
    de(seletor, noComputador).find((d) => d.propriedade === propriedade)?.valor;

  it("no computador (a partir de 48rem), o <summary> some e os filtros ficam à mostra, sem espaço a mais", () => {
    expect(valor(".pedidos-filtros-caixa__resumo", "display", true)).toBe(
      "none",
    );
    expect(
      valor(
        ".pedidos-filtros-caixa__resumo + .pedidos-filtros",
        "margin-top",
        true,
      ),
    ).toBe("0");
  });

  it("no celular, o <summary> tem o alvo de toque, a cara de botão secundário e a seta desenhada com a borda (nenhum caractere)", () => {
    const resumo = ".pedidos-filtros-caixa__resumo";
    expect(valor(resumo, "min-height")).toBe("var(--alvo-toque)");
    expect(valor(resumo, "border")).toBe("1px solid var(--cor-borda-forte)");
    expect(valor(resumo, "list-style")).toBe("none");
    expect(valor(`${resumo}::after`, "content")).toBe('""');
    expect(valor(`${resumo}::-webkit-details-marker`, "display")).toBe("none");
    // A seta gira só com movimento (a transição fica no @media de movimento).
    expect(
      todas.find(
        (d) =>
          d.blocos.at(-1) === `${resumo}::after` &&
          d.propriedade === "transition",
      )?.blocos[0],
    ).toBe("@media (prefers-reduced-motion: no-preference)");
  });
});
