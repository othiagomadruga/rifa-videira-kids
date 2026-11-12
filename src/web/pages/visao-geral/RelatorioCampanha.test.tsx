// RIFA-038 (D23): o cartão "Relatório da campanha" no fim da Visão geral. Renderiza o site pela rota de verdade,
// com a API simulada de teste-apoio.ts (o CSV sai de montarCsvRelatorio, com os cabeçalhos de
// cabecalhosDoRelatorio) e o download espiado por test/download.ts (o jsdom não baixa arquivos).
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsuarioSessao } from "../../../shared/contracts";
import {
  TIPOS_RELATORIO,
  nomeDoArquivoRelatorio,
  type TipoRelatorio,
} from "../../../shared/contracts/relatorio";
import { LIBERAR_ARQUIVO_DEPOIS_MS } from "../../lib/api";
import { espiarDownloads } from "../../test/download";
import {
  ADMIN_DE_TESTE,
  USUARIO_DE_TESTE,
  renderizarRota,
} from "../../test/renderizar";
import { LIDER } from "../minha/teste-apoio";
import {
  CENARIOS,
  RESPOSTAS_DE_ERRO,
  csvDoRelatorio,
  dataDoCenario,
  respostaRelatorio,
  simularApi,
} from "./teste-apoio";
import { TEXTOS_TIPO_RELATORIO } from "./textos";

let downloads: ReturnType<typeof espiarDownloads>;

