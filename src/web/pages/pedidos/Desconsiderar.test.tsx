// RIFA-028 (D20), CA3: desconsiderar pedido e desfazer na tela Pedidos, pela rota de verdade e com a API falsa de
// teste-apoio.ts (corpos pelos schemas do contrato; 400, 404 e 409 como a API). Só o admin vê a ação, e só com a
// chave `pedidos.desconsiderar` ligada; o selo, o filtro e os totais mudam; a observação com "@" é recusada com uma
// mensagem clara. CA8: foco nos diálogos, região viva e rótulos.
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
} from "../../test/renderizar";
import { MENSAGEM_OBSERVACAO_COM_CONTATO } from "./Desconsiderar";
import { idDoPedido } from "./ListaPedidos";
import {
  ROTA_CAMPANHA,
  ROTA_DESCONSIDERAR,
  ROTA_PEDIDOS,
  ROTA_RECONSIDERAR,
  pedido,
  respostaErro,
  simularApi,
} from "./teste-apoio";

function abrir(
  usuario: UsuarioSessao = ADMIN_DE_TESTE,
  caminho = "/coordenacao/pedidos",
) {
  return renderizarRota(caminho, { usuario });
}

const tabela = () =>
  screen.findByRole("table", {
    name: "Pedidos, do mais recente para o mais antigo",
  });

/** A linha da tabela de um pedido. */
async function linhaDo(id: string) {
  const [, corpo] = within(await tabela()).getAllByRole("rowgroup");
  const linha = within(corpo)
    .getAllByRole("row")
    .find((tr) => tr.textContent?.includes(id));
  if (!linha) throw new Error(`sem a linha de ${id}`);
  return linha;
}

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

/** A região viva fixa do resultado das ações (a segunda da aba: a primeira é a da lista). */
const anuncioDaAcao = () =>
  within(screen.getByRole("tabpanel", { name: "Pedidos" }))
    .getAllByRole("status")
    .filter((elemento) => elemento.classList.contains("visualmente-oculto"))[1];

/** Foca e clica, como o toque e o Enter fazem no navegador (o jsdom não foca no clique). */
function acionar(elemento: HTMLElement) {
  act(() => elemento.focus());
  fireEvent.click(elemento);
}

/** Três pedidos: dois aprovados (um deles já desconsiderado) e um aguardando, recuperado na conferência. */
function pedidosDoTeste() {
  return [
    pedido(3, { id: "PED-A", qtd_bilhetes: 3, total_centavos: 6000 }),
    pedido(2, {
      id: "PED-B",
      status: "in_process",
      origem: "conferencia",
    }),
    pedido(1, {
      id: "PED-TESTE",
      qtd_bilhetes: 5,
      total_centavos: 10000,
      desconsiderado: {
        motivo: "teste",
        observacao: "compra de teste na reunião",
        em: "2026-11-25T14:00:00.000Z",
      },
    }),
  ];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CA3: quem vê a ação", () => {
  it("a coordenação vê o selo e a marca, mas não a ação (nem pede a chave da campanha)", async () => {
    const api = simularApi({ pedidos: pedidosDoTeste(), desconsiderar: true });

    abrir(USUARIO_DE_TESTE);

    const linhaTeste = await linhaDo("PED-TESTE");
    expect(
      within(linhaTeste).getByText("Desconsiderado (teste)"),
    ).toBeVisible();
    expect(
      linhaTeste.querySelector(".pedidos-desconsiderado__detalhe")?.textContent,
    ).toBe(
      "Fora das contas desde 25/11/2026 11:00. Observação: compra de teste na reunião.",
    );
    expect(
      within(await linhaDo("PED-B")).getByText("Recuperado na conferência"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "Ações" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Desconsiderar|^Desfazer/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/está desligado/)).not.toBeInTheDocument();
    expect(api.pedidosA(ROTA_CAMPANHA)).toEqual([]);
  });

  it("admin com a chave desligada: sem ação, com o aviso de onde ligar (a Campanha)", async () => {
    const api = simularApi({ pedidos: pedidosDoTeste(), desconsiderar: false });

    abrir();

    await linhaDo("PED-A");
    expect(
      await screen.findByText("Desconsiderar pedidos está desligado"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "tela Campanha" })).toHaveAttribute(
      "href",
      "/coordenacao/campanha#campanha-pedidos-desconsiderar",
    );
    expect(
      screen.queryByRole("button", { name: /^Desconsiderar|^Desfazer/ }),
    ).not.toBeInTheDocument();
    expect(api.pedidosA(ROTA_CAMPANHA)).toHaveLength(1);
  });

  it("admin com a chave ligada: 'Desconsiderar' nos que contam e 'Desfazer' nos desconsiderados", async () => {
    simularApi({ pedidos: pedidosDoTeste(), desconsiderar: true });

    abrir();

    expect(
      await within(await linhaDo("PED-A")).findByRole("button", {
        name: "Desconsiderar o pedido PED-A",
      }),
    ).toBeInTheDocument();
    expect(
      within(await linhaDo("PED-TESTE")).getByRole("button", {
        name: "Desfazer a desconsideração do pedido PED-TESTE",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Ações" }),
    ).toBeInTheDocument();
  });
});

