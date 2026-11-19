// RIFA-059: a seção "Extrato do banco (Pix manual)" da Conferência, renderizada pela rota de verdade, com a API falsa
// (teste-apoio.ts): subir o OFX, colar o texto, o CSV com as colunas, o resultado (para marcar na Rifei, ambíguos,
// sem pedido e já contados), copiar os números, a janela e as palavras sem buscar de novo, as falhas e a PROVA de que
// nenhuma chamada leva o conteúdo do extrato (nem o storage, nem o log). RIFA-068: o PDF (lido pelo pdf.js de verdade,
// com o worker na mesma linha de execução), com o mesmo resultado da tabela colada. Todos os dados são fictícios.
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { conferirIndisponivel, lerCss } from "../../../test/indisponivel";
import {
  ADMIN_DE_TESTE,
  renderizarRota,
  respostaJson,
} from "../../../test/renderizar";
import {
  AGORA,
  CSV_EXTRATO,
  OFX_SGML,
  OFX_XML,
  PAGADORA_TRES,
  PAGADORA_UM,
  TEXTOS_DO_EXTRATO,
  TEXTO_APP,
  TEXTO_LINHAS,
  TEXTO_TABELA,
  belem,
  criarApiDoExtrato,
  itemPedido,
  type Chamada,
} from "./teste-apoio";
import {
  criarPdfDeImagem,
  pdfComSenha,
  pdfDoBradesco,
  prepararPdfjsNosTestes,
  TEXTO_DO_BRADESCO,
} from "./teste-apoio-pdf";
import {
  CAMPOS,
  DICAS,
  FALHAS_DO_PDF,
  GRUPOS,
  LER_TEXTO,
  MAIS_AMBIGUOS,
  MAIS_CANDIDATOS,
  MAXIMO_AMBIGUOS_NA_TELA,
  MAXIMO_CANDIDATOS_NA_TELA,
} from "./textos";

const CAMINHO = "/coordenacao/conferencia";
type Api = ReturnType<typeof criarApiDoExtrato>;

beforeAll(prepararPdfjsNosTestes);

