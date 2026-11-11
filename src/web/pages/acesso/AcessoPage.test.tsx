// CA1: /acesso/<token> com a API simulada (fetch trocado). Os dois primeiros testes usam o roteador do
// navegador (createBrowserRouter, no window.history do jsdom e com o StrictMode do main.tsx) para provar o
// que acontece na barra de endereço e no histórico; os demais, o roteador em memória do renderizarRota.
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { createBrowserRouter, type DataRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App";
import { guardarDestino } from "../../lib/sessao";
import { rotas } from "../../rotas";
import { renderizarRota, respostaJson } from "../../test/renderizar";
import { FORMATO_TOKEN } from "./AcessoPage";

/** Token fictício no formato do contrato (43 caracteres base64url). */
const TOKEN = "TokenFicticioDeTeste_0123456789-abcdefghijk";
const USUARIO = { id: 7, nome: "Coordenadora Fictícia", papel: "coordenacao" };
const TITULO = "Entrar no sistema da Rifa Videira Kids";

type Chamada = { metodo: string; caminho: string; corpo: unknown };

/** fetch simulado: POST /api/sessao responde com `aoEntrar` (padrão: 200 com o usuário). */
function simularApi(
  aoEntrar: () => Response | Promise<Response> = () =>
    respostaJson({ usuario: USUARIO }),
) {
  const chamadas: Chamada[] = [];
  const fetchMock = vi.fn(async (caminho: string, init?: RequestInit) => {
    const metodo = init?.method ?? "GET";
    chamadas.push({
      metodo,
      caminho,
      corpo: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (metodo === "POST" && caminho === "/api/sessao") return aoEntrar();
    return respostaJson(
      { erro: { codigo: "nao_encontrado", mensagem: "Rota não encontrada" } },
      404,
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return { chamadas, fetchMock };
}

/** Só as chamadas da sessão: depois de entrar, a Visão geral (/coordenacao) carrega os próprios dados. */
const daSessao = (chamadas: Chamada[]) =>
  chamadas.filter((chamada) => chamada.caminho.startsWith("/api/sessao"));

const LINK_INVALIDO = () =>
  respostaJson(
    {
      erro: {
        codigo: "nao_autenticado",
        mensagem: "Link de acesso inválido, expirado ou revogado",
      },
    },
    401,
  );

const botaoEntrar = () => screen.getByRole("button", { name: "Entrar" });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("CA1: o link no navegador (barra de endereço e histórico)", () => {
  let roteador: DataRouter | null = null;
  const espioesDoConsole: ReturnType<typeof vi.spyOn>[] = [];

  beforeEach(() => {
    window.history.replaceState(null, "", `/acesso/${TOKEN}`);
    for (const metodo of ["log", "info", "warn", "error", "debug"] as const) {
      espioesDoConsole.push(vi.spyOn(console, metodo));
    }
  });

  afterEach(() => {
    roteador?.dispose();
    roteador = null;
    espioesDoConsole.length = 0;
    window.history.replaceState(null, "", "/");
  });

  function abrirNoNavegador() {
    roteador = createBrowserRouter(rotas);
    render(
      <StrictMode>
        <App roteador={roteador} />
      </StrictMode>,
    );
  }

  function esperarQueNadaGuardouOToken() {
    expect(window.location.href).not.toContain(TOKEN);
    expect(JSON.stringify(window.history.state)).not.toContain(TOKEN);
    expect(document.title).not.toContain(TOKEN);
    expect(document.body.innerHTML).not.toContain(TOKEN);
    expect(roteador?.state.location.pathname).not.toContain(TOKEN);
    for (const espiao of espioesDoConsole) {
      expect(JSON.stringify(espiao.mock.calls)).not.toContain(TOKEN);
    }
  }

  it("ao abrir, troca /acesso/<token> por /acesso na hora (replaceState sem token) e não chama a API", async () => {
    expect(TOKEN).toMatch(FORMATO_TOKEN);
    const replaceState = vi.spyOn(window.history, "replaceState");
    const pushState = vi.spyOn(window.history, "pushState");
    const { fetchMock } = simularApi();

    abrirNoNavegador();

    expect(
      screen.getByRole("heading", { level: 1, name: TITULO }),
    ).toBeInTheDocument();
    expect(botaoEntrar()).toBeEnabled();
    await waitFor(() => expect(window.location.pathname).toBe("/acesso"));
    expect(replaceState).toHaveBeenLastCalledWith(
      expect.anything(),
      "",
      "/acesso",
    );
    // Nenhuma chamada ao histórico levou o token (nem no estado, nem na URL).
    expect(
      JSON.stringify([...replaceState.mock.calls, ...pushState.mock.calls]),
    ).not.toContain(TOKEN);
    expect(pushState).not.toHaveBeenCalled();
    expect(document.title).toBe(`${TITULO} · Rifa Videira Kids`);

    // O preview do WhatsApp abre a URL e não toca no botão: nada de POST (nem de outra chamada).
    await act(() => new Promise((resolver) => setTimeout(resolver, 50)));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(botaoEntrar()).toBeInTheDocument();
    esperarQueNadaGuardouOToken();
  });

  it("tocar em Entrar faz POST /api/sessao com o token guardado na memória e leva à coordenação", async () => {
    const { chamadas, fetchMock } = simularApi();
    abrirNoNavegador();
    await waitFor(() => expect(window.location.pathname).toBe("/acesso"));

    fireEvent.click(botaoEntrar());

    expect(
      await screen.findByRole("heading", { level: 1, name: "Visão geral" }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/coordenacao");
    expect(daSessao(chamadas)).toEqual([
      { metodo: "POST", caminho: "/api/sessao", corpo: { token: TOKEN } },
    ]);
    // O token vai só nesse POST: as chamadas que a Visão geral faz ao abrir não o levam (nem nos cabeçalhos).
    const outras = () =>
      fetchMock.mock.calls.filter(([caminho]) => caminho !== "/api/sessao");
    await waitFor(() => expect(outras().length).toBeGreaterThan(0));
    expect(JSON.stringify(outras())).not.toContain(TOKEN);
    expect(screen.getByText("Coordenadora Fictícia")).toBeInTheDocument();
    esperarQueNadaGuardouOToken();
  });
});

describe("CA1: confirmação e resposta da API", () => {
  it("401: 'Este link não vale mais: peça um link novo à coordenação', sem o botão Entrar e com o foco na mensagem", async () => {
    simularApi(LINK_INVALIDO);
    const { roteador } = renderizarRota(`/acesso/${TOKEN}`, { usuario: null });

    fireEvent.click(botaoEntrar());

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent(
      "Este link não vale mais: peça um link novo à coordenação.",
    );
    expect(
      screen.queryByRole("button", { name: "Entrar" }),
    ).not.toBeInTheDocument();
    // O foco vem num efeito depois de a mensagem aparecer: pode chegar um pouco depois do findByRole.
    await waitFor(() => expect(alerta.parentElement).toHaveFocus());
    expect(roteador.state.location.pathname).toBe("/acesso");
  });

  it.each([
    [
      "discipulador",
      "A coordenação desligou o acesso de discipuladores por enquanto.",
    ],
    ["rede", "A coordenação desligou o acesso de redes por enquanto."],
  ])(
    "403 acesso_desligado (%s): o texto da coordenação, sem tratar como link inválido (o Entrar continua)",
    async (papel, texto) => {
      let tentativas = 0;
      const { chamadas } = simularApi(() => {
        tentativas += 1;
        return tentativas === 1
          ? respostaJson(
              {
                erro: {
                  codigo: "acesso_desligado",
                  mensagem: "O acesso deste papel está desligado na campanha",
                  detalhes: { papel },
                },
              },
              403,
            )
          : respostaJson({ usuario: USUARIO });
      });
      const { roteador } = renderizarRota(`/acesso/${TOKEN}`, {
        usuario: null,
      });

      fireEvent.click(botaoEntrar());

      const alerta = await screen.findByRole("alert");
      expect(alerta).toHaveTextContent(texto);
      expect(alerta).toHaveTextContent(
        "O seu link continua valendo: quando a coordenação ligar o acesso de novo, toque em Entrar.",
      );
      expect(alerta).not.toHaveTextContent(/não vale mais|incompleto/);
      await waitFor(() => expect(alerta.parentElement).toHaveFocus());
      // Quando a chave volta, o mesmo link entra.
      fireEvent.click(botaoEntrar());
      await waitFor(() =>
        expect(roteador.state.location.pathname).toBe("/coordenacao"),
      );
      expect(daSessao(chamadas).map((chamada) => chamada.corpo)).toEqual([
        { token: TOKEN },
        { token: TOKEN },
      ]);
    },
  );

  it("sem conexão: avisa e deixa tentar de novo com o mesmo token (que segue só na memória)", async () => {
    let tentativas = 0;
    const { chamadas } = simularApi(() => {
      tentativas += 1;
      if (tentativas === 1) throw new TypeError("Failed to fetch");
      return respostaJson({ usuario: USUARIO });
    });
    const { roteador } = renderizarRota(`/acesso/${TOKEN}`, { usuario: null });
    await waitFor(() =>
      expect(roteador.state.location.pathname).toBe("/acesso"),
    );

    fireEvent.click(botaoEntrar());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível entrar agora.",
    );
    fireEvent.click(botaoEntrar());

    await waitFor(() =>
      expect(roteador.state.location.pathname).toBe("/coordenacao"),
    );
    expect(daSessao(chamadas).map((chamada) => chamada.corpo)).toEqual([
      { token: TOKEN },
      { token: TOKEN },
    ]);
  });

  it("enquanto entra, o botão fica ocupado e um segundo toque não repete o POST", async () => {
    let responder: (resposta: Response) => void = () => {};
    const { chamadas } = simularApi(
      () => new Promise<Response>((resolver) => (responder = resolver)),
    );
    const { roteador } = renderizarRota(`/acesso/${TOKEN}`, { usuario: null });

    fireEvent.click(botaoEntrar());
    const ocupado = await screen.findByRole("button", { name: "Entrando…" });
    expect(ocupado).toBeDisabled();
    fireEvent.click(ocupado);
    await act(async () => responder(respostaJson({ usuario: USUARIO })));

    await waitFor(() =>
      expect(roteador.state.location.pathname).toBe("/coordenacao"),
    );
    expect(daSessao(chamadas)).toHaveLength(1);
  });

  it("depois de entrar, volta para a tela que a guarda tinha guardado", async () => {
    guardarDestino("/coordenacao/pedidos");
    simularApi();
    const { roteador } = renderizarRota(`/acesso/${TOKEN}`, { usuario: null });

    fireEvent.click(botaoEntrar());

    expect(
      await screen.findByRole("heading", { level: 1, name: "Pedidos" }),
    ).toBeInTheDocument();
    expect(roteador.state.location.pathname).toBe("/coordenacao/pedidos");
  });

  it("link cortado (fora do formato): avisa que está incompleto, sem Entrar e sem chamar a API", async () => {
    const { fetchMock } = simularApi();
    const { roteador } = renderizarRota(`/acesso/${TOKEN.slice(0, 30)}`, {
      usuario: null,
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Este link está incompleto.",
    );
    expect(
      screen.queryByRole("button", { name: "Entrar" }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(roteador.state.location.pathname).toBe("/acesso"),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("/acesso sem token (ex.: a página foi recarregada) vai para /entrar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respostaJson(
          { erro: { codigo: "nao_autenticado", mensagem: "Sem sessão" } },
          401,
        ),
      ),
    );
    const { roteador } = renderizarRota("/acesso", { usuario: null });

    expect(
      await screen.findByRole("heading", { level: 1, name: "Entrar" }),
    ).toBeInTheDocument();
    expect(roteador.state.location.pathname).toBe("/entrar");
  });

  it("link inválido com uma sessão aberta: a sessão atual continua (o 401 do POST não derruba ninguém)", async () => {
    simularApi(LINK_INVALIDO);
    const { roteador } = renderizarRota(`/acesso/${TOKEN}`);

    fireEvent.click(botaoEntrar());
    await screen.findByRole("alert");
    await act(() => roteador.navigate("/coordenacao"));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Visão geral" }),
    ).toBeInTheDocument();
    expect(roteador.state.location.pathname).toBe("/coordenacao");
  });
});
