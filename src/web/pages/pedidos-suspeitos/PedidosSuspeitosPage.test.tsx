// RIFA-024: /coordenacao/pedidos-suspeitos (coordenação), pela rota de verdade e com a API simulada; toda
// resposta passa pelo schema do contrato (respostaPedidosSuspeitosSchema).
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  respostaPedidosSuspeitosSchema,
  type PedidoSuspeito,
  type RespostaPedidosSuspeitos,
} from "../../../shared/contracts";
import {
  ADMIN_DE_TESTE,
  renderizarRota,
  respostaJson,
} from "../../test/renderizar";

const CAMINHO = "/coordenacao/pedidos-suspeitos";
const ROTA_API = "/api/admin/pedidos/suspeitos";

const MENSAGEM_TETO =
  "Mais de 200 bilhetes num pedido só: confira na Rifei (o pedido continua contando)";
const MENSAGEM_ABAIXO =
  "Total abaixo de bilhetes × preço do bilhete da campanha com mais de 50% de desconto: confira na Rifei (o pedido continua contando)";

/** O exemplo do docs/api.md: 300 bilhetes por R$ 60,00 (esperado R$ 6.000,00). */
function pedido(parcial: Partial<PedidoSuspeito> = {}): PedidoSuspeito {
  return {
    pedido_id: "PEDTESTE0001",
    affiliate_id: 1042,
    celula_id: 7,
    celula_nome: "Célula Ficticia 07",
    qtd_bilhetes: 300,
    total_centavos: 6000,
    esperado_centavos: 600000,
    motivos: [
      {
        caminho: ["numbers_count"],
        codigo: "quantidade_acima_do_teto",
        mensagem: MENSAGEM_TETO,
        ocorrencias: 1,
      },
      {
        caminho: ["total"],
        codigo: "total_abaixo_do_esperado",
        mensagem: MENSAGEM_ABAIXO,
        ocorrencias: 1,
      },
    ],
    aprovado_em: "2026-12-01T12:20:31.512Z",
    marcado_em: "2026-12-01T12:20:32.004Z",
    desconsiderado: null,
    ...parcial,
  };
}

/** Um pedido de 3 bilhetes pago a mais: R$ 90,00 contra R$ 60,00. */
const pagoAMais = pedido({
  pedido_id: "PEDTESTE0002",
  qtd_bilhetes: 3,
  total_centavos: 9000,
  esperado_centavos: 6000,
  motivos: [
    {
      caminho: ["total"],
      codigo: "total_acima_do_esperado",
      mensagem:
        "Total acima de bilhetes × preço do bilhete da campanha: confira na Rifei (o pedido continua contando)",
      ocorrencias: 1,
    },
  ],
  aprovado_em: "2026-11-30T02:05:00.000Z",
  marcado_em: "2026-11-30T02:05:01.000Z",
});

type Responder = () => Response | Promise<Response>;

/** Simula a API: a lista (validada pelo schema) ou a resposta dada; outra rota recebe 404. */
function simularApi(resposta: RespostaPedidosSuspeitos | Responder) {
  const pedidos: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (caminho: string) => {
      if (caminho !== ROTA_API) {
        return respostaJson(
          {
            erro: { codigo: "nao_encontrado", mensagem: "Rota não encontrada" },
          },
          404,
        );
      }
      pedidos.push(caminho);
      return typeof resposta === "function"
        ? resposta()
        : respostaJson(respostaPedidosSuspeitosSchema.parse(resposta));
    }),
  );
  return { pedidos };
}

const erroApi = (status: number, codigo: string, mensagem: string) => () =>
  respostaJson({ erro: { codigo, mensagem } }, status);

const tabela = () =>
  screen.findByRole("table", {
    name: "Pedidos suspeitos, o mais recente primeiro",
  });

async function linhas() {
  const [, corpo] = within(await tabela()).getAllByRole("rowgroup");
  return within(corpo).getAllByRole("row");
}

/** O texto de uma célula da linha, pelo rótulo da coluna. */
function celula(linha: HTMLElement, rotulo: string): HTMLElement {
  const achada = within(linha)
    .getAllByRole("cell")
    .find((elemento) => elemento.dataset.rotulo === rotulo);
  if (!achada) throw new Error(`sem a coluna ${rotulo}`);
  return achada;
}

/** O texto do elemento, com o espaço não separável do "R$" (U+00A0) trocado por espaço comum. */
const texto = (elemento: HTMLElement) =>
  elemento.textContent?.replace(/\u00a0/g, " ");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RIFA-028 (D20): o pedido suspeito já desconsiderado", () => {
  it("fica na lista (e no total) com o mesmo selo da tela Pedidos: 'Desconsiderado (motivo)'", async () => {
    simularApi({
      itens: [
        pedido({
          desconsiderado: {
            motivo: "fraude",
            observacao: null,
            em: "2026-12-01T13:00:00.000Z",
          },
        }),
        pagoAMais,
      ],
      total: 2,
    });
    renderizarRota(CAMINHO);

    const [primeiro, segundo] = await linhas();
    expect(celula(primeiro, "Pedido")).toHaveTextContent(
      "PEDTESTE0001Desconsiderado (fraude)",
    );
    expect(
      within(celula(segundo, "Pedido")).queryByText(/Desconsiderado/),
    ).not.toBeInTheDocument();
    expect(screen.getByText("2 pedidos marcados.")).toBeInTheDocument();
  });
});

