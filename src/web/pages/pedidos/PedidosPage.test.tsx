// RIFA-025: /coordenacao/pedidos (aba Pedidos), pela rota de verdade e com a API falsa de teste-apoio.ts, que
// pagina como GET /api/admin/pedidos (cursor opaco, totais só na primeira página) e passa consultas e respostas
// pelos schemas do contrato. CA1 (lista, filtros, cursor e totais), CA4 (quem vê) e CA5 (acessibilidade).
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UsuarioSessao } from "../../../shared/contracts";
import {
  ADMIN_DE_TESTE,
  USUARIO_DE_TESTE,
  renderizarRota,
  respostaJson,
} from "../../test/renderizar";
import { DISCIPULADOR, LIDER, REDE } from "../minha/teste-apoio";
import {
  ROTA_PEDIDOS,
  idDoPedidoFicticio,
  pedido,
  pedidosVariados,
  respostaErro,
  simularApi,
} from "./teste-apoio";

const CAMINHO = "/coordenacao/pedidos";

function abrir(caminho = CAMINHO, usuario: UsuarioSessao = USUARIO_DE_TESTE) {
  return renderizarRota(caminho, { usuario });
}

const tabela = () =>
  screen.findByRole("table", {
    name: "Pedidos, do mais recente para o mais antigo",
  });

/** As linhas de dados da tabela (sem a do cabeçalho). */
async function linhas() {
  const [, corpo] = within(await tabela()).getAllByRole("rowgroup");
  return within(corpo).getAllByRole("row");
}

/** Os textos das células de uma linha (o espaço não separável do "R$" vira espaço comum). */
const celulas = (linha: HTMLElement) =>
  within(linha)
    .getAllByRole("cell")
    .map((celula) => celula.textContent?.replace(/\u00a0/g, " "));

/** Os ids dos pedidos da tabela, na ordem. */
async function idsNaTabela() {
  return (await linhas()).map(
    (linha) =>
      within(linha).getAllByRole("cell")[0].firstElementChild?.firstElementChild
        ?.textContent,
  );
}

const campoStatus = () => screen.getByRole("combobox", { name: "Status" });
const campoCelula = () => screen.getByRole("combobox", { name: "Célula" });
const campoBusca = () =>
  screen.getByRole("textbox", { name: "Buscar pelo id do pedido" });
const botaoCarregarMais = () =>
  screen.getByRole("button", { name: "Carregar mais" });

/** A região viva fixa da lista (anuncia o que o filtro e o "Carregar mais" trouxeram). */
const anuncio = () =>
  within(screen.getByRole("tabpanel", { name: "Pedidos" }))
    .getAllByRole("status")
    .find((elemento) => elemento.classList.contains("visualmente-oculto"));

/** Os totais: para cada cartão, o status e os valores de pedidos, bilhetes e valor. */
function totais() {
  const secao = screen.getByRole("region", { name: "Totais por status" });
  return within(secao)
    .getAllByRole("listitem")
    .map((cartao) => [
      within(cartao).getByRole("heading", { level: 3 }).textContent,
      ...within(cartao)
        .getAllByRole("definition")
        .map((valor) => valor.textContent?.replace(/\u00a0/g, " ")),
    ]);
}