beforeEach(() => {
  // Só os temporizadores (como em VisaoGeralPage.test.tsx): as promessas e o agendador do React continuam reais.
  // A liberação do object URL (60 s) nunca fica pendente no relógio de verdade: o useRealTimers a descarta.
  vi.useFakeTimers({
    shouldAdvanceTime: true,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  downloads = espiarDownloads();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  downloads.desfazer();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const DATA = dataDoCenario(CENARIOS.emDia); // 2026-12-04, dia 12

/** Abre a Visão geral com a API simulada e espera o painel chegar (o cartão do relatório não depende dele). */
async function abrir(usuario: UsuarioSessao = USUARIO_DE_TESTE) {
  const api = simularApi(CENARIOS.emDia);
  const tela = renderizarRota("/coordenacao", { usuario });
  await waitFor(() =>
    expect(screen.getByText(/^Atualizado às/)).toBeInTheDocument(),
  );
  return { api, ...tela };
}

/** O cartão do relatório, pelo título <h2>. */
function cartao() {
  const titulo = screen.getByRole("heading", {
    level: 2,
    name: "Relatório da campanha",
  });
  const elemento = titulo.closest<HTMLElement>(".ui-card");
  if (!elemento) throw new Error("cartão do relatório não encontrado");
  return within(elemento);
}

const botaoBaixar = () =>
  cartao().getByRole("button", { name: "Baixar relatório" });
const regiaoViva = () => cartao().getByRole("status");
const radio = (tipo: TipoRelatorio) =>
  cartao().getByRole("radio", { name: TEXTOS_TIPO_RELATORIO[tipo].rotulo });

/** Uma resposta que só chega quando o teste solta. */
function segurar() {
  let soltar: (resposta: Response) => void = () => undefined;
  const promessa = new Promise<Response>((resolver) => {
    soltar = resolver;
  });
  return { promessa, soltar };
}

/** Foca e clica (o jsdom não foca no clique): para conferir onde o foco fica. */
function clicar(elemento: HTMLElement) {
  elemento.focus();
  fireEvent.click(elemento);
}

/** Espera o download terminar: a linha "Baixado" com o nome do arquivo. */
async function esperarBaixado(nome: string) {
  expect(
    await cartao().findByText(nome, { selector: ".visao-relatorio__arquivo" }),
  ).toBeInTheDocument();
}

describe("CA1: o cartão, os tipos, a consulta e o nome do arquivo", () => {
  it("no fim da Visão geral: os 7 tipos na ordem do contrato, cada um com a explicação; Totais vem escolhido; o botão e como abrir", async () => {
    await abrir();

    const titulos = screen
      .getAllByRole("heading", { level: 2 })
      .map((titulo) => titulo.textContent);
    expect(titulos.at(-1)).toBe("Relatório da campanha");

    const grupo = cartao().getByRole("group", { name: "O que baixar" });
    const opcoes = within(grupo).getAllByRole("radio");
    expect(opcoes.map((opcao) => (opcao as HTMLInputElement).value)).toEqual([
      ...TIPOS_RELATORIO,
    ]);
    for (const tipo of TIPOS_RELATORIO) {
      const { rotulo, descricao } = TEXTOS_TIPO_RELATORIO[tipo];
      const opcao = within(grupo).getByRole("radio", { name: rotulo });
      expect(opcao).toHaveAccessibleDescription(descricao);
      expect(within(grupo).getByText(descricao)).toBeVisible();
    }
    expect(opcoes.map((opcao) => opcao.getAttribute("name"))).toEqual(
      Array(7).fill(opcoes[0].getAttribute("name")),
    );
    expect(radio("totais")).toBeChecked();
    expect(
      within(grupo).getByRole("radio", { name: "Por célula" }),
    ).toHaveAccessibleDescription(
      "Cada célula com rede, discipulador, líder, vendas, % da meta e posição na divisão.",
    );

    expect(botaoBaixar()).toBeEnabled();
    const comoAbrir = cartao().getByText("Como abrir").parentElement;
    expect(comoAbrir).toHaveTextContent("Excel: dois cliques no arquivo.");
    const google = within(comoAbrir!)
      .getByText("Google Planilhas:")
      .closest("li")!;
    // As setas do caminho do menu são só visuais: o leitor de tela ouve "Arquivo, Importar, Fazer upload".
    expect(google).toHaveTextContent(
      "Google Planilhas: Arquivo → , Importar → , Fazer upload. Em “Tipo de separador”, escolha “Personalizado” e digite ; (ponto e vírgula).",
    );
    const setas = within(google).getAllByText("→");
    expect(setas).toHaveLength(2);
    for (const seta of setas)
      expect(seta).toHaveAttribute("aria-hidden", "true");
  });

  it("o tipo escolhido vai na consulta; o nome do arquivo vem do Content-Disposition; o arquivo é o CSV da API, com o BOM", async () => {
    const { api } = await abrir();

    fireEvent.click(radio("celulas"));
    expect(radio("celulas")).toBeChecked();
    clicar(botaoBaixar());

    const nome = nomeDoArquivoRelatorio("celulas", DATA);
    expect(nome).toBe("rifa-videira-kids-celulas-2026-12-04.csv");
    await esperarBaixado(nome);
    expect(api.consultasAoRelatorio).toEqual([
      "/api/painel/relatorio?tipo=celulas",
    ]);
    const { init } = api.pedidos.find(
      (pedido) => pedido.url.pathname === "/api/painel/relatorio",
    )!;
    expect(init).toMatchObject({ method: "GET", credentials: "same-origin" });

    expect(downloads.cliques).toEqual([
      { endereco: expect.stringMatching(/^blob:/), nome, naPagina: true },
    ]);
    expect(await downloads.texto()).toBe(csvDoRelatorio("celulas"));
    expect((await downloads.texto()).startsWith("﻿Divisão;Rede;")).toBe(true);
    // Os bytes gravados começam pelo BOM UTF-8, que faz o Excel ler os acentos certos (D23).
    expect([...(await downloads.bytes()).slice(0, 3)]).toEqual([
      0xef, 0xbb, 0xbf,
    ]);
    expect(regiaoViva()).toHaveTextContent(`Relatório baixado: ${nome}.`);
    expect(cartao().getByText(/^Baixado:/).parentElement).toHaveTextContent(
      `Baixado: ${nome}. Fica na pasta de downloads do aparelho.`,
    );
  });

  it.each(TIPOS_RELATORIO)(
    "tipo %s: a consulta e o nome do arquivo do tipo",
    async (tipo) => {
      const { api } = await abrir();

      fireEvent.click(radio(tipo));
      clicar(botaoBaixar());

      const nome = nomeDoArquivoRelatorio(tipo, DATA);
      await esperarBaixado(nome);
      expect(api.consultasAoRelatorio).toEqual([
        `/api/painel/relatorio?tipo=${tipo}`,
      ]);
      expect(downloads.cliques.map((clique) => clique.nome)).toEqual([nome]);
    },
  );

  it("sem o Content-Disposition, o nome de reserva do contrato (rifa-videira-kids-<tipo>.csv)", async () => {
    const { api } = await abrir();
    api.relatorio = () =>
      new Response(csvDoRelatorio("dias"), {
        headers: { "content-type": "text/csv; charset=utf-8" },
      });

    fireEvent.click(radio("dias"));
    clicar(botaoBaixar());

    await esperarBaixado("rifa-videira-kids-dias.csv");
    expect(downloads.cliques.map((clique) => clique.nome)).toEqual([
      "rifa-videira-kids-dias.csv",
    ]);
  });

  it.each([
    ["coordenação", USUARIO_DE_TESTE],
    ["admin", ADMIN_DE_TESTE],
  ])("%s vê o cartão e baixa", async (_papel, usuario) => {
    await abrir(usuario);

    clicar(botaoBaixar());

    await esperarBaixado(nomeDoArquivoRelatorio("totais", DATA));
  });

  it("quem não é da coordenação não chega à Visão geral: vai para /minha, sem pedir o relatório", async () => {
    const api = simularApi(CENARIOS.emDia);
    const { roteador } = renderizarRota("/coordenacao", { usuario: LIDER });

    await waitFor(() =>
      expect(roteador.state.location.pathname).toBe("/minha"),
    );
    expect(
      screen.queryByRole("heading", { name: "Relatório da campanha" }),
    ).toBeNull();
    expect(api.consultasAoRelatorio).toEqual([]);
  });
});

describe("CA2: um download por vez", () => {
  it("clique duplo faz uma consulta só; baixando, o botão diz 'Baixando…', fica aria-disabled e com o foco; depois volta", async () => {
    const { api } = await abrir();
    const resposta = segurar();
    api.relatorio = () => resposta.promessa;
    const botao = botaoBaixar();

    botao.focus();
    fireEvent.click(botao);
    fireEvent.click(botao);

    expect(botao).toHaveAccessibleName("Baixando…");
    expect(botao).toHaveAttribute("aria-disabled", "true");
    expect(botao).toHaveFocus();
    expect(regiaoViva()).toHaveTextContent(
      "Baixando o relatório: Totais da campanha…",
    );
    // Mais um toque com o download em andamento: nada.
    fireEvent.click(botao);
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.consultasAoRelatorio).toHaveLength(1);

    api.relatorio = undefined;
    resposta.soltar(respostaRelatorio("totais"));

    await esperarBaixado(nomeDoArquivoRelatorio("totais", DATA));
    expect(botao).toHaveAccessibleName("Baixar relatório");
    expect(botao).not.toHaveAttribute("aria-disabled");
    expect(botao).toHaveFocus();
    expect(downloads.cliques).toHaveLength(1);

    // Terminado, o próximo clique baixa de novo.
    fireEvent.click(botao);
    await waitFor(() => expect(downloads.cliques).toHaveLength(2));
    expect(api.consultasAoRelatorio).toHaveLength(2);
  });

  it("saindo da tela no meio do download: a consulta é cancelada e nada é baixado", async () => {
    const { api, roteador } = await abrir();
    const resposta = segurar();
    api.relatorio = () => resposta.promessa;

    clicar(botaoBaixar());
    await waitFor(() => expect(api.consultasAoRelatorio).toHaveLength(1));
    const pedido = api.pedidos.find(
      (item) => item.url.pathname === "/api/painel/relatorio",
    )!;

    await act(async () => {
      await roteador.navigate("/coordenacao/adesao");
    });
    expect(pedido.init?.signal?.aborted).toBe(true);

    resposta.soltar(respostaRelatorio("totais"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(downloads.criar).not.toHaveBeenCalled();
    expect(downloads.cliques).toEqual([]);
  });
});

describe("CA3: erros, foco e região viva", () => {
  it("404 sem campanha: 'A campanha ainda não foi configurada', com o link para Campanha e sem 'Tentar de novo'; o foco fica no botão", async () => {
    const { api } = await abrir();
    api.relatorio = () => RESPOSTAS_DE_ERRO.semCampanha();

    clicar(botaoBaixar());

    const titulo = await cartao().findByText(
      "A campanha ainda não foi configurada",
    );
    const aviso = titulo.closest<HTMLElement>(".ui-aviso")!;
    expect(aviso).toHaveTextContent(
      "Cadastre a campanha em Campanha para baixar o relatório.",
    );
    expect(
      within(aviso).getByRole("link", { name: "Campanha" }),
    ).toHaveAttribute("href", "/coordenacao/campanha");
    expect(aviso).not.toHaveAttribute("role");
    expect(
      cartao().queryByRole("button", { name: "Tentar de novo" }),
    ).toBeNull();
    expect(regiaoViva()).toHaveTextContent(
      "A campanha ainda não foi configurada. Cadastre a campanha em Campanha para baixar o relatório.",
    );
    expect(botaoBaixar()).toHaveFocus();
    expect(downloads.criar).not.toHaveBeenCalled();
  });

  it("401 (a sessão terminou): vai para /entrar com o aviso", async () => {
    const { api, roteador } = await abrir();
    api.relatorio = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            erro: { codigo: "nao_autenticado", mensagem: "Sessão inválida" },
          }),
          { status: 401, headers: { "content-type": "application/json" } },
        ),
      );

    clicar(botaoBaixar());

    await waitFor(() =>
      expect(roteador.state.location.pathname).toBe("/entrar"),
    );
    expect(await screen.findByText(/Sua sessão terminou/)).toBeInTheDocument();
    expect(downloads.cliques).toEqual([]);
  });

  it("500: a mensagem e 'Tentar de novo'; o foco fica no botão e a região viva avisa; tentar de novo leva o foco ao 'Baixar relatório' e baixa", async () => {
    const { api } = await abrir();
    api.relatorio = () => RESPOSTAS_DE_ERRO.interno();
    const botao = botaoBaixar();

    clicar(botao);

    const titulo = await cartao().findByText(
      "Não foi possível baixar o relatório",
    );
    const aviso = titulo.closest<HTMLElement>(".ui-aviso")!;
    expect(aviso).toHaveTextContent(
      "Erro interno. Tente de novo em instantes.",
    );
    expect(regiaoViva()).toHaveTextContent(
      "Não foi possível baixar o relatório. Erro interno. Tente de novo em instantes.",
    );
    expect(botao).toHaveFocus();
    expect(botao).not.toHaveAttribute("aria-disabled");

    api.relatorio = undefined;
    clicar(within(aviso).getByRole("button", { name: "Tentar de novo" }));

    // O aviso sai ao recomeçar: o foco já foi para o botão que fica.
    expect(botao).toHaveFocus();
    const nome = nomeDoArquivoRelatorio("totais", DATA);
    await esperarBaixado(nome);
    expect(
      cartao().queryByText("Não foi possível baixar o relatório"),
    ).toBeNull();
    expect(botao).toHaveFocus();
    expect(regiaoViva()).toHaveTextContent(`Relatório baixado: ${nome}.`);
    expect(api.consultasAoRelatorio).toHaveLength(2);
  });

  it("400: a mensagem da API, sem 'Tentar de novo'; sem conexão: a mensagem e 'Tentar de novo'", async () => {
    const { api } = await abrir();
    api.relatorio = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            erro: {
              codigo: "requisicao_invalida",
              mensagem: "Requisição inválida",
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
      );

    clicar(botaoBaixar());
    expect(
      await cartao().findByText("Requisição inválida"),
    ).toBeInTheDocument();
    expect(
      cartao().queryByRole("button", { name: "Tentar de novo" }),
    ).toBeNull();

    api.relatorio = () => Promise.reject(new TypeError("Failed to fetch"));
    clicar(botaoBaixar());
    expect(
      await cartao().findByText("Não foi possível conectar à API."),
    ).toBeInTheDocument();
    expect(
      cartao().getByRole("button", { name: "Tentar de novo" }),
    ).toBeInTheDocument();
    expect(regiaoViva()).toHaveTextContent(
      "Não foi possível baixar o relatório. Não foi possível conectar à API.",
    );
  });

  it("trocar o tipo depois de uma falha tira o aviso (ele era do download anterior)", async () => {
    const { api } = await abrir();
    api.relatorio = () => RESPOSTAS_DE_ERRO.interno();
    clicar(botaoBaixar());
    await cartao().findByText("Não foi possível baixar o relatório");

    fireEvent.click(radio("redes"));

    expect(
      cartao().queryByText("Não foi possível baixar o relatório"),
    ).toBeNull();
  });
});

describe("CA4: o object URL é liberado e nada fica guardado", () => {
  it(`o endereço do arquivo é liberado ${LIBERAR_ARQUIVO_DEPOIS_MS / 1000} s depois; o link sai da página; nada no localStorage nem no sessionStorage`, async () => {
    await abrir();

    clicar(botaoBaixar());
    await esperarBaixado(nomeDoArquivoRelatorio("totais", DATA));

    const [{ endereco }] = downloads.cliques;
    expect(downloads.liberados).toEqual([]);
    expect(document.querySelector("a[download]")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIBERAR_ARQUIVO_DEPOIS_MS);
    });

    expect(downloads.liberados).toEqual([endereco]);
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
  });
});

describe("CA5: acessibilidade", () => {
  it("o grupo tem rótulo, cada opção tem nome e descrição, o botão tem nome e a região viva existe vazia desde o começo", async () => {
    await abrir();

    expect(
      cartao().getByRole("group", { name: "O que baixar" }),
    ).toBeInTheDocument();
    for (const tipo of TIPOS_RELATORIO)
      expect(radio(tipo)).toHaveAccessibleDescription(
        TEXTOS_TIPO_RELATORIO[tipo].descricao,
      );
    expect(botaoBaixar()).toHaveAccessibleName("Baixar relatório");
    expect(regiaoViva()).toBeEmptyDOMElement();
    expect(regiaoViva()).toHaveClass("visualmente-oculto");
    // O ícone do botão é só visual.
    expect(botaoBaixar().querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });
});
