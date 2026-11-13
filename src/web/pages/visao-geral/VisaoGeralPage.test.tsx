import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TITULO_SEM_CONEXAO } from "../../components/ui";
import { MENSAGEM_SEM_CONEXAO } from "../../lib/api";
import { renderizarRota, respostaJson } from "../../test/renderizar";
import {
  CENARIOS,
  RESPOSTAS_DE_ERRO,
  resolverEscopo,
  resumoDoCenario,
  simularApi,
  type Cenario,
} from "./teste-apoio";
import { INTERVALO_ATUALIZACAO_MS } from "./usePainelResumo";

beforeEach(() => {
  // Só os temporizadores: as promessas e o agendador do React continuam reais.
  vi.useFakeTimers({
    shouldAdvanceTime: true,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "visibilityState");
});

/** Espera a consulta em andamento terminar (o texto volta de "Atualizando…" para "Atualizado às"). */
async function esperarAtualizacao() {
  await waitFor(() =>
    expect(screen.getByText(/^Atualizado às/)).toBeInTheDocument(),
  );
}

/** Abre /coordenacao (ou outro caminho) com a API simulada do cenário e espera o painel chegar. */
async function abrir(
  cenario: Cenario = CENARIOS.emDia,
  caminho = "/coordenacao",
) {
  const api = simularApi(cenario);
  const tela = renderizarRota(caminho);
  await esperarAtualizacao();
  return { api, ...tela };
}

function definirVisibilidade(estado: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => estado,
  });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

/** O cartão (Card) pelo título <h2>. */
function cartao(titulo: string | RegExp) {
  const cabecalho = screen.getByRole("heading", { level: 2, name: titulo });
  const elemento = cabecalho.closest<HTMLElement>(".ui-card");
  if (!elemento) throw new Error(`cartão ${String(titulo)} não encontrado`);
  return within(elemento);
}

/** O valor (dd) de um termo (dt) dentro de um cartão. */
function definicao(dentro: ReturnType<typeof within>, termo: string) {
  const dt = dentro.getByText(termo, { selector: "dt" });
  return dt.nextElementSibling?.textContent?.replace(/\s+/g, " ").trim();
}

const filtro = () => screen.getByRole("combobox", { name: "Filtrar por" });
const cabecalhoDaFase = (nome: string | RegExp) =>
  screen.getByRole("region", { name: nome });

describe("CA1: cabeçalho com a fase e o recorte", () => {
  it("em andamento: dia N de T, o período e quanto falta dele; o recorte atual; a hora da última atualização", async () => {
    await abrir(CENARIOS.emDia);

    const cabecalho = cabecalhoDaFase(
      "Dia 12 de 24 · Semana 2 (faltam 6 dias)",
    );
    expect(cabecalho).toHaveTextContent("Campanha toda: Rifa Videira Kids");
    expect(
      within(cabecalho).getByText(
        "Faltam 13 dias, contando hoje (até 16/12/2026).",
      ),
    ).toBeInTheDocument();
    expect(filtro()).toHaveDisplayValue("Campanha toda");
    // A hora vem da resposta (atualizado_em), no fuso de Belém.
    expect(
      screen.getByText("Atualizado às 15:30. Atualiza sozinho a cada 60 s."),
    ).toBeInTheDocument();
    expect(document.title).toBe("Visão geral · Rifa Videira Kids");
  });

  it("último dia: o período e a campanha no último dia", async () => {
    await abrir(CENARIOS.ultimoDia);

    const cabecalho = cabecalhoDaFase("Dia 24 de 24 · Semana 3 (último dia)");
    expect(cabecalho).toHaveTextContent(
      "Hoje é o último dia da campanha (16/12/2026).",
    );
  });

  it("antes do início: contagem regressiva, e amanhã na véspera", async () => {
    const { unmount } = await abrir(CENARIOS.antes);
    expect(cabecalhoDaFase("A campanha começa em 3 dias")).toHaveTextContent(
      "De 23/11/2026 a 16/12/2026: 24 dias de vendas.",
    );
    unmount();

    await abrir(CENARIOS.vespera);
    expect(cabecalhoDaFase("A campanha começa amanhã")).toBeInTheDocument();
  });

  it("encerrada", async () => {
    await abrir(CENARIOS.encerrada);

    expect(cabecalhoDaFase("Campanha encerrada")).toHaveTextContent(
      "Foi de 23/11/2026 a 16/12/2026 (24 dias de vendas).",
    );
  });

  it("recorte de uma célula: o tipo e o nome no cabeçalho e no filtro", async () => {
    await abrir(CENARIOS.emDia, "/coordenacao?escopo=celula&id=3");

    expect(cabecalhoDaFase(/^Dia 12 de 24/)).toHaveTextContent(
      "Célula: Célula Ficticia 03",
    );
    expect(filtro()).toHaveDisplayValue("Célula Ficticia 03");
  });
});