beforeEach(() => {
  // O "agora" fixo (18/11/2026): o ano que falta em "17 nov" sai sempre o mesmo. Só o Date: os temporizadores andam.
  vi.useFakeTimers({ toFake: ["Date"], now: AGORA });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function abrir(
  api: Api = criarApiDoExtrato(),
  usuario = undefined as typeof ADMIN_DE_TESTE | undefined,
) {
  vi.stubGlobal("fetch", api.fetch);
  renderizarRota(CAMINHO, usuario ? { usuario } : undefined);
  await screen.findByLabelText(CAMPOS.arquivo.rotulo, undefined, {
    timeout: 5000,
  });
  return api;
}

/** Sobe o arquivo e espera o resultado (ou a falha). */
async function subir(
  conteudo: string | Uint8Array<ArrayBuffer>,
  nome = "extrato.ofx",
) {
  fireEvent.change(screen.getByLabelText(CAMPOS.arquivo.rotulo), {
    target: { files: [new File([conteudo], nome)] },
  });
  await esperarFim();
}

async function colar(texto: string) {
  fireEvent.change(screen.getByLabelText(CAMPOS.texto.rotulo), {
    target: { value: texto },
  });
  fireEvent.click(screen.getByRole("button", { name: LER_TEXTO }));
  await esperarFim();
}

async function esperarFim() {
  await waitFor(() =>
    expect(
      screen.queryByText(/^(Lendo o extrato|Buscando os pedidos)/),
    ).toBeNull(),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("heading", { name: "Resultado do extrato" }) ??
        screen.queryByRole("alert"),
    ).not.toBeNull(),
  );
}

const grupo = (titulo: string) => screen.getByRole("region", { name: titulo });

/** A varredura: nada do extrato numa chamada (endereço ou corpo), e só leitura (GET, sem corpo). */
function conferirPrivacidade(chamadas: Chamada[]) {
  expect(chamadas.length).toBeGreaterThan(0);
  for (const chamada of chamadas) {
    expect(chamada.metodo).toBe("GET");
    expect(chamada.corpo).toBeUndefined();
    const endereco = new URL(chamada.url, "http://localhost");
    expect([
      "/api/admin/campanha",
      "/api/admin/pedidos",
      "/api/admin/reconciliacao/recuperacoes",
    ]).toContain(endereco.pathname);
    if (endereco.pathname === "/api/admin/pedidos")
      expect(
        [...endereco.searchParams.keys()].every((chave) =>
          ["limite", "antes_de"].includes(chave),
        ),
      ).toBe(true);
    for (const texto of TEXTOS_DO_EXTRATO) {
      expect(decodeURIComponent(chamada.url)).not.toContain(texto);
      expect(chamada.url.toUpperCase()).not.toContain(texto.toUpperCase());
    }
  }
}

describe("subir o OFX", () => {
  it("mostra o resultado: para marcar (Certo e Provável), ambíguos, sem pedido e o que ficou de fora", async () => {
    const api = await abrir();
    await subir(OFX_SGML);

    expect(
      await screen.findByRole("heading", { name: "Resultado do extrato" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Ficaram de fora: 1 débito e 1 crédito sem as palavras do Pix\./,
      ),
    ).toBeInTheDocument();

    const marcar = grupo(GRUPOS.paraMarcar.titulo);
    expect(
      within(marcar).getByText(`${GRUPOS.paraMarcar.aviso}.`),
    ).toBeInTheDocument();
    const linhas = within(marcar).getAllByRole("row").slice(1);
    expect(
      linhas.map((linha) => within(linha).getAllByRole("cell")[0].textContent),
    ).toEqual(["PEDTESTE0101", "PEDTESTE0103"]);
    expect(within(linhas[0]).getByText("Certo")).toBeInTheDocument();
    expect(within(linhas[1]).getByText("Provável")).toBeInTheDocument();
    expect(within(linhas[1]).getByText("Célula Betel")).toBeInTheDocument();

    // O nome de quem pagou aparece só na tela, para desempatar o ambíguo.
    const ambiguos = grupo(GRUPOS.ambiguos.titulo);
    expect(
      within(ambiguos).getByText(`PIX RECEBIDO ${PAGADORA_TRES}`),
    ).toBeInTheDocument();
    expect(within(ambiguos).getByText("PEDTESTE0104")).toBeInTheDocument();
    expect(within(ambiguos).getByText("PEDTESTE0105")).toBeInTheDocument();
    expect(within(ambiguos).getByText("Expirado")).toBeInTheDocument();

    const semPedido = grupo(GRUPOS.semPedido.titulo);
    expect(within(semPedido).getByText(/7,77/)).toBeInTheDocument();
    expect(
      within(semPedido).getByText("Nenhum pedido com este valor no horário."),
    ).toBeInTheDocument();

    // O foco vai para o título do resultado e o leitor de tela ouve o resumo.
    await waitFor(() =>
      expect(screen.getByText("Resultado do extrato")).toHaveFocus(),
    );
    expect(
      screen.getByText(
        "Extrato comparado: 2 pedidos para marcar na Rifei, 1 ambíguo.",
      ),
    ).toBeInTheDocument();
    conferirPrivacidade(api.chamadas);
  });

  it("o OFX 2.x: o pedido já pago aparece como já contado", async () => {
    await abrir();
    await subir(OFX_XML);
    const contados = await screen.findByRole("region", {
      name: GRUPOS.jaContados.titulo,
    });
    expect(within(contados).getByText("PEDTESTE0102")).toBeInTheDocument();
    expect(
      within(grupo(GRUPOS.paraMarcar.titulo)).getByText(
        GRUPOS.paraMarcar.vazio,
      ),
    ).toBeInTheDocument();
  });

  it("“Copiar os números dos pedidos” copia um por linha; sem a área de transferência, mostra os números selecionados", async () => {
    await abrir();
    await subir(OFX_SGML);
    const escrever = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: escrever },
      configurable: true,
    });
    try {
      fireEvent.click(
        screen.getByRole("button", { name: "Copiar os números dos pedidos" }),
      );
      await waitFor(() =>
        expect(escrever).toHaveBeenCalledWith("PEDTESTE0101\nPEDTESTE0103"),
      );
      expect(await screen.findAllByText(/2 números copiados/)).not.toHaveLength(
        0,
      );

      Object.defineProperty(navigator, "clipboard", {
        value: undefined,
        configurable: true,
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Copiar os números dos pedidos" }),
      );
      const campo = await screen.findByLabelText(
        "Números dos pedidos para marcar",
      );
      expect(campo).toHaveValue("PEDTESTE0101\nPEDTESTE0103");
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("as páginas da lista: busca até passar do primeiro Pix menos a maior janela, e para", async () => {
    const antigos = ["2026-11-01", "2026-10-31", "2026-10-30"].map(
      (dia, indice) =>
        itemPedido(`PEDVELHO000${indice}`, { reserva: belem(dia, "10:00") }),
    );
    const api = await abrir(
      criarApiDoExtrato({
        porPagina: 2,
        pedidos: [
          itemPedido("PEDTESTE0102", {
            status: "approved",
            total_centavos: 123456,
            reserva: belem("2026-11-17", "09:05"),
            aprovado_em: belem("2026-11-17", "10:00"),
          }),
          itemPedido("PEDTESTE0105", { reserva: belem("2026-11-16", "16:40") }),
          itemPedido("PEDTESTE0103", {
            total_centavos: 4000,
            reserva: belem("2026-11-16", "14:25"),
          }),
          itemPedido("PEDTESTE0101", { reserva: belem("2026-11-16", "09:58") }),
          ...antigos,
        ],
      }),
    );
    await subir(OFX_SGML);
    await screen.findByRole("heading", { name: "Resultado do extrato" });
    // Páginas 1, 2 e 3 (a 3ª termina em 31/10, antes de 13/11 10:05): a 4ª nunca é pedida.
    expect(api.pedidos().map((chamada) => chamada.url)).toEqual([
      "/api/admin/pedidos?limite=200",
      "/api/admin/pedidos?limite=200&antes_de=pagina-2",
      "/api/admin/pedidos?limite=200&antes_de=pagina-3",
    ]);
    expect(
      within(grupo(GRUPOS.paraMarcar.titulo)).getByText("PEDTESTE0103"),
    ).toBeInTheDocument();
  });
});

describe("colar o texto", () => {
  it("o texto de uma linha por lançamento: o pendente para marcar e o já pago como já contado", async () => {
    const api = await abrir();
    await colar(TEXTO_LINHAS);
    const marcar = grupo(GRUPOS.paraMarcar.titulo);
    expect(within(marcar).getByText("PEDTESTE0101")).toBeInTheDocument();
    expect(within(marcar).getByText("Provável")).toBeInTheDocument();
    expect(
      within(marcar).getByText(`PIX RECEBIDO ${PAGADORA_UM}`),
    ).toBeInTheDocument();
    expect(
      within(grupo(GRUPOS.jaContados.titulo)).getByText("PEDTESTE0102"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Ficaram de fora: 1 débito, 1 crédito sem as palavras do Pix e 1 linha de saldo\./,
      ),
    ).toBeInTheDocument();
    conferirPrivacidade(api.chamadas);
  });

  it("a tabela copiada da tela e o jeito dos apps também funcionam", async () => {
    await abrir();
    await colar(TEXTO_TABELA);
    // Sem a hora, o Pix de R$ 20,00 do dia 16 serve aos três pedidos de R$ 20,00 daquele dia: Ambíguo, com o nome.
    expect(screen.getByText(/O extrato não traz a hora/)).toBeInTheDocument();
    const ambiguos = grupo(GRUPOS.ambiguos.titulo);
    expect(
      within(ambiguos).getByText(/REM: Pagadora Ficticia Um/),
    ).toBeInTheDocument();
    expect(within(ambiguos).getAllByText(/^PEDTESTE010[145]$/)).toHaveLength(3);
    expect(
      within(grupo(GRUPOS.jaContados.titulo)).getByText("PEDTESTE0102"),
    ).toBeInTheDocument();
    await colar(TEXTO_APP);
    expect(
      within(grupo(GRUPOS.paraMarcar.titulo)).getByText("PEDTESTE0101"),
    ).toBeInTheDocument();
    expect(
      within(grupo(GRUPOS.jaContados.titulo)).getByText("PEDTESTE0102"),
    ).toBeInTheDocument();
  });

  it("“Ler o texto colado” fica indisponível (aria-disabled, com a dica) com a caixa vazia", async () => {
    const api = await abrir();
    const antes = api.chamadas.length;
    const botao = screen.getByRole("button", { name: LER_TEXTO });
    await conferirIndisponivel(botao, {
      dica: DICAS.lerTextoVazio,
      semEfeito: () => expect(api.chamadas).toHaveLength(antes),
      css: [
        lerCss("components/ui/Button.css"),
        lerCss("pages/conferencia/extrato/extrato.css"),
      ],
    });
  });

  it("a janela e as palavras mudam o resultado na hora, sem buscar os pedidos de novo", async () => {
    const api = await abrir(
      criarApiDoExtrato({
        pedidos: [
          itemPedido("PEDTESTE0201", { reserva: belem("2026-11-15", "09:00") }),
        ],
      }),
    );
    await colar("16/11/2026 10:05 PIX RECEBIDO FULANA FICTICIA R$ 20,00");
    expect(
      within(grupo(GRUPOS.paraMarcar.titulo)).getByText(
        GRUPOS.paraMarcar.vazio,
      ),
    ).toBeInTheDocument();
    const buscas = api.pedidos().length;

    fireEvent.change(screen.getByLabelText(CAMPOS.janela.rotulo), {
      target: { value: "48" },
    });
    expect(
      within(grupo(GRUPOS.paraMarcar.titulo)).getByText("PEDTESTE0201"),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(CAMPOS.palavras.rotulo), {
      target: { value: "TED" },
    });
    expect(
      screen.getByText(/Nenhum Pix recebido neste extrato/),
    ).toBeInTheDocument();
    expect(api.pedidos()).toHaveLength(buscas);
  });

  it("muitos pedidos do mesmo valor: o ambíguo mostra os 8 primeiros e conta os outros (a página não trava)", async () => {
    const pedidos = Array.from({ length: 12 }, (_, i) =>
      itemPedido(`PEDTESTE03${String(i).padStart(2, "0")}`, {
        reserva: belem("2026-11-16", `09:${String(10 + i)}`),
      }),
    ).reverse();
    await abrir(criarApiDoExtrato({ pedidos }));
    await colar("16/11/2026 10:05 PIX RECEBIDO FULANA FICTICIA R$ 20,00");
    const ambiguos = grupo(GRUPOS.ambiguos.titulo);
    expect(
      within(ambiguos).getByText("12 pedidos servem:"),
    ).toBeInTheDocument();
    expect(within(ambiguos).getAllByText(/^PEDTESTE03\d\d$/)).toHaveLength(
      MAXIMO_CANDIDATOS_NA_TELA,
    );
    expect(within(ambiguos).getByText(MAIS_CANDIDATOS(4))).toBeInTheDocument();
  });

  it("muitos Pix ambíguos: mostra os 100 primeiros e conta os outros", async () => {
    await abrir(
      criarApiDoExtrato({
        pedidos: [
          itemPedido("PEDTESTE0402", { reserva: belem("2026-11-16", "09:02") }),
          itemPedido("PEDTESTE0401", { reserva: belem("2026-11-16", "09:01") }),
        ],
      }),
    );
    await colar(
      Array.from(
        { length: MAXIMO_AMBIGUOS_NA_TELA + 3 },
        (_, i) =>
          `16/11/2026 10:${String(i % 60).padStart(2, "0")} PIX RECEBIDO FULANA FICTICIA R$ 20,00`,
      ).join("\n"),
    );
    const ambiguos = grupo(GRUPOS.ambiguos.titulo);
    expect(within(ambiguos).getAllByText("2 pedidos servem:")).toHaveLength(
      MAXIMO_AMBIGUOS_NA_TELA,
    );
    expect(within(ambiguos).getByText(MAIS_AMBIGUOS(3))).toBeInTheDocument();
  });
});

describe("o PDF do banco (RIFA-068)", () => {
  /** O que o cartão do resultado mostra (os números e as listas), sem a linha de onde veio o extrato. */
  const resultadoNaTela = () =>
    (
      screen
        .getByRole("heading", { name: "Resultado do extrato" })
        .closest(".ui-card")?.textContent ?? ""
    ).replace(/Lido do [^:]+:/, "Lido:");

  it("o campo aceita PDF e a dica diz como baixar o PDF no Net Empresa", async () => {
    await abrir();
    expect(screen.getByLabelText(CAMPOS.arquivo.rotulo)).toHaveAttribute(
      "accept",
      expect.stringMatching(/\.pdf,.*application\/pdf/),
    );
    expect(screen.getByText(/salve em PDF/)).toBeInTheDocument();
  });

  it("subir o PDF do Bradesco dá o mesmo resultado que colar a tabela", async () => {
    const api = await abrir();
    await subir(pdfDoBradesco(), "extrato.pdf");
    expect(
      screen.getByText(/Lido do arquivo PDF: 6 lançamentos\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Ficaram de fora: 3 débitos\./),
    ).toBeInTheDocument();
    const marcar = grupo(GRUPOS.paraMarcar.titulo);
    expect(within(marcar).getByText("PEDTESTE0103")).toBeInTheDocument();
    expect(within(marcar).getByText("Provável")).toBeInTheDocument();
    expect(
      within(grupo(GRUPOS.ambiguos.titulo)).getByText(
        new RegExp(`REM: ${PAGADORA_UM}`),
      ),
    ).toBeInTheDocument();
    expect(
      within(grupo(GRUPOS.jaContados.titulo)).getByText("PEDTESTE0102"),
    ).toBeInTheDocument();
    const doPdf = resultadoNaTela();
    conferirPrivacidade(api.chamadas);

    await colar(TEXTO_DO_BRADESCO);
    expect(
      screen.getByText(/Lido do texto colado: 6 lançamentos\./),
    ).toBeInTheDocument();
    expect(resultadoNaTela()).toEqual(doPdf);
  });
});

describe("o CSV do banco", () => {
  it("mostra as colunas detectadas; trocar a coluna muda o resultado na hora", async () => {
    await abrir();
    await subir(CSV_EXTRATO, "extrato.csv");
    expect(
      screen.getByRole("heading", { name: "Colunas do extrato" }),
    ).toBeInTheDocument();
    const marcar = () => grupo(GRUPOS.paraMarcar.titulo);
    const linhaDe = (numero: string) =>
      within(marcar())
        .getAllByRole("row")
        .find((linha) => linha.textContent?.includes(numero)) as HTMLElement;
    expect(
      within(linhaDe("PEDTESTE0101")).getByText("Certo"),
    ).toBeInTheDocument();
    expect(
      within(linhaDe("PEDTESTE0103")).getByText("Provável"),
    ).toBeInTheDocument();

    // Sem a coluna do documento, o Pix de R$ 20,00 casa só pelo valor.
    fireEvent.change(screen.getByLabelText("Documento ou identificador"), {
      target: { value: "" },
    });
    expect(
      within(linhaDe("PEDTESTE0101")).getByText("Provável"),
    ).toBeInTheDocument();
  });
});

describe("falhas", () => {
  it("sem campanha: diz que é preciso configurar antes", async () => {
    await abrir(criarApiDoExtrato({ campanha: null }));
    await subir(OFX_SGML);
    expect(
      await screen.findByText("Não dá para conferir ainda"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByText("Não dá para conferir ainda").closest("[tabindex]"),
      ).toHaveFocus(),
    );
  });

  it("o PDF-imagem (escaneado) e o PDF com senha: dizem o que houve e o outro jeito, com o foco na mensagem", async () => {
    await abrir();
    await subir(criarPdfDeImagem(), "extrato.pdf");
    const imagem = await screen.findByText(FALHAS_DO_PDF.imagem.titulo);
    expect(screen.getByText(FALHAS_DO_PDF.imagem.mensagem)).toBeInTheDocument();
    await waitFor(() => expect(imagem.closest("[tabindex]")).toHaveFocus());
    await subir(pdfComSenha(), "extrato.pdf");
    expect(
      await screen.findByText(FALHAS_DO_PDF.senha.titulo),
    ).toBeInTheDocument();
    expect(screen.queryByText(FALHAS_DO_PDF.imagem.titulo)).toBeNull();
    // O arquivo quebrado que diz ser PDF.
    await subir("%PDF-1.4", "extrato.pdf");
    expect(
      await screen.findByText(FALHAS_DO_PDF.invalido.titulo),
    ).toBeInTheDocument();
  });

  it("a falha ao buscar os pedidos tem “Tentar de novo”", async () => {
    let falhar = true;
    const api = await abrir(
      criarApiDoExtrato({
        falharPedidos: () =>
          falhar
            ? respostaJson(
                { erro: { codigo: "erro_interno", mensagem: "Erro interno" } },
                500,
              )
            : null,
      }),
    );
    await subir(OFX_SGML);
    expect(
      await screen.findByText("Não foi possível buscar os pedidos"),
    ).toBeInTheDocument();
    falhar = false;
    fireEvent.click(screen.getByRole("button", { name: /Tentar de novo/ }));
    expect(
      await screen.findByRole("region", { name: GRUPOS.paraMarcar.titulo }),
    ).toBeInTheDocument();
    expect(api.pedidos()).toHaveLength(2);
  });
});

describe("privacidade: o extrato fica só na tela", () => {
  it("nenhuma chamada, storage ou log leva o conteúdo do extrato, para admin e coordenação", async () => {
    const gravados: string[] = [];
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(
      (chave: string, valor: string) => {
        gravados.push(`${chave}=${valor}`);
      },
    );
    const logs = (["log", "info", "warn", "error", "debug"] as const).map(
      (nome) => vi.spyOn(console, nome).mockImplementation(() => {}),
    );
    for (const usuario of [undefined, ADMIN_DE_TESTE]) {
      const api = await abrir(criarApiDoExtrato(), usuario);
      await subir(OFX_SGML);
      await colar(TEXTO_LINHAS);
      await subir(CSV_EXTRATO, "extrato.csv");
      await subir(pdfDoBradesco(), "extrato.pdf");
      expect(screen.getByText(/Lido do arquivo PDF/)).toBeInTheDocument();
      conferirPrivacidade(api.chamadas);
      cleanup();
    }
    for (const texto of TEXTOS_DO_EXTRATO) {
      expect(gravados.join("\n")).not.toContain(texto);
      for (const espiao of logs)
        expect(JSON.stringify(espiao.mock.calls)).not.toContain(texto);
    }
  });
});
