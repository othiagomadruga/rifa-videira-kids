// RIFA-025, CA3: o alerta de webhook parado no topo da Visão geral e da tela Pedidos. O texto certo em cada
// situação do GET /api/admin/webhook/estado (D16), nada além de uma linha discreta no "ok", a região viva fixa,
// a atualização a cada 5 min com a aba visível e o erro do estado que não derruba a tela.
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RespostaEstadoWebhook } from "../../../shared/contracts";
import { renderizarRota, respostaJson } from "../../test/renderizar";
import {
  CENARIOS,
  simularApi as simularPainel,
} from "../visao-geral/teste-apoio";
import { INTERVALO_ESTADO_MS } from "./alerta-webhook";
import {
  BASE_MS,
  ROTA_ESTADO,
  estado,
  pedidosVariados,
  respostaErro,
  simularApi,
} from "./teste-apoio";

const horasAntes = (horas: number) =>
  new Date(BASE_MS - horas * 3_600_000).toISOString();
const minutosAntes = (minutos: number) =>
  new Date(BASE_MS - minutos * 60_000).toISOString();

const zerado = estado("ok").ultimas_24h;

beforeEach(() => {
  // Só os temporizadores: as promessas e o agendador do React continuam reais.
  vi.useFakeTimers({
    shouldAdvanceTime: true,
    // Date também: o alerta confere quanto tempo passou desde a última consulta ao voltar para a aba.
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "visibilityState");
});

/** A região viva fixa do alerta (existe desde o começo, vazia até chegar um aviso). */
function regiao(): HTMLElement {
  const elemento = document.querySelector<HTMLElement>(".alerta-webhook");
  if (!elemento) throw new Error("região do alerta não encontrada");
  return elemento;
}

function definirVisibilidade(estadoDaAba: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => estadoDaAba,
  });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

type Caso = {
  nome: string;
  estado: RespostaEstadoWebhook;
  titulo: string;
  textos: string[];
  link: [string, string] | null;
};

const CASOS: Caso[] = [
  {
    nome: "erros_recentes",
    estado: estado("erros_recentes", {
      ultima_processada_em: minutosAntes(20),
      ultimas_24h: { ...zerado, processado: 30, erro_validacao: 3 },
    }),
    titulo: "A Rifei mandou pedidos com erro nas últimas 24 h",
    textos: [
      "3 entregas foram recusadas por erro nas últimas 24 h. Pedido recusado não é gravado: veja quais foram e confira cada um na Rifei.",
    ],
    link: [
      "Ver as entregas com erro",
      "/coordenacao/pedidos?aba=entregas&resultado=erro_validacao",
    ],
  },
  {
    nome: "sem_entregas_recentes",
    estado: estado("sem_entregas_recentes", {
      ultima_entrega_em: horasAntes(5.5),
      ultima_processada_em: horasAntes(5.5),
      ultimas_24h: { ...zerado, processado: 12 },
    }),
    titulo: "Nenhuma venda chegou há 5 horas",
    textos: [
      "Confira na Rifei a URL do webhook, o token e o slug da campanha. Se faltar alguma venda, use a conferência pelo CSV da Rifei.",
    ],
    link: ["Abrir a Conferência", "/coordenacao/conferencia"],
  },
  {
    nome: "sem_entregas_recentes, sem nenhuma entrega da campanha",
    estado: estado("sem_entregas_recentes"),
    titulo: "Nenhuma venda chegou até agora",
    textos: [
      "Confira na Rifei a URL do webhook, o token e o slug da campanha. Se faltar alguma venda, use a conferência pelo CSV da Rifei.",
    ],
    link: ["Abrir a Conferência", "/coordenacao/conferencia"],
  },
  {
    nome: "nunca_recebeu",
    estado: estado("nunca_recebeu"),
    titulo: "Ainda não chegou nenhuma venda",
    textos: [
      "Se a campanha já começou, confira na Rifei a URL do webhook, o token e o slug da campanha.",
    ],
    link: null,
  },
  {
    nome: "nunca_recebeu, com pedidos de outra campanha nas 24 h",
    estado: estado("nunca_recebeu", {
      ultima_entrega_em: minutosAntes(30),
      ultimas_24h: { ...zerado, ignorado_outra_campanha: 2 },
    }),
    titulo: "Ainda não chegou nenhuma venda",
    textos: [
      "Se a campanha já começou, confira na Rifei a URL do webhook, o token e o slug da campanha.",
      "Nas últimas 24 h, 2 pedidos chegaram com o slug de outra campanha: confira se o slug da campanha no sistema é o mesmo da Rifei.",
    ],
    link: null,
  },
  {
    nome: "sem_entregas_recentes, com 1 pedido de outra campanha e nada da campanha nas 24 h",
    estado: estado("sem_entregas_recentes", {
      ultima_processada_em: horasAntes(30),
      ultimas_24h: { ...zerado, ignorado_outra_campanha: 1 },
    }),
    titulo: "Nenhuma venda chegou há 30 horas",
    textos: [
      "Confira na Rifei a URL do webhook, o token e o slug da campanha. Se faltar alguma venda, use a conferência pelo CSV da Rifei.",
      "Nas últimas 24 h, 1 pedido chegou com o slug de outra campanha: confira se o slug da campanha no sistema é o mesmo da Rifei.",
    ],
    link: ["Abrir a Conferência", "/coordenacao/conferencia"],
  },
];