describe("CA2: cartões Hoje, Campanha e período", () => {
  it("em dia (dia 12): a meta de hoje desconta o que sobrou; a campanha em dia, com ritmo e projeção; a Semana 2, esperado × realizado", async () => {
    await abrir(CENARIOS.emDia);

    const hoje = cartao("Hoje · 04/12");
    expect(hoje.getByText("Meta de hoje")).toBeInTheDocument();
    expect(hoje.getByText("11 bilhetes")).toBeInTheDocument();
    expect(
      hoje.getByText(
        "12 bilhetes da curva de hoje − 1 bilhete que sobrou até ontem.",
      ),
    ).toBeInTheDocument();
    expect(
      hoje.getByRole("progressbar", {
        name: "Vendido hoje até agora: 5 bilhetes",
      }),
    ).toHaveAttribute("aria-valuetext", "45%");
    expect(
      hoje.getByText("Faltam 6 bilhetes para a meta de hoje."),
    ).toBeInTheDocument();

    const campanha = cartao("Campanha");
    expect(campanha.getByText("Do 1º dia até agora")).toBeInTheDocument();
    expect(campanha.getByText("Em dia")).toBeInTheDocument();
    expect(
      campanha.getByText("6 bilhetes acima do esperado até ontem"),
    ).toBeInTheDocument();
    expect(
      campanha.getByRole("progressbar", {
        name: "Realizado: 139 de 360 bilhetes",
      }),
    ).toHaveAttribute("aria-valuetext", "38%");
    expect(definicao(campanha, "Esperado até ontem")).toBe(
      "133 bilhetes (36% da meta)",
    );
    expect(definicao(campanha, "Ritmo")).toBe("101% do esperado até ontem");
    expect(definicao(campanha, "Projeção")).toBe(
      "No ritmo atual, chega a 101% da meta (364 bilhetes).",
    );
    // A coordenação vê o arrecadado em R$, mesmo com a meta em bilhetes.
    expect(definicao(campanha, "Vendas aprovadas")).toBe(
      "81 pedidos aprovados · 139 bilhetes · R$ 2.780,00",
    );

    const semana = cartao("Semana 2");
    expect(semana.getByText("Dia 2 de 7 · 03/12 a 09/12")).toBeInTheDocument();
    expect(semana.getByText("Em dia")).toBeInTheDocument();
    expect(
      semana.getByText("1 bilhete acima do esperado até ontem"),
    ).toBeInTheDocument();
    expect(definicao(semana, "Esperado até ontem")).toBe("13 bilhetes");
    expect(definicao(semana, "Realizado")).toBe("14 bilhetes");
    expect(
      semana.getByRole("progressbar", { name: "Meta do período: 86 bilhetes" }),
    ).toHaveAttribute("aria-valuetext", "16%");
    expect(
      semana.getByText("Ritmo do período: 73% do esperado até ontem."),
    ).toBeInTheDocument();

    // Os cartões seguem a ordem da leitura: hoje, a campanha e o período; o relatório para baixar no fim (RIFA-038).
    expect(
      screen
        .getAllByRole("heading", { level: 2 })
        .map((titulo) => titulo.textContent),
    ).toEqual([
      "Dia 12 de 24 · Semana 2 (faltam 6 dias)",
      "Hoje · 04/12",
      "Campanha",
      "Semana 2",
      "Para conferir",
      "Curva: esperado × realizado",
      "Relatório da campanha",
    ]);
  });

  it("abaixo do ritmo: a meta de hoje soma o que faltou; quanto falta para o esperado e para onde vai", async () => {
    await abrir(CENARIOS.abaixo);

    const hoje = cartao("Hoje · 04/12");
    expect(hoje.getByText("55 bilhetes")).toBeInTheDocument();
    expect(
      hoje.getByText(
        "12 bilhetes da curva de hoje + 43 bilhetes que faltaram até ontem.",
      ),
    ).toBeInTheDocument();
    expect(
      hoje.getByText("Faltam 51 bilhetes para a meta de hoje."),
    ).toBeInTheDocument();

    const campanha = cartao("Campanha");
    expect(campanha.getByText("Abaixo do esperado")).toBeInTheDocument();
    expect(
      campanha.getByText("Faltam 39 bilhetes para o esperado até ontem"),
    ).toBeInTheDocument();
    expect(definicao(campanha, "Ritmo")).toBe("68% do esperado até ontem");
    expect(definicao(campanha, "Projeção")).toBe(
      "No ritmo atual, chega a 68% da meta (245 bilhetes).",
    );

    const semana = cartao("Semana 2");
    expect(semana.getByText("Abaixo do esperado")).toBeInTheDocument();
    expect(
      semana.getByText("Falta 1 bilhete para o esperado até ontem"),
    ).toBeInTheDocument();
    expect(definicao(semana, "Realizado")).toBe("12 bilhetes");
  });

  it("1º dia: a meta de hoje é a parte da curva; sem ritmo nem projeção ainda", async () => {
    await abrir(CENARIOS.primeiroDia);

    const hoje = cartao("Hoje · 23/11");
    expect(hoje.getByText("12 bilhetes")).toBeInTheDocument();
    expect(hoje.getByText("É a parte da curva de hoje.")).toBeInTheDocument();

    const campanha = cartao("Campanha");
    expect(campanha.getByText("1º dia de vendas")).toBeInTheDocument();
    expect(definicao(campanha, "Projeção")).toBe(
      "Sem projeção ainda: ela aparece depois do 1º dia fechado.",
    );
    expect(campanha.queryByText("Ritmo", { selector: "dt" })).toBeNull();
    expect(
      campanha.queryByText("Esperado até ontem", { selector: "dt" }),
    ).toBeNull();

    const semana = cartao("Semana 1");
    expect(semana.getByText("1º dia de Semana 1")).toBeInTheDocument();
    expect(
      semana.getByText("O ritmo do período aparece depois do 1º dia dele."),
    ).toBeInTheDocument();
  });

  it("último dia: a meta de hoje é tudo o que falta", async () => {
    await abrir(CENARIOS.ultimoDia);

    const hoje = cartao("Hoje · 16/12");
    expect(hoje.getByText("58 bilhetes")).toBeInTheDocument();
    expect(
      hoje.getByText(
        "Último dia: a meta de hoje é tudo o que falta para a meta da campanha.",
      ),
    ).toBeInTheDocument();
    expect(
      hoje.getByText("Faltam 46 bilhetes para a meta de hoje."),
    ).toBeInTheDocument();
    expect(
      cartao("Semana 3").getByText("Dia 7 de 7 · 10/12 a 16/12"),
    ).toBeInTheDocument();
  });

  it("meta de hoje já coberta pela sobra (divisão Jovens): nada a cobrar, só o vendido hoje", async () => {
    await abrir(CENARIOS.emDia, "/coordenacao?escopo=divisao&divisao=jovens");

    const hoje = cartao("Hoje · 04/12");
    expect(hoje.getByText("0 bilhetes")).toBeInTheDocument();
    expect(
      hoje.getByText(
        "O que sobrou até ontem já cobre a curva de hoje (7 bilhetes).",
      ),
    ).toBeInTheDocument();
    expect(
      hoje.getByText("Vendido hoje até agora: 2 bilhetes"),
    ).toBeInTheDocument();
    expect(hoje.queryByRole("progressbar")).toBeNull();
    expect(hoje.queryByText(/para a meta de hoje/)).toBeNull();
  });

  it("antes do início: só o cartão da campanha, com a meta e sem números de ritmo", async () => {
    await abrir(CENARIOS.antes);

    expect(screen.queryByRole("heading", { name: /^Hoje/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: /^Semana/ })).toBeNull();
    const campanha = cartao("Campanha");
    expect(campanha.getByText("Começa em 23/11")).toBeInTheDocument();
    expect(campanha.getByText("Ainda não começou")).toBeInTheDocument();
    expect(campanha.getByText("Meta: 360 bilhetes")).toBeInTheDocument();
    expect(definicao(campanha, "Projeção")).toBe(
      "A projeção aparece depois do 1º dia de vendas.",
    );
    expect(campanha.queryByRole("progressbar")).toBeNull();
    expect(campanha.queryByText("Vendas aprovadas")).toBeNull();
  });

  it("encerrada: o resultado contra a meta", async () => {
    await abrir(CENARIOS.encerrada);

    expect(screen.queryByRole("heading", { name: /^Hoje/ })).toBeNull();
    const campanha = cartao("Campanha");
    expect(campanha.getByText("Do 1º ao último dia")).toBeInTheDocument();
    expect(campanha.getByText("Meta batida")).toBeInTheDocument();
    expect(campanha.getByText("27 bilhetes acima da meta")).toBeInTheDocument();
    expect(definicao(campanha, "Resultado")).toBe(
      "Resultado final: 107% da meta (387 bilhetes).",
    );
    expect(
      campanha.getByRole("progressbar", {
        name: "Realizado: 387 de 360 bilhetes",
      }),
    ).toHaveAttribute("aria-valuetext", "107%");
  });

  it("avisos discretos só com algo a avisar: vendas sem célula (com o caminho para Adesão) e fora da janela", async () => {
    const { unmount } = await abrir(CENARIOS.emDia);
    const avisos = screen.getByRole("region", { name: "Para conferir" });
    const itens = within(avisos).getAllByRole("listitem");
    expect(itens.map((item) => item.textContent)).toEqual([
      "3 bilhetes (2 pedidos) sem célula: contam na campanha, mas em nenhuma divisão, rede ou célula. Vincule os afiliados em Adesão.",
      "1 bilhete (1 pedido) antes do início: não conta em nada (ex.: compra de teste na reunião de cadastro).",
    ]);
    // RIFA-051: o "i" de cada aviso é o Icone (só visual), não um caractere.
    for (const item of itens) {
      const icone = item.querySelector("svg");
      expect(icone).toHaveAttribute("data-icone", "info");
      expect(icone).toHaveAttribute("aria-hidden", "true");
    }
    expect(
      within(avisos).getByRole("link", { name: "Adesão" }),
    ).toHaveAttribute("href", "/coordenacao/adesao");
    // Discretos: não interrompem o leitor de tela a cada atualização.
    expect(within(avisos).queryByRole("alert")).toBeNull();
    unmount();

    const encerrada = await abrir(CENARIOS.encerrada);
    expect(
      within(screen.getByRole("region", { name: "Para conferir" })).getByText(
        "2 bilhetes (1 pedido) depois do fim",
      ),
    ).toBeInTheDocument();
    encerrada.unmount();

    // Nada a avisar: a seção não aparece.
    await abrir(CENARIOS.primeiroDia);
    expect(screen.queryByRole("region", { name: "Para conferir" })).toBeNull();
  });

  it("meta em R$: os valores saem em reais, pelos formatadores", async () => {
    await abrir(CENARIOS.emReais);

    const hoje = cartao("Hoje · 04/12");
    expect(hoje.getByText("R$ 209,80")).toBeInTheDocument();
    expect(
      hoje.getByText(
        "R$ 244,90 da curva de hoje − R$ 35,10 que sobraram até ontem.",
      ),
    ).toBeInTheDocument();
    expect(
      hoje.getByRole("progressbar", {
        name: /^Vendido hoje até agora: R\$\s100,00$/,
      }),
    ).toHaveAttribute("aria-valuetext", "47%");
    expect(
      hoje.getByText("Faltam R$ 109,80 para a meta de hoje."),
    ).toBeInTheDocument();
    expect(hoje.queryByText(/bilhete/)).toBeNull();

    const campanha = cartao("Campanha");
    expect(
      campanha.getByText("R$ 135,10 acima do esperado até ontem"),
    ).toBeInTheDocument();
    expect(
      campanha.getByRole("progressbar", {
        name: /^Realizado: R\$\s2\.780,00 de R\$\s7\.200,00$/,
      }),
    ).toBeInTheDocument();
    expect(definicao(campanha, "Esperado até ontem")).toBe(
      "R$ 2.644,90 (36% da meta)",
    );
    expect(definicao(campanha, "Projeção")).toBe(
      "No ritmo atual, chega a 101% da meta (R$ 7.295,55).",
    );
    expect(
      within(screen.getByRole("region", { name: "Para conferir" })).getByText(
        "R$ 60,00 (2 pedidos) sem célula",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Acumulado por dia, em R$.")).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "Esperado e realizado acumulados por dia, em R$",
      }),
    ).toBeInTheDocument();
  });
});

