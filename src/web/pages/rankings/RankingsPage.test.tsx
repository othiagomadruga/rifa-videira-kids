import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ItemRanking,
  NivelRanking,
} from "../../../shared/contracts/calculos";
import { dicaDe } from "../../test/dicas";
import {
  chegarPeloTab,
  esperarDisponivel,
  esperarIndisponivel,
} from "../../test/indisponivel";
import { renderizarRota, respostaJson } from "../../test/renderizar";
import {
  item,
  respostaDaConsulta,
  simularApiRanking,
  type Responder,
} from "./teste-apoio";

const TELA = "/coordenacao/rankings";

/** Cinco células da Semana 2: duas divisões, em dia, abaixo e uma sem meta (no fim). */
const CELULAS: ItemRanking[] = [
  item({
    posicao: 1,
    id: 1,
    nome: "Célula Ficticia 01",
    realizado: 7,
    meta: 29,
    esperado: 5,
  }),
  item({
    posicao: 2,
    id: 3,
    nome: "Célula Ficticia 03",
    realizado: 5,
    meta: 36,
    esperado: 6,
    divisao: "adultos",
  }),
  item({
    posicao: 3,
    id: 2,
    nome: "Célula Ficticia 02",
    realizado: 2,
    meta: 22,
    esperado: 4,
  }),
  item({
    posicao: 4,
    id: 4,
    nome: "Célula Ficticia 04",
    realizado: 0,
    meta: 30,
    esperado: 5,
    divisao: "adultos",
  }),
  item({
    posicao: 5,
    id: 5,
    nome: "Célula Ficticia 05",
    realizado: 3,
    meta: 0,
    esperado: 0,
    divisao: "adultos",
  }),
];

/** Responde qualquer consulta com estes itens (coerente com o nível, a divisão e a janela pedidos). */
const comItens =
  (itens: ItemRanking[]): Responder =>
  (consulta) =>
    respostaDaConsulta(consulta, itens);

let api: ReturnType<typeof simularApiRanking>;

afterEach(() => {
  // A tela só chama a rota do ranking da coordenação.
  expect(api.inesperadas).toEqual([]);
  vi.unstubAllGlobals();
});

function abrir(caminho = TELA, responder: Responder = comItens(CELULAS)) {
  api = simularApiRanking(responder);
  return renderizarRota(caminho);
}

/** Espera a tabela da consulta atual aparecer. */
const tabela = () => screen.findByRole("table");

function linhas(): HTMLElement[] {
  const [, ...corpo] = within(screen.getByRole("table")).getAllByRole("row");
  return corpo;
}

/** O que cada linha mostra: posição, nome (com o vínculo), % da meta, realizado/meta, situação e destaque. */
function lerLinha(linha: HTMLElement) {
  const [posicao, percentual, valores, situacao] =
    within(linha).getAllByRole("cell");
  const barra = within(percentual).queryByRole("progressbar");
  return {
    posicao: posicao.textContent,
    nome: within(linha).getByRole("rowheader").textContent,
    percentual: barra
      ? barra.getAttribute("aria-valuetext")
      : percentual.textContent,
    valores: valores.textContent,
    situacao: situacao.textContent,
    destaque: linha.hasAttribute("data-destaque"),
  };
}

const posicoes = () => linhas().map((linha) => lerLinha(linha).posicao);
/** O painel da aba atual (o menu da coordenação também tem links "Campanha" e "Hierarquia"). */
const painel = () => screen.getByRole("tabpanel");
const aba = (nome: string) => screen.getByRole("tab", { name: nome });
const campo = (nome: string) =>
  screen.getByRole("combobox", { name: nome }) as HTMLSelectElement;

/** A região viva fixa da tela (a outra região de status que pode aparecer é o "Carregando…"). */
function anuncio(): HTMLElement {
  const regiao = screen
    .getAllByRole("status")
    .find((elemento) => elemento.classList.contains("visualmente-oculto"));
  if (!regiao) throw new Error("Região viva da tela não encontrada");
  return regiao;
}

