// RIFA-040: o CSS dos componentes base que o jsdom não confere (ele não faz layout). A barra lateral do computador
// (AppShell) em tela baixa: com o menu do admin, em 1366×768 e 1280×720, ela é mais alta que a janela; o topo
// encolhia e "Coordenação" ficava por cima de "Visão geral". E a caixa com rolagem da DataTable segura o que é
// absoluto numa célula (o texto escondido dos botões), para a página não rolar na horizontal. A medida na tela de
// verdade está nas capturas do Playwright. RIFA-047: o botão indisponível (aria-disabled) tem a cara do disabled numa
// regra só, no Button.css, e nenhuma tela a repete.
import { describe, expect, it } from "vitest";
import {
  caraDeIndisponivel,
  caraDoDesabilitado,
  lerCss,
} from "../../test/indisponivel";

// O Vitest esvazia todo import de CSS (até com ?raw): o texto vem do disco, pelo fs do Node.
type ModuloFs = {
  readFileSync(caminho: string, codificacao: "utf8"): string;
  readdirSync(
    caminho: string,
    opcoes: { recursive: true; encoding: "utf8" },
  ): string[];
};
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
    // Os cinco :hover das variantes, o subir 1 px no mouse e o afundar ao pressionar.
    expect(seletores.length).toBeGreaterThanOrEqual(7);
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

