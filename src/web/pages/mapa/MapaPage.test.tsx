// RIFA-015: /coordenacao/mapa (coordenação, com valores), pela rota de verdade e com a API falsa de teste-apoio.ts
// (toda resposta passa pelo respostaMapaDddSchema, com as invariantes de soma; toda consulta, pelo schema da rota).
// O CSS (a cor de cada faixa, o contraste e os 390 px) é conferido em mapa-css.test.ts; a medida na tela de
// verdade, nas capturas do Playwright.
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UsuarioSessao } from "../../../shared/contracts";
import { respostaMapaDddSchema } from "../../../shared/contracts/api";
import { UFS } from "../../../shared/contracts/ddd";
import {
  ADMIN_DE_TESTE,
  USUARIO_DE_TESTE,
  renderizarRota,
  respostaJson,
} from "../../test/renderizar";
import { DISCIPULADOR, LIDER, REDE } from "../minha/teste-apoio";
import {
  JANELA_SEMANA_2,
  SEM_CAMPANHA,
  mapaDasFaixas,
  mapaDeBelem,
  mapaSemVendas,
  respostaErro,
  simularApi,
} from "./teste-apoio";

const CAMINHO = "/coordenacao/mapa";

function abrir(caminho = CAMINHO, usuario: UsuarioSessao = USUARIO_DE_TESTE) {
  return renderizarRota(caminho, { usuario });
}

const mapa = () =>
  screen.findByRole("group", { name: "Mapa das vendas por estado" });

/** O quadrado de uma UF (o botão, pelo data-uf que o teste lê do rótulo: a sigla é aria-hidden). */
async function quadrado(uf: string) {
  const botoes = within(await mapa()).getAllByRole("button");
  const achado = botoes.find((botao) => botao.textContent === uf);
  if (!achado) throw new Error(`UF ${uf} fora do mapa`);
  return achado;
}

const tabelaDdd = () =>
  screen.findByRole("table", {
    name: "Vendas por DDD, com exterior, sem DDD e o total",
  });

/** As linhas de dados de uma tabela (sem a do cabeçalho). */
function linhasDe(tabela: HTMLElement) {
  const [, corpo] = within(tabela).getAllByRole("rowgroup");
  return within(corpo).getAllByRole("row");
}

/** Os textos das células de uma linha (o espaço não separável do "R$" vira espaço comum). */
const celulas = (linha: HTMLElement) =>
  within(linha)
    .getAllByRole("cell")
    .map((celula) => (celula.textContent ?? "").replace(/\u00a0/g, " "));

/** O quadro do mapa (os números do estado escolhido). */
const quadro = () => {
  const elemento = document.querySelector(".mapa-quadro");
  if (!(elemento instanceof HTMLElement)) throw new Error("sem o quadro");
  return elemento;
};

const textoDoQuadro = () =>
  (quadro().textContent ?? "").replace(/\u00a0/g, " ");

/** A região viva fixa da tela (anuncia o resultado de cada consulta). */
const anuncio = () =>
  screen
    .getAllByRole("status")
    .find((elemento) => elemento.classList.contains("visualmente-oculto"));

