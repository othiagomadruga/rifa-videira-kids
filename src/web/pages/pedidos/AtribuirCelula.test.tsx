// RIFA-088 (D41): atribuir à mão a célula de uma venda sem célula pelo afiliado, na tela Pedidos, pela rota de verdade e
// com a API falsa de teste-apoio.ts (corpo pelo schema do contrato; 400, 404 e 409 como a API). Só o admin vê o botão,
// só nas vendas sem célula pelo afiliado; a coordenação vê a célula efetiva e o sinal "atribuída à mão", sem o botão.
// O seletor agrupa as células por rede; "Remover atribuição" aparece quando há uma; todo controle tem dica.
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  RifeiNaAtribuicao,
  UsuarioSessao,
} from "../../../shared/contracts";
import {
  contarControles,
  controlesSemDica,
  titulosSemAjuda,
} from "../../test/dicas";
import {
  ADMIN_DE_TESTE,
  USUARIO_DE_TESTE,
  renderizarRota,
} from "../../test/renderizar";
import {
  ROTA_ATRIBUIR_CELULA,
  ROTA_CELULAS,
  pedido,
  respostaErro,
  simularApi,
} from "./teste-apoio";
import { MARCA_ATRIBUIDA } from "./textos";

afterEach(() => {
  vi.unstubAllGlobals();
});

function abrir(usuario: UsuarioSessao = ADMIN_DE_TESTE) {
  return renderizarRota("/coordenacao/pedidos", { usuario });
}

const tabela = () =>
  screen.findByRole("table", {
    name: "Pedidos, do mais recente para o mais antigo",
  });

async function linhaDo(id: string) {
  const [, corpo] = within(await tabela()).getAllByRole("rowgroup");
  const linha = within(corpo)
    .getAllByRole("row")
    .find((tr) => tr.textContent?.includes(id));
  if (!linha) throw new Error(`sem a linha de ${id}`);
  return linha;
}

function acionar(elemento: HTMLElement) {
  act(() => elemento.focus());
  fireEvent.click(elemento);
}

/** Uma venda do afiliado com célula, uma sem afiliado, uma de afiliado sem célula e uma já atribuída à mão. */
function pedidosDoTeste() {
  return [
    pedido(4, { id: "PED-AFILIADO" }),
    pedido(3, {
      id: "PED-SEM-AFILIADO",
      affiliate_id: null,
      celula_id: null,
      celula_nome: null,
      celula_origem: null,
    }),
    pedido(2, {
      id: "PED-ORFAO",
      affiliate_id: 9900,
      celula_id: null,
      celula_nome: null,
      celula_origem: null,
    }),
    pedido(1, {
      id: "PED-ATRIBUIDO",
      affiliate_id: null,
      celula_id: 2,
      celula_nome: "Célula Ficticia 10",
      celula_origem: "manual",
    }),
  ];
}

const botaoAtribuirDe = (linha: HTMLElement) =>
  within(linha).queryByRole("button", {
    name: /^(Atribuir a uma célula|Trocar a célula) do pedido/,
  });

describe("RIFA-088: o botão e o sinal na lista", () => {
  it("admin: 'Atribuir a uma célula' só nas vendas sem célula pelo afiliado; a atribuída mostra o sinal e 'Trocar a célula'", async () => {
    simularApi({ pedidos: pedidosDoTeste() });
    abrir();
    expect(botaoAtribuirDe(await linhaDo("PED-AFILIADO"))).toBeNull();
    expect(
      botaoAtribuirDe(await linhaDo("PED-SEM-AFILIADO")),
    ).toHaveAccessibleName("Atribuir a uma célula do pedido PED-SEM-AFILIADO");
    expect(botaoAtribuirDe(await linhaDo("PED-ORFAO"))).toBeInTheDocument();
    const atribuido = await linhaDo("PED-ATRIBUIDO");
    expect(atribuido).toHaveTextContent("Célula Ficticia 10");
    expect(atribuido).toHaveTextContent(MARCA_ATRIBUIDA);
    expect(botaoAtribuirDe(atribuido)).toHaveAccessibleName(
      "Trocar a célula do pedido PED-ATRIBUIDO",
    );
    expect(await linhaDo("PED-AFILIADO")).not.toHaveTextContent(
      MARCA_ATRIBUIDA,
    );
  });

  it("coordenação: vê a célula efetiva e o sinal 'atribuída à mão', sem nenhum botão de atribuir", async () => {
    simularApi({ pedidos: pedidosDoTeste() });
    abrir(USUARIO_DE_TESTE);
    const atribuido = await linhaDo("PED-ATRIBUIDO");
    expect(atribuido).toHaveTextContent("Célula Ficticia 10");
    expect(atribuido).toHaveTextContent(MARCA_ATRIBUIDA);
    for (const id of ["PED-SEM-AFILIADO", "PED-ORFAO", "PED-ATRIBUIDO"])
      expect(botaoAtribuirDe(await linhaDo(id))).toBeNull();
  });
});