describe("CA3: o texto certo em cada situação, na tela Pedidos e na Visão geral", () => {
  it.each(CASOS)("$nome (tela Pedidos)", async (caso) => {
    simularApi({ estado: caso.estado });
    renderizarRota("/coordenacao/pedidos");

    const aviso = await within(regiao()).findByText(caso.titulo);
    expect(regiao()).toHaveAttribute("role", "status");
    const textos = [...regiao().querySelectorAll(".ui-aviso__conteudo p")].map(
      (paragrafo) => paragrafo.textContent,
    );
    expect(textos).toEqual(caso.textos);
    const links = within(regiao()).queryAllByRole("link");
    if (caso.link) {
      expect(links).toHaveLength(1);
      expect(links[0]).toHaveAccessibleName(caso.link[0]);
      expect(links[0]).toHaveAttribute("href", caso.link[1]);
    } else {
      expect(links).toHaveLength(0);
    }
    expect(aviso).toBeVisible();
    // O aviso vem logo abaixo do título da tela, antes das abas.
    expect(
      screen
        .getByRole("heading", { level: 1, name: "Pedidos" })
        .compareDocumentPosition(regiao()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      regiao().compareDocumentPosition(
        await screen.findByRole("tablist", {
          name: "Pedidos e entregas do webhook",
        }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it.each(CASOS.slice(0, 4))("$nome (Visão geral, no topo)", async (caso) => {
    simularPainel(CENARIOS.emDia);
    simularApi({ estado: caso.estado, repassar: true });
    renderizarRota("/coordenacao");

    await within(regiao()).findByText(caso.titulo);
    // Logo abaixo do título, antes do filtro do painel.
    const filtro = screen.getByRole("combobox", { name: "Filtrar por" });
    expect(
      regiao().compareDocumentPosition(filtro) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen
        .getByRole("heading", { level: 1, name: "Visão geral" })
        .compareDocumentPosition(regiao()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("ok: nenhum aviso, só a linha discreta 'Última venda recebida há X' (fora da região viva)", async () => {
    simularApi({
      estado: estado("ok", {
        ultima_entrega_em: minutosAntes(12),
        ultima_processada_em: minutosAntes(12),
        ultimas_24h: { ...zerado, processado: 40 },
      }),
    });
    renderizarRota("/coordenacao/pedidos");

    const linha = await screen.findByText("Última venda recebida há 12 min.");
    expect(regiao()).toBeEmptyDOMElement();
    expect(regiao()).not.toContainElement(linha);
    expect(document.querySelector(".ui-aviso")).toBeNull();
  });

  it.each([
    [30, "há menos de 1 min"],
    [5 * 60, "há 5 min"],
    [3 * 3600 + 59 * 60, "há 3 h"],
    [47 * 3600, "há 47 h"],
    [3 * 86_400, "há 3 dias"],
  ])("ok, a última venda %i s antes: '%s'", async (segundos, texto) => {
    simularApi({
      estado: estado("ok", {
        ultima_processada_em: new Date(BASE_MS - segundos * 1000).toISOString(),
      }),
    });
    renderizarRota("/coordenacao/pedidos");

    expect(
      await screen.findByText(`Última venda recebida ${texto}.`),
    ).toBeInTheDocument();
  });

  it("o link do erro abre a aba das entregas já filtrada pelos pedidos com erro", async () => {
    const api = simularApi({
      estado: CASOS[0].estado,
      pedidos: pedidosVariados(3),
    });
    const { roteador } = renderizarRota("/coordenacao/pedidos");
    await screen.findByRole("table", {
      name: "Pedidos, do mais recente para o mais antigo",
    });

    fireEvent.click(
      await within(regiao()).findByRole("link", {
        name: "Ver as entregas com erro",
      }),
    );

    expect(roteador.state.location.search).toBe(
      "?aba=entregas&resultado=erro_validacao",
    );
    expect(
      screen.getByRole("tab", { name: "Entregas do webhook" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      await screen.findByRole("combobox", { name: "Resultado" }),
    ).toHaveValue("erro_validacao");
    await waitFor(() =>
      expect(api.pedidosA("/api/admin/webhook/entregas")).toEqual([
        "/api/admin/webhook/entregas?limite=50&resultado=erro_validacao",
      ]),
    );
  });
});

describe("CA3/CA5: região viva fixa e atualização a cada 5 min com a aba visível", () => {
  it("a região viva existe vazia antes da resposta e recebe o aviso quando ele chega", async () => {
    let liberar: (resposta: Response) => void = () => {};
    const api = simularApi();
    api.proxima(
      ROTA_ESTADO,
      () => new Promise<Response>((resolver) => (liberar = resolver)),
    );
    renderizarRota("/coordenacao/pedidos");

    await waitFor(() => expect(api.pedidosA(ROTA_ESTADO)).toHaveLength(1));
    expect(regiao()).toHaveAttribute("role", "status");
    expect(regiao()).toBeEmptyDOMElement();

    await act(async () => liberar(respostaJson(estado("nunca_recebeu"))));
    expect(
      await within(regiao()).findByText("Ainda não chegou nenhuma venda"),
    ).toBeInTheDocument();
    // O aviso não é outra região viva dentro da região (seria anunciado duas vezes).
    expect(within(regiao()).queryByRole("status")).toBeNull();
    expect(within(regiao()).queryByRole("alert")).toBeNull();
  });

  it("consulta de novo a cada 5 min com a aba visível (o aviso muda na mesma região); com a aba oculta, para; ao voltar, nunca antes de 5 min desde a última", async () => {
    const api = simularApi();
    renderizarRota("/coordenacao/pedidos");
    await screen.findByText("Última venda recebida há 12 min.");
    expect(api.pedidosA(ROTA_ESTADO)).toHaveLength(1);

    api.dados.estado = estado("sem_entregas_recentes", {
      ultima_processada_em: horasAntes(4.2),
    });
    // O relógio falso também anda com o tempo real: a margem de 2 s cobre a duração do teste.
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ESTADO_MS - 2000));
    expect(api.pedidosA(ROTA_ESTADO)).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(api.pedidosA(ROTA_ESTADO)).toHaveLength(2);
    expect(
      await within(regiao()).findByText("Nenhuma venda chegou há 4 horas"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Última venda recebida há 12 min."),
    ).not.toBeInTheDocument();

    // Sai da aba e volta antes de completar 5 min desde a última consulta: espera o resto (cada consulta custa
    // centenas de linhas do D1).
    definirVisibilidade("hidden");
    await act(() => vi.advanceTimersByTimeAsync(2 * 60_000));
    definirVisibilidade("visible");
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(api.pedidosA(ROTA_ESTADO)).toHaveLength(2);
    await act(() => vi.advanceTimersByTimeAsync(2 * 60_000));
    await waitFor(() => expect(api.pedidosA(ROTA_ESTADO)).toHaveLength(3));

    // Oculta por mais que o intervalo: nada enquanto oculta e, ao voltar, consulta na hora.
    definirVisibilidade("hidden");
    await act(() => vi.advanceTimersByTimeAsync(4 * INTERVALO_ESTADO_MS));
    expect(api.pedidosA(ROTA_ESTADO)).toHaveLength(3);
    definirVisibilidade("visible");
    await waitFor(() => expect(api.pedidosA(ROTA_ESTADO)).toHaveLength(4));
  });

  it("a primeira página dos pedidos (cara, por causa dos totais) não se recarrega sozinha: só o estado do webhook se atualiza", async () => {
    const api = simularApi({ pedidos: pedidosVariados(3) });
    renderizarRota("/coordenacao/pedidos");
    await screen.findByRole("table", {
      name: "Pedidos, do mais recente para o mais antigo",
    });

    // Meia hora com a aba visível: uma consulta ao estado a cada 5 min (cada uma agenda a seguinte ao terminar).
    for (let rodada = 2; rodada <= 7; rodada++) {
      await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ESTADO_MS));
      await waitFor(() =>
        expect(api.pedidosA(ROTA_ESTADO)).toHaveLength(rodada),
      );
    }
    expect(api.pedidosA("/api/admin/pedidos")).toHaveLength(1);
    expect(api.pedidosA("/api/admin/celulas")).toHaveLength(1);
  });
});

describe("CA3: erro ao consultar o estado não quebra a tela", () => {
  it("tela Pedidos: a lista aparece, o alerta vira uma linha discreta (sem alerta) e a próxima rodada volta ao normal", async () => {
    const api = simularApi({ pedidos: pedidosVariados(3) });
    api.proxima(ROTA_ESTADO, () =>
      respostaErro(500, "erro_interno", "Erro interno do servidor."),
    );
    renderizarRota("/coordenacao/pedidos");

    expect(
      await screen.findByText(
        "Não foi possível conferir agora se as vendas estão chegando pela Rifei; o sistema tenta de novo em alguns minutos.",
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("table", {
        name: "Pedidos, do mais recente para o mais antigo",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(regiao()).toBeEmptyDOMElement();

    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ESTADO_MS));
    expect(
      await screen.findByText("Última venda recebida há 12 min."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Não foi possível conferir agora/),
    ).not.toBeInTheDocument();
  });

  it("uma falha depois de um aviso mantém o último aviso na tela", async () => {
    const api = simularApi({ estado: estado("nunca_recebeu") });
    renderizarRota("/coordenacao/pedidos");
    await within(regiao()).findByText("Ainda não chegou nenhuma venda");

    api.proxima(ROTA_ESTADO, () => {
      throw new TypeError("Failed to fetch");
    });
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ESTADO_MS));
    await waitFor(() => expect(api.pedidosA(ROTA_ESTADO)).toHaveLength(2));

    expect(
      within(regiao()).getByText("Ainda não chegou nenhuma venda"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Não foi possível conferir agora/),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["500", () => respostaErro(500, "erro_interno", "Erro interno.")],
    ["resposta fora do formato", () => respostaJson({ situacao: "parado" })],
  ])(
    "Visão geral (%s): o painel aparece normal, com a linha discreta",
    async (_caso, responder) => {
      simularPainel(CENARIOS.emDia);
      const api = simularApi({ repassar: true });
      api.proxima(ROTA_ESTADO, responder);
      renderizarRota("/coordenacao");

      expect(
        await screen.findByText(/Não foi possível conferir agora/),
      ).toBeInTheDocument();
      expect(await screen.findByText(/^Atualizado às/)).toBeInTheDocument();
      expect(
        screen.getByRole("region", { name: /^Dia 12 de 24/ }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );
});
