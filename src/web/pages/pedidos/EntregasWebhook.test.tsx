// RIFA-025, CA2: a aba "Entregas do webhook" da tela Pedidos, pela rota de verdade e com a API falsa de
// teste-apoio.ts (pagina pelo id como GET /api/admin/webhook/entregas e passa tudo pelos schemas do contrato).
// O erro e os avisos aparecem legíveis (campo: texto), sem código cru, mensagem gravada nem dado pessoal.
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderizarRota } from "../../test/renderizar";
import {
  ROTA_ENTREGAS,
  ROTA_PEDIDOS,
  entrega,
  entregasEmSequencia,
  idDoPedidoFicticio,
  respostaErro,
  simularApi,
} from "./teste-apoio";

const CAMINHO = "/coordenacao/pedidos?aba=entregas";

const tabela = () =>
  screen.findByRole("table", {
    name: "Entregas do webhook, da mais recente para a mais antiga",
  });

async function linhas() {
  const [, corpo] = within(await tabela()).getAllByRole("rowgroup");
  return within(corpo).getAllByRole("row");
}

/** O texto de cada célula de uma linha, com os blocos internos separados por " | ". */
function celulas(linha: HTMLElement) {
  return within(linha)
    .getAllByRole("cell")
    .map((celula) => {
      const blocos = celula.querySelectorAll(
        "p, li, .ui-badge, .pedidos-resultado__explicacao",
      );
      return blocos.length > 0
        ? [...blocos].map((bloco) => bloco.textContent).join(" | ")
        : celula.textContent;
    });
}

const campoResultado = () =>
  screen.getByRole("combobox", { name: "Resultado" });