const NBSP = "\u00a0";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CA1: o mapa pinta cada UF pela parte dos bilhetes", () => {
  it("cada UF fica na faixa da sua parte; quem vendeu 1 bilhete fica na 1, e a UF sem venda fica neutra", async () => {
    simularApi(() => respostaJson(mapaDasFaixas()));
    abrir();

    const botoes = within(await mapa()).getAllByRole("button");
    expect(botoes.map((botao) => botao.textContent).sort()).toEqual(
      [...UFS].sort(),
    );
    const esperado: Record<string, string> = {
      PA: "5", // 65%
      SP: "4", // 20%
      DF: "3", // 8%
      AM: "2", // 3%
      MA: "1", // 0,5%
      RS: "1", // 1 bilhete de 10.000 (0,01%)
    };
    for (const botao of botoes) {
      const uf = botao.textContent ?? "";
      expect(botao.getAttribute("data-faixa"), uf).toBe(esperado[uf] ?? "0");
    }
  });

  it("cada UF tem o rótulo acessível com o nome e os números (sem venda, diz que não vendeu)", async () => {
    simularApi(() => respostaJson(mapaDasFaixas()));
    abrir();

    expect(await quadrado("PA")).toHaveAttribute(
      "aria-label",
      `Pará: 2.170 pedidos aprovados, 6.500 bilhetes, R$${NBSP}65.000,00, 65,0% dos bilhetes`,
    );
    expect(await quadrado("RS")).toHaveAttribute(
      "aria-label",
      `Rio Grande do Sul: 1 pedido aprovado, 1 bilhete, R$${NBSP}10,00, menos de 0,1% dos bilhetes`,
    );
    expect(await quadrado("TO")).toHaveAttribute(
      "aria-label",
      "Tocantins: sem venda",
    );
    // O nome acessível é o rótulo (a sigla visível é aria-hidden).
    expect(
      within(await mapa()).getByRole("button", { name: /^São Paulo: 700/ }),
    ).toBe(await quadrado("SP"));
  });

  it("o quadro começa no estado que mais vendeu e troca no mouse, no foco e no toque", async () => {
    simularApi(() => respostaJson(mapaDasFaixas()));
    abrir();

    const pa = await quadrado("PA");
    expect(pa).toHaveAttribute("data-ativa");
    expect(textoDoQuadro()).toBe(
      "Pará65,0% dos bilhetes2.170 pedidos aprovados6.500 bilhetesR$ 65.000,00",
    );
    expect(quadro()).toHaveAttribute("data-faixa", "5");

    fireEvent.pointerEnter(await quadrado("SP"));
    expect(textoDoQuadro()).toContain("São Paulo20,0% dos bilhetes");
    expect(await quadrado("SP")).toHaveAttribute("data-ativa");
    expect(pa).not.toHaveAttribute("data-ativa");

    act(() => pa.focus());
    expect(textoDoQuadro()).toContain("Pará65,0%");

    fireEvent.click(await quadrado("TO"));
    expect(textoDoQuadro()).toBe("TocantinsSem venda aprovada.");
    expect(quadro()).toHaveAttribute("data-faixa", "0");
  });

  it("a legenda diz o que cada cor quer dizer, e a tabela dos estados tem os mesmos números do mapa", async () => {
    simularApi(() => respostaJson(mapaDasFaixas()));
    abrir();
    await mapa();

    const legenda = screen.getByText("Parte dos bilhetes do estado")
      .parentElement as HTMLElement;
    expect(
      within(legenda)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Sem venda",
      "Menos de 1%",
      "1% a 5%",
      "5% a 15%",
      "15% a 40%",
      "40% ou mais",
    ]);

    const tabela = screen.getByRole("table", {
      name: "Vendas por estado, do que mais vendeu bilhetes para o que menos vendeu",
    });
    expect(linhasDe(tabela).map(celulas)).toEqual([
      ["Pará (PA)", "2.170", "6.500", "R$ 65.000,00", "65,0%"],
      ["São Paulo (SP)", "700", "2.000", "R$ 20.000,00", "20,0%"],
      ["Distrito Federal (DF)", "300", "800", "R$ 8.000,00", "8,0%"],
      ["Amazonas (AM)", "100", "300", "R$ 3.000,00", "3,0%"],
      ["Maranhão (MA)", "20", "50", "R$ 500,00", "0,5%"],
      ["Rio Grande do Sul (RS)", "1", "1", "R$ 10,00", "menos de 0,1%"],
    ]);
    expect(
      screen.getByText(/^Sem venda \(21 estados\): Acre, Alagoas, Amapá, /),
    ).toHaveTextContent(/Sergipe e Tocantins\.$/);
  });
});