/** Foca e clica, como o toque e o Enter fazem no navegador (o jsdom não foca no clique). */
function acionar(elemento: HTMLElement) {
  act(() => elemento.focus());
  fireEvent.click(elemento);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CA1: a lista de pedidos", () => {
  it("mostra pedido, status, quando (no fuso da campanha), célula, bilhetes, R$, DDD e o selo de suspeito, numa tabela com cabeçalhos", async () => {
    const api = simularApi({
      pedidos: [
        pedido(30, {
          id: "PED-APROVADO",
          criado_em: "2026-11-25T15:00:00.000Z",
          aprovado_em: "2026-11-25T15:04:00.000Z",
          qtd_bilhetes: 3,
          total_centavos: 6000,
          suspeito: true,
        }),
        pedido(20, {
          id: "PED-AGUARDANDO",
          status: "in_process",
          criado_em: "2026-11-25T02:30:00.000Z",
          celula_id: null,
          celula_nome: null,
          affiliate_id: 1042,
          ddd: null,
        }),
        pedido(10, {
          id: "PED-EXPIRADO",
          status: "expired",
          criado_em: null,
          registrado_em: "2026-11-24T13:00:00.000Z",
          expirado_em: "2026-11-24T14:00:00.000Z",
          celula_id: null,
          celula_nome: null,
          affiliate_id: null,
          qtd_bilhetes: 1234,
          total_centavos: 2468000,
          ddd: "11",
        }),
      ],
    });
    abrir();

    expect(
      screen.getByRole("heading", { level: 1, name: "Pedidos" }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Pedidos · Rifa Videira Kids");
    const tabelaDosPedidos = await tabela();
    expect(
      within(tabelaDosPedidos)
        .getAllByRole("columnheader")
        .map((cabecalho) => cabecalho.textContent),
    ).toEqual([
      "Pedido",
      "Status",
      "Quando",
      "Célula",
      "Bilhetes",
      "Valor",
      "DDD",
    ]);

    const [aprovado, aguardando, expirado] = await linhas();
    // 15:00 UTC = 12:00 em Belém; 02:30 UTC do dia 25 = 23:30 do dia 24 em Belém.
    expect(celulas(aprovado)).toEqual([
      "PED-APROVADOSuspeito (ver em Pedidos suspeitos)",
      "Aprovado",
      "25/11/2026 12:00Aprovado em 25/11/2026 12:04",
      "Célula Ficticia 02",
      "3",
      "R$ 60,00",
      "91",
    ]);
    expect(celulas(aguardando)).toEqual([
      "PED-AGUARDANDO",
      "Aguardando pagamento",
      "24/11/2026 23:30",
      "Sem célula (afiliado 1042)",
      "2",
      "R$ 40,00",
      "Sem DDD",
    ]);
    // Sem a data da Rifei, vale quando o pedido chegou.
    expect(celulas(expirado)).toEqual([
      "PED-EXPIRADO",
      "Expirado",
      "24/11/2026 10:00Expirou em 24/11/2026 11:00",
      "Sem afiliado",
      "1.234",
      "R$ 24.680,00",
      "11",
    ]);
    expect(within(aprovado).getByText("25/11/2026 12:00")).toHaveAttribute(
      "datetime",
      "2026-11-25T15:00:00.000Z",
    );
    // O selo leva à tela Pedidos suspeitos.
    expect(
      within(aprovado).getByRole("link", {
        name: "Suspeito (ver em Pedidos suspeitos)",
      }),
    ).toHaveAttribute("href", "/coordenacao/pedidos-suspeitos");
    expect(within(aguardando).queryByRole("link")).not.toBeInTheDocument();
    // No celular, cada célula vira "rótulo: valor" (o rótulo vem do cabeçalho da coluna).
    expect(
      within(aprovado)
        .getAllByRole("cell")
        .map((celula) => celula.dataset.rotulo),
    ).toEqual([
      "Pedido",
      "Status",
      "Quando",
      "Célula",
      "Bilhetes",
      "Valor",
      "DDD",
    ]);

    expect(api.pedidosA(ROTA_PEDIDOS)).toEqual([`${ROTA_PEDIDOS}?limite=50`]);
    expect(
      screen.getByText("3 pedidos; não há pedidos mais antigos."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Carregar mais" }),
    ).not.toBeInTheDocument();
  });

  it("os totais por status vêm da primeira página (pedidos, bilhetes e R$, de todos os pedidos do filtro) e não mudam com o Carregar mais", async () => {
    const api = simularApi({ pedidos: pedidosVariados(120) });
    abrir();

    expect(await linhas()).toHaveLength(50);
    // 120 pedidos em ciclo: 40 de cada status. Bilhetes (n % 7) + 1, a R$ 20,00 cada.
    const esperados = [
      ["Aprovados", "40", "162", "R$ 3.240,00"],
      ["Aguardando pagamento", "40", "159", "R$ 3.180,00"],
      ["Expirados", "40", "157", "R$ 3.140,00"],
    ];
    expect(totais()).toEqual(esperados);
    expect(
      screen.getByText("Só os aprovados contam nas vendas."),
    ).toBeInTheDocument();

    acionar(botaoCarregarMais());
    await waitFor(async () => expect(await linhas()).toHaveLength(100));
    // A segunda página vem sem totais (null): a tela mantém os da primeira, sem somar as linhas carregadas.
    const [, segunda] = api.pedidosA(ROTA_PEDIDOS);
    expect(segunda).toMatch(/antes_de=/);
    expect(totais()).toEqual(esperados);
  });

  it("Carregar mais pede a página seguinte com o cursor da API, acrescenta no fim sem repetir nem pular, leva o foco ao primeiro pedido novo e anuncia; na última página, o botão some", async () => {
    const api = simularApi({ pedidos: pedidosVariados(120) });
    abrir();

    expect(await linhas()).toHaveLength(50);
    expect(
      screen.getByText("Mostrando 50 pedidos; há pedidos mais antigos."),
    ).toBeInTheDocument();

    acionar(botaoCarregarMais());
    await waitFor(async () => expect(await linhas()).toHaveLength(100));
    // O primeiro pedido novo é o 51º da lista: n = 70 (do 120 ao 71 na primeira página).
    const primeiroNovo = (await linhas())[50];
    expect(celulas(primeiroNovo)[0]).toBe(idDoPedidoFicticio(70));
    await waitFor(() =>
      expect(
        within(primeiroNovo).getByText(idDoPedidoFicticio(70)),
      ).toHaveFocus(),
    );
    expect(anuncio()).toHaveTextContent("50 pedidos a mais na lista.");

    acionar(botaoCarregarMais());
    await waitFor(async () => expect(await linhas()).toHaveLength(120));
    const ultimoBloco = (await linhas())[100];
    await waitFor(() =>
      expect(
        within(ultimoBloco).getByText(idDoPedidoFicticio(20)),
      ).toHaveFocus(),
    );
    expect(anuncio()).toHaveTextContent(
      "20 pedidos a mais na lista. Não há pedidos mais antigos.",
    );
    expect(
      screen.getByText("120 pedidos; não há pedidos mais antigos."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Carregar mais" }),
    ).not.toBeInTheDocument();

    // O cursor é o `proximo` que a API mandou, sem mexer.
    const pedidos = api.pedidosA(ROTA_PEDIDOS);
    expect(pedidos).toHaveLength(3);
    expect(pedidos[0]).toBe(`${ROTA_PEDIDOS}?limite=50`);
    for (const caminho of pedidos.slice(1)) {
      expect(caminho).toMatch(
        new RegExp(`^${ROTA_PEDIDOS}\\?limite=50&antes_de=[\\w-]+$`),
      );
    }
    // Do mais novo para o mais antigo, sem repetir nem pular nenhum.
    expect(await idsNaTabela()).toEqual(
      Array.from({ length: 120 }, (_, i) => idDoPedidoFicticio(120 - i)),
    );
  });

  it.each([
    [
      "cursor_invalido (docs/api.md)",
      {
        caminho: ["antes_de"],
        codigo: "cursor_invalido",
        mensagem:
          "Cursor inválido: use o valor de `proximo` da página anterior",
      },
    ],
    [
      "outro problema no antes_de",
      { caminho: ["antes_de"], codigo: "too_big", mensagem: "Muito grande" },
    ],
  ])(
    "cursor que não vale mais (400, %s): recomeça da primeira página, sem erro na tela, com o foco no primeiro pedido",
    async (_caso, detalhe) => {
      const api = simularApi({ pedidos: pedidosVariados(120) });
      abrir();
      expect(await linhas()).toHaveLength(50);
      acionar(botaoCarregarMais());
      await waitFor(async () => expect(await linhas()).toHaveLength(100));
      api.proxima(ROTA_PEDIDOS, () =>
        respostaJson(
          {
            erro: {
              codigo: "requisicao_invalida",
              mensagem: "Consulta inválida",
              detalhes: [detalhe],
            },
          },
          400,
        ),
      );

      acionar(botaoCarregarMais());

      await waitFor(() => expect(api.pedidosA(ROTA_PEDIDOS)).toHaveLength(4));
      await waitFor(async () => expect(await linhas()).toHaveLength(50));
      const pedidos = api.pedidosA(ROTA_PEDIDOS);
      expect(pedidos[2]).toMatch(/antes_de=/);
      expect(pedidos[3]).toBe(`${ROTA_PEDIDOS}?limite=50`);
      expect(celulas((await linhas())[0])[0]).toBe(idDoPedidoFicticio(120));
      await waitFor(() =>
        expect(screen.getByText(idDoPedidoFicticio(120))).toHaveFocus(),
      );
      expect(anuncio()).toHaveTextContent(
        "A lista recomeçou do início: o ponto da página seguinte não valia mais.",
      );
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      // Dali em diante, o Carregar mais segue normal.
      acionar(botaoCarregarMais());
      await waitFor(async () => expect(await linhas()).toHaveLength(100));
    },
  );

  it("outro 400 no Carregar mais (sem ser do cursor) aparece como erro e não recarrega a primeira página", async () => {
    const api = simularApi({ pedidos: pedidosVariados(70) });
    abrir();
    await tabela();
    api.proxima(ROTA_PEDIDOS, () =>
      respostaJson(
        {
          erro: {
            codigo: "requisicao_invalida",
            mensagem: "Consulta inválida",
            detalhes: [
              { caminho: ["status"], codigo: "invalid_value", mensagem: "x" },
            ],
          },
        },
        400,
      ),
    );

    acionar(botaoCarregarMais());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível carregar mais pedidos",
    );
    expect(await linhas()).toHaveLength(50);
    expect(api.pedidosA(ROTA_PEDIDOS)).toHaveLength(2);
  });

  it("uma página que repete um pedido já na lista não o mostra duas vezes", async () => {
    const todos = pedidosVariados(60);
    const api = simularApi({ pedidos: todos });
    api.proxima(ROTA_PEDIDOS, () =>
      respostaJson({
        itens: todos.slice(0, 50),
        proximo: "cursor-1",
        totais: null,
      }),
    );
    abrir();
    await tabela();
    // A primeira chamada usou o especial (sem totais); a segunda repete o último da primeira página.
    api.proxima(ROTA_PEDIDOS, () =>
      respostaJson({ itens: todos.slice(49), proximo: null, totais: null }),
    );

    acionar(botaoCarregarMais());
    await waitFor(async () => expect(await linhas()).toHaveLength(60));
    expect(new Set(await idsNaTabela()).size).toBe(60);
    expect(anuncio()).toHaveTextContent(
      "10 pedidos a mais na lista. Não há pedidos mais antigos.",
    );
  });

  it("enquanto carrega mais, o botão fica indisponível (continua focável) e um segundo toque não pede de novo", async () => {
    let liberar: () => void = () => {};
    const segura = new Promise<void>((resolver) => (liberar = resolver));
    const todos = pedidosVariados(60);
    const api = simularApi({ pedidos: todos });
    abrir();
    await tabela();
    api.proxima(ROTA_PEDIDOS, async () => {
      await segura;
      return respostaJson({
        itens: todos.slice(50),
        proximo: null,
        totais: null,
      });
    });

    const botao = botaoCarregarMais();
    acionar(botao);
    expect(botao).toHaveAttribute("aria-disabled", "true");
    expect(botao).toHaveTextContent("Carregando…");
    expect(botao).toHaveFocus();
    fireEvent.click(botao);
    expect(api.pedidosA(ROTA_PEDIDOS)).toHaveLength(2);

    liberar();
    await waitFor(async () => expect(await linhas()).toHaveLength(60));
    expect(api.pedidosA(ROTA_PEDIDOS)).toHaveLength(2);
  });

  it("falha no Carregar mais: os pedidos ficam, o erro aparece e o botão tenta de novo com o mesmo cursor", async () => {
    const api = simularApi({ pedidos: pedidosVariados(70) });
    abrir();
    await tabela();
    api.proxima(ROTA_PEDIDOS, () =>
      respostaErro(503, "indisponivel", "O banco não respondeu a tempo."),
    );

    acionar(botaoCarregarMais());
    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Não foi possível carregar mais pedidos");
    expect(alerta).toHaveTextContent("O banco não respondeu a tempo.");
    expect(await linhas()).toHaveLength(50);

    acionar(botaoCarregarMais());
    await waitFor(async () => expect(await linhas()).toHaveLength(70));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const [, primeira, segunda] = api.pedidosA(ROTA_PEDIDOS);
    expect(segunda).toBe(primeira);
  });
});

describe("CA1: os filtros (status, célula ou só sem célula, busca pelo id) vão para a consulta e para a URL", () => {
  it("status: pede só o status escolhido, a URL guarda o filtro e os totais continuam com todos os status", async () => {
    const api = simularApi({ pedidos: pedidosVariados(12) });
    const { roteador } = abrir();
    await tabela();
    expect(
      within(campoStatus())
        .getAllByRole("option")
        .map((opcao) => opcao.textContent),
    ).toEqual([
      "Todos os status",
      "Aguardando pagamento",
      "Aprovado",
      "Expirado",
    ]);

    fireEvent.change(campoStatus(), { target: { value: "approved" } });

    await waitFor(async () => expect(await linhas()).toHaveLength(4));
    for (const linha of await linhas())
      expect(celulas(linha)[1]).toBe("Aprovado");
    expect(api.pedidosA(ROTA_PEDIDOS).at(-1)).toBe(
      `${ROTA_PEDIDOS}?limite=50&status=approved`,
    );
    expect(roteador.state.location.search).toBe("?status=approved");
    expect(totais().map(([status, quantos]) => [status, quantos])).toEqual([
      ["Aprovados", "4"],
      ["Aguardando pagamento", "4"],
      ["Expirados", "4"],
    ]);
    // Só o status escolhido: a nota dos totais não aparece (eles não dependem do status).
    expect(screen.queryByText(/Os totais seguem/)).not.toBeInTheDocument();
    expect(anuncio()).toHaveTextContent("Lista atualizada: 4 pedidos.");
  });

  it("célula: as opções vêm da hierarquia (por rede, em ordem de nome), com 'Só os sem célula'; escolher manda celula_id ou sem_celula, nunca os dois", async () => {
    const api = simularApi({ pedidos: pedidosVariados(12) });
    const { roteador } = abrir();
    await tabela();
    await waitFor(() =>
      expect(within(campoCelula()).getAllByRole("group")).toHaveLength(2),
    );
    expect(
      within(campoCelula())
        .getAllByRole("option")
        .slice(0, 2)
        .map((opcao) => opcao.textContent),
    ).toEqual(["Todas as células", "Só os sem célula"]);
    expect(
      within(campoCelula())
        .getAllByRole("group")
        .map((grupo) => [
          grupo.getAttribute("label"),
          within(grupo)
            .getAllByRole("option")
            .map((opcao) => opcao.textContent),
        ]),
    ).toEqual([
      ["Rede Adulta Ficticia", ["Célula Ficticia 03"]],
      ["Rede Jovem Ficticia", ["Célula Ficticia 02", "Célula Ficticia 10"]],
    ]);

    fireEvent.change(campoCelula(), { target: { value: "celula:2" } });
    await waitFor(() =>
      expect(api.pedidosA(ROTA_PEDIDOS).at(-1)).toBe(
        `${ROTA_PEDIDOS}?limite=50&celula_id=2`,
      ),
    );
    await waitFor(async () => {
      for (const linha of await linhas())
        expect(celulas(linha)[3]).toBe("Célula Ficticia 10");
    });
    expect(roteador.state.location.search).toBe("?celula_id=2");
    // Com célula escolhida, a nota explica que os totais seguem a célula.
    expect(
      screen.getByText(/Os totais seguem a célula e a busca escolhidas/),
    ).toBeInTheDocument();

    fireEvent.change(campoCelula(), { target: { value: "sem_celula" } });
    await waitFor(() =>
      expect(api.pedidosA(ROTA_PEDIDOS).at(-1)).toBe(
        `${ROTA_PEDIDOS}?limite=50&sem_celula=true`,
      ),
    );
    await waitFor(async () => {
      for (const linha of await linhas())
        expect(celulas(linha)[3]).toBe("Sem célula (afiliado 2002)");
    });
    expect(roteador.state.location.search).toBe("?sem_celula=true");
    expect(
      api
        .pedidosA(ROTA_PEDIDOS)
        .filter(
          (caminho) =>
            caminho.includes("celula_id") && caminho.includes("sem_celula"),
        ),
    ).toEqual([]);
  });

  it("busca pelo id: só ao tocar em Buscar, sem os espaços das pontas; 'Limpar busca' volta à lista toda", async () => {
    const api = simularApi({ pedidos: pedidosVariados(12) });
    const { roteador } = abrir();
    await tabela();

    fireEvent.change(campoBusca(), { target: { value: "  PEDFIC0007 " } });
    expect(api.pedidosA(ROTA_PEDIDOS)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));

    await waitFor(async () => expect(await linhas()).toHaveLength(1));
    expect(celulas((await linhas())[0])[0]).toBe("PEDFIC0007");
    expect(api.pedidosA(ROTA_PEDIDOS).at(-1)).toBe(
      `${ROTA_PEDIDOS}?limite=50&id=PEDFIC0007`,
    );
    expect(roteador.state.location.search).toBe("?id=PEDFIC0007");
    expect(
      screen.getByText(/Os totais seguem a célula e a busca escolhidas/),
    ).toBeInTheDocument();
    expect(screen.getByRole("search")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Limpar busca" }));
    await waitFor(async () => expect(await linhas()).toHaveLength(12));
    expect(roteador.state.location.search).toBe("");
    expect(campoBusca()).toHaveValue("");
  });

  it("busca pelo id: o foco não se perde (fica no Buscar; 'Limpar busca', que some, leva ao campo) e 'Limpar filtros' esvazia o campo", async () => {
    simularApi({ pedidos: pedidosVariados(12) });
    abrir();
    await tabela();

    fireEvent.change(campoBusca(), { target: { value: "PEDFIC0007" } });
    acionar(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(async () => expect(await linhas()).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Buscar" })).toHaveFocus();
    expect(campoBusca()).toHaveValue("PEDFIC0007");

    acionar(screen.getByRole("button", { name: "Limpar busca" }));
    await waitFor(async () => expect(await linhas()).toHaveLength(12));
    expect(campoBusca()).toHaveFocus();
    expect(campoBusca()).toHaveValue("");

    // Uma busca sem resultado e "Limpar filtros" (fora do campo): o campo volta vazio.
    fireEvent.change(campoBusca(), { target: { value: "NAO-EXISTE" } });
    fireEvent.submit(screen.getByRole("search"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Limpar filtros" }),
    );
    await waitFor(async () => expect(await linhas()).toHaveLength(12));
    expect(campoBusca()).toHaveValue("");
  });

  it("os filtros da URL valem ao abrir (o 'voltar' e o recarregar mantêm a tela); fora do contrato, são ignorados", async () => {
    const api = simularApi({ pedidos: pedidosVariados(24) });
    abrir(`${CAMINHO}?status=expired&celula_id=3&id=%20&sem_celula=talvez`);

    await tabela();
    expect(api.pedidosA(ROTA_PEDIDOS)).toEqual([
      `${ROTA_PEDIDOS}?limite=50&status=expired&celula_id=3`,
    ]);
    expect(campoStatus()).toHaveValue("expired");
    await waitFor(() => expect(campoCelula()).toHaveValue("celula:3"));
    expect(campoBusca()).toHaveValue("");
  });

  it("trocar o filtro depois do Carregar mais recomeça da primeira página (sem cursor)", async () => {
    const api = simularApi({ pedidos: pedidosVariados(120) });
    abrir();
    await tabela();
    acionar(botaoCarregarMais());
    await waitFor(async () => expect(await linhas()).toHaveLength(100));

    fireEvent.change(campoStatus(), { target: { value: "in_process" } });

    await waitFor(async () => expect(await linhas()).toHaveLength(40));
    expect(api.pedidosA(ROTA_PEDIDOS).at(-1)).toBe(
      `${ROTA_PEDIDOS}?limite=50&status=in_process`,
    );
    expect(
      screen.getByText("40 pedidos; não há pedidos mais antigos."),
    ).toBeInTheDocument();
  });

  it("nenhum pedido com os filtros: diz isso e 'Limpar filtros' volta à lista toda, com o foco no primeiro filtro", async () => {
    simularApi({ pedidos: pedidosVariados(6) });
    const { roteador } = abrir(`${CAMINHO}?id=NAO-EXISTE`);

    expect(
      await screen.findByText("Nenhum pedido com estes filtros."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    acionar(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(await linhas()).toHaveLength(6);
    expect(roteador.state.location.search).toBe("");
    // O botão sumiu com a lista vazia: o foco foi para o primeiro filtro (não para o body).
    await waitFor(() => expect(campoStatus()).toHaveFocus());
  });
});

describe("estados da lista de pedidos", () => {
  it("carregando: anuncia enquanto a primeira página não chega", async () => {
    let liberar: () => void = () => {};
    const segura = new Promise<void>((resolver) => (liberar = resolver));
    const api = simularApi();
    api.proxima(ROTA_PEDIDOS, async () => {
      await segura;
      return respostaJson({
        itens: [],
        proximo: null,
        totais: {
          in_process: { pedidos: 0, bilhetes: 0, total_centavos: 0 },
          approved: { pedidos: 0, bilhetes: 0, total_centavos: 0 },
          expired: { pedidos: 0, bilhetes: 0, total_centavos: 0 },
        },
      });
    });
    abrir();

    await waitFor(() => expect(api.pedidosA(ROTA_PEDIDOS)).toHaveLength(1));
    expect(screen.getByText("Carregando os pedidos…")).toBeInTheDocument();
    liberar();
    expect(await screen.findByText("Nenhum pedido ainda.")).toBeInTheDocument();
  });

  it("vazia, sem filtro: explica de onde vêm os pedidos, sem tabela, totais nem botão", async () => {
    simularApi();
    abrir();

    expect(await screen.findByText("Nenhum pedido ainda.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Os pedidos chegam da Rifei pelo webhook e aparecem aqui assim que são feitos.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Carregar mais" }),
    ).not.toBeInTheDocument();
  });

  it("erro: mostra a mensagem e 'Tentar de novo' carrega outra vez", async () => {
    const api = simularApi({ pedidos: pedidosVariados(2) });
    api.proxima(ROTA_PEDIDOS, () =>
      respostaErro(500, "erro_interno", "Erro interno do servidor."),
    );
    abrir();

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Não foi possível carregar os pedidos.");
    expect(alerta).toHaveTextContent("Erro interno do servidor.");

    fireEvent.click(
      within(alerta).getByRole("button", { name: "Tentar de novo" }),
    );
    expect(await linhas()).toHaveLength(2);
    expect(api.pedidosA(ROTA_PEDIDOS)).toHaveLength(2);
  });

  it("403 da API (o papel mudou com a tela aberta): diz que é da coordenação, sem 'Tentar de novo'", async () => {
    const api = simularApi();
    api.proxima(ROTA_PEDIDOS, () =>
      respostaErro(403, "proibido", "Sem permissão para esta rota."),
    );
    abrir();

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Sem permissão para ver os pedidos");
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
  });

  it("falha ao carregar as células: o filtro de célula avisa e a lista funciona", async () => {
    const api = simularApi({ pedidos: pedidosVariados(3) });
    api.proxima("/api/admin/celulas", () =>
      respostaErro(500, "erro_interno", "Erro interno do servidor."),
    );
    abrir(`${CAMINHO}?celula_id=1`);

    expect(await linhas()).toHaveLength(1);
    await waitFor(() =>
      expect(campoCelula()).toHaveAccessibleDescription(
        "Não foi possível carregar as células; recarregue a página para tentar de novo.",
      ),
    );
    // A célula da URL continua escolhida, com uma opção só para ela.
    expect(campoCelula()).toHaveValue("celula:1");
    expect(
      within(campoCelula()).getByRole("option", { name: "Célula 1" }),
    ).toBeInTheDocument();
  });
});

describe("CA4: coordenação e admin veem a tela; líder, discipulador e rede, não", () => {
  it.each([
    ["coordenação", USUARIO_DE_TESTE],
    ["admin", ADMIN_DE_TESTE],
  ] as const)(
    "%s: 'Pedidos' no menu, e a tela mostra a lista",
    async (_papel, usuario) => {
      simularApi({ pedidos: pedidosVariados(3) });
      const { roteador } = abrir("/coordenacao", usuario);
      const menu = screen.getByRole("navigation", { name: "Coordenação" });

      fireEvent.click(within(menu).getByRole("link", { name: "Pedidos" }));

      expect(roteador.state.location.pathname).toBe(CAMINHO);
      expect(await linhas()).toHaveLength(3);
    },
  );

  it.each([
    ["líder", LIDER],
    ["discipulador", DISCIPULADOR],
    ["rede", REDE],
  ] as const)(
    "%s: o endereço leva para /minha, sem montar a tela nem pedir nada da coordenação à API",
    async (_papel, usuario) => {
      const api = simularApi({ pedidos: pedidosVariados(3) });
      const { roteador } = abrir(CAMINHO, usuario);

      await waitFor(() =>
        expect(roteador.state.location.pathname).toBe("/minha"),
      );
      expect(
        screen.queryByRole("heading", { level: 1, name: "Pedidos" }),
      ).not.toBeInTheDocument();
      expect(
        api.chamadas.filter((caminho) => caminho.startsWith("/api/admin")),
      ).toEqual([]);
    },
  );
});

describe("CA5: acessibilidade da tela", () => {
  it("abas no padrão WAI-ARIA (a dos pedidos aberta por padrão), tabela com nome e cabeçalhos, campos com rótulo e um h1 só", async () => {
    simularApi({ pedidos: pedidosVariados(3) });
    abrir();

    const lista = await screen.findByRole("tablist", {
      name: "Pedidos e entregas do webhook",
    });
    expect(
      within(lista)
        .getAllByRole("tab")
        .map((aba) => [aba.textContent, aba.getAttribute("aria-selected")]),
    ).toEqual([
      ["Pedidos", "true"],
      ["Entregas do webhook", "false"],
    ]);
    expect(await tabela()).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    for (const campo of [campoStatus(), campoCelula(), campoBusca()])
      expect(campo).toHaveAccessibleName();
    expect(
      screen.getByRole("region", { name: "Totais por status" }),
    ).toBeInTheDocument();
  });
});
