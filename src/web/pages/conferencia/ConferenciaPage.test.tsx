// CA4 (RIFA-012): a tela /coordenacao/conferencia renderizada pela rota de verdade, com a API falsa
// (teste-apoio.ts): subir o arquivo, ver e ajustar o mapeamento detectado, conferir, ler o resumo e as
// diferenças por tipo (com a explicação), marcar e recuperar com confirmação, e as recuperações feitas.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderizarRota } from "../../test/renderizar";
import {
  ANALISE_AGREGADA,
  ANALISE_DEPOIS,
  ANALISE_POR_PEDIDO,
  ANALISE_SEM_DIFERENCA,
  CSV_EXEMPLO,
  EMAIL_FICTICIO,
  MAPEAMENTO,
  NOME_FICTICIO,
  PREVIA,
  RECUPERACOES,
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
      screen.getByText("Os dados dos compradores não ficam no sistema"),
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

  it("escolher o arquivo confere com as colunas detectadas e mostra o resumo e as diferenças por tipo", async () => {
    const api = await abrir();
    await escolher();

    // O arquivo vai inteiro, sem mapeamento: a API detecta as colunas.
    expect(api.de("/analisar")).toEqual([
      {
        metodo: "POST",
        caminho: "/api/admin/reconciliacao/analisar",
        corpo: { csv: CSV_EXEMPLO },
      },
    ]);

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
        "Ignoradas por terem dados pessoais (nunca são lidas nem guardadas): Nome, E-mail.",
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

    // O que se lê em 5 segundos: o aviso e os totais dos dois lados.
    expect(
      screen.getByText("4 vendas pagas na Rifei não estão no sistema"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("8 pedidos · 16 bilhetes · R$ 310,00"),
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
      within(perdidas).getByText("Na Rifei: 7 bilhetes · R$ 120,00."),
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

  it("trocar uma coluna e conferir de novo manda o mapeamento escolhido; desfazer volta ao detectado", async () => {
    const api = await abrir(
      criarApiFalsa({
        analises: [
          ANALISE_POR_PEDIDO,
          {
            ...ANALISE_POR_PEDIDO,
            mapeamento: { ...MAPEAMENTO, afiliado: null },
            mapeamento_detectado: false,
          },
        ],
      }),
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
    expect(api.de("/analisar")[1].corpo).toEqual({
      csv: CSV_EXEMPLO,
      mapeamento: { ...MAPEAMENTO, afiliado: null },
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Afiliado")).toHaveValue(""),
    );
    expect(botao("Conferir com estas colunas")).toBeDisabled();
  });

  it("colunas que não servem: mostra o que a API apontou, sem perder o resultado anterior", async () => {
    await abrir(
      criarApiFalsa({
        analises: [
          ANALISE_POR_PEDIDO,
          respostaErro(
            "requisicao_invalida",
            "O mapeamento não serve para as colunas do arquivo",
            400,
            [
              {
                caminho: ["mapeamento", "data"],
                codigo: "coluna_repetida",
                mensagem:
                  'A coluna "Pedido" já foi escolhida para outro campo (pedido_id)',
              },
            ],
          ),
        ],
      }),
    );
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
    expect(screen.getByText("Resultado da conferência")).toBeInTheDocument();
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
    expect(api.de("/recuperar")).toEqual([
      {
        metodo: "POST",
        caminho: "/api/admin/reconciliacao/recuperar",
        corpo: {
          csv: CSV_EXEMPLO,
          mapeamento: MAPEAMENTO,
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
      csv: CSV_EXEMPLO,
      mapeamento: MAPEAMENTO,
      pedidos: ["R-0101", "R-0105"],
      simular: false,
    });
    expect(
      screen.getByText(/4 bilhetes já contam no painel e no ranking/),
    ).toBeInTheDocument();
    // Confere de novo com as mesmas colunas e recarrega as recuperações.
    await waitFor(() => expect(api.de("/analisar")).toHaveLength(2));
    expect(api.de("/analisar")[1].corpo).toEqual({
      csv: CSV_EXEMPLO,
      mapeamento: MAPEAMENTO,
    });
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
    await abrir(criarApiFalsa({ analises: [ANALISE_AGREGADA] }));
    await escolher();

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

  it("csv_invalido da API (ex.: primeira linha de dados): mostra a mensagem em português e recebe o foco", async () => {
    const mensagem =
      "A primeira linha do arquivo não parece um cabeçalho: ela tem números, datas, valores ou e-mails. Exporte de novo pela Rifei: a primeira linha precisa ter os nomes das colunas.";
    await abrir(
      criarApiFalsa({
        analises: [
          respostaErro("csv_invalido", mensagem, 400, {
            motivo: "sem_cabecalho",
          }),
        ],
      }),
    );
    await escolher();

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Não foi possível ler o arquivo");
    expect(alerta).toHaveTextContent(mensagem);
    await waitFor(() => expect(alerta.parentElement).toHaveFocus());
    expect(screen.queryByText("Resultado da conferência")).toBeNull();
  });

  it("sem campanha ativa (404): explica que ainda não dá para conferir", async () => {
    await abrir(
      criarApiFalsa({
        analises: [
          respostaErro(
            "nao_encontrado",
            "A campanha ainda não foi configurada: configure-a antes de conferir",
            404,
          ),
        ],
      }),
    );
    await escolher();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não dá para conferir ainda",
    );
  });

  it("arquivo em Windows-1252 (salvo no Excel): os acentos chegam certos à API e a tela avisa", async () => {
    const texto = "Pedido;Situação;Valor\r\nR-1;Não pago;R$ 20,00\r\n";
    const latin1 = Uint8Array.from(texto, (caractere) =>
      caractere.charCodeAt(0),
    );
    const api = await abrir();
    await escolher(arquivoCsv(latin1, "excel.csv"));

    expect(api.de("/analisar")[0].corpo).toEqual({ csv: texto });
    expect(
      screen.getByText(/foi lido como no Excel \(Windows-1252\)/),
    ).toBeInTheDocument();
  });

  it("UTF-8 com BOM: o BOM sai antes de ir para a API", async () => {
    const api = await abrir();
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    await escolher(arquivoCsv(new Blob([bom, CSV_EXEMPLO]), "bom.csv"));
    expect(api.de("/analisar")[0].corpo).toEqual({ csv: CSV_EXEMPLO });
  });

  it("D1 no navegador: nenhum dado do comprador aparece na tela nem fica guardado no aparelho", async () => {
    await abrir();
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
  });
});