describe("CA2: a lista por DDD, na ordem da API", () => {
  it("os DDDs na ordem da API, depois exterior, sem DDD e o total, com R$ formatado", async () => {
    const resposta = mapaDeBelem();
    simularApi(() => respostaJson(resposta));
    abrir();

    const linhas = linhasDe(await tabelaDdd());
    // A ordem da API: por UF (da que mais vendeu) e, dentro dela, do DDD que mais vendeu.
    expect(linhas.map((linha) => celulas(linha)[0].split(" ")[0])).toEqual([
      ...resposta.ddds.map((item) => item.ddd),
      "Exterior",
      "Sem",
      "Total",
    ]);
    expect(resposta.ddds.map((item) => item.ddd)).toEqual([
      "91",
      "94",
      "93",
      "11",
      "19",
      "61",
      "92",
      "98",
      "85",
      "21",
      "62",
    ]);
    expect(celulas(linhas[0])).toEqual([
      "91 1º em bilhetes",
      "Pará",
      "412",
      "1.236",
      "R$ 12.360,00",
      "88,4%",
    ]);
    expect(celulas(linhas[4])).toEqual([
      "19",
      "São Paulo",
      "1",
      "2",
      "R$ 20,00",
      "0,1%",
    ]);
    expect(linhas.slice(-3).map(celulas)).toEqual([
      ["Exterior", "Fora do Brasil", "2", "6", "R$ 60,00", "0,4%"],
      ["Sem DDD", "Não identificada", "5", "12", "R$ 120,00", "0,8%"],
      ["Total", "Todas", "468", "1.397", "R$ 13.970,00", "100,0%"],
    ]);
  });

  it("o top 3 por bilhetes ganha a posição ao lado do DDD, mesmo fora das primeiras linhas", async () => {
    simularApi(() => respostaJson(mapaDasFaixas()));
    abrir();

    const linhas = linhasDe(await tabelaDdd());
    const primeiras = linhas.map((linha) => celulas(linha)[0]);
    // Ordem da API: 91, 94, 93 (Pará), 11 (SP), 61 (DF)...; o top 3 é 91, 11 e 61.
    expect(primeiras.slice(0, 5)).toEqual([
      "91 1º em bilhetes",
      "94",
      "93",
      "11 2º em bilhetes",
      "61 3º em bilhetes",
    ]);
    expect(document.querySelectorAll(".mapa-top")).toHaveLength(3);
  });

  it("o resumo traz a janela, o total e a hora da consulta, com a nota da legenda", async () => {
    simularApi();
    abrir();
    await tabelaDdd();

    expect(
      screen.getByText("Campanha inteira", { selector: "strong" })
        .parentElement,
    ).toHaveTextContent("Campanha inteira: 23/11/2026 a 16/12/2026");
    expect(
      screen.getByText(/^468 pedidos aprovados, 1\.397 bilhetes/),
    ).toHaveTextContent("468 pedidos aprovados, 1.397 bilhetes, R$ 13.970,00.");
    expect(screen.getByText(/^Atualizado às 15:30\./)).toBeInTheDocument();
    expect(
      screen.getByText(
        "O DDD é o do telefone cadastrado na Rifei, não onde a pessoa mora.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("O DDD 61 inclui o Entorno do DF (cidades de Goiás)."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "“Sem DDD”: sem telefone, telefone fora do padrão ou DDD desconhecido.",
      ),
    ).toBeInTheDocument();
  });
});

