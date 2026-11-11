// RIFA-024: /coordenacao/trilha (só admin), pela rota de verdade e com a API falsa abaixo, que pagina como a
// rota GET /api/admin/auditoria (cursor `antes_de`, do mais novo para o mais antigo) e passa cada consulta e
// cada resposta pelos schemas do contrato.
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACOES_AUDITORIA,
  consultaAuditoriaSchema,
  respostaAuditoriaSchema,
  type RegistroAuditoria,
} from "../../../shared/contracts";
import {
  ADMIN_DE_TESTE,
  renderizarRota,
  respostaJson,
} from "../../test/renderizar";

const CAMINHO = "/coordenacao/trilha";
const ROTA_API = "/api/admin/auditoria";

/** Registro fictício: o id define a ordem (o maior é o mais novo); 1 minuto entre um e outro. */
function registro(
  id: number,
  parcial: Partial<RegistroAuditoria> = {},
): RegistroAuditoria {
  return {
    id,
    em: new Date(Date.UTC(2026, 10, 25, 15, 0) + id * 60_000).toISOString(),
    usuario_id: 3,
    usuario_nome: "Coordenadora Ficticia",
    acao: "campanha.salvar",
    alvo: "campanha:1",
    resumo: `Alteração fictícia número ${id}`,
    ...parcial,
  };
}

/** `quantidade` registros, do mais novo (id = quantidade) para o mais antigo (id = 1). */
const trilhaCom = (quantidade: number) =>
  Array.from({ length: quantidade }, (_, i) => registro(quantidade - i));

type Responder = (url: URL) => Response | Promise<Response>;

/**
 * API falsa da trilha: pagina `registros` como a rota (limite, antes_de, proximo). `responder` troca a resposta
 * de uma chamada (pela ordem: 0 = primeira página). Guarda as URLs pedidas; outra rota recebe 404.
 */