describe("CA3: desconsiderar e desfazer", () => {
  it("desconsiderar: diálogo com motivo e observação (e o aviso do dado do comprador); o selo aparece e os totais mudam", async () => {
    const api = simularApi({ pedidos: pedidosDoTeste(), desconsiderar: true });
    abrir();
    const botao = await within(await linhaDo("PED-A")).findByRole("button", {
      name: "Desconsiderar o pedido PED-A",
    });
    // O desconsiderado já fica fora dos totais (a API conta só o que conta).
    expect(totais()[0]).toEqual(["Aprovados", "1", "3", "R$ 60,00"]);

    acionar(botao);

    const dialogo = screen.getByRole("dialog", {
      name: "Desconsiderar o pedido PED-A?",
    });
    expect(dialogo).toHaveAccessibleDescription(
      /Ele sai de todas as contas .* e continua nesta lista, com o selo\. Dá para desfazer\./,
    );
    const motivo = within(dialogo).getByRole("combobox", { name: "Motivo" });
    await waitFor(() => expect(motivo).toHaveFocus());
    const observacao = within(dialogo).getByRole("textbox", {
      name: "Observação (opcional)",
    });
    expect(observacao).toHaveAccessibleDescription(
      "Até 140 caracteres. Não escreva nome, telefone, e-mail nem documento do comprador.",
    );
    expect(observacao).toHaveAttribute("maxlength", "140");

    // Sem motivo: o erro fica no campo, e nada vai para a API.
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Desconsiderar" }),
    );
    expect(motivo).toHaveAccessibleDescription("Escolha o motivo.");
    expect(api.envios).toEqual([]);

    fireEvent.change(motivo, { target: { value: "teste" } });
    fireEvent.change(observacao, { target: { value: "  pedido de teste  " } });
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Desconsiderar" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(api.envios).toEqual([
      [
        ROTA_DESCONSIDERAR,
        { pedido_id: "PED-A", motivo: "teste", observacao: "pedido de teste" },
      ],
    ]);
    const linha = await linhaDo("PED-A");
    expect(
      within(linha).getByText("Desconsiderado (teste)"),
    ).toBeInTheDocument();
    expect(
      within(linha).getByRole("button", {
        name: "Desfazer a desconsideração do pedido PED-A",
      }),
    ).toBeInTheDocument();
    // Os totais mudam na hora, sem pedir a primeira página de novo.
    expect(totais()[0]).toEqual(["Aprovados", "0", "0", "R$ 0,00"]);
    expect(api.pedidosA(ROTA_PEDIDOS)).toHaveLength(1);
    expect(anuncioDaAcao()).toHaveTextContent(
      "Pedido PED-A desconsiderado: saiu de todas as contas e dos totais.",
    );
    await waitFor(() =>
      expect(document.getElementById(idDoPedido("PED-A"))).toHaveFocus(),
    );
  });

  it("a observação com '@' (ou 8 números seguidos) é recusada com uma mensagem clara, sem chamar a API", async () => {
    const api = simularApi({ pedidos: pedidosDoTeste(), desconsiderar: true });
    abrir();
    acionar(
      await within(await linhaDo("PED-A")).findByRole("button", {
        name: "Desconsiderar o pedido PED-A",
      }),
    );
    const dialogo = screen.getByRole("dialog");
    const observacao = within(dialogo).getByRole("textbox", {
      name: "Observação (opcional)",
    });
    fireEvent.change(
      within(dialogo).getByRole("combobox", { name: "Motivo" }),
      {
        target: { value: "fraude" },
      },
    );

    for (const texto of ["comprador@exemplo.com", "ligar para 91 98888-7777"]) {
      fireEvent.change(observacao, { target: { value: texto } });
      fireEvent.click(
        within(dialogo).getByRole("button", { name: "Desconsiderar" }),
      );
      expect(observacao).toHaveAttribute("aria-invalid", "true");
      expect(observacao).toHaveAccessibleDescription(
        expect.stringContaining(MENSAGEM_OBSERVACAO_COM_CONTATO),
      );
      expect(observacao).toHaveFocus();
    }
    expect(MENSAGEM_OBSERVACAO_COM_CONTATO).toBe(
      "Tire o e-mail, o telefone ou o documento: a observação não pode ter dado pessoal do comprador (nem “@”, nem 8 números seguidos).",
    );
    expect(api.envios).toEqual([]);
  });

  it("desfazer: confirmação; o pedido volta a contar, o selo some e os totais voltam", async () => {
    const api = simularApi({ pedidos: pedidosDoTeste(), desconsiderar: true });
    abrir();
    const botao = await within(await linhaDo("PED-TESTE")).findByRole(
      "button",
      { name: "Desfazer a desconsideração do pedido PED-TESTE" },
    );

    acionar(botao);

    const dialogo = screen.getByRole("alertdialog", {
      name: "Desfazer: o pedido PED-TESTE volta a contar?",
    });
    expect(
      within(dialogo).getByText(
        /Desconsiderado \(teste\) em 25\/11\/2026 11:00\. Observação: compra de teste na reunião\./,
      ),
    ).toBeInTheDocument();
    // Confirmação: o foco começa em "Cancelar" (o primeiro do rodapé).
    await waitFor(() =>
      expect(
        within(dialogo).getByRole("button", { name: "Cancelar" }),
      ).toHaveFocus(),
    );
    fireEvent.click(within(dialogo).getByRole("button", { name: "Desfazer" }));

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(api.envios).toEqual([
      [ROTA_RECONSIDERAR, { pedido_id: "PED-TESTE" }],
    ]);
    const linha = await linhaDo("PED-TESTE");
    expect(within(linha).queryByText(/Desconsiderado/)).not.toBeInTheDocument();
    expect(totais()[0]).toEqual(["Aprovados", "2", "8", "R$ 160,00"]);
    expect(anuncioDaAcao()).toHaveTextContent(
      "Pedido PED-TESTE voltou a contar em todas as contas.",
    );
  });

  it("409 acao_desligada (desligaram com a tela aberta): explica no diálogo e a ação some da lista", async () => {
    const api = simularApi({ pedidos: pedidosDoTeste(), desconsiderar: true });
    abrir();
    acionar(
      await within(await linhaDo("PED-A")).findByRole("button", {
        name: "Desconsiderar o pedido PED-A",
      }),
    );
    api.dados.desconsiderar = false;
    const dialogo = screen.getByRole("dialog");
    fireEvent.change(
      within(dialogo).getByRole("combobox", { name: "Motivo" }),
      {
        target: { value: "estorno" },
      },
    );
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Desconsiderar" }),
    );

    expect(
      await within(dialogo).findByText(
        "A chave “Permitir desconsiderar pedidos” foi desligada na Campanha: ligue de novo para desconsiderar ou desfazer.",
      ),
    ).toBeInTheDocument();
    // Tentar de novo daria o mesmo 409: fica só "Entendi", com o foco (o botão da ação some do diálogo).
    expect(
      within(dialogo).queryByRole("button", { name: "Desconsiderar" }),
    ).not.toBeInTheDocument();
    const entendi = within(dialogo).getByRole("button", { name: "Entendi" });
    await waitFor(() => expect(entendi).toHaveFocus());
    fireEvent.click(entendi);
    expect(
      await screen.findByText("Desconsiderar pedidos está desligado"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Desconsiderar/ }),
    ).not.toBeInTheDocument();
    // O botão que abriu o diálogo saiu com as ações: o foco volta ao id do pedido.
    await waitFor(() =>
      expect(document.getElementById(idDoPedido("PED-A"))).toHaveFocus(),
    );
    expect(api.envios).toHaveLength(1);
  });

  it("outra falha (ex.: sem conexão): explica no diálogo e o foco vai para o botão da ação, para tentar de novo", async () => {
    const api = simularApi({ pedidos: pedidosDoTeste(), desconsiderar: true });
    api.proxima(ROTA_RECONSIDERAR, () =>
      respostaErro(500, "erro_interno", "Erro interno"),
    );
    abrir();
    acionar(
      await within(await linhaDo("PED-TESTE")).findByRole("button", {
        name: "Desfazer a desconsideração do pedido PED-TESTE",
      }),
    );
    const dialogo = screen.getByRole("alertdialog");

    fireEvent.click(within(dialogo).getByRole("button", { name: "Desfazer" }));

    expect(
      await within(dialogo).findByText("Não foi possível desfazer"),
    ).toBeInTheDocument();
    const desfazer = within(dialogo).getByRole("button", { name: "Desfazer" });
    await waitFor(() => expect(desfazer).toHaveFocus());
    fireEvent.click(desfazer);
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(api.envios).toHaveLength(2);
  });
});