describe("RIFA-088: o diálogo", () => {
  it("atribui: o seletor agrupa por rede, manda o PUT com a célula e a linha mostra a célula com o sinal", async () => {
    const api = simularApi({ pedidos: pedidosDoTeste() });
    abrir();
    acionar(botaoAtribuirDe(await linhaDo("PED-SEM-AFILIADO"))!);
    const dialogo = await screen.findByRole("dialog", {
      name: "Atribuir o pedido PED-SEM-AFILIADO a uma célula",
    });
    const campo = within(dialogo).getByRole("combobox", { name: /Célula/ });
    const grupos = [...campo.querySelectorAll("optgroup")].map((grupo) => ({
      rede: grupo.label,
      celulas: [...grupo.querySelectorAll("option")].map(
        (opcao) => opcao.textContent,
      ),
    }));
    expect(grupos.length).toBeGreaterThan(0);
    for (const grupo of grupos)
      expect(grupo.celulas).toEqual(
        [...grupo.celulas].sort((a, b) =>
          (a ?? "").localeCompare(b ?? "", "pt-BR", { numeric: true }),
        ),
      );
    // Sem escolher: pede a célula e não manda nada.
    expect(
      within(dialogo).queryByRole("button", { name: "Remover atribuição" }),
    ).toBeNull();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Atribuir" }));
    expect(await within(dialogo).findByText("Escolha a célula.")).toBeVisible();
    expect(api.envios).toEqual([]);

    fireEvent.change(campo, { target: { value: "2" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Atribuir" }));
    await screen.findByText(
      "Pedido PED-SEM-AFILIADO atribuído à Célula Ficticia 10: a venda conta para ela em todo o sistema.",
      { selector: "p:not(.visualmente-oculto)" },
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.envios).toEqual([
      ["/api/admin/pedidos/PED-SEM-AFILIADO/celula", { celula_id: 2 }],
    ]);
    const linha = await linhaDo("PED-SEM-AFILIADO");
    expect(linha).toHaveTextContent("Célula Ficticia 10");
    expect(linha).toHaveTextContent(MARCA_ATRIBUIDA);
    expect(botaoAtribuirDe(linha)).toHaveAccessibleName(
      "Trocar a célula do pedido PED-SEM-AFILIADO",
    );
  });

  it("'Remover atribuição' manda null e a venda volta a ficar sem célula", async () => {
    const api = simularApi({ pedidos: pedidosDoTeste() });
    abrir();
    acionar(botaoAtribuirDe(await linhaDo("PED-ATRIBUIDO"))!);
    const dialogo = await screen.findByRole("dialog", {
      name: "Trocar a célula do pedido PED-ATRIBUIDO",
    });
    expect(
      within(dialogo).getByRole("combobox", { name: /Célula/ }),
    ).toHaveValue("2");
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Remover atribuição" }),
    );
    await screen.findByText(
      "Pedido PED-ATRIBUIDO sem célula de novo: não conta para nenhuma.",
      { selector: "p:not(.visualmente-oculto)" },
    );
    expect(api.envios).toEqual([
      ["/api/admin/pedidos/PED-ATRIBUIDO/celula", { celula_id: null }],
    ]);
    const linha = await linhaDo("PED-ATRIBUIDO");
    expect(linha).not.toHaveTextContent(MARCA_ATRIBUIDA);
    expect(linha).toHaveTextContent("Sem afiliado");
  });

  it("409 (o afiliado ganhou célula): explica e troca o Cancelar por 'Entendi'", async () => {
    const api = simularApi({ pedidos: pedidosDoTeste() });
    api.proxima(ROTA_ATRIBUIR_CELULA, () =>
      respostaErro(409, "pedido_ja_tem_celula", "Já tem célula"),
    );
    abrir();
    acionar(botaoAtribuirDe(await linhaDo("PED-ORFAO"))!);
    const dialogo = await screen.findByRole("dialog");
    fireEvent.change(
      within(dialogo).getByRole("combobox", { name: /Célula/ }),
      {
        target: { value: "1" },
      },
    );
    fireEvent.click(within(dialogo).getByRole("button", { name: "Atribuir" }));
    expect(
      await within(dialogo).findByText(/já tem célula pelo link do afiliado/),
    ).toBeVisible();
    expect(
      within(dialogo).getByRole("button", { name: "Entendi" }),
    ).toHaveFocus();
    expect(
      within(dialogo).queryByRole("button", { name: "Atribuir" }),
    ).toBeNull();
  });

  it("as células não carregaram: o diálogo diz isso (não fica em 'Carregando as células…') e não manda nada", async () => {
    const api = simularApi({ pedidos: pedidosDoTeste() });
    api.proxima(ROTA_CELULAS, () =>
      respostaErro(500, "erro_interno", "Falhou"),
    );
    abrir();
    acionar(botaoAtribuirDe(await linhaDo("PED-SEM-AFILIADO"))!);
    const dialogo = await screen.findByRole("dialog");
    expect(
      await within(dialogo).findByText(
        /Não foi possível carregar as células\. Feche e recarregue a página/,
      ),
    ).toBeVisible();
    expect(
      within(dialogo).queryByText("Carregando as células…"),
    ).not.toBeInTheDocument();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Atribuir" }));
    expect(api.envios).toEqual([]);
  });

  it("dicas: o botão na lista e cada controle do diálogo têm dica, e o campo tem a ajuda", async () => {
    simularApi({ pedidos: pedidosDoTeste() });
    abrir();
    await linhaDo("PED-ATRIBUIDO");
    expect(controlesSemDica()).toEqual([]);
    acionar(botaoAtribuirDe(await linhaDo("PED-ATRIBUIDO"))!);
    const dialogo = await screen.findByRole("dialog");
    expect(contarControles(dialogo)).toBeGreaterThanOrEqual(4);
    expect(controlesSemDica()).toEqual([]);
    expect(await titulosSemAjuda()).toEqual([]);
  });
});

describe("RIFA-091: o resultado na Rifei no aviso depois de atribuir", () => {
  async function atribuirNaTela(id: string, rifei: RifeiNaAtribuicao) {
    simularApi({ pedidos: pedidosDoTeste(), rifei });
    abrir();
    acionar(botaoAtribuirDe(await linhaDo(id))!);
    const dialogo = await screen.findByRole("dialog");
    fireEvent.change(
      within(dialogo).getByRole("combobox", { name: /Célula/ }),
      { target: { value: "2" } },
    );
    fireEvent.click(within(dialogo).getByRole("button", { name: "Atribuir" }));
  }

  const ATRIBUIDO =
    "Pedido PED-SEM-AFILIADO atribuído à Célula Ficticia 10: a venda conta para ela em todo o sistema.";

  /** O aviso visível (o texto inteiro) e o tom dele. */
  async function aviso(texto: string) {
    const paragrafo = await screen.findByText(texto, {
      selector: "p:not(.visualmente-oculto)",
    });
    return paragrafo.closest(".ui-aviso");
  }

  it("o diálogo diz que a venda sem afiliado também é ligada ao afiliado da célula na Rifei (a de afiliado sem célula, não)", async () => {
    simularApi({ pedidos: pedidosDoTeste() });
    abrir();
    acionar(botaoAtribuirDe(await linhaDo("PED-SEM-AFILIADO"))!);
    expect(await screen.findByRole("dialog")).toHaveAccessibleDescription(
      /Se a célula tiver link de afiliado, a venda também é ligada a ele na Rifei\./,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    acionar(botaoAtribuirDe(await linhaDo("PED-ORFAO"))!);
    expect(await screen.findByRole("dialog")).not.toHaveAccessibleDescription(
      /Rifei/,
    );
  });

  it("vinculado: 'Também ligada ao afiliado da célula na Rifei.', em sucesso; a célula passa a vir do afiliado", async () => {
    await atribuirNaTela("PED-SEM-AFILIADO", { situacao: "vinculado" });
    const caixa = await aviso(
      `${ATRIBUIDO} Também ligada ao afiliado da célula na Rifei.`,
    );
    expect(caixa).toHaveClass("ui-aviso--sucesso");
    // A região viva anuncia o mesmo texto.
    expect(
      screen.getByText(
        `${ATRIBUIDO} Também ligada ao afiliado da célula na Rifei.`,
        { selector: "p.visualmente-oculto" },
      ),
    ).toBeInTheDocument();
    const linha = await linhaDo("PED-SEM-AFILIADO");
    expect(linha).toHaveTextContent("Célula Ficticia 10");
    expect(linha).not.toHaveTextContent(MARCA_ATRIBUIDA);
    expect(botaoAtribuirDe(linha)).toBeNull();
  });

  it.each([
    [{ situacao: "sem_conexao" }, "o sistema não está conectado à Rifei"],
    [{ situacao: "celula_sem_afiliado" }, "a célula não tem link de afiliado"],
    [
      { situacao: "varios_afiliados" },
      "a célula tem mais de um link de afiliado",
    ],
    [
      { situacao: "recusado", mensagem: "Pedido já tem afiliado" },
      "a Rifei recusou: Pedido já tem afiliado",
    ],
    [
      {
        situacao: "indisponivel",
        mensagem:
          "A Rifei não respondeu agora. Tente de novo em alguns minutos ou faça no painel da Rifei.",
      },
      "a Rifei não respondeu agora",
    ],
  ] as const)(
    "%o: 'Na Rifei não deu (…): ligue lá à mão.', em alerta; a atribuição vale",
    async (rifei, motivo) => {
      await atribuirNaTela("PED-SEM-AFILIADO", rifei);
      const caixa = await aviso(
        `${ATRIBUIDO} Na Rifei não deu (${motivo}): ligue lá à mão.`,
      );
      expect(caixa).toHaveClass("ui-aviso--alerta");
      const linha = await linhaDo("PED-SEM-AFILIADO");
      expect(linha).toHaveTextContent("Célula Ficticia 10");
      expect(linha).toHaveTextContent(MARCA_ATRIBUIDA);
    },
  );

  it("falhou (token recusado): o motivo e o que fazer, que vem da API", async () => {
    const mensagem =
      "A Rifei recusou o token: cole um novo em Conexão com a Rifei (Acessos → Conexão com a Rifei).";
    await atribuirNaTela("PED-SEM-AFILIADO", { situacao: "falhou", mensagem });
    const caixa = await aviso(
      `${ATRIBUIDO} Na Rifei não deu (a Rifei deu erro): ligue lá à mão. ${mensagem}`,
    );
    expect(caixa).toHaveClass("ui-aviso--alerta");
  });

  it("atribuir de novo a mesma célula numa venda sem afiliado manda o PUT outra vez (tenta a Rifei de novo); na de afiliado sem célula, só fecha", async () => {
    const api = simularApi({
      pedidos: [
        ...pedidosDoTeste(),
        pedido(5, {
          id: "PED-ORFAO-ATRIBUIDO",
          affiliate_id: 9901,
          celula_id: 2,
          celula_nome: "Célula Ficticia 10",
          celula_origem: "manual",
        }),
      ],
      rifei: { situacao: "vinculado" },
    });
    abrir();
    acionar(botaoAtribuirDe(await linhaDo("PED-ATRIBUIDO"))!);
    const dialogo = await screen.findByRole("dialog", {
      name: "Trocar a célula do pedido PED-ATRIBUIDO",
    });
    expect(
      within(dialogo).getByRole("combobox", { name: /Célula/ }),
    ).toHaveValue("2");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Atribuir" }));
    const caixa = await aviso(
      "Pedido PED-ATRIBUIDO atribuído à Célula Ficticia 10: a venda conta para ela em todo o sistema. Também ligada ao afiliado da célula na Rifei.",
    );
    expect(caixa).toHaveClass("ui-aviso--sucesso");
    expect(api.envios).toEqual([
      ["/api/admin/pedidos/PED-ATRIBUIDO/celula", { celula_id: 2 }],
    ]);

    // A venda de afiliado sem célula não vai à Rifei: a mesma célula não muda nada, e o diálogo só fecha.
    acionar(botaoAtribuirDe(await linhaDo("PED-ORFAO-ATRIBUIDO"))!);
    const outro = await screen.findByRole("dialog", {
      name: "Trocar a célula do pedido PED-ORFAO-ATRIBUIDO",
    });
    fireEvent.click(within(outro).getByRole("button", { name: "Atribuir" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(api.envios).toHaveLength(1);
  });

  it("não se aplica (venda com afiliado sem célula): só o aviso de hoje, em sucesso", async () => {
    await atribuirNaTela("PED-ORFAO", { situacao: "nao_se_aplica" });
    const caixa = await aviso(
      "Pedido PED-ORFAO atribuído à Célula Ficticia 10: a venda conta para ela em todo o sistema.",
    );
    expect(caixa).toHaveClass("ui-aviso--sucesso");
    expect(caixa).not.toHaveTextContent(/Rifei/);
  });
});
