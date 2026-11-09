// CA4 (RIFA-012): a tela /coordenacao/conferencia renderizada pela rota de verdade, com a API falsa
// (teste-apoio.ts): escolher o arquivo (lido NO NAVEGADOR), ver e ajustar o mapeamento detectado, conferir,
// ler o resumo e as diferenças por tipo (com a explicação), marcar e recuperar com confirmação, e as
// recuperações feitas. Os corpos enviados à API são varridos atrás dos dados pessoais do arquivo.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderizarRota } from "../../test/renderizar";
import {
  ANALISE_AGREGADA,
  ANALISE_AMBIGUA,
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
} from "./teste-apoio";

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
    expect(botao("Conferir com estas colunas")).toBeDisabled();

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
    expect(botao("Recuperar 3 vendas")).toBeEnabled();
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
    expect(botao("Conferir com estas colunas")).toBeDisabled();

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
    expect(botao("Conferir com estas colunas")).toBeDisabled();
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
    expect(
      within(dialogo).getByRole("button", { name: "Gravar 2 vendas" }),
    ).toBeEnabled();
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
    // A linha paga sem valor não vira R$ 0: o total diz quantas ficaram de fora.
    expect(
      within(porDia).getByText(
        "2 pedidos · 3 bilhetes · R$ 40,00 (+1 sem valor)",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("8 pedidos · 16 bilhetes · R$ 310,00 (+1 sem valor)"),
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
    expect(
      screen.getAllByRole("status").map((item) => item.textContent),
    ).toContain("Conferência pronta: tudo confere.");
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
    expect(botao("Recuperar")).toBeDisabled();
    expect(
      screen.getAllByRole("status").map((item) => item.textContent),
    ).toContain(
      "Conferência pronta: a coluna escolhida como código do pedido não parece ser o código da Rifei.",
    );
  });

  it("valor ambíguo (o mesmo em todas as linhas, e não é o preço): explica e não deixa marcar", async () => {
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