describe("RIFA-024: a lista dos pedidos suspeitos", () => {
  it("explica que o pedido conta nas vendas até o admin desconsiderá-lo (D20)", async () => {
    simularApi({ itens: [pedido()], total: 1 });
    renderizarRota(CAMINHO);

    expect(
      screen.getByRole("heading", { level: 1, name: "Pedidos suspeitos" }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Pedidos suspeitos · Projeto Videira Kids");
    expect(screen.getByText("Estes pedidos contam nas vendas")).toBeVisible();
    expect(
      screen.getByText(
        "Cada pedido desta lista continua contando nas vendas, no painel e nos rankings até o admin desconsiderá-lo na tela Pedidos (com “Permitir desconsiderar pedidos” ligado na Campanha). O desconsiderado fica aqui, com o selo. Esta tela só aponta o que conferir.",
      ),
    ).toBeInTheDocument();
    await tabela();
  });

  it("mostra pedido, quando (no fuso da campanha), célula, bilhetes, total e os motivos em português com o detalhe, numa tabela com cabeçalhos", async () => {
    const { pedidos } = simularApi({ itens: [pedido(), pagoAMais], total: 2 });
    renderizarRota(CAMINHO);

    const tabelaDosPedidos = await tabela();
    expect(
      within(tabelaDosPedidos)
        .getAllByRole("columnheader")
        .map((cabecalho) => cabecalho.textContent),
    ).toEqual(["Pedido", "Quando", "Célula", "Bilhetes", "Total", "Motivos"]);
    expect(screen.getByText("2 pedidos marcados.")).toBeInTheDocument();

    const [primeiro, segundo] = await linhas();
    expect(celula(primeiro, "Pedido")).toHaveTextContent("PEDTESTE0001");
    // 12:20 UTC = 09:20 em Belém.
    expect(celula(primeiro, "Quando")).toHaveTextContent("01/12/2026 09:20");
    expect(
      within(celula(primeiro, "Quando")).getByText("01/12/2026 09:20"),
    ).toHaveAttribute("datetime", "2026-12-01T12:20:31.512Z");
    expect(celula(primeiro, "Célula")).toHaveTextContent("Célula Ficticia 07");
    expect(celula(primeiro, "Bilhetes")).toHaveTextContent("300");
    expect(texto(celula(primeiro, "Total"))).toBe("R$ 60,00");

    const motivos = within(celula(primeiro, "Motivos")).getAllByRole(
      "listitem",
    );
    expect(motivos.map(texto)).toEqual([
      "Bilhetes acima do teto 300 bilhetes num pedido só; o teto é 200 por pedido.",
      "Total abaixo do esperado Pago R$ 60,00: desconto de mais de 50% sobre bilhetes × preço do bilhete (R$ 6.000,00).",
    ]);

    // 02:05 UTC do dia 30 = 23:05 do dia 29 em Belém.
    expect(celula(segundo, "Quando")).toHaveTextContent("29/11/2026 23:05");
    expect(texto(celula(segundo, "Total"))).toBe("R$ 90,00");
    expect(texto(celula(segundo, "Motivos"))).toBe(
      "Total acima do esperado Pago R$ 90,00, mais que bilhetes × preço do bilhete (R$ 60,00).",
    );

    // Os códigos da API não aparecem; os valores em R$ podem (área da coordenação).
    expect(document.body.textContent).not.toMatch(
      /quantidade_acima_do_teto|total_(acima|abaixo)_do_esperado/,
    );
    expect(pedidos).toEqual([ROTA_API]);
  });

  it("sem célula vinculada, sem afiliado, sem data de aprovação e com um motivo que o site não conhece", async () => {
    simularApi(() =>
      // Fora do schema de propósito (um código novo): a tela não pode quebrar nem esconder o pedido.
      respostaJson({
        itens: [
          pedido({
            pedido_id: "PEDSEMCELULA",
            celula_id: null,
            celula_nome: null,
          }),
          pedido({
            pedido_id: "PEDSEMAFILIADO",
            affiliate_id: null,
            celula_id: null,
            celula_nome: null,
            aprovado_em: null,
            motivos: [
              {
                caminho: ["total"],
                codigo: "motivo_novo",
                mensagem: "Um motivo que veio depois: confira na Rifei",
                ocorrencias: 1,
              } as unknown as PedidoSuspeito["motivos"][number],
            ],
          }),
        ],
        total: 2,
      }),
    );
    renderizarRota(CAMINHO);

    const [semCelula, semAfiliado] = await linhas();
    expect(celula(semCelula, "Célula").textContent).toBe(
      "Afiliado 1042, sem célula vinculada",
    );
    expect(celula(semAfiliado, "Célula").textContent).toBe("Sem afiliado");
    expect(celula(semAfiliado, "Quando").textContent).toBe(
      "Marcado em 01/12/2026 09:20",
    );
    expect(celula(semAfiliado, "Motivos").textContent).toBe(
      "Outro motivo Um motivo que veio depois: confira na Rifei",
    );
  });

  it("com mais marcados do que a lista traz, diz que mostra só os mais recentes", async () => {
    simularApi({
      itens: ["A", "B", "C"].map((letra) =>
        pedido({ pedido_id: `PEDTESTE000${letra}` }),
      ),
      total: 1612,
    });
    renderizarRota(CAMINHO);

    expect(await linhas()).toHaveLength(3);
    expect(
      screen.getByText("1.612 pedidos marcados; mostrando os 3 mais recentes."),
    ).toBeInTheDocument();
  });

  it("um pedido só: o texto no singular", async () => {
    simularApi({ itens: [pedido()], total: 1 });
    renderizarRota(CAMINHO);

    await tabela();
    expect(screen.getByText("1 pedido marcado.")).toBeInTheDocument();
  });
});

describe("RIFA-024: estados dos pedidos suspeitos", () => {
  it("carregando: anuncia enquanto a lista não chega", async () => {
    let liberar: () => void = () => {};
    const segura = new Promise<void>((resolver) => (liberar = resolver));
    const { pedidos } = simularApi(async () => {
      await segura;
      return respostaJson({ itens: [], total: 0 });
    });
    renderizarRota(CAMINHO);

    await waitFor(() => expect(pedidos).toHaveLength(1));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Carregando os pedidos marcados…",
    );
    liberar();
    expect(await screen.findByText("Nenhum pedido marcado.")).toBeVisible();
  });

  it("vazia: explica quando um pedido aparece aqui, sem tabela", async () => {
    simularApi({ itens: [], total: 0 });
    renderizarRota(CAMINHO);

    expect(await screen.findByText("Nenhum pedido marcado.")).toBeVisible();
    expect(
      screen.getByText(
        "Quando um pedido aprovado vier com bilhetes demais ou com o total fora de bilhetes × preço do bilhete, ele aparece aqui.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("erro: mostra a mensagem e 'Tentar de novo' carrega outra vez", async () => {
    let falhar = true;
    const { pedidos } = simularApi(() =>
      falhar
        ? erroApi(500, "erro_interno", "Erro interno do servidor.")()
        : respostaJson({ itens: [pedido()], total: 1 }),
    );
    renderizarRota(CAMINHO);

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent(
      "Não foi possível carregar os pedidos suspeitos.",
    );
    expect(alerta).toHaveTextContent("Erro interno do servidor.");

    falhar = false;
    fireEvent.click(
      within(alerta).getByRole("button", { name: "Tentar de novo" }),
    );
    expect(await linhas()).toHaveLength(1);
    expect(pedidos).toHaveLength(2);
  });

  it("403 da API: diz que não tem permissão, sem 'Tentar de novo'", async () => {
    simularApi(erroApi(403, "proibido", "Sem permissão para esta rota."));
    renderizarRota(CAMINHO);

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent(
      "Sem permissão para ver os pedidos suspeitos",
    );
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
  });

  it("401 (a sessão terminou): vai para /entrar com o aviso", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respostaJson(
          { erro: { codigo: "nao_autenticado", mensagem: "Sessão inválida" } },
          401,
        ),
      ),
    );
    const { roteador } = renderizarRota(CAMINHO);

    await waitFor(() =>
      expect(roteador.state.location.pathname).toBe("/entrar"),
    );
    expect(await screen.findByText(/Sua sessão terminou/)).toBeInTheDocument();
  });
});