describe("RIFA-051 (P3.5 e P3.6): a cara dos cartões", () => {
  it("cada cartão com o ícone antes do título (só visual: o nome do título não muda)", async () => {
    await abrir(CENARIOS.emDia);
    const titulos = [
      ["Hoje · 04/12", "calendario"],
      ["Campanha", "campanha"],
      ["Semana 2", "periodo"],
      ["Curva: esperado × realizado", "grafico"],
      ["Relatório da campanha", "documento"],
    ] as const;
    // RIFA-053: nenhum ícone repetido entre os cartões da tela.
    expect(new Set(titulos.map(([, icone]) => icone)).size).toBe(
      titulos.length,
    );
    // O botão do relatório continua com o de baixar.
    expect(
      screen
        .getByRole("button", { name: "Baixar relatório" })
        .querySelector("svg"),
    ).toHaveAttribute("data-icone", "baixar");
    for (const [titulo, icone] of titulos) {
      const cabecalho = screen.getByRole("heading", { level: 2, name: titulo });
      const desenho = cabecalho.querySelector("svg");
      expect(desenho, titulo).toHaveAttribute("data-icone", icone);
      expect(desenho, titulo).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("a meta de hoje é o Stat grande (a cara única dos números), com o mesmo rótulo e o mesmo valor", async () => {
    await abrir(CENARIOS.emDia);
    const rotulo = cartao("Hoje · 04/12").getByText("Meta de hoje");
    const stat = rotulo.closest(".ui-stat");
    expect(stat).toHaveClass("ui-stat--grande");
    expect(stat?.querySelector(".ui-stat__valor")).toHaveTextContent(
      /^11 bilhetes$/,
    );
  });
});

describe("CA3: curva esperado × realizado", () => {
  it("SVG com título e descrição, legenda, rótulos só no fim das linhas e a tabela com um dia por linha", async () => {
    const { container } = await abrir(CENARIOS.emDia);

    const grafico = screen.getByRole("img", {
      name: "Esperado e realizado acumulados por dia, em bilhetes",
    });
    expect(grafico).toHaveAccessibleDescription(
      /^O esperado acumulado sobe de 23\/11\/2026 a 16\/12\/2026, até a meta de 360 bilhetes\. Até hoje, dia 12 \(04\/12\/2026\), o realizado é 139 bilhetes; o esperado até ontem era 133 bilhetes: em dia\./,
    );
    expect(
      within(screen.getByRole("list", { name: "Legenda" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Realizado", "Esperado pela curva"]);
    expect(
      [...container.querySelectorAll(".ui-grafico__rotulo")].map(
        (rotulo) => rotulo.textContent,
      ),
    ).toEqual(["139", "Meta 360"]);

    const detalhes = screen
      .getByText("Ver os dados em tabela")
      .closest("details");
    if (!detalhes) throw new Error("sem tabela");
    detalhes.open = true;
    const tabela = screen.getByRole("table", {
      name: "Esperado e realizado acumulados por dia, em bilhetes",
    });
    const linhas = within(tabela).getAllByRole("row").slice(1);
    expect(linhas).toHaveLength(24);
    const hoje = linhas[11];
    expect(hoje).toHaveAttribute("aria-current", "true");
    expect(within(hoje).getByRole("rowheader")).toHaveTextContent(
      "Dia 12 · 04/12/2026 (hoje)",
    );
    expect(
      within(hoje)
        .getAllByRole("cell")
        .map((celula) => celula.textContent),
    ).toEqual(["139", "145", "5"]);
    expect(within(linhas[12]).getAllByRole("cell")[0]).toHaveTextContent(
      "sem dado",
    );
    expect(within(linhas[23]).getAllByRole("cell")[1]).toHaveTextContent("360");
  });

  it("no teclado, as setas percorrem os dias e o leitor de tela ouve os valores", async () => {
    const { container } = await abrir(CENARIOS.emDia);
    const grafico = screen.getByRole("img", { name: /^Esperado e realizado/ });
    const anuncio = () => container.querySelector("[aria-live]")?.textContent;

    fireEvent.focus(grafico);
    expect(anuncio()).toBe(
      "Dia 12 · 04/12/2026 (hoje): Realizado 139; Esperado pela curva 145; Vendido no dia 5.",
    );
    fireEvent.keyDown(grafico, { key: "ArrowLeft" });
    expect(anuncio()).toBe(
      "Dia 11 · 03/12/2026: Realizado 134; Esperado pela curva 133; Vendido no dia 9.",
    );
  });

  it("antes do início: só a curva esperada, sem rótulo de realizado", async () => {
    const { container } = await abrir(CENARIOS.antes);

    expect(
      screen.getByRole("img", { name: /^Esperado e realizado/ }),
    ).toHaveAccessibleDescription(/As vendas ainda não começaram\./);
    expect(
      [...container.querySelectorAll(".ui-grafico__rotulo")].map(
        (rotulo) => rotulo.textContent,
      ),
    ).toEqual(["Meta 360"]);
  });
});

describe("CA4: filtro do recorte e atualização", () => {
  it("as opções: a campanha toda, as divisões e, a partir das células, as redes, os discipuladores e as células, em ordem de nome", async () => {
    await abrir();

    await waitFor(() =>
      expect(within(filtro()).getAllByRole("option")).toHaveLength(10),
    );
    expect(within(filtro()).getAllByRole("option")[0]).toHaveTextContent(
      "Campanha toda",
    );
    expect(
      within(filtro())
        .getAllByRole("group")
        .map((grupo) => [
          grupo.getAttribute("label"),
          within(grupo)
            .getAllByRole("option")
            .map((opcao) => opcao.textContent),
        ]),
    ).toEqual([
      ["Divisão", ["Jovens", "Adultos"]],
      ["Rede", ["Rede Adulta Ficticia", "Rede Jovem Ficticia"]],
      ["Discipulador", ["Discipulador Ficticio A", "Discipulador Ficticio B"]],
      [
        "Célula",
        ["Célula Ficticia 01", "Célula Ficticia 02", "Célula Ficticia 03"],
      ],
    ]);
  });

  it("escolher a divisão Jovens: a URL e a consulta mudam, o painel mostra a divisão (sem os avisos da campanha) e a região viva avisa", async () => {
    const { api, roteador } = await abrir();

    fireEvent.change(filtro(), {
      target: { value: "escopo=divisao&divisao=jovens" },
    });

    await waitFor(() =>
      expect(cabecalhoDaFase(/^Dia 12 de 24/)).toHaveTextContent(
        "Divisão: Jovens",
      ),
    );
    expect(roteador.state.location.pathname).toBe("/coordenacao");
    expect(roteador.state.location.search).toBe(
      "?escopo=divisao&divisao=jovens",
    );
    expect(api.chamadas.at(-1)).toBe(
      "/api/painel/resumo?escopo=divisao&divisao=jovens",
    );
    expect(
      cartao("Campanha").getByRole("progressbar", {
        name: "Realizado: 88 de 210 bilhetes",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Para conferir" })).toBeNull();
    expect(screen.getByText("Mostrando Divisão: Jovens.")).toHaveAttribute(
      "role",
      "status",
    );

    // De volta à campanha toda: a URL fica sem consulta.
    fireEvent.change(filtro(), { target: { value: "" } });
    await waitFor(() =>
      expect(cabecalhoDaFase(/^Dia 12 de 24/)).toHaveTextContent(
        "Campanha toda: Rifa Videira Kids",
      ),
    );
    expect(roteador.state.location.search).toBe("");
    expect(api.chamadas.at(-1)).toBe("/api/painel/resumo");
  });

  it("escolher uma rede, um discipulador e uma célula", async () => {
    const { api, roteador } = await abrir();
    await waitFor(() =>
      expect(within(filtro()).getAllByRole("option")).toHaveLength(10),
    );

    for (const [valor, rotulo] of [
      ["escopo=rede&id=2", "Rede: Rede Adulta Ficticia"],
      ["escopo=discipulador&id=1", "Discipulador: Discipulador Ficticio A"],
      ["escopo=celula&id=2", "Célula: Célula Ficticia 02"],
    ]) {
      fireEvent.change(filtro(), { target: { value: valor } });
      await waitFor(() =>
        expect(cabecalhoDaFase(/^Dia 12 de 24/)).toHaveTextContent(rotulo),
      );
      expect(roteador.state.location.search).toBe(`?${valor}`);
      expect(api.chamadas.at(-1)).toBe(`/api/painel/resumo?${valor}`);
    }
  });

  it("abrir com o recorte na URL consulta esse recorte; um recorte inválido vira a campanha toda", async () => {
    const { api, unmount } = await abrir(
      CENARIOS.emDia,
      "/coordenacao?escopo=celula&id=3",
    );
    expect(api.chamadas).toContain("/api/painel/resumo?escopo=celula&id=3");
    expect(
      cartao("Campanha").getByText(
        "Faltam 8 bilhetes para o esperado até ontem",
      ),
    ).toBeInTheDocument();
    unmount();

    const invalido = await abrir(
      CENARIOS.emDia,
      "/coordenacao?escopo=celula&id=abc",
    );
    expect(invalido.api.chamadas).toContain("/api/painel/resumo");
    expect(
      invalido.api.chamadas.filter((caminho) => caminho.includes("escopo=")),
    ).toEqual([]);
    expect(filtro()).toHaveDisplayValue("Campanha toda");
  });

  it("trocando o recorte, o quadro anterior fica (esmaecido e ocupado) até chegar o novo", async () => {
    const { api } = await abrir();
    let liberar: (resposta: Response) => void = () => {};
    api.resumo = (url) =>
      url.search.includes("jovens")
        ? new Promise<Response>((resolver) => {
            liberar = resolver;
          })
        : undefined;

    fireEvent.change(filtro(), {
      target: { value: "escopo=divisao&divisao=jovens" },
    });

    const painel = cabecalhoDaFase(/^Dia 12 de 24/).parentElement;
    expect(painel).toHaveAttribute("aria-busy", "true");
    expect(painel).toHaveAttribute("data-trocando");
    expect(cabecalhoDaFase(/^Dia 12 de 24/)).toHaveTextContent("Campanha toda");
    expect(screen.getByText(/^Atualizando…/)).toBeInTheDocument();

    const jovens = resolverEscopo(
      new URLSearchParams("escopo=divisao&divisao=jovens"),
    );
    if (!jovens) throw new Error("escopo");
    await act(async () => {
      liberar(respostaJson(resumoDoCenario(CENARIOS.emDia, jovens)));
    });
    await waitFor(() =>
      expect(cabecalhoDaFase(/^Dia 12 de 24/)).toHaveTextContent(
        "Divisão: Jovens",
      ),
    );
    expect(cabecalhoDaFase(/^Dia 12 de 24/).parentElement).not.toHaveAttribute(
      "aria-busy",
    );
  });

  it("atualiza sozinho a cada 60 s com a aba visível, para com a aba oculta e volta na hora; o botão Atualizar consulta já", async () => {
    const { api } = await abrir();
    expect(api.consultasAoResumo).toBe(1);

    // O relógio falso também anda com o tempo real: a margem de 2 s cobre a duração do teste.
    await act(() =>
      vi.advanceTimersByTimeAsync(INTERVALO_ATUALIZACAO_MS - 2000),
    );
    expect(api.consultasAoResumo).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(api.consultasAoResumo).toBe(2);
    await esperarAtualizacao();

    definirVisibilidade("hidden");
    await act(() => vi.advanceTimersByTimeAsync(4 * INTERVALO_ATUALIZACAO_MS));
    expect(api.consultasAoResumo).toBe(2);

    definirVisibilidade("visible");
    expect(api.consultasAoResumo).toBe(3);
    await esperarAtualizacao();

    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    expect(api.consultasAoResumo).toBe(4);
    await esperarAtualizacao();
    // O ritmo recomeça a contar do "Atualizar".
    await act(() =>
      vi.advanceTimersByTimeAsync(INTERVALO_ATUALIZACAO_MS - 2000),
    );
    expect(api.consultasAoResumo).toBe(4);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(api.consultasAoResumo).toBe(5);
  });

  it("uma atualização que falha não apaga a tela: avisa e a próxima volta ao normal", async () => {
    const { api } = await abrir();
    api.resumo = () => {
      api.resumo = undefined;
      return RESPOSTAS_DE_ERRO.interno();
    };

    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ATUALIZACAO_MS));

    expect(
      await screen.findByText(
        "A última atualização falhou: Erro interno. Tente de novo em instantes. Os dados são das 15:30; tentando de novo sozinho.",
      ),
    ).toHaveAttribute("role", "status");
    expect(cartao("Campanha").getByText("Em dia")).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ATUALIZACAO_MS));
    await waitFor(() =>
      expect(
        screen.queryByText(/^A última atualização falhou/),
      ).not.toBeInTheDocument(),
    );
  });

  it("sem a lista de células, o filtro avisa e oferece a campanha e as divisões; o Atualizar busca a lista de novo", async () => {
    const api = simularApi(CENARIOS.emDia);
    api.celulas = () => {
      api.celulas = undefined;
      return RESPOSTAS_DE_ERRO.interno();
    };
    renderizarRota("/coordenacao");
    await esperarAtualizacao();

    expect(
      await screen.findByText(
        /^Não foi possível carregar as redes e as células\./,
      ),
    ).toBeInTheDocument();
    expect(within(filtro()).getAllByRole("option")).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await waitFor(() =>
      expect(within(filtro()).getAllByRole("option")).toHaveLength(10),
    );
    expect(
      screen.queryByText(/^Não foi possível carregar as redes/),
    ).not.toBeInTheDocument();
  });
});

describe("CA5: estados", () => {
  it("carregando", async () => {
    const api = simularApi(CENARIOS.emDia);
    api.resumo = () => new Promise<Response>(() => {});
    renderizarRota("/coordenacao");

    expect(await screen.findByText("Carregando o painel…")).toHaveAttribute(
      "role",
      "status",
    );
    // RIFA-053 (D25): o esqueleto no formato do painel (a referência, os três cartões na grade deles e a curva), só
    // visual, com um anúncio só; nada da linha de "carregando" de antes.
    const esqueleto = document.querySelector(".visao-painel.visao-esqueleto");
    expect(esqueleto).not.toBeNull();
    const cartoes = esqueleto?.querySelectorAll(
      ".visao-cartoes > .ui-esqueleto.ui-esqueleto--cartao",
    );
    expect(cartoes).toHaveLength(3);
    expect(
      esqueleto?.querySelectorAll(":scope > .ui-esqueleto--cartao"),
    ).toHaveLength(1);
    for (const bloco of esqueleto?.querySelectorAll(".ui-esqueleto__bloco") ??
      [])
      expect(bloco).toHaveAttribute("aria-hidden", "true");
    expect(
      [...document.querySelectorAll('[role="status"]')].filter((regiao) =>
        /Carregando/.test(regiao.textContent ?? ""),
      ),
    ).toHaveLength(1);
    expect(document.querySelector(".ui-loading")).toBeNull();
  });

  it("erro: a mensagem e Tentar de novo, que volta a carregar", async () => {
    const api = simularApi(CENARIOS.emDia);
    api.resumo = () => {
      api.resumo = undefined;
      return RESPOSTAS_DE_ERRO.interno();
    };
    renderizarRota("/coordenacao");

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Não foi possível carregar os dados.");
    expect(alerta).toHaveTextContent(
      "Erro interno. Tente de novo em instantes.",
    );
    // Falha de verdade (a API respondeu com erro): o vermelho continua (RIFA-051).
    expect(alerta).toHaveClass("ui-estado--erro");

    fireEvent.click(
      within(alerta).getByRole("button", { name: "Tentar de novo" }),
    );
    await esperarAtualizacao();
    expect(cartao("Campanha").getByText("Em dia")).toBeInTheDocument();
  });

  it("RIFA-051 (P3.6): sem conexão, a falha fica neutra ('Sem conexão agora', sem o vermelho) e Tentar de novo volta a carregar", async () => {
    const api = simularApi(CENARIOS.emDia);
    api.resumo = () => {
      api.resumo = undefined;
      throw new TypeError("Failed to fetch");
    };
    renderizarRota("/coordenacao");

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveClass("ui-estado--conexao");
    expect(alerta).not.toHaveClass("ui-estado--erro");
    expect(alerta).toHaveTextContent(TITULO_SEM_CONEXAO);
    expect(alerta).toHaveTextContent(MENSAGEM_SEM_CONEXAO);

    fireEvent.click(
      within(alerta).getByRole("button", { name: "Tentar de novo" }),
    );
    await esperarAtualizacao();
    expect(cartao("Campanha").getByText("Em dia")).toBeInTheDocument();
  });

  it("404 sem campanha ativa: 'Ative a campanha em Campanha', com o link", async () => {
    const api = simularApi(CENARIOS.emDia);
    api.resumo = () => RESPOSTAS_DE_ERRO.semCampanha();
    renderizarRota("/coordenacao");

    const titulo = await screen.findByText("Nenhuma campanha ativa");
    const estado = titulo.closest<HTMLElement>(".ui-estado");
    if (!estado) throw new Error("sem estado vazio");
    expect(estado).toHaveTextContent(
      "Ative a campanha em Campanha para acompanhar o ritmo das vendas aqui.",
    );
    expect(
      within(estado).getByRole("link", { name: "Campanha" }),
    ).toHaveAttribute("href", "/coordenacao/campanha");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("404 num recorte que não existe: avisa e leva à campanha toda", async () => {
    simularApi(CENARIOS.emDia);
    const { roteador } = renderizarRota("/coordenacao?escopo=celula&id=99");

    expect(
      await screen.findByText("Não encontramos este recorte"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Célula não encontrada. O item pode ter saído da hierarquia.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Ver a campanha toda" }),
    );
    await esperarAtualizacao();
    expect(roteador.state.location.search).toBe("");
    expect(cabecalhoDaFase(/^Dia 12 de 24/)).toHaveTextContent("Campanha toda");
  });

  it("vazio antes da 1ª venda: antes do início e durante, com os cartões e a curva esperada", async () => {
    const { unmount } = await abrir(CENARIOS.antes);
    expect(screen.getByText("Nenhuma venda ainda")).toBeInTheDocument();
    expect(
      screen.getByText(
        "As vendas contam a partir de 23/11/2026, o 1º dia da campanha.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /^Esperado e realizado/ }),
    ).toBeInTheDocument();
    unmount();

    await abrir(CENARIOS.semVendas);
    expect(screen.getByText("Nenhuma venda ainda")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Assim que o primeiro pedido for aprovado na Rifei, ele aparece aqui.",
      ),
    ).toBeInTheDocument();
    // A meta de hoje continua na tela: é o que mais importa sem vendas.
    expect(cartao("Hoje · 27/11").getByText("60 bilhetes")).toBeInTheDocument();
  });
});