describe("Button: o indisponível (aria-disabled) tem a cara do disabled numa regra só (RIFA-047)", () => {
  /** Um botão da tela com aria-disabled (ex.: "Saindo…" da coordenação, "Atualizando…" do Mapa). */
  function indisponivel(classes = "ui-button ui-button--secundario") {
    const botao = document.createElement("button");
    botao.className = classes;
    botao.setAttribute("aria-disabled", "true");
    return botao;
  }

  it('.ui-button[aria-disabled="true"]: a opacidade e o cursor do :disabled, em todas as variantes, só com o Button.css', () => {
    const button = lerCss("components/ui/Button.css");
    for (const variante of [
      "primario",
      "secundario",
      "discreto",
      "perigo",
      "perigo-discreto",
    ]) {
      expect(
        caraDeIndisponivel(
          indisponivel(`ui-button ui-button--${variante}`),
          button,
        ),
        variante,
      ).toEqual(caraDoDesabilitado());
    }
    // Disponível (sem aria-disabled ou com "false"), nada: só o cursor de sempre.
    const disponivel = indisponivel();
    disponivel.setAttribute("aria-disabled", "false");
    expect(caraDeIndisponivel(disponivel, button)).toBeNull();
    disponivel.removeAttribute("aria-disabled");
    expect(caraDeIndisponivel(disponivel, button)).toBeNull();
  });

  it("a mesma regra do :disabled (um seletor ao lado do outro): mudar um muda o outro", () => {
    const regra = declaracoes(lerArquivo("./Button.css")).filter(({ blocos }) =>
      blocos
        .at(-1)!
        .split(/\s*,\s*/)
        .includes(".ui-button:disabled"),
    );
    expect(regra.map(({ propriedade }) => propriedade).sort()).toEqual([
      "cursor",
      "opacity",
    ]);
    for (const { blocos } of regra)
      expect(blocos.at(-1)!.split(/\s*,\s*/)).toEqual([
        ".ui-button:disabled",
        '.ui-button[aria-disabled="true"]',
      ]);
  });

  /** O último seletor composto ("a > b.c[d]" → "b.c[d]"): o que diz em quem a regra vale. */
  function ultimoComposto(seletor: string): string {
    let profundidade = 0;
    let inicio = 0;
    for (let indice = 0; indice < seletor.length; indice += 1) {
      const caractere = seletor[indice];
      if (caractere === "(" || caractere === "[") profundidade += 1;
      else if (caractere === ")" || caractere === "]") profundidade -= 1;
      else if (profundidade === 0 && /[\s>+~]/.test(caractere))
        inicio = indice + 1;
    }
    return seletor.slice(inicio);
  }

  /**
   * Seletor de um botão indisponível: o último composto tem o [aria-disabled="true"] (fora de um :not() ou :has()) e
   * é um botão ou não diz o tipo. Pega também a repetida com a classe da tela (ex.: a antiga
   * `.adesao-dialogo-botao[aria-disabled="true"]`); a caixa de marcar (`input[...]`) fica fora (RIFA-047, revisão).
   */
  function ehDeBotaoIndisponivel(seletor: string): boolean {
    let composto = ultimoComposto(seletor);
    while (/\([^()]*\)/.test(composto))
      composto = composto.replace(/\([^()]*\)/g, "");
    const tipo = /^[a-z][\w-]*/i.exec(composto)?.[0];
    return (
      /\[aria-disabled=["']?true["']?\]/.test(composto) &&
      (tipo === undefined || tipo === "button")
    );
  }

  /** As regras de botão indisponível de uma folha: os seletores de botão e a cara que dão (as caixas de marcar ficam fora). */
  function regrasDeBotaoIndisponivel(css: string) {
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(
      ([, seletores, corpo]) => {
        const deBotao = seletores
          .split(",")
          .map((seletor) => seletor.trim())
          .filter(ehDeBotaoIndisponivel);
        if (deBotao.length === 0) return [];
        return [
          {
            seletores: deBotao.join(", "),
            repete:
              /(^|;)\s*opacity:\s*0\.55\s*(;|$)/.test(corpo) &&
              /(^|;)\s*cursor:\s*not-allowed\s*(;|$)/.test(corpo),
          },
        ];
      },
    );
  }

  it("nenhuma tela repete a regra: o que sobra no CSS das telas é só a cara diferente de propósito", () => {
    expect(caraDoDesabilitado()).toEqual({
      opacity: "0.55",
      cursor: "not-allowed",
    });
    const fs = process.getBuiltinModule("node:fs");
    // A pasta src/web (o caminho numa variável, como no lerArquivo).
    const acima = "../../";
    const raiz = decodeURIComponent(new URL(acima, import.meta.url).pathname);
    const folhas = fs
      .readdirSync(raiz, { recursive: true, encoding: "utf8" })
      .filter(
        (caminho) =>
          caminho.endsWith(".css") && caminho !== "components/ui/Button.css",
      );
    expect(folhas.length).toBeGreaterThan(20);
    const regras = folhas.flatMap((folha) =>
      regrasDeBotaoIndisponivel(lerCss(folha)).map((regra) => ({
        ...regra,
        folha,
      })),
    );
    expect(regras.filter(({ repete }) => repete)).toEqual([]);
    // As que ficam são de propósito: o cursor de espera no "Carregando…" das listas e no "Baixando…" do relatório
    // (que fica com 0,75, para o texto branco manter o contraste).
    expect(
      regras.map(({ folha, seletores }) => `${folha}: ${seletores}`).sort(),
    ).toEqual([
      'pages/pedidos/pedidos.css: .pedidos-rodape button[aria-disabled="true"]',
      'pages/trilha/trilha.css: .trilha-rodape button[aria-disabled="true"]',
      'pages/visao-geral/visao-geral.css: .visao-relatorio__acoes .ui-button[aria-disabled="true"]',
    ]);
  });

  it("o leitor das regras das telas não passa por acaso: a repetida é pega, a diferente e a da caixa de marcar não", () => {
    expect(
      regrasDeBotaoIndisponivel(`
        .tela-acoes button[aria-disabled="true"] { opacity: 0.55; cursor: not-allowed; }
        .tela-lista .ui-button[aria-disabled="true"] { opacity: 0.55; cursor: progress; }
        .tela-opcao input[aria-disabled="true"] { opacity: 0.55; cursor: not-allowed; }
        .tela-dialogo-botao[aria-disabled="true"],
        .tela-acoes > [aria-disabled="true"].ui-button { opacity: 0.55; cursor: not-allowed; }
        .tela-opcao:has(input[aria-disabled="true"]) { opacity: 0.55; cursor: not-allowed; }
        .tela .ui-button:hover:not([aria-disabled="true"]) { opacity: 0.55; cursor: not-allowed; }
      `),
    ).toEqual([
      {
        seletores: '.tela-acoes button[aria-disabled="true"]',
        repete: true,
      },
      {
        seletores: '.tela-lista .ui-button[aria-disabled="true"]',
        repete: false,
      },
      // RIFA-047 (revisão): a repetida com a classe da tela (como a antiga do diálogo da Adesão) também é pega.
      {
        seletores:
          '.tela-dialogo-botao[aria-disabled="true"], .tela-acoes > [aria-disabled="true"].ui-button',
        repete: true,
      },
    ]);
  });
});

// RIFA-049 (P1.3, A-18): a falha de conexão é passageira, não é erro. O cartão dela e o círculo do ícone não usam
// nenhuma cor de perigo (o vermelho fica só no .ui-estado--erro); o vazio tem borda sólida suave (antes, tracejada).
describe("Estados: a falha de conexão sem vermelho e o vazio sem tracejado", () => {
  const estados = declaracoes(lerArquivo("./Estados.css"));
  const doSeletor = (parte: string) =>
    estados.filter(({ blocos }) =>
      blocos
        .at(-1)!
        .split(/\s*,\s*/)
        .some((seletor) => seletor.includes(parte)),
    );

  it("o .ui-estado--conexao (e o que vale dentro dele) não usa --cor-perigo*", () => {
    const conexao = doSeletor(".ui-estado--conexao");
    expect(conexao.length).toBeGreaterThanOrEqual(4);
    for (const { propriedade, valor, blocos } of conexao)
      expect(valor, `${blocos.at(-1)} { ${propriedade} }`).not.toMatch(
        /--cor-perigo/,
      );
    // O vermelho continua, mas só na falha de verdade.
    expect(
      doSeletor(".ui-estado--erro").some(({ valor }) =>
        /--cor-perigo/.test(valor),
      ),
    ).toBe(true);
    // O círculo do ícone da conexão: o amarelo suave do alerta.
    expect(
      Object.fromEntries(
        doSeletor(".ui-estado--conexao .ui-estado__icone").map(
          ({ propriedade, valor }) => [propriedade, valor],
        ),
      ),
    ).toEqual({
      background: "var(--cor-alerta-suave)",
      color: "var(--cor-alerta)",
    });
  });

  it("o vazio: borda sólida suave, sem tracejado", () => {
    const vazio = Object.fromEntries(
      doSeletor(".ui-estado--vazio").map(({ propriedade, valor }) => [
        propriedade,
        valor,
      ]),
    );
    expect(vazio.border).toBe("1px solid var(--cor-borda)");
    expect(lerArquivo("./Estados.css")).not.toMatch(/dashed/);
  });
});

// RIFA-049 (P1.4, A-14 e A-15): o botão pequeno tem o alvo de toque de 44 px numa tela de toque (o mouse continua com
// 36 px), e a variante perigo-discreto (ação destrutiva leve) segue as regras das outras.
describe("Button: o pequeno com 44 px no toque e a variante perigo-discreto", () => {
  const button = declaracoes(lerArquivo("./Button.css"));
  const daRegra = (media: string | null, seletor: string) =>
    Object.fromEntries(
      button
        .filter(
          ({ blocos }) =>
            blocos.length === (media ? 2 : 1) &&
            (media === null || blocos[0] === media) &&
            blocos
              .at(-1)!
              .split(/\s*,\s*/)
              .includes(seletor),
        )
        .map(({ propriedade, valor }) => [propriedade, valor]),
    );

  it("no toque (pointer: coarse), o pequeno tem o alvo de toque; no mouse, 36 px", () => {
    expect(daRegra(null, ".ui-button--pequeno")["min-height"]).toBe("2.25rem");
    expect(daRegra("@media (pointer: coarse)", ".ui-button--pequeno")).toEqual({
      "min-height": "var(--alvo-toque)",
    });
    // O alvo de toque é 44 px (2,75rem).
    expect(lerArquivo("../../tema/tokens.css")).toMatch(
      /--alvo-toque:\s*2\.75rem;/,
    );
  });

  it("perigo-discreto: texto do perigo sem fundo; o hover pula o indisponível e não repete a regra dele", () => {
    expect(daRegra(null, ".ui-button--perigo-discreto")).toEqual({
      background: "transparent",
      color: "var(--cor-perigo)",
    });
    const hover = daRegra(
      null,
      '.ui-button--perigo-discreto:hover:not(:disabled):not([aria-disabled="true"])',
    );
    expect(hover).toEqual({
      background: "var(--cor-perigo-suave)",
      color: "var(--cor-perigo)",
    });
    // Nenhuma regra própria do indisponível nesta variante (a de .ui-button[aria-disabled="true"] vale para todas).
    expect(
      button.filter(({ blocos }) =>
        /perigo-discreto[^,]*\[aria-disabled="true"\](?!\))/.test(
          blocos.at(-1)!,
        ),
      ),
    ).toEqual([]);
  });
});

// RIFA-049 (P1.7, A-02): o topo das telas abertas é a faixa do degradê forte da marca, com o texto branco (o contraste
// de cada ponto está no tokens.test.ts); a altura é fixa (padding fixo e o selo do logo reservado desde o início).
describe("PublicShell: o topo na faixa da marca", () => {
  const topo = Object.fromEntries(
    declaracoes(lerArquivo("./PublicShell.css"))
      .filter(
        ({ blocos }) =>
          blocos.length === 1 && blocos[0] === ".ui-public-shell__topo",
      )
      .map(({ propriedade, valor }) => [propriedade, valor]),
  );

  it("o fundo é o --gradiente-marca-forte e o texto, o --cor-sobre-primaria", () => {
    expect(topo.background).toBe("var(--gradiente-marca-forte)");
    expect(topo.color).toBe("var(--cor-sobre-primaria)");
    // Nada de altura que depende do logo ter chegado: o padding é fixo.
    expect(topo.padding).toBe("var(--espaco-3) var(--margem-pagina)");
  });

  it("o selo do logo (fundo escuro) tem o lugar reservado em rem, com ou sem o logo carregado", () => {
    const selo = Object.fromEntries(
      declaracoes(lerArquivo("./Marca.css"))
        .filter(
          ({ blocos }) =>
            blocos.at(-1) === '.ui-marca[data-fundo="escuro"] .ui-marca__selo',
        )
        .map(({ propriedade, valor }) => [propriedade, valor]),
    );
    expect(selo.padding).toBe("var(--espaco-1) var(--espaco-2)");
  });
});
