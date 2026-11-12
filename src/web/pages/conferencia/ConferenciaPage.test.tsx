// CA4 (RIFA-012): a tela /coordenacao/conferencia renderizada pela rota de verdade, com a API falsa
// (teste-apoio.ts): escolher o arquivo (lido NO NAVEGADOR), ver e ajustar o mapeamento detectado, conferir,
// ler o resumo e as diferenças por tipo (com a explicação), marcar e recuperar com confirmação, e as
// recuperações feitas. Os corpos enviados à API são varridos atrás dos dados pessoais do arquivo.
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dicaDe } from "../../test/dicas";
import {
  ativarPeloTeclado,
  chegarPeloTab,
  conferirIndisponivel,
  esperarDisponivel,
  esperarIndisponivel,
  lerCss,
  tab,
} from "../../test/indisponivel";
import { renderizarRota } from "../../test/renderizar";
import {
  ANALISE_AGREGADA,
  ANALISE_AMBIGUA,
  ANALISE_COM_DESCONSIDERADOS,
  ANALISE_DEPOIS,
  ANALISE_POR_PEDIDO,
  ANALISE_SEM_DIFERENCA,
  ANALISE_TRAVADA,
  CSV_EXEMPLO,
  CSV_SEM_CODIGO,
  EMAIL_FICTICIO,
  NOME_FICTICIO,
  PREVIA,
  RECUPERACOES,
  TEXTOS_PESSOAIS_DO_EXEMPLO,
  criarApiFalsa,
  respostaErro,
  type ApiFalsa,
  type Chamada,
} from "./teste-apoio";
import { DICAS } from "./textos";

const CAMINHO = "/coordenacao/conferencia";
const ROTULO_ARQUIVO = "Arquivo exportado da Rifei (CSV)";

function arquivoCsv(conteudo: BlobPart, nome = "pedidos-rifei.csv") {
  return new File([conteudo], nome, { type: "text/csv" });
}

async function abrir(api: ApiFalsa = criarApiFalsa()) {
  vi.stubGlobal("fetch", api.fetch);
  renderizarRota(CAMINHO);
  expect(
    await screen.findByRole("heading", { level: 1, name: "Conferência" }),
  ).toBeInTheDocument();
  // O conteúdo vem num pacote à parte (lazy): espera ele chegar.
  expect(await screen.findByLabelText(ROTULO_ARQUIVO)).toBeInTheDocument();
  return api;
}

/** Escolhe o arquivo e espera a conferência (ou a falha) chegar. */
async function escolher(arquivo = arquivoCsv(CSV_EXEMPLO)) {
  fireEvent.change(screen.getByLabelText(ROTULO_ARQUIVO), {
    target: { files: [arquivo] },
  });
  await screen.findByText(arquivo.name);
  await waitFor(() =>
    expect(screen.queryByText(/^(Lendo o arquivo|Conferindo)/)).toBeNull(),
  );
}

function botao(nome: string | RegExp) {
  return screen.getByRole("button", { name: nome });
}

function grupo(titulo: string) {
  return screen.getByRole("region", { name: titulo });
}

/** Nada dos dados pessoais do arquivo foi para a API (em nenhuma chamada). */
function esperarCorposSemDadoPessoal(api: ApiFalsa) {
  const enviados = JSON.stringify(api.chamadas.map((chamada) => chamada.corpo));
  for (const texto of TEXTOS_PESSOAIS_DO_EXEMPLO)
    expect(enviados).not.toContain(texto);
}