describe("CA3: o filtro 'Desconsiderados'", () => {
  it("só os desconsiderados e só os que contam, na URL e na consulta da API (os totais não mudam)", async () => {
    const api = simularApi({ pedidos: pedidosDoTeste(), desconsiderar: true });
    const { roteador } = abrir(USUARIO_DE_TESTE);
    await linhaDo("PED-A");
    const totaisAntes = totais();
    const filtro = screen.getByRole("combobox", { name: "Desconsiderados" });
    expect(filtro).toHaveValue("todos");

    fireEvent.change(filtro, { target: { value: "so" } });

    await waitFor(() =>
      expect(roteador.state.location.search).toBe("?desconsiderado=true"),
    );
    await waitFor(async () =>
      expect((await tabela()).textContent).not.toContain("PED-A"),
    );
    expect((await linhaDo("PED-TESTE")).textContent).toContain(
      "Desconsiderado (teste)",
    );
    expect(api.pedidosA(ROTA_PEDIDOS).at(-1)).toBe(
      `${ROTA_PEDIDOS}?limite=50&desconsiderado=true`,
    );
    expect(totais()).toEqual(totaisAntes);

    fireEvent.change(filtro, { target: { value: "sem" } });

    await waitFor(() =>
      expect(roteador.state.location.search).toBe("?desconsiderado=false"),
    );
    await waitFor(async () =>
      expect((await tabela()).textContent).not.toContain("PED-TESTE"),
    );
    expect(api.pedidosA(ROTA_PEDIDOS).at(-1)).toBe(
      `${ROTA_PEDIDOS}?limite=50&desconsiderado=false`,
    );
  });

  it("a URL com o filtro abre a tela filtrada", async () => {
    simularApi({ pedidos: pedidosDoTeste() });

    abrir(USUARIO_DE_TESTE, "/coordenacao/pedidos?desconsiderado=true");

    await linhaDo("PED-TESTE");
    expect(
      screen.getByRole("combobox", { name: "Desconsiderados" }),
    ).toHaveValue("so");
  });
});