describe("CA3: filtros de período e divisão", () => {
  it("abre na campanha inteira, todas as divisões, sem nada na URL", async () => {
    const api = simularApi();
    const { roteador } = abrir();
    await tabelaDdd();

    expect(api.chamadas).toEqual(["/api/painel/mapa-ddd?periodo=campanha"]);
    expect(roteador.state.location.search).toBe("");
    expect(screen.getByLabelText("Período")).toHaveValue("campanha");
    expect(screen.getByLabelText("Divisão")).toHaveValue("");
    expect(
      screen.queryByText(/vendas sem célula ficam de fora/),
    ).not.toBeInTheDocument();
  });

  it("trocar o período e a divisão muda a consulta e a URL; com divisão, aparece a nota", async () => {
    const api = simularApi();
    const { roteador } = abrir();
    await tabelaDdd();

    fireEvent.change(screen.getByLabelText("Período"), {
      target: { value: "atual" },
    });
    await waitFor(() =>
      expect(api.consultas.at(-1)).toEqual({ periodo: "atual" }),
    );
    expect(roteador.state.location.search).toBe("?periodo=atual");
    expect(
      await screen.findByText("Semana 2", { selector: "strong" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Divisão"), {
      target: { value: "jovens" },
    });
    await waitFor(() =>
      expect(api.consultas.at(-1)).toEqual({
        periodo: "atual",
        divisao: "jovens",
      }),
    );
    expect(roteador.state.location.search).toBe(
      "?periodo=atual&divisao=jovens",
    );
    expect(
      screen.getByText(
        "Só as vendas das células da divisão Jovens: vendas sem célula ficam de fora.",
      ),
    ).toBeInTheDocument();
    await tabelaDdd();
    await waitFor(() =>
      expect(anuncio()).toHaveTextContent(
        "Mapa da Semana 2, divisão Jovens: 468 pedidos aprovados. Atualizado às 15:30.",
      ),
    );

    fireEvent.change(screen.getByLabelText("Divisão"), {
      target: { value: "" },
    });
    await waitFor(() =>
      expect(api.consultas.at(-1)).toEqual({ periodo: "atual" }),
    );
    expect(roteador.state.location.search).toBe("?periodo=atual");
    expect(
      screen.queryByText(/vendas sem célula ficam de fora/),
    ).not.toBeInTheDocument();
    expect(api.chamadas).toEqual([
      "/api/painel/mapa-ddd?periodo=campanha",
      "/api/painel/mapa-ddd?periodo=atual",
      "/api/painel/mapa-ddd?periodo=atual&divisao=jovens",
      "/api/painel/mapa-ddd?periodo=atual",
    ]);
  });

  it("a URL abre a tela com os filtros dela (recarregar ou compartilhar)", async () => {
    const api = simularApi();
    abrir(`${CAMINHO}?periodo=atual&divisao=adultos`);
    await tabelaDdd();

    expect(api.consultas).toEqual([{ periodo: "atual", divisao: "adultos" }]);
    expect(screen.getByLabelText("Período")).toHaveValue("atual");
    expect(screen.getByLabelText("Divisão")).toHaveValue("adultos");
    expect(
      screen.getByText(/divisão Adultos: vendas sem célula ficam de fora/),
    ).toBeInTheDocument();
  });

  it("enquanto o filtro novo carrega, a tela não mostra o mapa do filtro anterior", async () => {
    let liberar: () => void = () => {};
    simularApi((consulta, ordem) =>
      ordem === 0
        ? respostaJson(mapaDeBelem())
        : new Promise<Response>((resolver) => {
            liberar = () =>
              resolver(
                respostaJson(
                  mapaDeBelem({
                    janela: JANELA_SEMANA_2,
                    divisao: consulta.divisao ?? null,
                  }),
                ),
              );
          }),
    );
    abrir();
    await tabelaDdd();

    fireEvent.change(screen.getByLabelText("Período"), {
      target: { value: "atual" },
    });
    expect(await screen.findByText("Carregando o mapa…")).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "Mapa das vendas por estado" }),
    ).not.toBeInTheDocument();
    act(() => liberar());
    expect(
      await screen.findByText("Semana 2", { selector: "strong" }),
    ).toBeInTheDocument();
  });
});