function simularTrilha(
  registros: RegistroAuditoria[],
  responder: Record<number, Responder> = {},
) {
  const pedidos: string[] = [];
  const fetchMock = vi.fn(async (caminho: string) => {
    const url = new URL(caminho, "https://site.example");
    if (url.pathname !== ROTA_API) {
      return respostaJson(
        { erro: { codigo: "nao_encontrado", mensagem: "Rota não encontrada" } },
        404,
      );
    }
    const ordem = pedidos.length;
    pedidos.push(caminho);
    if (responder[ordem]) return responder[ordem](url);
    const { limite, antes_de } = consultaAuditoriaSchema.parse(
      Object.fromEntries(url.searchParams),
    );
    const restantes = registros.filter(
      (item) => antes_de === undefined || item.id < antes_de,
    );
    const itens = restantes.slice(0, limite);
    const proximo =
      restantes.length > limite ? (itens[itens.length - 1]?.id ?? null) : null;
    return respostaJson(respostaAuditoriaSchema.parse({ itens, proximo }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { pedidos };
}

const erroApi = (status: number, codigo: string, mensagem: string) => () =>
  respostaJson({ erro: { codigo, mensagem } }, status);

function abrirComoAdmin() {
  return renderizarRota(CAMINHO, { usuario: ADMIN_DE_TESTE });
}

const tabela = () =>
  screen.findByRole("table", {
    name: "Trilha de auditoria, do mais novo para o mais antigo",
  });

/** As linhas de dados da tabela (sem a do cabeçalho). */
async function linhas() {
  const [, corpo] = within(await tabela()).getAllByRole("rowgroup");
  return within(corpo).getAllByRole("row");
}

/** Os textos das células de uma linha. */
const celulas = (linha: HTMLElement) =>
  within(linha)
    .getAllByRole("cell")
    .map((celula) => celula.textContent);

const botaoCarregarMais = () =>
  screen.getByRole("button", { name: "Carregar mais" });

/** A região viva fixa da tela (anuncia o que o "Carregar mais" trouxe). */
const anuncio = () =>
  screen
    .getAllByRole("status")
    .find((elemento) => elemento.classList.contains("visualmente-oculto"));

/** Foca e clica, como o toque e o Enter fazem no navegador (o jsdom não foca no clique). */
function acionar(elemento: HTMLElement) {
  act(() => elemento.focus());
  fireEvent.click(elemento);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RIFA-024: a trilha lista do mais novo para o mais antigo", () => {
  it("mostra quando (no fuso da campanha), quem, a ação em português, o alvo e o resumo, numa tabela com cabeçalhos", async () => {
    const { pedidos } = simularTrilha([
      registro(42, {
        em: "2026-11-25T15:00:00.000Z",
        acao: "campanha.salvar",
        alvo: "campanha:1",
        resumo:
          'Alterado: slug_rifei ("videira-kids" → "videira-kids-2"), periodos',
      }),
      registro(41, {
        em: "2026-11-25T02:30:00.000Z",
        usuario_nome: "Admin de Teste",
        acao: "hierarquia.remover",
        alvo: "celula:7",
        resumo:
          'Célula "Célula Ágape" removida (discipulador_id 3, qtd_pessoas 12)',
      }),
      registro(40, {
        acao: "acessos_hierarquia.gerar_links",
        alvo: "papel:lider",
        resumo: "3 alvos, 2 usuários criados",
      }),
    ]);
    abrirComoAdmin();

    expect(
      screen.getByRole("heading", { level: 1, name: "Trilha" }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Trilha · Rifa Videira Kids");
    const tabelaDaTrilha = await tabela();
    expect(
      within(tabelaDaTrilha)
        .getAllByRole("columnheader")
        .map((cabecalho) => cabecalho.textContent),
    ).toEqual(["Quando", "Quem", "Ação", "Alvo", "Resumo"]);

    const [primeira, segunda, terceira] = await linhas();
    // 15:00 UTC = 12:00 em Belém; 02:30 UTC do dia 25 = 23:30 do dia 24 em Belém.
    expect(celulas(primeira)).toEqual([
      "25/11/2026 12:00",
      "Coordenadora Ficticia",
      "Campanha salva",
      "Campanha 1",
      'Alterado: slug_rifei ("videira-kids" → "videira-kids-2"), periodos',
    ]);
    expect(within(primeira).getByText("25/11/2026 12:00")).toHaveAttribute(
      "datetime",
      "2026-11-25T15:00:00.000Z",
    );
    expect(celulas(segunda)).toEqual([
      "24/11/2026 23:30",
      "Admin de Teste",
      "Item da hierarquia removido",
      "Célula 7",
      'Célula "Célula Ágape" removida (discipulador_id 3, qtd_pessoas 12)',
    ]);
    expect(celulas(terceira).slice(2, 4)).toEqual([
      "Links da hierarquia gerados",
      "Papel: Líder",
    ]);
    // No celular, cada célula vira "rótulo: valor" (o rótulo vem do cabeçalho da coluna).
    expect(
      within(primeira)
        .getAllByRole("cell")
        .map((celula) => celula.dataset.rotulo),
    ).toEqual(["Quando", "Quem", "Ação", "Alvo", "Resumo"]);

    expect(pedidos).toEqual([`${ROTA_API}?limite=50`]);
    expect(
      screen.getByText("3 registros; não há registros mais antigos."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Carregar mais" }),
    ).not.toBeInTheDocument();
  });

  it("toda ação do contrato aparece em português, nunca como o código da API", async () => {
    simularTrilha(
      ACOES_AUDITORIA.map((acao, indice) =>
        registro(ACOES_AUDITORIA.length - indice, { acao }),
      ),
    );
    abrirComoAdmin();

    const textos = (await linhas()).map((linha) => celulas(linha)[2]);
    expect(textos).toEqual([
      "Campanha salva",
      "Vínculo de afiliado salvo",
      "Hierarquia importada",
      "Acesso criado",
      "Acesso reativado",
      "Acesso desativado",
      "Link de acesso gerado",
      "Link de acesso revogado",
      "Links da hierarquia gerados",
      "Item da hierarquia criado",
      "Item da hierarquia alterado",
      "Item da hierarquia removido",
    ]);
    for (const acao of ACOES_AUDITORIA) {
      expect(screen.queryByText(acao)).not.toBeInTheDocument();
    }
  });
});

describe("RIFA-024: Carregar mais (cursor) e o foco", () => {
  it("pede a página seguinte com antes_de, acrescenta no fim, leva o foco ao primeiro registro novo e anuncia; na última página, o botão some", async () => {
    const { pedidos } = simularTrilha(trilhaCom(120));
    abrirComoAdmin();

    expect(await linhas()).toHaveLength(50);
    expect(
      screen.getByText("Mostrando 50 registros; há registros mais antigos."),
    ).toBeInTheDocument();

    acionar(botaoCarregarMais());
    await waitFor(async () => expect(await linhas()).toHaveLength(100));
    // O primeiro registro novo é o 51º da lista: id 70 (do 120 ao 71 na primeira página).
    const primeiroNovo = (await linhas())[50];
    expect(celulas(primeiroNovo)[4]).toBe("Alteração fictícia número 70");
    await waitFor(() =>
      expect(
        within(primeiroNovo).getAllByRole("cell")[0].firstElementChild,
      ).toHaveFocus(),
    );
    expect(anuncio()).toHaveTextContent("50 registros a mais na lista.");
    expect(
      screen.getByText("Mostrando 100 registros; há registros mais antigos."),
    ).toBeInTheDocument();

    acionar(botaoCarregarMais());
    await waitFor(async () => expect(await linhas()).toHaveLength(120));
    const ultimoBloco = (await linhas())[100];
    expect(celulas(ultimoBloco)[4]).toBe("Alteração fictícia número 20");
    await waitFor(() =>
      expect(
        within(ultimoBloco).getAllByRole("cell")[0].firstElementChild,
      ).toHaveFocus(),
    );
    expect(anuncio()).toHaveTextContent(
      "20 registros a mais na lista. Não há registros mais antigos.",
    );
    expect(
      screen.getByText("120 registros; não há registros mais antigos."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Carregar mais" }),
    ).not.toBeInTheDocument();

    expect(pedidos).toEqual([
      `${ROTA_API}?limite=50`,
      `${ROTA_API}?limite=50&antes_de=71`,
      `${ROTA_API}?limite=50&antes_de=21`,
    ]);
    // Do mais novo para o mais antigo, sem repetir nem pular nenhum.
    const ids = (await linhas()).map((linha) =>
      Number(/número (\d+)/.exec(celulas(linha)[4] ?? "")?.[1]),
    );
    expect(ids).toEqual(Array.from({ length: 120 }, (_, i) => 120 - i));
  });

  it("enquanto carrega, o botão fica indisponível (continua focável) e um segundo toque não pede de novo", async () => {
    let liberar: () => void = () => {};
    const segura = new Promise<void>((resolver) => (liberar = resolver));
    const registros = trilhaCom(60);
    const { pedidos } = simularTrilha(registros, {
      1: async () => {
        await segura;
        return respostaJson({ itens: registros.slice(50), proximo: null });
      },
    });
    abrirComoAdmin();
    await tabela();

    const botao = botaoCarregarMais();
    acionar(botao);
    expect(botao).toHaveAttribute("aria-disabled", "true");
    expect(botao).toHaveTextContent("Carregando…");
    expect(botao).toHaveFocus();
    fireEvent.click(botao);
    expect(pedidos).toHaveLength(2);

    liberar();
    await waitFor(async () => expect(await linhas()).toHaveLength(60));
    expect(pedidos).toHaveLength(2);
  });

  it("falha no Carregar mais: os registros ficam, o erro aparece e o botão tenta de novo", async () => {
    const { pedidos } = simularTrilha(trilhaCom(70), {
      1: erroApi(503, "indisponivel", "O banco não respondeu a tempo."),
    });
    abrirComoAdmin();
    await tabela();

    acionar(botaoCarregarMais());
    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent(
      "Não foi possível carregar mais registros",
    );
    expect(alerta).toHaveTextContent("O banco não respondeu a tempo.");
    expect(await linhas()).toHaveLength(50);

    acionar(botaoCarregarMais());
    await waitFor(async () => expect(await linhas()).toHaveLength(70));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(pedidos.slice(1)).toEqual([
      `${ROTA_API}?limite=50&antes_de=21`,
      `${ROTA_API}?limite=50&antes_de=21`,
    ]);
  });
});

describe("RIFA-024: estados da trilha", () => {
  it("carregando: anuncia enquanto a primeira página não chega", async () => {
    let liberar: () => void = () => {};
    const segura = new Promise<void>((resolver) => (liberar = resolver));
    const { pedidos } = simularTrilha([], {
      0: async () => {
        await segura;
        return respostaJson({ itens: [], proximo: null });
      },
    });
    abrirComoAdmin();

    await waitFor(() => expect(pedidos).toHaveLength(1));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Carregando a trilha…",
    );
    liberar();
    expect(
      await screen.findByText("Nenhuma ação registrada ainda."),
    ).toBeInTheDocument();
  });

  it("vazia: explica o que vai aparecer, sem tabela nem botão", async () => {
    simularTrilha([]);
    abrirComoAdmin();

    expect(
      await screen.findByText("Nenhuma ação registrada ainda."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Cada mudança na campanha, nos vínculos de afiliado, na hierarquia e nos acessos aparece aqui, com quem fez e quando.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
  });

  it("erro: mostra a mensagem e 'Tentar de novo' carrega outra vez", async () => {
    const { pedidos } = simularTrilha(trilhaCom(2), {
      0: erroApi(500, "erro_interno", "Erro interno do servidor."),
    });
    abrirComoAdmin();

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Não foi possível carregar a trilha.");
    expect(alerta).toHaveTextContent("Erro interno do servidor.");

    fireEvent.click(
      within(alerta).getByRole("button", { name: "Tentar de novo" }),
    );
    expect(await linhas()).toHaveLength(2);
    expect(pedidos).toHaveLength(2);
  });

  it("403 da API (o papel mudou com a tela aberta): diz que é só para admin, sem 'Tentar de novo'", async () => {
    simularTrilha([], {
      0: erroApi(403, "proibido", "Sem permissão para esta rota."),
    });
    abrirComoAdmin();

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Sem permissão para ver a trilha");
    expect(alerta).toHaveTextContent(
      "A trilha é só para quem tem o papel Admin.",
    );
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
  });

  it("401 (a sessão terminou): vai para /entrar com o aviso, guardando a trilha para depois", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respostaJson(
          { erro: { codigo: "nao_autenticado", mensagem: "Sessão inválida" } },
          401,
        ),
      ),
    );
    const { roteador } = abrirComoAdmin();

    await waitFor(() =>
      expect(roteador.state.location.pathname).toBe("/entrar"),
    );
    expect(await screen.findByText(/Sua sessão terminou/)).toBeInTheDocument();
  });
});

describe("RIFA-024: só admin", () => {
  it("a coordenação não vê 'Trilha' no menu e, pelo endereço, vê 'sem permissão' sem nada pedido à API", () => {
    const fetchMock = vi.fn(async () => respostaJson({}));
    vi.stubGlobal("fetch", fetchMock);
    renderizarRota(CAMINHO);

    const menu = screen.getByRole("navigation", { name: "Coordenação" });
    expect(
      within(menu).queryByRole("link", { name: "Trilha" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Trilha" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sem permissão para esta tela",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Esta tela é só para quem tem o papel Admin.",
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("o admin vê 'Trilha' no menu e o link abre a tela", async () => {
    simularTrilha(trilhaCom(1));
    const { roteador } = renderizarRota("/coordenacao", {
      usuario: ADMIN_DE_TESTE,
    });
    const menu = screen.getByRole("navigation", { name: "Coordenação" });

    fireEvent.click(within(menu).getByRole("link", { name: "Trilha" }));

    expect(roteador.state.location.pathname).toBe(CAMINHO);
    expect(await tabela()).toBeInTheDocument();
  });
});
