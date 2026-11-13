// CA2, CA3 e CA5 (RIFA-014): /minha pela rota de verdade, com a API falsa (teste-apoio.ts, respostas que
// passam no schema estrito do contrato). CA2: os números do próprio alvo, o gráfico, as posições, os vizinhos
// (só nome e posição) e os primeiros; com a meta em centavos, só percentuais; nenhum "R$" no DOM em nenhum
// cenário. CA3: a equipe do discipulador e da rede, com o aviso de adesão; o líder sem equipe e com o aviso de
// afiliado. E os estados: carregando, erro, sem campanha, antes do início, sem vendas, sem células e a
// atualização a cada minuto com a aba visível.
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  RespostaVisaoIndividual,
  UsuarioSessao,
} from "../../../shared/contracts";
import { MENSAGEM_SEM_CONEXAO } from "../../lib/api";
import { esperarDisponivel } from "../../test/indisponivel";
import { renderizarRota, respostaJson } from "../../test/renderizar";
import {
  comHojeCoberto,
  comPercentualDaCampanha,
  criarApiFalsa,
  respostaErro,
  sessaoDaVisao,
  todosOsCenarios,
  visaoDe,
  type ApiFalsa,
  type Cenario,
} from "./teste-apoio";
import { INTERVALO_ATUALIZACAO_MS } from "./useVisaoIndividual";

const CAMINHO_VISAO = "/api/minha/visao";

async function abrir(
  visao: RespostaVisaoIndividual = visaoDe(),
  { api = criarApiFalsa(visao), usuario = sessaoDaVisao(visao) } = {} as {
    api?: ApiFalsa;
    usuario?: UsuarioSessao;
  },
) {
  vi.stubGlobal("fetch", api.fetch);
  const tela = renderizarRota("/minha", { usuario });
  await screen.findByRole("heading", { level: 2, name: "Ranking" });
  return { api, ...tela };
}

const abrirCenario = (cenario: Cenario) => abrir(visaoDe(cenario));

/** A seção (ou o cartão) com este título. */
function regiao(nome: string, nivel = 2): HTMLElement {
  const titulo = screen.getByRole("heading", { level: nivel, name: nome });
  // As seções da tela e os cartões dela (pelas classes da própria tela, não pelas dos componentes base).
  const elemento = titulo.closest<HTMLElement>(
    "section, .minha-periodo, .minha-curva, .minha-ranking",
  );
  if (!elemento) throw new Error(`sem região para ${nome}`);
  return elemento;
}

/** Valor de um par rótulo/valor (dt/dd) dentro de `raiz`. */
function valorDe(raiz: HTMLElement, rotulo: string) {
  return within(raiz).getByText(rotulo, { selector: "dt" }).nextElementSibling
    ?.textContent;
}

