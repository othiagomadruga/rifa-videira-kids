// RIFA-070 (D32): "Marcar como pago na Rifei" na lista "Para marcar" do extrato, pela rota de verdade e com a API
// falsa. Só o admin vê o botão; a confirmação mostra os números; para a API vão só os NÚMEROS dos pedidos (nada do
// extrato); o resultado diz quantos foram marcados e quais não, com o motivo; sem a configuração, a tela manda usar o
// "Copiar os números". O caminho é a cópia do contrato.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROTAS_RIFEI_API } from "../../../../shared/contracts/api";
import {
  ADMIN_DE_TESTE,
  renderizarRota,
  respostaJson,
} from "../../../test/renderizar";
import { CAMINHO_MARCAR_PAGOS } from "./marcar-na-rifei-api";
import {
  AGORA,
  OFX_SGML,
  PAGADORA_UM,
  criarApiDoExtrato,
  itemPedido,
} from "./teste-apoio";
import { CAMPOS, GRUPOS, MARCAR_A_MAO, MARCAR_NA_RIFEI } from "./textos";

const CAMINHO = "/coordenacao/conferencia";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: AGORA });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function abrirComExtrato(
  api: ReturnType<typeof criarApiDoExtrato>,
  admin = true,
) {
  vi.stubGlobal("fetch", api.fetch);
  renderizarRota(CAMINHO, admin ? { usuario: ADMIN_DE_TESTE } : undefined);
  const campo = await screen.findByLabelText(CAMPOS.arquivo.rotulo, undefined, {
    timeout: 5000,
  });
  fireEvent.change(campo, {
    target: { files: [new File([OFX_SGML], "extrato.ofx")] },
  });
  return screen.findByRole(
    "region",
    { name: GRUPOS.paraMarcar.titulo },
    {
      timeout: 5000,
    },
  );
}

describe("RIFA-070: Marcar como pago na Rifei", () => {
  it("o caminho é a cópia do contrato (POST, só admin)", () => {
    expect(CAMINHO_MARCAR_PAGOS).toBe(ROTAS_RIFEI_API.marcarPagosRifei.caminho);
    expect(ROTAS_RIFEI_API.marcarPagosRifei.metodo).toBe("POST");
    expect(ROTAS_RIFEI_API.marcarPagosRifei.papeis).toEqual(["admin"]);
  });

  it("a coordenação não vê o botão (só o Copiar)", async () => {
    const grupo = await abrirComExtrato(criarApiDoExtrato(), false);
    expect(
      within(grupo).queryByRole("button", { name: MARCAR_NA_RIFEI.botao(2) }),
    ).toBeNull();
  });

  it("o admin confirma, só os números vão à API e a tela mostra o resultado de cada pedido", async () => {
    const api = criarApiDoExtrato({
      marcarNaRifei: (pedidos) =>
        respostaJson({
          itens: pedidos.map((pedido_id, indice) => ({
            pedido_id,
            resultado: indice === 0 ? "marcado" : "recusado_pela_rifei",
            mensagem: indice === 0 ? null : "Este pedido não pode ser aprovado",
          })),
          marcados: 1,
        }),
    });
    const grupo = await abrirComExtrato(api);
    fireEvent.click(
      within(grupo).getByRole("button", { name: MARCAR_NA_RIFEI.botao(2) }),
    );
    const dialogo = await screen.findByRole("alertdialog");
    expect(
      within(dialogo).getByText("PEDTESTE0101, PEDTESTE0103"),
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialogo).getByRole("button", { name: MARCAR_NA_RIFEI.confirmar }),
    );

    expect(
      await within(grupo).findByText(MARCAR_NA_RIFEI.resultadoTitulo(1, 2)),
    ).toBeInTheDocument();
    expect(
      within(grupo).getByText("Este pedido não pode ser aprovado"),
    ).toBeInTheDocument();
    expect(
      within(grupo).getByText(MARCAR_NA_RIFEI.resultados.recusado_pela_rifei),
    ).toBeInTheDocument();

    const posts = api.chamadas.filter((chamada) => chamada.metodo === "POST");
    expect(posts).toEqual([
      {
        metodo: "POST",
        url: CAMINHO_MARCAR_PAGOS,
        corpo: JSON.stringify({ pedidos: ["PEDTESTE0101", "PEDTESTE0103"] }),
      },
    ]);
    // Nada do extrato (o nome de quem pagou, o FITID) sai da tela.
    expect(JSON.stringify(api.chamadas)).not.toContain(PAGADORA_UM);

    // "Buscar de novo" busca os pedidos mesmo com a busca de antes cobrindo o extrato.
    const antes = api.pedidos().length;
    fireEvent.click(
      within(grupo).getByRole("button", { name: MARCAR_NA_RIFEI.buscarDeNovo }),
    );
    await waitFor(() => expect(api.pedidos().length).toBeGreaterThan(antes));
  });

  it("sem a configuração no servidor (503): a tela manda usar o Copiar os números", async () => {
    const api = criarApiDoExtrato({
      marcarNaRifei: () =>
        respostaJson(
          { erro: { codigo: "nao_configurado", mensagem: "Falta o segredo" } },
          503,
        ),
    });
    const grupo = await abrirComExtrato(api);
    fireEvent.click(
      within(grupo).getByRole("button", { name: MARCAR_NA_RIFEI.botao(2) }),
    );
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: MARCAR_NA_RIFEI.confirmar,
      }),
    );
    expect(
      await within(grupo).findByText(MARCAR_NA_RIFEI.semConfiguracao),
    ).toBeInTheDocument();
  });
});