function acionar(elemento: HTMLElement) {
  act(() => elemento.focus());
  fireEvent.click(elemento);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Uma entrega de cada tipo, com os erros e avisos que a API pode mandar (campo, código e ocorrências). */
const ENTREGAS_VARIADAS = [
  entrega(9, {
    evento: null,
    pedido_id: null,
    slug: null,
    resultado: "erro_validacao",
    status_anterior: null,
    status_resultante: null,
    erro: {
      codigo: "json_invalido",
      problemas: [{ campo: "", codigo: "json_invalido", ocorrencias: 1 }],
    },
  }),
  entrega(8, {
    resultado: "erro_validacao",
    status_anterior: null,
    status_resultante: null,
    erro: {
      codigo: "payload_invalido",
      problemas: [
        { campo: "total", codigo: "invalid_type", ocorrencias: 1 },
        { campo: "numbers_count", codigo: "too_big", ocorrencias: 1 },
      ],
    },
  }),
  entrega(7, {
    evento: "new_order",
    status_anterior: null,
    status_resultante: "in_process",
    avisos: [
      { campo: "buyer.phone", codigo: "invalid_type", ocorrencias: 1 },
      { campo: "numbers.*", codigo: "invalid_type", ocorrencias: 5000 },
      { campo: "total", codigo: "fracao_de_centavo", ocorrencias: 1 },
    ],
  }),
  entrega(6, {
    avisos: [
      { campo: "total", codigo: "total_abaixo_do_esperado", ocorrencias: 1 },
      { campo: "affiliate_id", codigo: "afiliado_alterado", ocorrencias: 1 },
    ],
  }),
  entrega(5, {
    resultado: "duplicado",
    status_anterior: "approved",
    status_resultante: "approved",
  }),
  entrega(4, {
    slug: "outra-campanha",
    resultado: "ignorado_outra_campanha",
    status_anterior: null,
    status_resultante: null,
  }),
  entrega(3, {
    evento: "expired_order",
    resultado: "ignorado_transicao",
    status_anterior: "approved",
    status_resultante: "approved",
  }),
  entrega(2, {
    evento: "refund_order",
    status_anterior: "in_process",
    status_resultante: "expired",
    avisos: [
      { campo: "slug", codigo: "codigo_novo", ocorrencias: 1 },
      { campo: "", codigo: "itens_omitidos", ocorrencias: 12 },
    ],
  }),
];

describe("CA2: entregas com o resultado em português e o erro e os avisos legíveis", () => {
  it("mostra quando, evento, pedido, slug, resultado, a transição de status e o erro e os avisos, numa tabela com cabeçalhos", async () => {
    const api = simularApi({ entregas: ENTREGAS_VARIADAS });
    renderizarRota(CAMINHO);

    const tabelaDasEntregas = await tabela();
    expect(
      within(tabelaDasEntregas)
        .getAllByRole("columnheader")
        .map((cabecalho) => cabecalho.textContent),
    ).toEqual([
      "Quando",
      "Evento",
      "Pedido",
      "Slug",
      "Resultado",
      "Status",
      "Erro e avisos",
    ]);
    const todas = (await linhas()).map(celulas);
    // 25/11/2026 15:00 UTC + id minutos = 12:0id em Belém.
    expect(todas[0]).toEqual([
      "25/11/2026 12:09",
      "Não lido",
      "Não lido",
      "Não lido",
      "Recusada | A entrega veio com erro: o pedido não foi gravado.",
      "Nenhuma",
      // A recusa sem campo fica só no título (não se repete na lista).
      "Erro: O corpo não era um JSON válido",
    ]);
    expect(todas[1]).toEqual([
      "25/11/2026 12:08",
      "Pedido pago",
      idDoPedidoFicticio(8),
      "rifa-videira-kids",
      "Recusada | A entrega veio com erro: o pedido não foi gravado.",
      "Nenhuma",
      "Erro: Faltou o essencial do pedido ou veio com valor inválido | total: tipo inválido | numbers_count: acima do limite",
    ]);
    expect(todas[2]).toEqual([
      "25/11/2026 12:07",
      "Pedido novo",
      idDoPedidoFicticio(7),
      "rifa-videira-kids",
      "Processada",
      "Novo: Aguardando pagamento",
      "Avisos | buyer.phone: tipo inválido | numbers (cada item): tipo inválido (5.000 vezes) | total: fração de centavo arredondada",
    ]);
    expect(todas[3].slice(4)).toEqual([
      "Processada",
      "Aguardando pagamento → para Aprovado",
      "Avisos | total: total abaixo de bilhetes × preço do bilhete, além do desconto aceito | affiliate_id: afiliado diferente do que estava no pedido (vale o deste evento)",
    ]);
    expect(todas[4].slice(4)).toEqual([
      "Repetida | O pedido já estava neste status.",
      "Continua Aprovado",
      "Nenhum",
    ]);
    expect(todas[5].slice(3, 6)).toEqual([
      "outra-campanha",
      "Outra campanha | O slug não é o da campanha ativa: o pedido não foi gravado.",
      "Nenhuma",
    ]);
    expect(todas[6].slice(1, 6)).toEqual([
      "Pedido expirado",
      idDoPedidoFicticio(3),
      "rifa-videira-kids",
      "Ignorada | Mudança de status que não vale (ex.: expirar um pedido já aprovado).",
      "Continua Aprovado",
    ]);
    // Evento e código que o site ainda não conhece: aparecem como vieram, nunca uma mensagem.
    expect(todas[7].slice(1, 2)).toEqual(["refund_order"]);
    expect(todas[7][6]).toBe(
      "Avisos | slug: outro problema (codigo_novo) | Outros problemas, omitidos da lista (12 vezes)",
    );
    // O leitor de tela ouve "Aguardando pagamento para Aprovado": a seta é só visual.
    expect(within((await linhas())[3]).getByText("→")).toHaveAttribute(
      "aria-hidden",
      "true",
    );

    expect(api.pedidosA(ROTA_ENTREGAS)).toEqual([`${ROTA_ENTREGAS}?limite=50`]);
    expect(
      screen.getByText("8 entregas; não há entregas mais antigas."),
    ).toBeInTheDocument();
  });

  it("nenhum código cru (resultado, evento, recusa, zod, D11) nem dado pessoal aparece na tela", async () => {
    simularApi({ entregas: ENTREGAS_VARIADAS });
    renderizarRota(CAMINHO);

    const texto = (await tabela()).textContent ?? "";
    for (const codigo of [
      "erro_validacao",
      "ignorado_outra_campanha",
      "ignorado_transicao",
      "duplicado",
      "processado",
      "new_order",
      "paid_order",
      "expired_order",
      "json_invalido",
      "payload_invalido",
      "invalid_type",
      "too_big",
      "fracao_de_centavo",
      "total_abaixo_do_esperado",
      "afiliado_alterado",
      "itens_omitidos",
      "in_process",
      "approved",
      "expired",
    ]) {
      expect(texto, codigo).not.toContain(codigo);
    }
    // A API não manda mensagem nem valor recebido: nada de texto do zod, e-mail, telefone ou documento.
    expect(texto).not.toMatch(/Invalid input|expected|received/i);
    expect(texto).not.toMatch(/@|\(\d{2}\)\s?\d|\d{3}\.\d{3}\.\d{3}-\d{2}/);
  });

  it("filtro por resultado: vai para a consulta e para a URL; sem nenhuma, 'Ver todas as entregas' volta, com o foco no filtro", async () => {
    const api = simularApi({ entregas: ENTREGAS_VARIADAS });
    const { roteador } = renderizarRota(CAMINHO);
    await tabela();
    expect(
      within(campoResultado())
        .getAllByRole("option")
        .map((opcao) => opcao.textContent),
    ).toEqual([
      "Todos os resultados",
      "Processadas",
      "Repetidas",
      "De outra campanha",
      "Ignoradas",
      "Recusadas (com erro)",
    ]);

    fireEvent.change(campoResultado(), {
      target: { value: "erro_validacao" },
    });
    await waitFor(async () => expect(await linhas()).toHaveLength(2));
    for (const linha of await linhas())
      expect(celulas(linha)[4]).toMatch(/^Recusada/);
    expect(api.pedidosA(ROTA_ENTREGAS).at(-1)).toBe(
      `${ROTA_ENTREGAS}?limite=50&resultado=erro_validacao`,
    );
    expect(roteador.state.location.search).toBe(
      "?aba=entregas&resultado=erro_validacao",
    );

    api.dados.entregas = ENTREGAS_VARIADAS.filter(
      ({ resultado }) => resultado !== "duplicado",
    );
    fireEvent.change(campoResultado(), { target: { value: "duplicado" } });
    expect(
      await screen.findByText("Nenhuma entrega com este resultado."),
    ).toBeInTheDocument();
    acionar(screen.getByRole("button", { name: "Ver todas as entregas" }));
    expect(await linhas()).toHaveLength(7);
    expect(roteador.state.location.search).toBe("?aba=entregas");
    // O botão sumiu com a lista vazia: o foco foi para o filtro de resultado.
    await waitFor(() => expect(campoResultado()).toHaveFocus());
  });

  it("Carregar mais pelo cursor (id): acrescenta no fim sem repetir nem pular, leva o foco à primeira entrega nova e o botão some no fim", async () => {
    const api = simularApi({ entregas: entregasEmSequencia(70) });
    renderizarRota(CAMINHO);

    expect(await linhas()).toHaveLength(50);
    acionar(screen.getByRole("button", { name: "Carregar mais" }));
    await waitFor(async () => expect(await linhas()).toHaveLength(70));
    const primeiraNova = (await linhas())[50];
    await waitFor(() =>
      expect(
        within(primeiraNova).getAllByRole("cell")[0].firstElementChild,
      ).toHaveFocus(),
    );
    expect(celulas(primeiraNova)[2]).toBe(idDoPedidoFicticio(20));
    expect(api.pedidosA(ROTA_ENTREGAS)).toEqual([
      `${ROTA_ENTREGAS}?limite=50`,
      `${ROTA_ENTREGAS}?limite=50&antes_de=21`,
    ]);
    expect((await linhas()).map((linha) => celulas(linha)[2])).toEqual(
      Array.from({ length: 70 }, (_, i) => idDoPedidoFicticio(70 - i)),
    );
    expect(
      screen.queryByRole("button", { name: "Carregar mais" }),
    ).not.toBeInTheDocument();
  });

  it("a aba só carrega quando é aberta; trocar de aba guarda a escolha na URL e não perde a outra", async () => {
    const api = simularApi({ entregas: ENTREGAS_VARIADAS });
    const { roteador } = renderizarRota("/coordenacao/pedidos");
    await screen.findByText("Nenhum pedido ainda.");
    expect(api.pedidosA(ROTA_ENTREGAS)).toEqual([]);

    fireEvent.click(screen.getByRole("tab", { name: "Entregas do webhook" }));
    expect(await linhas()).toHaveLength(8);
    expect(roteador.state.location.search).toBe("?aba=entregas");
    expect(
      screen.getByRole("tab", { name: "Entregas do webhook" }),
    ).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("tab", { name: "Pedidos" }));
    expect(roteador.state.location.search).toBe("");
    // A lista de pedidos não foi pedida de novo (o painel fica montado).
    expect(api.pedidosA(ROTA_PEDIDOS)).toHaveLength(1);
    expect(api.pedidosA(ROTA_ENTREGAS)).toHaveLength(1);
  });

  it("explica o que é cada entrega e quando o alerta acende (as constantes do contrato)", async () => {
    simularApi();
    renderizarRota(CAMINHO);

    expect(
      await screen.findByText(
        /O aviso de webhook parado acende com mais de 4 h sem venda entre 8h e 22h \(horário de Belém\)/,
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Nenhuma entrega do webhook ainda."),
    ).toBeInTheDocument();
  });

  it("erro ao carregar as entregas: a mensagem e 'Tentar de novo'", async () => {
    const api = simularApi({ entregas: ENTREGAS_VARIADAS });
    api.proxima(ROTA_ENTREGAS, () =>
      respostaErro(500, "erro_interno", "Erro interno do servidor."),
    );
    renderizarRota(CAMINHO);

    const painel = await screen.findByRole("tabpanel", {
      name: "Entregas do webhook",
    });
    const alerta = await within(painel).findByRole("alert");
    expect(alerta).toHaveTextContent("Não foi possível carregar as entregas.");
    fireEvent.click(
      within(alerta).getByRole("button", { name: "Tentar de novo" }),
    );
    expect(await linhas()).toHaveLength(8);
  });
});