/** O corpo compacto que a tela manda para o CSV_EXEMPLO (com o SHA-256 que ela calculou). */
const CORPO_EXEMPLO = {
  colunas: {
    pedido_id: "Pedido",
    status: "Status",
    qtd_bilhetes: "Quantidade de bilhetes",
    bilhetes: null,
    valor: "Valor",
    afiliado: "Afiliado",
    data: "Data do pagamento",
  },
  linhas: 2,
  arquivo_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
  vezes: [1, 1],
  pedido_id: ["R-0101", "R-0102"],
  status: ["aprovado", "aprovado"],
  qtd_bilhetes: [3, 2],
  valor: [6000, 4000],
  afiliado: [101, 102],
  dia: ["2026-11-27", "2026-11-28"],
  instante: [Date.parse("2026-11-27T13:00:00.000Z"), null],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CA4: a tela da conferência", () => {
  it("abre com o passo a passo, o aviso de privacidade e as recuperações feitas, sem chamar a análise", async () => {
    const api = await abrir(
      criarApiFalsa({ recuperacoes: () => RECUPERACOES }),
    );

    expect(screen.getByText("Exportar Pedidos")).toBeInTheDocument();
    expect(
      screen.getByText("Os dados dos compradores não saem do seu computador"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(ROTULO_ARQUIVO)).toHaveAttribute(
      "accept",
      ".csv,text/csv",
    );
    const historico = await screen.findByRole("table", {
      name: "Recuperações feitas",
    });
    expect(within(historico).getByText("Pessoa de Teste")).toBeInTheDocument();
    expect(within(historico).getByText("R-0101, R-0105")).toBeInTheDocument();
    expect(within(historico).getByText("R$ 80,00")).toBeInTheDocument();
    expect(api.de("/analisar")).toEqual([]);
    expect(document.title).toBe("Conferência · Rifa Videira Kids");
  });

  it("sem recuperações ainda: o histórico diz que vai registrar quem e quando", async () => {
    await abrir();
    expect(
      await screen.findByText("Nenhuma venda recuperada ainda."),
    ).toBeInTheDocument();
  });

  it("o histórico vem de 50 em 50: “Carregar mais” pede a página seguinte pelo cursor e junta", async () => {
    const recuperacao = (id: number, pedido: string) => ({
      ...RECUPERACOES[0],
      id,
      pedidos: [pedido],
    });
    const pedidas: (string | null)[] = [];
    await abrir(
      criarApiFalsa({
        recuperacoes: (antesDe) => {
          pedidas.push(antesDe);
          return antesDe === null
            ? {
                itens: [recuperacao(9, "R-0901"), recuperacao(8, "R-0801")],
                proximo: 8,
              }
            : { itens: [recuperacao(4, "R-0401")], proximo: null };
        },
      }),
    );
    const historico = await screen.findByRole("table", {
      name: "Recuperações feitas",
    });
    expect(within(historico).getByText("R-0901")).toBeInTheDocument();
    expect(
      screen.getByText(/^As 2 recuperações mais recentes; as anteriores/),
    ).toBeInTheDocument();

    fireEvent.click(botao("Carregar mais"));

    expect(await within(historico).findByText("R-0401")).toBeInTheDocument();
    expect(within(historico).getByText("R-0901")).toBeInTheDocument();
    expect(pedidas).toEqual([null, "8"]);
    // Sem página seguinte, o botão some e o texto conta todas.
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
    expect(
      screen.getByText(/^3 recuperações, a mais recente primeiro\./),
    ).toBeInTheDocument();
  });

  it("escolher o arquivo confere com as colunas detectadas e mostra o resumo e as diferenças por tipo", async () => {
    const api = await abrir();
    await escolher();

    // A tela leu o arquivo e pediu o fuso da campanha: para a API vai só o corpo compacto, sem nome nem
    // e-mail (D1), com as datas já no fuso.
    expect(api.de("/campanha")).toHaveLength(1);
    expect(api.de("/analisar")).toEqual([
      {
        metodo: "POST",
        caminho: "/api/admin/reconciliacao/analisar",
        corpo: CORPO_EXEMPLO,
      },
    ]);
    esperarCorposSemDadoPessoal(api);

    // Mapeamento detectado, ajustável; as colunas pessoais não são opção.
    const codigo = screen.getByLabelText("Código do pedido");
    expect(codigo).toHaveValue("0");
    expect(
      within(codigo).getByRole("option", { selected: true }),
    ).toHaveTextContent("Pedido (coluna 1)");
    expect(
      within(codigo).queryByRole("option", { name: /Nome|E-mail/ }),
    ).toBeNull();
    expect(screen.getByLabelText("Números dos bilhetes")).toHaveValue("");
    expect(
      screen.getByText(
        "Ignoradas por terem dados pessoais (não saem do seu computador): Nome, E-mail.",
      ),
    ).toBeInTheDocument();
    esperarIndisponivel(botao("Conferir com estas colunas"));

    // O resultado recebe o foco e o leitor de tela ouve o resumo.
    const titulo = screen.getByText("Resultado da conferência");
    await waitFor(() => expect(titulo).toHaveFocus());
    expect(
      screen.getAllByRole("status").map((item) => item.textContent),
    ).toContain(
      "Conferência pronta: 6 pedidos com diferença, 4 vendas perdidas.",
    );

    // O que se lê em 5 segundos: o aviso e os totais dos dois lados. O pedido pago sem valor (R-0103)
    // não vira R$ 0: aparece à parte, ao lado do total.
    expect(
      screen.getByText("4 vendas pagas na Rifei não estão no sistema"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("8 pedidos · 16 bilhetes · R$ 310,00 (+1 sem valor)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("5 pedidos · 9 bilhetes · R$ 180,00"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/As colunas Nome e E-mail têm dados pessoais/),
    ).toBeInTheDocument();

    // Cada tipo com casos, com a explicação para leigos; os sem casos numa linha só.
    const perdidas = grupo("Vendas perdidas");
    expect(
      within(perdidas).getByText(/não contam no painel nem no ranking/),
    ).toBeInTheDocument();
    expect(
      within(perdidas).getByText(
        "Na Rifei: 7 bilhetes · R$ 120,00 (+1 sem valor).",
      ),
    ).toBeInTheDocument();
    const ausentes = grupo("Só no sistema");
    expect(
      within(ausentes).getByText(
        /arquivo de outro período ou uma compra de teste/,
      ),
    ).toBeInTheDocument();
    expect(
      within(ausentes).getByText("De um dia que o arquivo não cobre."),
    ).toBeInTheDocument();
    const valor = grupo("Valor diferente");
    expect(
      within(valor).getByText(
        /Pago · 2 bilhetes · R\$ 50,00 · Célula Betel \(afiliado 102\) · 25\/11\/2026/,
      ),
    ).toBeInTheDocument();
    expect(
      within(valor).getByText(
        /Pago · 2 bilhetes · R\$ 40,00 · Célula Betel \(afiliado 102\) · 25\/11\/2026 12:00/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Sem nenhum caso: Pagamento não registrado, Não pagas na Rifei, Quantidade de bilhetes diferente, Afiliado diferente.",
      ),
    ).toBeInTheDocument();
    // O ausente de um dia que o arquivo não cobre fica à parte, sem somar nas diferenças.
    expect(
      screen.getByText(
        "1 pedido pago no sistema é de um dia que o arquivo não cobre: ele aparece em “Só no sistema”, mas não conta como diferença.",
      ),
    ).toBeInTheDocument();

    // As recuperáveis já vêm marcadas; a sem valor não pode ser marcada e diz por quê.
    const caixa = (codigo: string) =>
      within(perdidas).getByRole("checkbox", {
        name: new RegExp(`Pedido ${codigo}`),
      });
    expect(caixa("R-0101")).toBeChecked();
    expect(caixa("R-0102")).toBeChecked();
    expect(caixa("R-0105")).toBeChecked();
    expect(caixa("R-0103")).toBeDisabled();
    expect(
      within(perdidas).getByText(
        "Sem o valor no arquivo: não dá para recuperar.",
      ),
    ).toBeInTheDocument();
    expect(
      within(perdidas).getByText(/afiliado não reconhecido/),
    ).toBeInTheDocument();
    esperarDisponivel(botao("Recuperar 3 vendas"));
  });

  it("trocar uma coluna e conferir de novo manda só as colunas escolhidas; desfazer volta ao detectado", async () => {
    const api = await abrir(
      criarApiFalsa({ analises: [ANALISE_POR_PEDIDO, ANALISE_POR_PEDIDO] }),
    );
    await escolher();

    fireEvent.change(screen.getByLabelText("Afiliado"), {
      target: { value: "" },
    });
    expect(
      screen.getByText("Troque o que for preciso e confira de novo."),
    ).toBeInTheDocument();
    fireEvent.click(botao("Desfazer as trocas"));
    expect(screen.getByLabelText("Afiliado")).toHaveValue("6");
    esperarIndisponivel(botao("Conferir com estas colunas"));

    fireEvent.change(screen.getByLabelText("Afiliado"), {
      target: { value: "" },
    });
    fireEvent.click(botao("Conferir com estas colunas"));

    await waitFor(() => expect(api.de("/analisar")).toHaveLength(2));
    const { afiliado: _afiliado, ...semAfiliado } = CORPO_EXEMPLO;
    void _afiliado;
    expect(api.de("/analisar")[1].corpo).toEqual({
      ...semAfiliado,
      colunas: { ...CORPO_EXEMPLO.colunas, afiliado: null },
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Afiliado")).toHaveValue(""),
    );
    esperarIndisponivel(botao("Conferir com estas colunas"));
    // O fuso da campanha foi pedido uma vez só.
    expect(api.de("/campanha")).toHaveLength(1);
  });

  it("colunas que não servem (a mesma coluna em dois campos): a tela explica sem chamar a API e sem perder o resultado", async () => {
    const api = await abrir();
    await escolher();

    fireEvent.change(screen.getByLabelText("Data do pagamento"), {
      target: { value: "0" },
    });
    fireEvent.click(botao("Conferir com estas colunas"));

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Estas colunas não servem");
    expect(alerta).toHaveTextContent(
      'A coluna "Pedido" já foi escolhida para outro campo (pedido_id)',
    );
    expect(api.de("/analisar")).toHaveLength(1);
    expect(screen.getByText("Resultado da conferência")).toBeInTheDocument();
  });

  it("a API recusa as colunas (400 com detalhes): mostra o que ela apontou", async () => {
    await abrir(
      criarApiFalsa({
        analises: [
          ANALISE_POR_PEDIDO,
          respostaErro(
            "requisicao_invalida",
            "Uma coluna com dados pessoais não pode ser usada na conferência",
            400,
            [
              {
                caminho: ["colunas", "afiliado"],
                codigo: "coluna_pessoal",
                mensagem:
                  'A coluna "Afiliado" tem dados pessoais e não pode ser usada',
              },
            ],
          ),
        ],
      }),
    );
    await escolher();
    fireEvent.change(screen.getByLabelText("Afiliado"), {
      target: { value: "" },
    });
    fireEvent.click(botao("Conferir com estas colunas"));
    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Estas colunas não servem");
    expect(alerta).toHaveTextContent(
      'A coluna "Afiliado" tem dados pessoais e não pode ser usada',
    );
  });

  it("Recuperar: mostra a prévia da API, só grava ao confirmar e confere de novo", async () => {
    let vezes = 0;
    const api = await abrir(
      criarApiFalsa({
        analises: [ANALISE_POR_PEDIDO, ANALISE_DEPOIS],
        recuperacoes: () => (vezes++ === 0 ? [] : RECUPERACOES),
      }),
    );
    await escolher();

    const perdidas = grupo("Vendas perdidas");
    fireEvent.click(
      within(perdidas).getByRole("checkbox", { name: /Pedido R-0102/ }),
    );
    const recuperar = botao("Recuperar 2 vendas");
    recuperar.focus();
    fireEvent.click(recuperar);

    const dialogo = await screen.findByRole("alertdialog", {
      name: "Recuperar 2 vendas?",
    });
    // O mesmo corpo da conferência (sem os dados pessoais), mais os escolhidos.
    expect(api.de("/recuperar")).toEqual([
      {
        metodo: "POST",
        caminho: "/api/admin/reconciliacao/recuperar",
        corpo: {
          ...CORPO_EXEMPLO,
          pedidos: ["R-0101", "R-0105"],
          simular: true,
        },
      },
    ]);
    expect(
      await within(dialogo).findByText(
        /Vão entrar 2 vendas: 2 pedidos · 4 bilhetes · R\$ 80,00\./,
      ),
    ).toBeInTheDocument();
    expect(
      within(dialogo).getByText(
        /3 bilhetes · R\$ 60,00 · Célula Ágape \(afiliado 101\)/,
      ),
    ).toBeInTheDocument();
    expect(
      within(dialogo).getByText(
        /sem afiliado \(o do arquivo não foi reconhecido\)/,
      ),
    ).toBeInTheDocument();
    expect(
      within(dialogo).getByText(/sem data no arquivo: entra agora/),
    ).toBeInTheDocument();
    expect(
      within(dialogo).getByText("1 venda fica de fora:"),
    ).toBeInTheDocument();
    expect(
      within(dialogo).getByText("Já está no sistema (nada foi mudado)"),
    ).toBeInTheDocument();

    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Gravar 2 vendas" }),
    );

    expect(await screen.findByText("2 vendas recuperadas")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api.de("/recuperar")[1].corpo).toEqual({
      ...CORPO_EXEMPLO,
      pedidos: ["R-0101", "R-0105"],
      simular: false,
    });
    expect(
      screen.getByText(/4 bilhetes já contam no painel e no ranking/),
    ).toBeInTheDocument();
    // Confere de novo com o mesmo corpo e recarrega as recuperações.
    await waitFor(() => expect(api.de("/analisar")).toHaveLength(2));
    expect(api.de("/analisar")[1].corpo).toEqual(CORPO_EXEMPLO);
    esperarCorposSemDadoPessoal(api);
    await waitFor(() =>
      expect(
        within(grupo("Vendas perdidas")).queryByRole("checkbox", {
          name: /Pedido R-0101/,
        }),
      ).toBeNull(),
    );
    const historico = await screen.findByRole("table", {
      name: "Recuperações feitas",
    });
    expect(within(historico).getByText("Pessoa de Teste")).toBeInTheDocument();
    expect(api.de("/recuperacoes").length).toBeGreaterThanOrEqual(2);
  });

  it("Cancelar na prévia não grava nada e devolve o foco ao botão", async () => {
    const api = await abrir();
    await escolher();
    const recuperar = botao("Recuperar 3 vendas");
    recuperar.focus();
    fireEvent.click(recuperar);
    const dialogo = await screen.findByRole("alertdialog");
    await within(dialogo).findByText(/Vão entrar/);

    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(
      api
        .de("/recuperar")
        .map((chamada) => (chamada.corpo as { simular: boolean }).simular),
    ).toEqual([true]);
    await waitFor(() => expect(botao("Recuperar 3 vendas")).toHaveFocus());
  });

  it("falha ao gravar: o diálogo continua aberto e diz que nada foi gravado", async () => {
    await abrir(
      criarApiFalsa({
        recuperar: ({ simular }) =>
          simular ? PREVIA : respostaErro("erro_interno", "Erro interno", 500),
      }),
    );
    await escolher();
    fireEvent.click(botao("Recuperar 3 vendas"));
    const dialogo = await screen.findByRole("alertdialog");
    fireEvent.click(
      await within(dialogo).findByRole("button", { name: "Gravar 2 vendas" }),
    );

    expect(
      await within(dialogo).findByText("Nada foi gravado"),
    ).toBeInTheDocument();
    expect(within(dialogo).getByText("Erro interno")).toBeInTheDocument();
    esperarDisponivel(
      within(dialogo).getByRole("button", { name: "Gravar 2 vendas" }),
    );
  });

  it("modo por totais (sem o código): tabelas por afiliado e por dia, e nada para recuperar", async () => {
    const api = await abrir(criarApiFalsa({ analises: [ANALISE_AGREGADA] }));
    await escolher(arquivoCsv(CSV_SEM_CODIGO, "sem-codigo.csv"));

    expect(api.de("/analisar")[0].corpo).toMatchObject({
      colunas: { pedido_id: null },
      linhas: 2,
    });
    expect(api.de("/analisar")[0].corpo).not.toHaveProperty("pedido_id");
    esperarCorposSemDadoPessoal(api);

    expect(screen.getByLabelText("Código do pedido")).toHaveValue("");
    expect(
      within(screen.getByLabelText("Código do pedido")).getByRole("option", {
        selected: true,
      }),
    ).toHaveTextContent("Não tem (comparar só os totais)");
    expect(screen.getByText("Os totais não batem")).toBeInTheDocument();
    expect(
      screen.getByText(
        "O sistema conta só as vendas de 24/11/2026 a 29/11/2026, os dias do arquivo.",
      ),
    ).toBeInTheDocument();
    const porAfiliado = screen.getByRole("table", {
      name: "Totais por afiliado",
    });
    const linhas = within(porAfiliado).getAllByRole("row").slice(1);
    expect(
      linhas.map((linha) => within(linha).getAllByRole("cell")[0].textContent),
    ).toEqual([
      "Célula Ágape (afiliado 101)",
      "Afiliado não reconhecido",
      "Célula Betel (afiliado 102)",
    ]);
    expect(within(linhas[0]).getByText("Diferente")).toBeInTheDocument();
    expect(within(linhas[2]).getByText("Confere")).toBeInTheDocument();
    const porDia = screen.getByRole("table", { name: "Totais por dia" });
    expect(within(porDia).getByText("28/11/2026")).toBeInTheDocument();
    // A linha paga sem valor não vira R$ 0, nem a sem quantidade 0 bilhete: os totais dizem quantas
    // ficaram de fora.
    expect(
      within(porDia).getByText(
        "2 pedidos · 3 bilhetes · R$ 40,00 (+1 sem valor)",
      ),
    ).toBeInTheDocument();
    expect(
      within(linhas[1]).getByText(
        "1 pedido · 0 bilhetes (+1 sem quantidade) · R$ 20,00",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "8 pedidos · 15 bilhetes (+1 sem quantidade) · R$ 310,00 (+1 sem valor)",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Recuperar/ })).toBeNull();
  });

  it("tudo confere: o aviso diz isso e não há lista de diferenças", async () => {
    await abrir(criarApiFalsa({ analises: [ANALISE_SEM_DIFERENCA] }));
    await escolher();

    expect(screen.getByText("Tudo confere")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Vendas perdidas" }),
    ).toBeNull();
    // Sem desconsiderados (quantidade 0, como a API manda), o grupo não aparece.
    expect(
      screen.queryByRole("region", { name: "Desconsiderados" }),
    ).toBeNull();
    expect(
      screen.getAllByRole("status").map((item) => item.textContent),
    ).toContain("Conferência pronta: tudo confere.");
  });
});

describe("RIFA-028 (D20), CA7: o pedido desconsiderado no arquivo", () => {
  it("aparece num grupo à parte, 'Desconsiderados', nunca como faltando nem como diferença", async () => {
    await abrir(criarApiFalsa({ analises: [ANALISE_COM_DESCONSIDERADOS] }));
    await escolher();

    // O resto confere: o desconsiderado não vira diferença.
    expect(screen.getByText("Tudo confere")).toBeInTheDocument();
    const desconsiderados = grupo("Desconsiderados");
    expect(within(desconsiderados).getByText("1 pedido")).toBeInTheDocument();
    expect(desconsiderados).toHaveTextContent(
      "Estão no arquivo e no sistema, mas o admin os tirou das contas (teste, fraude ou estorno). Não são diferença nem venda faltando",
    );
    const tabela = within(desconsiderados).getByRole("table", {
      name: "Desconsiderados",
    });
    expect(
      within(tabela)
        .getAllByRole("cell")
        .map((celula) => celula.textContent?.replace(/\u00a0/g, " ")),
    ).toEqual([
      "Pedido R-0300",
      "Pago · 1 bilhete · R$ 20,00 · Célula Ágape (afiliado 101) · 24/11/2026",
      "Pago · 1 bilhete · R$ 20,00 · Célula Ágape (afiliado 101) · 24/11/2026 19:00",
      "Desconsiderado (teste) em 24/11/2026 20:00. Observação: compra de teste na reunião.",
    ]);
    // Nenhum grupo de diferença o lista (nem "Vendas perdidas", nem "Só no sistema").
    for (const regiao of screen.getAllByRole("region"))
      if (regiao !== desconsiderados)
        expect(regiao).not.toHaveTextContent("R-0300");
    expect(
      screen.queryByRole("region", { name: "Vendas perdidas" }),
    ).toBeNull();
  });
});

describe("CA4: as travas da revisão (código que não bate e valor ambíguo)", () => {
  it("a coluna do código não confere: aviso claro no topo, nada marcado e o Recuperar travado", async () => {
    await abrir(criarApiFalsa({ analises: [ANALISE_TRAVADA] }));
    await escolher();

    expect(
      screen.getByText(
        "A coluna escolhida como código do pedido não parece ser o código da Rifei",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Só 0 de 7 pedidos pagos do arquivo existem no sistema/),
    ).toBeInTheDocument();
    // Se a coluna está certa, o caminho é outro período (o webhook parou).
    expect(
      screen.getByText(
        "Se a coluna está certa e o webhook parou, exporte um período que inclua dias com vendas já no sistema.",
      ),
    ).toBeInTheDocument();
    const perdidas = grupo("Vendas perdidas");
    for (const caixa of within(perdidas).getAllByRole("checkbox")) {
      expect(caixa).not.toBeChecked();
      expect(caixa).toBeDisabled();
    }
    expect(
      within(perdidas).getByText(
        "Nada pode ser recuperado enquanto a coluna do código do pedido não conferir com o sistema.",
      ),
    ).toBeInTheDocument();
    esperarIndisponivel(botao("Recuperar"));
    expect(
      screen.getAllByRole("status").map((item) => item.textContent),
    ).toContain(
      "Conferência pronta: a coluna escolhida como código do pedido não parece ser o código da Rifei.",
    );
  });

  it("valor ambíguo (o mesmo em todas as linhas, e não é o preço) e quantidade ilegível: explica, não deixa marcar e a soma não conta 0", async () => {
    await abrir(criarApiFalsa({ analises: [ANALISE_AMBIGUA] }));
    await escolher();
    const perdidas = grupo("Vendas perdidas");
    expect(
      within(perdidas).getByRole("checkbox", { name: /Pedido R-0101/ }),
    ).toBeDisabled();
    expect(
      within(perdidas).getByText(
        /repetem um valor que não é o preço do bilhete/,
      ),
    ).toBeInTheDocument();
    expect(
      within(perdidas).getByRole("checkbox", { name: /Pedido R-0108/ }),
    ).toBeDisabled();
    expect(
      within(perdidas).getByText(
        "Sem a quantidade de bilhetes no arquivo: não dá para recuperar.",
      ),
    ).toBeInTheDocument();
    // Nem o valor ambíguo vira R$ 0, nem a quantidade ilegível 0 bilhete: a soma diz o que ficou de fora.
    expect(
      within(perdidas).getByText(
        "Na Rifei: 3 bilhetes (+1 sem quantidade) · R$ 20,00 (+1 sem valor).",
      ),
    ).toBeInTheDocument();
  });
});

describe("CA4: problemas do arquivo", () => {
  it("arquivo vazio ou grande demais: avisa sem chamar a API", async () => {
    const api = await abrir();
    await escolher(arquivoCsv("  \r\n", "vazio.csv"));
    expect(screen.getByText("O arquivo está vazio")).toBeInTheDocument();

    const grande = arquivoCsv("Pedido\r\n", "grande.csv");
    Object.defineProperty(grande, "size", { value: 30_000_000 });
    await escolher(grande);
    expect(screen.getByText("O arquivo é grande demais")).toBeInTheDocument();
    expect(api.de("/analisar")).toEqual([]);
  });

  it("primeira linha de dados (sem cabeçalho): a tela explica em português, recebe o foco e nada vai para a API", async () => {
    const api = await abrir();
    await escolher(
      arquivoCsv(
        `R-0101;${NOME_FICTICIO};${EMAIL_FICTICIO};Pago\r\n`,
        "sem-cabecalho.csv",
      ),
    );

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("O arquivo não tem cabeçalho");
    expect(alerta).toHaveTextContent(
      "A primeira linha do arquivo não parece um cabeçalho",
    );
    await waitFor(() => expect(alerta.parentElement).toHaveFocus());
    expect(screen.queryByText("Resultado da conferência")).toBeNull();
    expect(api.chamadas.filter((chamada) => chamada.metodo === "POST")).toEqual(
      [],
    );
  });

  it("corpo grande demais para uma conferência: pede um período menor, sem chamar a análise", async () => {
    const linhas = [
      "Pedido;Status;Quantidade;Valor;Afiliado;Data do pagamento",
      ...Array.from(
        { length: 13_000 },
        (_, i) =>
          `PEDIDO-${String(i).padStart(6, "0")}-${"X".repeat(48)};Pago;1;R$ 20,00;101;27/11/2026 10:00`,
      ),
      "",
    ];
    const api = await abrir();
    await escolher(arquivoCsv(linhas.join("\r\n"), "enorme.csv"));
    expect(
      await screen.findByText(
        "O arquivo tem pedidos demais para conferir de uma vez",
      ),
    ).toBeInTheDocument();
    expect(api.de("/analisar")).toEqual([]);
  });

  it("sem campanha ativa (404): explica que ainda não dá para conferir, sem mandar o arquivo", async () => {
    const api = await abrir(criarApiFalsa({ campanha: null }));
    await escolher();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não dá para conferir ainda",
    );
    expect(api.de("/analisar")).toEqual([]);
  });

  it("arquivo em Windows-1252 (salvo no Excel): os acentos chegam certos à API e a tela avisa", async () => {
    const texto = "Pedido;Situação;Valor\r\nR-1;Não pago;R$ 20,00\r\n";
    const latin1 = Uint8Array.from(texto, (caractere) =>
      caractere.charCodeAt(0),
    );
    const api = await abrir();
    await escolher(arquivoCsv(latin1, "excel.csv"));

    expect(api.de("/analisar")[0].corpo).toMatchObject({
      colunas: { pedido_id: "Pedido", status: "Situação", valor: "Valor" },
      status: ["pendente"],
      valor: [2000],
    });
    expect(
      screen.getByText(/foi lido como no Excel \(Windows-1252\)/),
    ).toBeInTheDocument();
  });

  it("UTF-8 com BOM: o BOM sai antes de ir para a API", async () => {
    const api = await abrir();
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    await escolher(arquivoCsv(new Blob([bom, CSV_EXEMPLO]), "bom.csv"));
    // Sem o BOM, a primeira coluna é "Pedido" e o SHA-256 é o do mesmo texto sem BOM.
    expect(api.de("/analisar")[0].corpo).toEqual(CORPO_EXEMPLO);
  });

  it("D1 no navegador: nenhum dado do comprador aparece na tela, fica guardado no aparelho ou vai para a API", async () => {
    const api = await abrir();
    localStorage.clear();
    sessionStorage.clear();
    await escolher();
    fireEvent.click(botao("Recuperar 3 vendas"));
    await screen.findByText(/Vão entrar/);

    expect(document.body.textContent).not.toContain(NOME_FICTICIO);
    expect(document.body.textContent).not.toContain(EMAIL_FICTICIO);
    const guardado = JSON.stringify({ ...localStorage, ...sessionStorage });
    expect(guardado).not.toContain(NOME_FICTICIO);
    expect(guardado).not.toContain("R-0101");
    esperarCorposSemDadoPessoal(api);
  });
});