/** A resposta da API de marcar: cada número com o resultado dado (padrão: marcado). */
function respostaMarcar(
  pedidos: string[],
  resultados: Record<string, [string, string | null]> = {},
) {
  const itens = pedidos.map((pedido_id) => {
    const [resultado, mensagem] = resultados[pedido_id] ?? ["marcado", null];
    return { pedido_id, resultado, mensagem };
  });
  return respostaJson({
    itens,
    marcados: itens.filter((item) =>
      ["marcado", "restaurado_e_marcado"].includes(item.resultado),
    ).length,
  });
}

describe("RIFA-070 (D32): seleção, resultado por pedido e token recusado", () => {
  it("cada pedido com a caixa (todos marcados); desmarcar um muda o botão, a confirmação e o que vai à API", async () => {
    const api = criarApiDoExtrato({
      marcarNaRifei: (pedidos) => respostaMarcar(pedidos),
    });
    const grupo = await abrirComExtrato(api);
    const caixas = within(grupo).getAllByRole("checkbox");
    expect(caixas).toHaveLength(2);
    for (const caixa of caixas) expect(caixa).toBeChecked();

    fireEvent.click(
      within(grupo).getByRole("checkbox", { name: /PEDTESTE0101/ }),
    );
    fireEvent.click(
      within(grupo).getByRole("button", { name: MARCAR_NA_RIFEI.botao(1) }),
    );
    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByText("PEDTESTE0103")).toBeInTheDocument();
    fireEvent.click(
      within(dialogo).getByRole("button", { name: MARCAR_NA_RIFEI.confirmar }),
    );
    await within(grupo).findByText(MARCAR_NA_RIFEI.resultadoTitulo(1, 1));
    expect(
      api.chamadas.filter((chamada) => chamada.metodo === "POST")[0].corpo,
    ).toBe(JSON.stringify({ pedidos: ["PEDTESTE0103"] }));

    // Desmarcar todos deixa o botão indisponível; Selecionar todos volta os dois.
    fireEvent.click(
      within(grupo).getByRole("button", {
        name: MARCAR_NA_RIFEI.selecionarTodos,
      }),
    );
    expect(
      within(grupo).getByRole("button", { name: MARCAR_NA_RIFEI.botao(2) }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(grupo).getByRole("button", {
        name: MARCAR_NA_RIFEI.desmarcarTodos,
      }),
    );
    expect(
      within(grupo).getByRole("button", { name: MARCAR_NA_RIFEI.botao(0) }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("o resultado de cada pedido: marcado, já pago, expirado e restaurado, falhou com o motivo", async () => {
    const api = criarApiDoExtrato({
      marcarNaRifei: (pedidos) =>
        respostaMarcar(pedidos, {
          PEDTESTE0101: ["ja_pago", null],
          PEDTESTE0103: ["falhou", "A Rifei não respondeu para este pedido"],
        }),
    });
    const grupo = await abrirComExtrato(api);
    fireEvent.click(
      within(grupo).getByRole("button", { name: MARCAR_NA_RIFEI.botao(2) }),
    );
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: MARCAR_NA_RIFEI.confirmar,
      }),
    );
    const tabela = await within(grupo).findByRole("table", {
      name: MARCAR_NA_RIFEI.legendaResultado,
    });
    expect(
      within(tabela).getByText(MARCAR_NA_RIFEI.resultados.ja_pago),
    ).toBeInTheDocument();
    expect(
      within(tabela).getByText(MARCAR_NA_RIFEI.resultados.falhou),
    ).toBeInTheDocument();
    expect(
      within(tabela).getByText("A Rifei não respondeu para este pedido"),
    ).toBeInTheDocument();
    expect(MARCAR_NA_RIFEI.resultados.restaurado_e_marcado).toMatch(
      /expirado: restaurado/,
    );
  });

  it("token vencido (502 da Rifei): a mensagem clara para colar um novo; e o topo mostra a recusa", async () => {
    const mensagem =
      "A Rifei recusou o token: cole um novo em Conexão com a Rifei (Acessos → Conexão com a Rifei).";
    const api = criarApiDoExtrato({
      conexao: {
        origem: "tela",
        conectado_em: "2026-11-19T12:00:00.000Z",
        final: "abcd",
        testado_em: "2026-11-19T12:00:00.000Z",
        recusado_em: "2026-11-19T15:00:00.000Z",
        expira_em: null,
        chave_configurada: true,
        token_legivel: true,
        segredo_configurado: false,
      },
      marcarNaRifei: () =>
        respostaJson(
          {
            erro: {
              codigo: "rifei_falhou",
              mensagem,
              detalhes: { motivo: "token_invalido" },
            },
          },
          502,
        ),
    });
    const grupo = await abrirComExtrato(api);
    expect(
      screen.getByText(/A Rifei recusou o token \(19\/11\/2026 às 12:00\)/),
    ).toBeInTheDocument();
    fireEvent.click(
      within(grupo).getByRole("button", { name: MARCAR_NA_RIFEI.botao(2) }),
    );
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: MARCAR_NA_RIFEI.confirmar,
      }),
    );
    expect(await within(grupo).findByText(mensagem)).toBeInTheDocument();
  });
});