describe("RIFA-024: menu da coordenação", () => {
  it.each([
    ["coordenacao", undefined],
    ["admin", ADMIN_DE_TESTE],
  ] as const)(
    "papel %s: 'Pedidos suspeitos' no menu, logo depois de 'Pedidos', e o link abre a tela",
    async (_papel, usuario) => {
      simularApi({ itens: [pedido()], total: 1 });
      const { roteador } = renderizarRota("/coordenacao", { usuario });
      const menu = screen.getByRole("navigation", { name: "Coordenação" });
      // "Quem comprou" (RIFA-093, só do admin) fica entre os dois no menu do admin.
      const rotulos = within(menu)
        .getAllByRole("link")
        .map((link) => link.textContent)
        .filter((rotulo) => rotulo !== "Quem comprou");
      expect(rotulos[rotulos.indexOf("Pedidos") + 1]).toBe("Pedidos suspeitos");

      fireEvent.click(
        within(menu).getByRole("link", { name: "Pedidos suspeitos" }),
      );

      expect(roteador.state.location.pathname).toBe(CAMINHO);
      expect(await tabela()).toBeInTheDocument();
      // Só o link da tela atual fica marcado (o de "Pedidos" não casa com "pedidos-suspeitos").
      expect(
        within(menu)
          .getAllByRole("link")
          .filter((link) => link.getAttribute("aria-current") === "page")
          .map((link) => link.textContent),
      ).toEqual(["Pedidos suspeitos"]);
    },
  );
});