describe("CA4: estados vazio, sem campanha e erro", () => {
  it("vazio: nenhuma venda aprovada ainda, com o que fazer, sem mapa nem tabela", async () => {
    simularApi(() => respostaJson(mapaSemVendas()));
    abrir();

    expect(
      await screen.findByText("Nenhuma venda aprovada ainda."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/aparece aqui pelo DDD do telefone do comprador/),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("main")).getByRole("link", { name: "Pedidos" }),
    ).toHaveAttribute("href", "/coordenacao/pedidos");
    expect(
      screen.queryByRole("group", { name: "Mapa das vendas por estado" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    // Dá para pedir de novo (esperando a primeira venda).
    expect(
      screen.getByRole("button", { name: "Atualizar" }),
    ).toBeInTheDocument();
  });

  it("vazio com filtro: o título diz qual período e qual divisão", async () => {
    simularApi((consulta) =>
      respostaJson(
        mapaSemVendas({
          janela: JANELA_SEMANA_2,
          divisao: consulta.divisao ?? null,
        }),
      ),
    );
    abrir(`${CAMINHO}?periodo=atual&divisao=jovens`);

    expect(
      await screen.findByText(
        "Nenhuma venda aprovada ainda (Semana 2, divisão Jovens).",
      ),
    ).toBeInTheDocument();
  });

  it("404: sem campanha ativa, com o caminho para configurar, sem derrubar a tela", async () => {
    simularApi(SEM_CAMPANHA);
    abrir();

    expect(
      await screen.findByText("Nenhuma campanha ativa."),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("main")).getByRole("link", { name: "Campanha" }),
    ).toHaveAttribute("href", "/coordenacao/campanha");
    expect(
      screen.getByRole("heading", { level: 1, name: "Mapa" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Período")).toBeInTheDocument();
  });

  it("erro: a mensagem e o 'Tentar de novo', com o cabeçalho e os filtros no lugar; tentar de novo carrega o mapa", async () => {
    const api = simularApi((_consulta, ordem) =>
      ordem === 0
        ? respostaErro(503, "indisponivel", "Serviço indisponível no momento")
        : respostaJson(mapaDeBelem()),
    );
    abrir();

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Não foi possível carregar o mapa.");
    expect(alerta).toHaveTextContent("Serviço indisponível no momento");
    expect(screen.getByLabelText("Divisão")).toBeInTheDocument();

    fireEvent.click(
      within(alerta).getByRole("button", { name: "Tentar de novo" }),
    );
    expect(await tabelaDdd()).toBeInTheDocument();
    expect(api.chamadas).toHaveLength(2);
  });

  it("'Atualizar' pede de novo (sem atualização automática) e troca os números", async () => {
    const api = simularApi((_consulta, ordem) =>
      respostaJson(ordem === 0 ? mapaDeBelem() : mapaDe91ComMais()),
    );
    abrir();
    await tabelaDdd();
    expect(api.chamadas).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await waitFor(() =>
      expect(
        celulas(
          linhasDe(
            screen.getByRole("table", {
              name: "Vendas por DDD, com exterior, sem DDD e o total",
            }),
          )[0],
        )[2],
      ).toBe("500"),
    );
    expect(api.chamadas).toHaveLength(2);
  });

  it("'Atualizar' que falha mantém os números na tela e avisa", async () => {
    let liberar: () => void = () => {};
    simularApi((_consulta, ordem) =>
      ordem === 0
        ? respostaJson(mapaDeBelem())
        : new Promise<Response>((resolver) => {
            liberar = () =>
              resolver(
                respostaErro(503, "indisponivel", "Serviço indisponível"),
              );
          }),
    );
    abrir();
    await tabelaDdd();

    const botao = screen.getByRole("button", { name: "Atualizar" });
    fireEvent.click(botao);
    // Enquanto pede, os números ficam e o botão diz que está atualizando (sem pedir duas vezes).
    expect(botao).toHaveTextContent("Atualizando…");
    expect(botao).toHaveAttribute("aria-disabled", "true");
    expect(await tabelaDdd()).toBeInTheDocument();
    act(() => liberar());

    expect(
      await screen.findByText("Não foi possível atualizar agora."),
    ).toBeInTheDocument();
    expect(screen.getByText("Serviço indisponível")).toBeInTheDocument();
    expect(
      screen.getByText("Os números abaixo são os das 15:30."),
    ).toBeInTheDocument();
    expect(await tabelaDdd()).toBeInTheDocument();
    expect(botao).toHaveTextContent("Atualizar");
    await waitFor(() =>
      expect(anuncio()).toHaveTextContent(
        "Não foi possível atualizar agora. Os números continuam os das 15:30.",
      ),
    );
  });
});

/** A resposta de Belém com mais pedidos no 91 (para ver o "Atualizar" trocar os números). */
function mapaDe91ComMais() {
  const base = mapaDeBelem();
  const somar = <T extends { pedidos_aprovados: number }>(item: T): T => ({
    ...item,
    pedidos_aprovados: item.pedidos_aprovados + 88,
  });
  return respostaMapaDddSchema.parse({
    ...base,
    ufs: base.ufs.map((item) => (item.uf === "PA" ? somar(item) : item)),
    ddds: base.ddds.map((item) => (item.ddd === "91" ? somar(item) : item)),
    total: somar(base.total),
  });
}

describe("CA5: só a coordenação e o admin veem a tela", () => {
  it.each([
    ["coordenação", USUARIO_DE_TESTE],
    ["admin", ADMIN_DE_TESTE],
  ] as const)("%s: a tela e o item 'Mapa' no menu", async (_papel, usuario) => {
    simularApi();
    abrir(CAMINHO, usuario);

    expect(
      screen.getByRole("heading", { level: 1, name: "Mapa" }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Mapa · Rifa Videira Kids");
    const menu = screen.getByRole("navigation", { name: "Coordenação" });
    const link = within(menu).getByRole("link", { name: "Mapa" });
    expect(link).toHaveAttribute("href", CAMINHO);
    expect(link).toHaveAttribute("aria-current", "page");
    expect(await tabelaDdd()).toBeInTheDocument();
  });

  it.each([
    ["líder", LIDER],
    ["discipulador", DISCIPULADOR],
    ["rede", REDE],
  ] as const)(
    "%s: o endereço leva para /minha, sem montar a tela nem pedir o mapa à API",
    async (_papel, usuario) => {
      const api = simularApi();
      const { roteador } = abrir(CAMINHO, usuario);

      await waitFor(() =>
        expect(roteador.state.location.pathname).toBe("/minha"),
      );
      expect(
        screen.queryByRole("heading", { level: 1, name: "Mapa" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: "Mapa" }),
      ).not.toBeInTheDocument();
      expect(api.chamadas).toEqual([]);
    },
  );
});

describe("CA6: acessibilidade", () => {
  it("um h1, campos com rótulo, o mapa com nome e as tabelas com nome e cabeçalhos", async () => {
    simularApi();
    abrir();
    const tabela = await tabelaDdd();

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual(["Por estado", "Por DDD"]);
    expect(
      screen.getByRole("combobox", { name: "Período" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Divisão" }),
    ).toBeInTheDocument();
    expect(
      within(tabela)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual([
      "DDD",
      "UF",
      "Pedidos aprovados",
      "Bilhetes",
      "Valor",
      "Parte dos bilhetes",
    ]);
    const tabelaUfs = screen.getByRole("table", {
      name: "Vendas por estado, do que mais vendeu bilhetes para o que menos vendeu",
    });
    expect(
      within(tabelaUfs)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual([
      "Estado",
      "Pedidos aprovados",
      "Bilhetes",
      "Valor",
      "Parte dos bilhetes",
    ]);
  });

  it("cada UF é focável, com o rótulo completo, na ordem da grade (do norte para o sul)", async () => {
    simularApi();
    abrir();

    const botoes = within(await mapa()).getAllByRole("button");
    expect(botoes).toHaveLength(27);
    expect(botoes.slice(0, 4).map((b) => b.textContent)).toEqual([
      "RR",
      "AP",
      "AM",
      "PA",
    ]);
    expect(botoes.at(-1)?.textContent).toBe("RS");
    for (const botao of botoes) {
      expect(botao.tagName).toBe("BUTTON");
      expect(botao).not.toBeDisabled();
      expect(botao).not.toHaveAttribute("tabindex", "-1");
      expect(botao.getAttribute("aria-label")).toMatch(
        /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][^:]+: (sem venda|\d[\d.]* pedidos? aprovados?, )/,
      );
      act(() => botao.focus());
      expect(botao).toHaveFocus();
      expect(botao).toHaveAttribute("data-ativa");
    }
  });

  it("a região viva anuncia o resultado da consulta", async () => {
    simularApi();
    abrir();
    await tabelaDdd();

    await waitFor(() =>
      expect(anuncio()).toHaveTextContent(
        "Mapa da Campanha inteira: 468 pedidos aprovados. Atualizado às 15:30.",
      ),
    );
  });
});