describe("RIFA-070 (D32): marcar um pedido à mão", () => {
  async function abrirSemExtrato(api: ReturnType<typeof criarApiDoExtrato>) {
    vi.stubGlobal("fetch", api.fetch);
    renderizarRota(CAMINHO, { usuario: ADMIN_DE_TESTE });
    return screen.findByLabelText(MARCAR_A_MAO.rotulo, undefined, {
      timeout: 5000,
    });
  }

  it("acha pelo bilhete, mostra o pedido (célula, bilhetes, valor, situação) e marca com confirmação", async () => {
    const api = criarApiDoExtrato({
      buscarPedido: (numero) =>
        respostaJson({
          pedidos:
            numero === "0042"
              ? [
                  {
                    achado_por: "bilhete",
                    pedido: itemPedido("PEDMAO1", {
                      qtd_bilhetes: 3,
                      total_centavos: 7500,
                    }),
                  },
                ]
              : [],
        }),
      marcarNaRifei: (pedidos) => respostaMarcar(pedidos),
    });
    const campo = await abrirSemExtrato(api);
    fireEvent.change(campo, { target: { value: "0042" } });
    fireEvent.click(screen.getByRole("button", { name: MARCAR_A_MAO.buscar }));
    expect(await screen.findByText("Pedido PEDMAO1")).toBeInTheDocument();
    expect(
      screen.getByText(MARCAR_A_MAO.achadoPeloBilhete),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Célula Ágape · 3 bilhetes · R\$\s?75,00/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: MARCAR_A_MAO.marcar }));
    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByText("PEDMAO1")).toBeInTheDocument();
    fireEvent.click(
      within(dialogo).getByRole("button", { name: MARCAR_NA_RIFEI.confirmar }),
    );
    expect(
      await screen.findByText(MARCAR_NA_RIFEI.resultadoTitulo(1, 1), {
        selector: ":not(.visualmente-oculto)",
      }),
    ).toBeInTheDocument();
    expect(
      api.chamadas.filter((chamada) => chamada.metodo === "POST")[0].corpo,
    ).toBe(JSON.stringify({ pedidos: ["PEDMAO1"] }));
  });

  it("pedido já pago: avisa e não oferece marcar; não achou: diz o que conferir", async () => {
    const api = criarApiDoExtrato({
      buscarPedido: (numero) =>
        respostaJson({
          pedidos:
            numero === "PEDPAGO"
              ? [
                  {
                    achado_por: "pedido",
                    pedido: itemPedido("PEDPAGO", { status: "approved" }),
                  },
                ]
              : [],
        }),
    });
    const campo = await abrirSemExtrato(api);
    fireEvent.change(campo, { target: { value: "PEDPAGO" } });
    fireEvent.click(screen.getByRole("button", { name: MARCAR_A_MAO.buscar }));
    expect(await screen.findByText(MARCAR_A_MAO.jaPago)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: MARCAR_A_MAO.marcar }),
    ).toBeNull();

    fireEvent.change(campo, { target: { value: "999" } });
    fireEvent.click(screen.getByRole("button", { name: MARCAR_A_MAO.buscar }));
    expect(
      await screen.findByText(MARCAR_A_MAO.naoAchou("999"), {
        selector: ":not(.visualmente-oculto)",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(MARCAR_A_MAO.oQueConferir)).toBeInTheDocument();
  });

  it("a coordenação não vê o Marcar à mão", async () => {
    vi.stubGlobal("fetch", criarApiDoExtrato().fetch);
    renderizarRota(CAMINHO);
    await screen.findByLabelText(CAMPOS.arquivo.rotulo, undefined, {
      timeout: 5000,
    });
    expect(screen.queryByLabelText(MARCAR_A_MAO.rotulo)).toBeNull();
  });
});