/** As linhas da tabela (uma por célula), como texto de cada célula. */
function linhasDaTabela(tabela: HTMLElement) {
  return within(tabela)
    .getAllByRole("row")
    .slice(1)
    .map((linha) =>
      within(linha)
        .getAllByRole("cell")
        .map((celula) => celula.textContent),
    );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("CA2: a visão do líder mostra os números da própria célula", () => {
  it("cabeçalho com o alvo, quem entrou e Sair; o % da meta da campanha e a meta de hoje em destaque", async () => {
    const { api } = await abrir();

    expect(
      screen.getByRole("heading", { level: 1, name: "Célula Ágape" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(document.title).toBe("Célula Ágape · Rifa Videira Kids");
    const cabecalho = screen.getByRole("heading", { level: 1 }).parentElement;
    expect(cabecalho).toHaveTextContent(
      "Célula · Jovens Você entrou como Maria Fictícia.",
    );
    // Na barra do topo: a marca com o papel e o "Sair".
    const topo = document.querySelector<HTMLElement>(".minha-moldura__topo");
    if (!topo) throw new Error("sem a barra do topo");
    expect(topo).toHaveTextContent("Líder");
    esperarDisponivel(within(topo).getByRole("button", { name: "Sair" }));

    const destaque = regiao("Meta da campanha");
    expect(destaque).toHaveTextContent(
      "Dia 12 de 24 · Faltam 13 dias, contando hoje (até 16/12/2026).",
    );
    expect(
      within(destaque).getByText("35%", {
        selector: ".minha-destaque__numero",
      }),
    ).toBeInTheDocument();
    const barra = within(destaque).getByRole("progressbar", {
      name: "Vendidos: 42 de 120 bilhetes",
    });
    expect(barra).toHaveAttribute("aria-valuenow", "35");
    // RIFA-051: o % aparece uma vez, grande; a barra não o repete (só no aria-valuetext). Abaixo da meta, sem selo.
    expect(barra).toHaveAttribute("aria-valuetext", "35%");
    expect(within(destaque).getAllByText("35%")).toHaveLength(1);
    expect(destaque.querySelector(".ui-progress__valor")).toBeNull();
    expect(within(destaque).queryByText("Meta batida")).toBeNull();
    // O destaque é um Card "destaque" (a borda roxa de 2 px do componente, não uma borda própria da tela).
    expect(destaque.querySelector(".ui-card.ui-card--destaque")).not.toBeNull();
    expect(destaque).toHaveTextContent(
      "Abaixo do esperadoFaltam 3 bilhetes para o esperado até ontem",
    );
    expect(destaque).toHaveTextContent(
      "No ritmo atual, chega a 90% da meta até 16/12/2026.",
    );
    const hoje = regiao("Hoje · 04/12", 3);
    expect(hoje).toHaveTextContent("Faltam 7 bilhetes hoje");
    expect(hoje).toHaveTextContent(
      "Meta de hoje: 9 bilhetes; vendidos hoje: 2.",
    );

    // A visão e, uma vez, o link de vendas (RIFA-046).
    await waitFor(() =>
      expect(api.chamadas).toEqual([
        { metodo: "GET", caminho: `${CAMINHO_VISAO}?periodo=atual` },
        { metodo: "GET", caminho: "/api/minha/links-vendas" },
      ]),
    );
  });

  it("meta batida (RIFA-051): o % uma vez, grande, com o selo 'Meta batida' e o troféu ao lado; a barra não repete o número", async () => {
    await abrir(comPercentualDaCampanha(visaoDe(), 11_300));

    const destaque = regiao("Meta da campanha");
    const numero = within(destaque).getByText("113%", {
      selector: ".minha-destaque__numero",
    });
    expect(within(destaque).getAllByText("113%")).toHaveLength(1);
    const selo = within(destaque).getByText("Meta batida", {
      selector: ".minha-destaque__selo",
    });
    // O selo fica ao lado do número (no mesmo bloco), com o troféu só visual.
    expect(numero.parentElement).toContainElement(selo);
    const trofeu = selo.querySelector("svg");
    expect(trofeu).toHaveAttribute("data-icone", "trofeu");
    expect(trofeu).toHaveAttribute("aria-hidden", "true");
    expect(selo).toHaveTextContent(/^Meta batida$/);
    const barra = within(destaque).getByRole("progressbar", {
      name: "Vendidos: 42 de 120 bilhetes",
    });
    expect(barra).toHaveAttribute("aria-valuenow", "100");
    expect(barra).toHaveAttribute("aria-valuetext", "113%");
    expect(destaque.querySelector(".ui-progress__valor")).toBeNull();
    // A barra continua com o selo do troféu no fim (P1); o selo amarelo da tela é outro, ao lado do número.
    expect(destaque.querySelector(".ui-progress__trofeu")).not.toBeNull();
  });

  it("a meta de hoje coberta: o ícone de check (desenho, não caractere) e a frase, sem o verde no texto inteiro", async () => {
    await abrir(comHojeCoberto(visaoDe()));
    const hoje = regiao("Hoje · 04/12", 3);
    expect(hoje).toHaveAttribute("data-batida");
    const frase = within(hoje).getByText("Meta de hoje já coberta");
    const icone = frase.querySelector("svg");
    expect(icone).toHaveAttribute("data-icone", "check");
    expect(icone).toHaveAttribute("aria-hidden", "true");
    expect(hoje).not.toHaveTextContent("✓");
    expect(hoje).toHaveTextContent(
      "O que foi vendido até ontem já cobre a curva de hoje. Vendidos hoje: 2 bilhetes.",
    );
  });

  it("o período atual, com a situação contra a curva do período", async () => {
    await abrir();

    const periodo = regiao("Semana 2");
    expect(periodo).toHaveTextContent("Dia 2 de 7 · 03/12 a 09/12");
    expect(periodo).toHaveTextContent("Em diaExatamente no esperado até ontem");
    expect(
      within(periodo).getByRole("progressbar", {
        name: "Meta do período: 29 bilhetes",
      }),
    ).toHaveAttribute("aria-valuenow", "17");
    expect(periodo).toHaveTextContent("Vendidos no período: 5 bilhetes.");
  });

  it("o gráfico da curva em % da meta, com o dia de hoje marcado", async () => {
    await abrir();

    const curva = regiao("Curva da campanha");
    const grafico = within(curva).getByRole("img", {
      name: "Esperado e realizado acumulados por dia, em % da meta",
    });
    expect(grafico).toHaveAccessibleDescription(
      /Até hoje, dia 12 \(04\/12\/2026\), o realizado é 35% da meta; o esperado até ontem era 36%: abaixo do esperado\./,
    );
    const detalhes = within(curva)
      .getByText("Ver os dados em tabela")
      .closest("details");
    if (!detalhes) throw new Error("sem tabela do gráfico");
    detalhes.open = true;
    const tabela = within(curva).getByRole("table");
    const linhas = within(tabela).getAllByRole("row").slice(1);
    expect(linhas).toHaveLength(24);
    expect(linhas[11]).toHaveTextContent("Dia 12 · 04/12/2026");
    expect(linhas[11]).toHaveTextContent("hoje");
    expect(linhas[11]).toHaveTextContent("35%");
    // Os dias que ainda não chegaram ficam sem o realizado.
    expect(linhas[12]).toHaveTextContent("sem dado");
    expect(linhas[23]).toHaveTextContent("100%");
  });

  it("as posições na divisão e no geral, com o nome e a posição dos vizinhos (sem a distância), e os primeiros com 'você'", async () => {
    await abrir();

    const ranking = regiao("Ranking");
    expect(ranking).toHaveTextContent("Semana 2 · 03/12 a 09/12");
    const divisao = regiao("Na sua divisão", 3);
    expect(divisao).toHaveTextContent("2º de 6");
    expect(divisao).toHaveTextContent("Entre as células dos Jovens");
    expect(valorDe(divisao, "Logo acima")).toBe("Célula Betel (1º)");
    expect(valorDe(divisao, "Logo abaixo")).toBe("Célula Getsêmani (3º)");
    const geral = regiao("Geral", 3);
    expect(geral).toHaveTextContent("4º de 12");
    expect(geral).toHaveTextContent("Entre todas as células, jovens e adultos");
    expect(valorDe(geral, "Logo acima")).toBe("Célula Éfeso (3º)");
    expect(valorDe(geral, "Logo abaixo")).toBe("Célula Filadélfia (5º)");

    const primeiros = within(regiao("Os primeiros dos Jovens", 3)).getAllByRole(
      "listitem",
    );
    expect(primeiros.map((item) => item.textContent)).toEqual([
      "1º Célula Betel",
      "2º Célula Ágape Você",
      "3º Célula Getsêmani",
    ]);
    expect(primeiros[1]).toHaveAttribute("aria-current", "true");
    expect(primeiros[0]).not.toHaveAttribute("aria-current");
    expect(ranking).toHaveTextContent("A ordem é pelo % da meta de cada um.");
  });

  it("líder em 1º lugar: ninguém logo acima", async () => {
    await abrirCenario({ primeiroLugar: true });

    expect(valorDe(regiao("Na sua divisão", 3), "Logo acima")).toBe(
      "Ninguém: é o 1º lugar",
    );
    expect(
      within(regiao("Os primeiros dos Jovens", 3)).getAllByRole("listitem")[0],
    ).toHaveTextContent("1º Célula Ágape Você");
  });

  it("com a meta em centavos: só percentuais (nenhuma quantidade da meta), e os bilhetes vendidos continuam", async () => {
    await abrirCenario({ unidade: "centavos" });

    const destaque = regiao("Meta da campanha");
    expect(
      within(destaque).getByText("35%", {
        selector: ".minha-destaque__numero",
      }),
    ).toBeInTheDocument();
    expect(
      within(destaque).getByRole("progressbar", {
        name: "Bilhetes vendidos: 42",
      }),
    ).toHaveAttribute("aria-valuenow", "35");
    expect(destaque).toHaveTextContent(
      "Abaixo do esperado35% da meta; a curva esperava 36% até ontem",
    );
    const hoje = regiao("Hoje · 04/12", 3);
    expect(hoje).toHaveTextContent("22% da meta de hoje");
    expect(hoje).toHaveTextContent("Vendidos hoje: 2 bilhetes.");
    const periodo = regiao("Semana 2");
    expect(periodo).toHaveTextContent(
      "Em dia17% da meta; a curva esperava 14% até ontem",
    );
    expect(
      within(periodo).getByRole("progressbar", { name: "Meta do período" }),
    ).toBeInTheDocument();

    const texto = document.body.textContent ?? "";
    expect(texto).not.toMatch(
      /Faltam? \d+ bilhetes? hoje|de \d+ bilhetes|Meta de hoje: \d|Meta do período: \d|Vendidos no período|acima do esperado|para o esperado até ontem/,
    );
  });
});

describe("CA2: nenhum R$ no DOM, em nenhum cenário", () => {
  it.each(todosOsCenarios())("%s", async (_nome, cenario) => {
    await abrirCenario(cenario);

    for (const texto of [
      document.body.textContent ?? "",
      document.body.innerHTML,
      document.title,
    ]) {
      expect(texto).not.toMatch(/R\$|BRL|reais/i);
    }
  });
});

describe("CA3: equipe por papel", () => {
  it("o líder não vê equipe nem o aviso de afiliado quando a célula tem afiliados", async () => {
    await abrir();

    expect(
      screen.queryByRole("heading", { name: /Suas células|Sua rede/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/link de afiliado/)).not.toBeInTheDocument();
  });

  it("líder sem afiliado vinculado: o aviso para falar com a coordenação", async () => {
    await abrirCenario({ afiliados: 0 });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Seu link de afiliado ainda não está ligado à sua célula: fale com a coordenação.",
    );
    expect(
      screen.queryByRole("heading", { name: /Suas células|Sua rede/ }),
    ).not.toBeInTheDocument();
  });

  it("discipulador: as células dele com números, a posição e o aviso de quem ainda não aderiu", async () => {
    await abrirCenario({ papel: "discipulador" });

    expect(
      screen.getByRole("heading", { level: 1, name: "Davi Fictício" }),
    ).toBeInTheDocument();
    const equipe = regiao("Suas células");
    expect(within(equipe).getByRole("alert")).toHaveTextContent(
      "1 célula ainda não aderiu",
    );
    expect(within(equipe).getByRole("alert")).toHaveTextContent(
      "Nenhum link de afiliado da Rifei está ligado a Célula Canaã (líder: Ana Fictícia).",
    );
    const tabela = within(equipe).getByRole("table", {
      name: "Células de Davi Fictício",
    });
    expect(
      within(tabela)
        .getAllByRole("columnheader")
        .map((coluna) => coluna.textContent),
    ).toEqual([
      "Célula",
      "Líder",
      "Meta da campanha",
      "Situação",
      "Bilhetes",
      "Vendidos hoje",
      "Posição nos Jovens",
      "Adesão",
    ]);
    expect(linhasDaTabela(tabela)).toEqual([
      [
        "Célula Ágape",
        "Maria Fictícia",
        "35%",
        "Abaixo do esperado",
        "42",
        "2",
        "2º",
        "Aderiu",
      ],
      [
        "Célula Betel",
        "João Fictício",
        "53%",
        "Em dia",
        "32",
        "3",
        "1º",
        "Aderiu",
      ],
      [
        "Célula Canaã",
        "Ana Fictícia",
        "0%",
        "Abaixo do esperado",
        "0",
        "0",
        "6º",
        "Não aderiu",
      ],
    ]);
    // O discipulador também tem os próprios números e a posição entre os discipuladores.
    expect(regiao("Na sua divisão", 3)).toHaveTextContent("1º de 2");
    expect(regiao("Na sua divisão", 3)).toHaveTextContent(
      "Entre os discipuladores dos Jovens",
    );
    expect(screen.queryByText(/Seu link de afiliado/)).not.toBeInTheDocument();
  });

  it("rede: os discipuladores dela, cada um com as próprias células e números, e o aviso de adesão", async () => {
    await abrirCenario({ papel: "rede" });

    expect(
      screen.getByRole("heading", { level: 1, name: "Rede Jovem Fictícia" }),
    ).toBeInTheDocument();
    const equipe = regiao("Sua rede");
    expect(within(equipe).getByRole("alert")).toHaveTextContent(
      "1 célula ainda não aderiu",
    );
    expect(
      within(equipe)
        .getAllByRole("heading", { level: 3 })
        .map((titulo) => titulo.textContent),
    ).toEqual(["Davi Fictício", "Elias Fictício", "Lucas Fictício"]);

    const davi = regiao("Davi Fictício", 3);
    expect(valorDe(davi, "Meta da campanha")).toBe("24%");
    expect(valorDe(davi, "Bilhetes")).toBe("74");
    expect(valorDe(davi, "Posição nos Jovens")).toBe("1º");
    expect(
      linhasDaTabela(
        within(davi).getByRole("table", { name: "Células de Davi Fictício" }),
      ).map((linha) => [linha[0], linha[7]]),
    ).toEqual([
      ["Célula Ágape", "Aderiu"],
      ["Célula Betel", "Aderiu"],
      ["Célula Canaã", "Não aderiu"],
    ]);
    const elias = regiao("Elias Fictício", 3);
    expect(
      linhasDaTabela(
        within(elias).getByRole("table", { name: "Células de Elias Fictício" }),
      ).map((linha) => linha[0]),
    ).toEqual(["Célula Dorcas"]);
    const lucas = regiao("Lucas Fictício", 3);
    expect(valorDe(lucas, "Posição nos Jovens")).toBe(
      "Fora do ranking (sem células)",
    );
    expect(lucas).toHaveTextContent(
      "Ainda não há células com este discipulador.",
    );
    expect(within(lucas).queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("fases, primeira venda e alvo sem células", () => {
  it("antes do início: a contagem regressiva no destaque e, no lugar da posição, a frase de incentivo", async () => {
    await abrirCenario({ fase: "antes" });

    const destaque = regiao("Faltam 3 dias para começar");
    expect(destaque).toHaveTextContent(
      "As vendas vão de 23/11/2026 a 16/12/2026.",
    );
    expect(destaque).toHaveTextContent("Meta da campanha: 120 bilhetes.");
    expect(screen.queryByRole("heading", { name: /^Hoje/ })).toBeNull();
    const ranking = regiao("Ranking");
    expect(ranking).toHaveTextContent(
      "As vendas começam em 23/11/2026: a primeira venda já coloca a sua célula na disputa.",
    );
    expect(
      screen.queryByRole("heading", { name: "Na sua divisão" }),
    ).toBeNull();
    expect(ranking).toHaveTextContent("Ninguém vendeu ainda nesta disputa.");
  });

  it("antes do início, com a meta em centavos: a contagem, sem a meta", async () => {
    await abrirCenario({ fase: "antes", unidade: "centavos" });

    const destaque = regiao("Faltam 3 dias para começar");
    expect(destaque).not.toHaveTextContent("Meta da campanha");
  });

  it("antes da 1ª venda da célula (durante): a frase de incentivo no lugar da posição, e os primeiros continuam", async () => {
    await abrirCenario({ semVendas: true });

    const ranking = regiao("Ranking");
    expect(ranking).toHaveTextContent(
      "Falta só a primeira venda para a sua célula entrar na disputa. Compartilhe o seu link de afiliado com amigos e familiares!",
    );
    expect(
      screen.queryByRole("heading", { name: "Na sua divisão" }),
    ).toBeNull();
    expect(ranking).not.toHaveTextContent("12º de 12");
    expect(
      within(regiao("Os primeiros dos Jovens", 3)).getAllByRole("listitem"),
    ).toHaveLength(3);
  });

  it("discipulador sem células: a explicação no lugar do ranking, sem meta e sem curva", async () => {
    await abrirCenario({ papel: "discipulador", semCelulas: true });

    expect(regiao("Ranking")).toHaveTextContent(
      "Ainda não há células ligadas a você, por isso você ainda não aparece no ranking dos discipuladores.",
    );
    expect(
      screen.queryByRole("heading", { name: "Na sua divisão" }),
    ).toBeNull();
    expect(regiao("Meta da campanha")).toHaveTextContent("Sem meta");
    expect(regiao("Curva da campanha")).toHaveTextContent(
      "Ainda não há meta para desenhar a curva.",
    );
    expect(within(regiao("Curva da campanha")).queryByRole("img")).toBeNull();
    expect(regiao("Suas células")).toHaveTextContent(
      "Ainda não há células ligadas a você.",
    );
  });

  it("alvo sem meta (sem células), durante: o dia não aparece como coberto", async () => {
    await abrirCenario({ papel: "discipulador", semCelulas: true });

    const hoje = regiao("Hoje · 04/12", 3);
    expect(hoje).toHaveTextContent("Sem meta hoje");
    expect(hoje).toHaveTextContent("Vendidos hoje: 0 bilhetes.");
    expect(hoje).not.toHaveTextContent(/coberta/);
  });

  it("rede sem células: a explicação do ranking das redes", async () => {
    await abrirCenario({ papel: "rede", semCelulas: true });

    expect(regiao("Ranking")).toHaveTextContent(
      "Ainda não há células nesta rede, por isso ela ainda não aparece no ranking das redes.",
    );
  });

  it("depois do fim: pede a campanha inteira e mostra o resultado final", async () => {
    const api = criarApiFalsa(() => visaoDe({ fase: "encerrada" }));
    await abrir(visaoDe({ fase: "encerrada" }), { api });

    // A 1ª consulta (período atual) mostra que a campanha acabou: a tela pede de novo a campanha inteira.
    expect(
      api.chamadasA("GET", CAMINHO_VISAO).map((chamada) => chamada.caminho),
    ).toEqual([
      `${CAMINHO_VISAO}?periodo=atual`,
      `${CAMINHO_VISAO}?periodo=campanha`,
    ]);
    const destaque = regiao("Meta da campanha");
    expect(destaque).toHaveTextContent(
      "Campanha encerrada · Terminou em 16/12/2026.",
    );
    expect(destaque).toHaveTextContent("105%");
    expect(destaque).toHaveTextContent("Meta batida6 bilhetes acima da meta");
    expect(regiao("Ranking")).toHaveTextContent("Resultado final da campanha");
    expect(screen.queryByRole("heading", { name: /^Hoje/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Semana 2" })).toBeNull();
  });
});

describe("estados e atualização", () => {
  it("enquanto carrega: o cabeçalho (da sessão) e o carregando", async () => {
    let responder: ((resposta: Response) => void) | null = null;
    const visao = visaoDe();
    const api = criarApiFalsa(visao);
    api.proxima(
      "GET",
      CAMINHO_VISAO,
      () => new Promise<Response>((resolver) => (responder = resolver)),
    );
    vi.stubGlobal("fetch", api.fetch);
    renderizarRota("/minha", { usuario: sessaoDaVisao(visao) });

    // Desde o 1º quadro (enquanto o pacote da tela e a visão chegam): o cabeçalho da sessão e o carregando, com o
    // esqueleto dos dois cartões de cima (RIFA-051): os blocos são só visuais e o leitor de tela ouve um anúncio só.
    const conferirEsqueleto = () => {
      expect(
        screen.getByRole("heading", { level: 1, name: "Célula Ágape" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(
        "Carregando os seus números…",
      );
      const esqueleto = document.querySelector(".minha-moldura__esqueleto");
      expect(esqueleto?.querySelectorAll(".ui-esqueleto--cartao")).toHaveLength(
        2,
      );
      expect(
        esqueleto?.querySelector(
          ".ui-esqueleto--cartao.minha-moldura__esqueleto-destaque",
        ),
      ).not.toBeNull();
      const blocos = [
        ...(esqueleto?.querySelectorAll(".ui-esqueleto__bloco") ?? []),
      ];
      expect(blocos.length).toBeGreaterThanOrEqual(10);
      for (const bloco of blocos) {
        expect(bloco).toHaveAttribute("aria-hidden", "true");
        // Em rem (acompanha o tamanho do texto), direto ou como a reserva de uma variável do computador
        // (minha-moldura.css); o número grande, no clamp do font-size dele (minha-css.test.ts). Nada em px.
        const altura = (bloco as HTMLElement).style.height;
        expect(altura).toMatch(
          /^(\d+(\.\d+)?rem|var\(--minha-esqueleto-[a-z]+, \d+(\.\d+)?rem\)|clamp\(.+\))$/,
        );
        expect(altura).not.toMatch(/px/);
      }
      // A linha de texto de antes saiu.
      expect(document.querySelector(".ui-loading")).toBeNull();
    };
    conferirEsqueleto();
    await waitFor(() => expect(responder).not.toBeNull());
    conferirEsqueleto();
    await act(async () =>
      responder?.(new Response(JSON.stringify(visao), { status: 200 })),
    );
    expect(
      await screen.findByRole("heading", { level: 2, name: "Ranking" }),
    ).toBeInTheDocument();
    expect(document.querySelector(".minha-moldura__esqueleto")).toBeNull();
  });

  it("falha na primeira carga: o erro com 'Tentar de novo', que carrega", async () => {
    const visao = visaoDe();
    const api = criarApiFalsa(visao);
    api.proxima("GET", CAMINHO_VISAO, () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", api.fetch);
    renderizarRota("/minha", { usuario: sessaoDaVisao(visao) });

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent(
      "Não foi possível carregar os seus números.",
    );
    expect(alerta).toHaveTextContent(
      "A página tenta de novo sozinha a cada minuto.",
    );
    // Sem conexão (RIFA-051): o cartão neutro, sem o vermelho da falha de verdade, e a mensagem sem jargão.
    expect(alerta).toHaveClass("ui-estado--conexao");
    expect(alerta).not.toHaveClass("ui-estado--erro");
    expect(alerta).toHaveTextContent(MENSAGEM_SEM_CONEXAO);
    fireEvent.click(
      within(alerta).getByRole("button", { name: "Tentar de novo" }),
    );

    expect(
      await screen.findByRole("heading", { level: 2, name: "Ranking" }),
    ).toBeInTheDocument();
    expect(api.chamadasA("GET", CAMINHO_VISAO)).toHaveLength(2);
  });

  it("falha de verdade na primeira carga (500): o erro em vermelho, com 'Tentar de novo'", async () => {
    const visao = visaoDe();
    const api = criarApiFalsa(visao);
    api.proxima(
      "GET",
      CAMINHO_VISAO,
      respostaErro(500, "erro_interno", "Erro interno"),
    );
    vi.stubGlobal("fetch", api.fetch);
    renderizarRota("/minha", { usuario: sessaoDaVisao(visao) });

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent(
      "Não foi possível carregar os seus números.",
    );
    expect(alerta).toHaveClass("ui-estado--erro");
    expect(alerta).not.toHaveClass("ui-estado--conexao");
    expect(
      within(alerta).getByRole("button", { name: "Tentar de novo" }),
    ).toBeInTheDocument();
  });

  it("sem campanha ativa (404): explica que os números aparecem quando a campanha for ativada", async () => {
    const visao = visaoDe();
    const api = criarApiFalsa(visao);
    api.proxima(
      "GET",
      CAMINHO_VISAO,
      respostaErro(
        404,
        "nao_encontrado",
        "A campanha ainda não foi configurada",
      ),
    );
    vi.stubGlobal("fetch", api.fetch);
    renderizarRota("/minha", { usuario: sessaoDaVisao(visao) });

    expect(
      await screen.findByText("A campanha ainda não está ativa."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Os seus números aparecem aqui quando a coordenação ativar a campanha.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Célula Ágape" }),
    ).toBeInTheDocument();
  });

  it.each([
    [
      "discipulador",
      "A coordenação desligou o acesso de discipuladores por enquanto.",
    ],
    ["rede", "A coordenação desligou o acesso de redes por enquanto."],
  ] as const)(
    "403 acesso_desligado (%s, D20): o texto da coordenação no lugar dos números, sem sair da sessão; volta quando a chave volta",
    async (papel, texto) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const visao = visaoDe({ papel });
      const api = criarApiFalsa(visao);
      const desligado = () =>
        respostaJson(
          {
            erro: {
              codigo: "acesso_desligado",
              mensagem: "O acesso deste papel está desligado na campanha",
              detalhes: { papel },
            },
          },
          403,
        );
      api.proxima("GET", CAMINHO_VISAO, desligado);
      vi.stubGlobal("fetch", api.fetch);
      const { roteador } = renderizarRota("/minha", {
        usuario: sessaoDaVisao(visao),
      });

      const alerta = await screen.findByRole("alert");
      expect(alerta).toHaveTextContent(texto);
      expect(alerta).toHaveTextContent(
        "Os seus números voltam a aparecer aqui quando a coordenação ligar o acesso de novo. A página confere sozinha a cada minuto.",
      );
      expect(alerta).not.toHaveTextContent(/link/i);
      expect(
        screen.queryByRole("heading", { level: 2, name: "Ranking" }),
      ).not.toBeInTheDocument();
      expect(roteador.state.location.pathname).toBe("/minha");
      expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();

      // A chave volta: a próxima consulta (1 minuto depois) traz os números de novo.
      await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ATUALIZACAO_MS));
      expect(
        await screen.findByRole("heading", { level: 2, name: "Ranking" }),
      ).toBeInTheDocument();
      expect(screen.queryByText(texto)).not.toBeInTheDocument();

      // Desligada com a tela aberta: os números saem e o texto volta.
      api.proxima("GET", CAMINHO_VISAO, desligado);
      await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ATUALIZACAO_MS));
      expect(await screen.findByText(texto)).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { level: 2, name: "Ranking" }),
      ).not.toBeInTheDocument();
    },
  );

  it("atualiza sozinha a cada minuto; uma falha mantém os números e avisa; com a aba oculta, para", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = criarApiFalsa(visaoDe());
    await abrir(visaoDe(), { api });
    expect(screen.getByText(/Atualizado às 15:30\./)).toBeInTheDocument();
    const falha = document.querySelector(".minha-rodape__falha");
    expect(falha).toHaveAttribute("role", "status");
    expect(falha).toHaveTextContent("");

    api.proxima("GET", CAMINHO_VISAO, () => {
      throw new TypeError("Failed to fetch");
    });
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ATUALIZACAO_MS));
    expect(api.chamadasA("GET", CAMINHO_VISAO)).toHaveLength(2);
    await waitFor(() =>
      expect(falha).toHaveTextContent(
        "Não foi possível atualizar agora. A página tenta de novo em 1 minuto.",
      ),
    );
    expect(regiao("Meta da campanha")).toHaveTextContent("35%");

    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ATUALIZACAO_MS));
    expect(api.chamadasA("GET", CAMINHO_VISAO)).toHaveLength(3);
    await waitFor(() => expect(falha).toHaveTextContent(""));

    // Aba oculta: nada de consulta. Ao voltar, consulta na hora.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(() => vi.advanceTimersByTimeAsync(3 * INTERVALO_ATUALIZACAO_MS));
    expect(api.chamadasA("GET", CAMINHO_VISAO)).toHaveLength(3);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() =>
      expect(api.chamadasA("GET", CAMINHO_VISAO)).toHaveLength(4),
    );
    Reflect.deleteProperty(document, "visibilityState");
  });
});

describe("CA5: acessibilidade da visão", () => {
  it("um h1, seções com nome, barras com rótulo, o gráfico focável e a lista dos primeiros", async () => {
    await abrirCenario({ papel: "discipulador" });

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    for (const barra of screen.getAllByRole("progressbar")) {
      expect(barra).toHaveAccessibleName();
      expect(barra).toHaveAttribute("aria-valuetext");
    }
    for (const nome of ["Meta da campanha", "Hoje · 04/12", "Suas células"]) {
      expect(screen.getByRole("region", { name: nome })).toBeInTheDocument();
    }
    const grafico = screen.getByRole("img", {
      name: "Esperado e realizado acumulados por dia, em % da meta",
    });
    expect(grafico).toHaveAttribute("tabindex", "0");
    expect(
      within(regiao("Os primeiros dos Jovens", 3)).getByRole("list"),
    ).toBeInTheDocument();
    // A situação e a adesão fazem sentido sem a cor (texto).
    expect(screen.getAllByText("Não aderiu").length).toBeGreaterThan(0);
  });
});