describe("CA1: ranking da coordenação (/coordenacao/rankings)", () => {
  it("abre nas células, período atual e todas as divisões, com posição, nome, % da meta, realizado/meta e situação", async () => {
    abrir();
    expect(
      screen.getByRole("heading", { level: 1, name: "Rankings" }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Rankings · Projeto Videira Kids");
    await tabela();

    expect(api.caminhos).toEqual([
      "/api/painel/ranking?nivel=celula&periodo=atual",
    ]);
    expect(api.fetchMock).toHaveBeenCalledWith(
      "/api/painel/ranking?nivel=celula&periodo=atual",
      expect.objectContaining({ method: "GET" }),
    );
    expect(aba("Células")).toHaveAttribute("aria-selected", "true");
    expect(campo("Divisão").value).toBe("");
    expect(campo("Janela").value).toBe("atual");

    // A janela, onde a campanha está e o critério.
    expect(screen.getByText("Semana 2").closest("p")).toHaveTextContent(
      "Semana 2: 03/12/2026 a 09/12/2026",
    );
    expect(
      screen.getByText(
        "Dia 12 de 24 da campanha. Classificação por % da meta atingido. Atualizado às 15:30.",
      ),
    ).toBeInTheDocument();

    expect(
      within(screen.getByRole("table"))
        .getAllByRole("columnheader")
        .map((cabecalho) => cabecalho.textContent),
    ).toEqual([
      "Posição",
      "Célula",
      "% da meta",
      "Vendidos / meta",
      "Situação",
    ]);
    expect(linhas().map(lerLinha)).toEqual([
      {
        posicao: "1º",
        nome: "Célula Ficticia 01, Jovens · Discipulador Ficticio A · Rede Jovem Ficticia",
        percentual: "24%",
        valores: "7 de 29 bilhetes",
        situacao: "Em dia",
        destaque: true,
      },
      {
        posicao: "2º",
        nome: "Célula Ficticia 03, Adultos · Discipulador Ficticio B · Rede Adulta Ficticia",
        percentual: "13%",
        valores: "5 de 36 bilhetes",
        situacao: "Abaixo falta 1 bilhete",
        destaque: true,
      },
      {
        posicao: "3º",
        nome: "Célula Ficticia 02, Jovens · Discipulador Ficticio A · Rede Jovem Ficticia",
        percentual: "9%",
        valores: "2 de 22 bilhetes",
        situacao: "Abaixo faltam 2 bilhetes",
        destaque: true,
      },
      {
        posicao: "4º",
        nome: "Célula Ficticia 04, Adultos · Discipulador Ficticio B · Rede Adulta Ficticia",
        percentual: "0%",
        valores: "0 de 30 bilhetes",
        situacao: "Abaixo faltam 5 bilhetes",
        destaque: false,
      },
      {
        // Sem meta na janela: sem barra (só o "Sem meta" para o leitor de tela), no fim.
        posicao: "5º",
        nome: "Célula Ficticia 05, Adultos · Discipulador Ficticio B · Rede Adulta Ficticia",
        percentual: "—Sem meta",
        valores: "3 bilhetes",
        situacao: "Sem meta",
        destaque: false,
      },
    ]);
    expect(anuncio()).toHaveTextContent("5 células no ranking: Semana 2.");
  });

  it("a barra do % da meta é acessível: nome, aria-valuenow de 0 a 100 e o percentual real acima da meta", async () => {
    abrir(
      TELA,
      comItens([
        item({
          posicao: 1,
          id: 9,
          nome: "Célula Acima",
          realizado: 36,
          meta: 30,
          esperado: 5,
        }),
        item({
          posicao: 2,
          id: 1,
          nome: "Célula Ficticia 01",
          realizado: 7,
          meta: 29,
          esperado: 5,
        }),
      ]),
    );
    await tabela();

    const [acima, normal] = linhas().map((linha) =>
      within(linha).getByRole("progressbar", { name: "% da meta" }),
    );
    expect(acima).toHaveAttribute("aria-valuenow", "100");
    expect(acima).toHaveAttribute("aria-valuetext", "120%");
    expect(normal).toHaveAttribute("aria-valuenow", "24");
    expect(normal).toHaveAttribute("aria-valuetext", "24%");
    // Cada linha tem o nome como cabeçalho de linha.
    expect(
      within(screen.getByRole("table")).getByRole("rowheader", {
        name: /^Célula Acima/,
      }),
    ).toBeInTheDocument();
  });

  it("empates dividem a posição (1º, 1º, 3º, 3º, 5º) e o destaque do top 3 inclui os empatados", async () => {
    abrir(
      TELA,
      comItens([
        item({
          posicao: 1,
          id: 1,
          nome: "Célula Ágape",
          realizado: 15,
          meta: 30,
          esperado: 5,
        }),
        item({
          posicao: 1,
          id: 2,
          nome: "Célula Betel",
          realizado: 10,
          meta: 20,
          esperado: 4,
        }),
        item({
          posicao: 3,
          id: 3,
          nome: "Célula Canaã",
          realizado: 8,
          meta: 20,
          esperado: 4,
        }),
        item({
          posicao: 3,
          id: 4,
          nome: "Célula Dorcas",
          realizado: 12,
          meta: 30,
          esperado: 5,
        }),
        item({
          posicao: 5,
          id: 5,
          nome: "Célula Éfeso",
          realizado: 2,
          meta: 20,
          esperado: 4,
        }),
      ]),
    );
    await tabela();

    expect(posicoes()).toEqual(["1º", "1º", "3º", "3º", "5º"]);
    expect(linhas().map((linha) => lerLinha(linha).percentual)).toEqual([
      "50%",
      "50%",
      "40%",
      "40%",
      "10%",
    ]);
    expect(linhas().map((linha) => lerLinha(linha).destaque)).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it("as abas de nível mudam a URL e a consulta; a coluna do nome e o vínculo acompanham o nível", async () => {
    const NOMES: Record<NivelRanking, string> = {
      celula: "Célula Ficticia 01",
      discipulador: "Discipulador Ficticio A",
      rede: "Rede Jovem Ficticia",
    };
    const { roteador } = abrir(TELA, (consulta) => {
      const nivel = (consulta.get("nivel") ?? "celula") as NivelRanking;
      return respostaDaConsulta(consulta, [
        item({
          posicao: 1,
          id: 1,
          nome: NOMES[nivel],
          realizado: 7,
          meta: 29,
          esperado: 5,
          nivel,
        }),
      ]);
    });
    await tabela();

    fireEvent.click(aba("Discipuladores"));
    expect(aba("Discipuladores")).toHaveAttribute("aria-selected", "true");
    expect(roteador.state.location.search).toBe("?nivel=discipulador");
    expect(
      await screen.findByRole("columnheader", { name: "Discipulador" }),
    ).toBeInTheDocument();
    expect(lerLinha(linhas()[0]).nome).toBe(
      "Discipulador Ficticio A, Jovens · Rede Jovem Ficticia",
    );

    // Pelo teclado (seta para a direita), como nas outras abas do site.
    act(() => aba("Discipuladores").focus());
    fireEvent.keyDown(aba("Discipuladores"), { key: "ArrowRight" });
    expect(aba("Redes")).toHaveAttribute("aria-selected", "true");
    expect(aba("Redes")).toHaveFocus();
    expect(roteador.state.location.search).toBe("?nivel=rede");
    expect(
      await screen.findByRole("columnheader", { name: "Rede" }),
    ).toBeInTheDocument();
    expect(lerLinha(linhas()[0]).nome).toBe("Rede Jovem Ficticia, Jovens");

    expect(api.caminhos).toEqual([
      "/api/painel/ranking?nivel=celula&periodo=atual",
      "/api/painel/ranking?nivel=discipulador&periodo=atual",
      "/api/painel/ranking?nivel=rede&periodo=atual",
    ]);
    // Só o painel da aba atual tem conteúdo: uma tabela só.
    expect(screen.getAllByRole("table")).toHaveLength(1);
  });

  it("filtro de divisão e janela: a URL reflete os filtros e cada mudança consulta a API", async () => {
    const { roteador } = abrir();
    await tabela();

    fireEvent.change(campo("Divisão"), { target: { value: "jovens" } });
    expect(roteador.state.location.search).toBe("?divisao=jovens");
    await waitFor(() =>
      expect(screen.getByRole("table")).toHaveAccessibleName(
        "Ranking: células · Semana 2 · Jovens",
      ),
    );
    expect(api.caminhos.at(-1)).toBe(
      "/api/painel/ranking?nivel=celula&divisao=jovens&periodo=atual",
    );
    // Com a divisão filtrada, o vínculo não repete a divisão.
    expect(lerLinha(linhas()[0]).nome).toBe(
      "Célula Ficticia 01, Discipulador Ficticio A · Rede Jovem Ficticia",
    );

    fireEvent.change(campo("Janela"), { target: { value: "campanha" } });
    expect(roteador.state.location.search).toBe(
      "?divisao=jovens&periodo=campanha",
    );
    expect(
      (
        await screen.findByText("Campanha inteira", { selector: "strong" })
      ).closest("p"),
    ).toHaveTextContent("Campanha inteira: 23/11/2026 a 16/12/2026");
    expect(api.caminhos.at(-1)).toBe(
      "/api/painel/ranking?nivel=celula&divisao=jovens&periodo=campanha",
    );
    expect(anuncio()).toHaveTextContent(
      "5 células no ranking: Campanha inteira, Jovens.",
    );

    fireEvent.change(campo("Divisão"), { target: { value: "" } });
    expect(roteador.state.location.search).toBe("?periodo=campanha");
    await waitFor(() =>
      expect(screen.getByRole("table")).toHaveAccessibleName(
        "Ranking: células · Campanha inteira · todas as divisões",
      ),
    );
    expect(api.caminhos.at(-1)).toBe(
      "/api/painel/ranking?nivel=celula&periodo=campanha",
    );
    expect(campo("Divisão").value).toBe("");
    expect(campo("Janela").value).toBe("campanha");
  });

  it("a URL já filtrada abre com os filtros; valor desconhecido na URL vale o padrão", async () => {
    const { unmount } = abrir(
      `${TELA}?nivel=rede&divisao=adultos&periodo=campanha`,
    );
    await tabela();
    expect(aba("Redes")).toHaveAttribute("aria-selected", "true");
    expect(campo("Divisão").value).toBe("adultos");
    expect(campo("Janela").value).toBe("campanha");
    expect(api.caminhos).toEqual([
      "/api/painel/ranking?nivel=rede&divisao=adultos&periodo=campanha",
    ]);
    unmount();
    vi.unstubAllGlobals();

    abrir(`${TELA}?nivel=bairro&divisao=criancas&periodo=ano`);
    await tabela();
    expect(aba("Células")).toHaveAttribute("aria-selected", "true");
    expect(campo("Divisão").value).toBe("");
    expect(campo("Janela").value).toBe("atual");
    expect(api.caminhos).toEqual([
      "/api/painel/ranking?nivel=celula&periodo=atual",
    ]);
  });

  it("meta em R$ (unidade centavos): realizado, meta e o que falta aparecem em reais", async () => {
    abrir(TELA, (consulta) =>
      respostaDaConsulta(
        consulta,
        [
          item({
            posicao: 1,
            id: 1,
            nome: "Célula Ficticia 01",
            realizado: 14_000,
            meta: 58_000,
            esperado: 10_000,
          }),
          item({
            posicao: 2,
            id: 2,
            nome: "Célula Ficticia 02",
            realizado: 4_000,
            meta: 44_000,
            esperado: 6_000,
          }),
        ],
        { unidade: "centavos", criterio: "arrecadacao" },
      ),
    );
    await tabela();

    expect(
      screen.getByRole("columnheader", { name: "Arrecadado / meta" }),
    ).toBeInTheDocument();
    expect(linhas().map(lerLinha)).toMatchObject([
      // O Intl põe um espaço não separável (U+00A0) entre "R$" e o número.
      { valores: "R$\u00a0140,00 de R$\u00a0580,00", situacao: "Em dia" },
      {
        valores: "R$\u00a040,00 de R$\u00a0440,00",
        situacao: "Abaixo faltam R$\u00a020,00",
      },
    ]);
    expect(
      screen.getByText(/Classificação por valor arrecadado\./),
    ).toBeInTheDocument();
  });

  it("antes do início e depois do fim, o resumo diz onde a campanha está", async () => {
    const { unmount } = abrir(TELA, (consulta) =>
      respostaDaConsulta(consulta, CELULAS.slice(0, 1), {
        referencia: {
          data: "2026-11-20",
          fase: "antes",
          data_inicio: "2026-11-23",
          data_fim: "2026-12-16",
          duracao_dias: 24,
          dia_campanha: null,
          dias_restantes: 24,
          dias_para_inicio: 3,
          periodo: null,
        },
      }),
    );
    expect(
      await screen.findByText(/^A campanha começa em 23\/11\/2026\./),
    ).toBeInTheDocument();
    unmount();
    vi.unstubAllGlobals();

    abrir(TELA, (consulta) =>
      respostaDaConsulta(consulta, CELULAS.slice(0, 1), {
        criterio: "bilhetes",
        referencia: {
          data: "2026-12-20",
          fase: "encerrada",
          data_inicio: "2026-11-23",
          data_fim: "2026-12-16",
          duracao_dias: 24,
          dia_campanha: null,
          dias_restantes: 0,
          dias_para_inicio: null,
          periodo: null,
        },
      }),
    );
    expect(
      await screen.findByText(
        /^Campanha encerrada em 16\/12\/2026\. Classificação por bilhetes vendidos\./,
      ),
    ).toBeInTheDocument();
  });

  it("divisão sem itens: estado vazio que leva à Hierarquia (e nada de tabela)", async () => {
    abrir(`${TELA}?divisao=adultos`, comItens([]));

    expect(
      await screen.findByText("Nenhuma célula para mostrar."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/A divisão Adultos ainda não tem células cadastradas\./),
    ).toBeInTheDocument();
    expect(
      within(painel()).getByRole("link", { name: "Hierarquia" }),
    ).toHaveAttribute("href", "/coordenacao/hierarquia");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(anuncio()).toHaveTextContent(
      "0 células no ranking: Semana 2, Adultos.",
    );

    fireEvent.click(aba("Discipuladores"));
    expect(
      await screen.findByText("Nenhum discipulador para mostrar."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /A divisão Adultos ainda não tem discipuladores com células\./,
      ),
    ).toBeInTheDocument();
  });

  it("sem campanha ativa (404): aviso com o caminho para a Campanha, sem erro", async () => {
    abrir(TELA, () =>
      respostaJson(
        {
          erro: {
            codigo: "nao_encontrado",
            mensagem: "Nenhuma campanha ativa",
          },
        },
        404,
      ),
    );

    expect(
      await screen.findByText("Nenhuma campanha ativa."),
    ).toBeInTheDocument();
    expect(
      within(painel()).getByRole("link", { name: "Campanha" }),
    ).toHaveAttribute("href", "/coordenacao/campanha");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("falha: mostra o erro e 'Tentar de novo' consulta outra vez", async () => {
    let falhar = true;
    abrir(TELA, (consulta) =>
      falhar
        ? respostaJson(
            {
              erro: {
                codigo: "erro_interno",
                mensagem: "Falha ao consultar o banco de dados.",
              },
            },
            500,
          )
        : respostaDaConsulta(consulta, CELULAS),
    );

    const alerta = await screen.findByRole("alert");
    expect(
      within(alerta).getByText("Não foi possível carregar o ranking."),
    ).toBeInTheDocument();
    expect(
      within(alerta).getByText("Falha ao consultar o banco de dados."),
    ).toBeInTheDocument();
    falhar = false;
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));

    await tabela();
    expect(posicoes()).toEqual(["1º", "2º", "3º", "4º", "5º"]);
    expect(api.caminhos).toHaveLength(2);
  });

  it("ao trocar de filtro, a lista do filtro anterior some até a nova resposta chegar", async () => {
    let liberar: () => void = () => {};
    abrir(TELA, async (consulta) => {
      if (consulta.get("divisao") === "jovens") {
        await new Promise<void>((resolver) => {
          liberar = resolver;
        });
        return respostaDaConsulta(consulta, CELULAS.slice(0, 1));
      }
      return respostaDaConsulta(consulta, CELULAS);
    });
    await tabela();
    expect(linhas()).toHaveLength(5);

    fireEvent.change(campo("Divisão"), { target: { value: "jovens" } });
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("Carregando o ranking…")).toBeInTheDocument();
    expect(anuncio().textContent).toBe("");

    act(() => liberar());
    await tabela();
    expect(linhas()).toHaveLength(1);
    expect(anuncio()).toHaveTextContent(
      "1 célula no ranking: Semana 2, Jovens.",
    );
  });
});

describe("RIFA-061 (D27): sem ranking por divisão", () => {
  /** A API ignora a divisão pedida: o ranking de todos, com divisao null e a marca. */
  const unico: Responder = (consulta) =>
    respostaDaConsulta(consulta, CELULAS, {
      divisao: null,
      por_divisao: false,
    });

  it("uma lista só, de todas as células, sem a divisão na legenda nem no vínculo; o filtro fica no lugar, indisponível, com a dica", async () => {
    abrir(TELA, unico);
    await tabela();

    expect(screen.getByRole("table")).toHaveAccessibleName(
      "Ranking: células · Semana 2",
    );
    expect(posicoes()).toEqual(["1º", "2º", "3º", "4º", "5º"]);
    // A célula dos adultos no meio das dos jovens, sem "Adultos" no vínculo.
    expect(lerLinha(linhas()[1]).nome).toBe(
      "Célula Ficticia 03, Discipulador Ficticio B · Rede Adulta Ficticia",
    );
    expect(painel()).not.toHaveTextContent(/Jovens|Adultos/);

    const divisao = campo("Divisão");
    esperarIndisponivel(divisao);
    expect([...divisao.options].map((opcao) => opcao.text)).toEqual([
      "Todas as células",
    ]);
    chegarPeloTab(divisao);
    expect(dicaDe(divisao)).toHaveTextContent(
      "Indisponível: a campanha usa um ranking só, com todas as células juntas. Para separar Jovens e Adultos, ligue a opção na tela Campanha.",
    );
  });

  it("a URL com uma divisão (de antes) mostra o ranking de todos, e mudar o filtro não faz nada", async () => {
    const { roteador } = abrir(`${TELA}?divisao=adultos`, unico);
    await tabela();
    expect(posicoes()).toHaveLength(5);
    expect(campo("Divisão").value).toBe("");
    const pedidos = api.caminhos.length;
    fireEvent.change(campo("Divisão"), { target: { value: "jovens" } });
    expect(roteador.state.location.search).toBe("?divisao=adultos");
    expect(api.caminhos).toHaveLength(pedidos);
  });

  it("no nível rede, a rede fica sem a divisão no vínculo", async () => {
    abrir(`${TELA}?nivel=rede`, (consulta) =>
      respostaDaConsulta(
        consulta,
        [
          item({
            posicao: 1,
            id: 1,
            nome: "Rede Jovem Ficticia",
            realizado: 9,
            meta: 51,
            esperado: 9,
            nivel: "rede",
          }),
          item({
            posicao: 2,
            id: 2,
            nome: "Rede Adulta Ficticia",
            realizado: 5,
            meta: 66,
            esperado: 11,
            divisao: "adultos",
            nivel: "rede",
          }),
        ],
        { divisao: null, por_divisao: false },
      ),
    );
    await tabela();
    expect(linhas().map((linha) => lerLinha(linha).nome)).toEqual([
      "Rede Jovem Ficticia",
      "Rede Adulta Ficticia",
    ]);
  });

  it("ligada (sem a marca na resposta), o filtro de sempre, disponível", async () => {
    abrir();
    await tabela();
    esperarDisponivel(campo("Divisão"));
    expect([...campo("Divisão").options].map((opcao) => opcao.text)).toEqual([
      "Todas",
      "Jovens",
      "Adultos",
    ]);
  });
});