// RIFA-045 (correção): os botões indisponíveis da Conferência ficam com aria-disabled, não disabled. Pelo teclado, eles
// continuam no Tab e a dica diz por quê (com o disabled, o foco nunca chegava, e no diálogo do Recuperar o foco caía
// fora dele durante a gravação); o clique, o Enter e o espaço não fazem nada; a cara continua a do disabled.
describe("RIFA-045: os indisponíveis da Conferência, pelo teclado", () => {
  /** A cara de indisponível vem do conferencia.css (o Button.css só a dá ao disabled). */
  const CSS = [
    lerCss("components/ui/Button.css"),
    lerCss("pages/conferencia/conferencia.css"),
  ];

  /** Foca e clica, como o Enter faz no navegador (o jsdom não foca no clique). */
  function acionar(elemento: HTMLElement) {
    act(() => elemento.focus());
    fireEvent.click(elemento);
  }

  /** Segura as respostas de `quais` chamadas até `liberar()` (a chamada já fica registrada). */
  function trava(quais: (chamada: Chamada) => boolean) {
    let liberar = () => {};
    const promessa = new Promise<void>((resolver) => {
      liberar = resolver;
    });
    return {
      segurar: (chamada: Chamada) => (quais(chamada) ? promessa : undefined),
      liberar: () => liberar(),
    };
  }

  /** Espera o foco que vai para o resultado quando a conferência chega (é de um efeito). */
  async function esperarFocoNoResultado() {
    const titulo = screen.getByText("Resultado da conferência");
    await waitFor(() => expect(titulo).toHaveFocus());
  }

  it("'Conferir com estas colunas', sem troca e conferindo: no Tab, com o motivo, e não confere de novo", async () => {
    let analises = 0;
    // A primeira conferência (ao escolher o arquivo) responde na hora; a segunda fica presa.
    const analisar = trava(
      ({ caminho }) => caminho.endsWith("/analisar") && ++analises > 1,
    );
    const api = await abrir(criarApiFalsa({ segurar: analisar.segurar }));
    await escolher();
    await esperarFocoNoResultado();
    const conferir = botao("Conferir com estas colunas");

    await conferirIndisponivel(conferir, {
      dica: DICAS.conferirSemTroca,
      semEfeito: () => expect(api.de("/analisar")).toHaveLength(1),
      css: CSS,
    });

    fireEvent.change(screen.getByLabelText("Afiliado"), {
      target: { value: "" },
    });
    esperarDisponivel(conferir);
    acionar(conferir);
    expect(conferir).toHaveTextContent("Conferindo…");
    await conferirIndisponivel(conferir, {
      dica: DICAS.conferindo,
      semEfeito: () => expect(api.de("/analisar")).toHaveLength(2),
      css: CSS,
    });
    analisar.liberar();
    await waitFor(() =>
      expect(conferir).toHaveTextContent("Conferir com estas colunas"),
    );
    expect(api.de("/analisar")).toHaveLength(2);
  });

  it("'Recuperar' sem nada marcado: no Tab, com o motivo, e não abre a confirmação", async () => {
    const api = await abrir();
    await escolher();
    await esperarFocoNoResultado();
    fireEvent.click(botao("Desmarcar todas"));
    const recuperar = botao("Recuperar");
    expect(recuperar).toHaveAccessibleDescription(
      "Marque as vendas que quer recuperar.",
    );

    await conferirIndisponivel(recuperar, {
      dica: DICAS.recuperarIndisponivel,
      semEfeito: () => {
        expect(screen.queryByRole("alertdialog")).toBeNull();
        expect(api.de("/recuperar")).toEqual([]);
      },
      css: CSS,
    });
    // O motivo continua na descrição, antes da dica aberta pelo teclado.
    expect(recuperar).toHaveAccessibleDescription(
      `Marque as vendas que quer recuperar. ${DICAS.recuperarIndisponivel}`,
    );
  });

  it("'Carregar mais' carregando: o foco fica nele, com o motivo, e a página não é pedida de novo", async () => {
    let paginas = 0;
    // A primeira página responde na hora; a segunda ("Carregar mais") fica presa.
    const pagina = trava(
      ({ caminho }) => caminho.endsWith("/recuperacoes") && ++paginas > 1,
    );
    const api = await abrir(
      criarApiFalsa({
        recuperacoes: (antesDe) =>
          antesDe === null
            ? { itens: RECUPERACOES, proximo: 7 }
            : { itens: [], proximo: null },
        segurar: pagina.segurar,
      }),
    );
    const carregarMais = await screen.findByRole("button", {
      name: "Carregar mais",
    });

    acionar(carregarMais);
    expect(carregarMais).toHaveTextContent("Carregando…");
    await conferirIndisponivel(carregarMais, {
      dica: DICAS.carregando,
      semEfeito: () => expect(api.de("/recuperacoes")).toHaveLength(2),
      css: CSS,
    });
    pagina.liberar();
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /^(Carregar mais|Carregando…)$/ }),
      ).toBeNull(),
    );
    expect(api.de("/recuperacoes")).toHaveLength(2);
  });

  it("diálogo do Recuperar, gravando: o foco não sai do diálogo, Cancelar e Gravar não fazem nada e o Esc não fecha", async () => {
    const gravacao = trava(
      ({ caminho, corpo }) =>
        caminho.endsWith("/recuperar") &&
        !(corpo as { simular: boolean }).simular,
    );
    const api = await abrir(criarApiFalsa({ segurar: gravacao.segurar }));
    await escolher();
    await esperarFocoNoResultado();
    acionar(botao("Recuperar 3 vendas"));
    const dialogo = await screen.findByRole("alertdialog", {
      name: "Recuperar 3 vendas?",
    });
    const gravar = await within(dialogo).findByRole("button", {
      name: "Gravar 2 vendas",
    });
    const cancelar = within(dialogo).getByRole("button", { name: "Cancelar" });
    const fechar = within(dialogo).getByRole("button", { name: "Fechar" });
    const gravacoes = () =>
      api
        .de("/recuperar")
        .filter((chamada) => !(chamada.corpo as { simular: boolean }).simular);
    /** Nada mudou: o diálogo continua aberto, com uma gravação só. */
    const semEfeito = () => {
      expect(screen.getByRole("alertdialog")).toBe(dialogo);
      expect(gravacoes()).toHaveLength(1);
    };

    // Pelo teclado: Tab até o Gravar e Enter. O foco fica no botão (com o disabled, caía no <body>, fora do diálogo).
    chegarPeloTab(gravar);
    ativarPeloTeclado(gravar, "Enter");
    expect(gravar).toHaveTextContent("Gravando…");
    expect(gravacoes()).toHaveLength(1);
    expect(gravar).toHaveFocus();
    esperarIndisponivel(gravar);
    esperarIndisponivel(cancelar);

    // Tab e Shift+Tab dão a volta só dentro do diálogo e passam pelos dois indisponíveis: ×, Cancelar, Gravar.
    expect([tab(), tab(), tab(), tab(true), tab(true), tab(true)]).toEqual([
      fechar,
      cancelar,
      gravar,
      cancelar,
      fechar,
      gravar,
    ]);

    await conferirIndisponivel(cancelar, {
      dica: DICAS.gravando,
      semEfeito,
      css: CSS,
    });
    await conferirIndisponivel(gravar, {
      dica: DICAS.gravando,
      semEfeito,
      css: CSS,
    });

    // Esc: com a dica aberta (pelo Tab), o primeiro fecha só a dica; o seguinte pede para fechar o diálogo, que
    // ignora enquanto grava. O foco continua no Gravar. O × também é ignorado.
    chegarPeloTab(gravar);
    expect(dicaDe(gravar)).toHaveTextContent(DICAS.gravando);
    fireEvent.keyDown(gravar, { key: "Escape" });
    expect(dicaDe(gravar)).toBeNull();
    semEfeito();
    expect(gravar).toHaveFocus();
    fireEvent.keyDown(gravar, { key: "Escape" });
    semEfeito();
    expect(gravar).toHaveFocus();
    acionar(fechar);
    semEfeito();
    expect(dialogo).toContainElement(document.activeElement as HTMLElement);

    // A gravação termina: o diálogo fecha e a tela mostra o resultado.
    gravacao.liberar();
    expect(await screen.findByText("2 vendas recuperadas")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(gravacoes()).toHaveLength(1);
  });
});
