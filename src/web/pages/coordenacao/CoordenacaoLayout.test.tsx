// CA2 (guarda da coordenação) e CA4 (nome, "Sair" e menu por papel), pelas rotas de verdade e com a API
// simulada (fetch trocado). `usuario: null` no renderizarRota = o site pergunta a GET /api/sessao, como no
// navegador; sem ele, a sessão de teste (papel coordenacao) já vem conhecida.
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UsuarioSessao } from "../../../shared/contracts";
import { guardarDestino, retirarDestino } from "../../lib/sessao";
import {
  ADMIN_DE_TESTE,
  USUARIO_DE_TESTE,
  renderizarRota,
  respostaJson,
} from "../../test/renderizar";

const TOKEN = "TokenFicticioDeTeste_0123456789-abcdefghijk";

const SEM_SESSAO = () =>
  respostaJson(
    { erro: { codigo: "nao_autenticado", mensagem: "Sessão inválida" } },
    401,
  );

type Chamada = { metodo: string; caminho: string };
type Responder = () => Response | Promise<Response>;

/**
 * fetch simulado por "MÉTODO caminho". Rota sem resposta definida: 404 no formato da API (e fica em
 * `inesperadas`).
 */
function simularApi(respostas: Record<string, Responder>) {
  const chamadas: Chamada[] = [];
  const inesperadas: string[] = [];
  const fetchMock = vi.fn(async (caminho: string, init?: RequestInit) => {
    const metodo = init?.method ?? "GET";
    chamadas.push({ metodo, caminho });
    const responder = respostas[`${metodo} ${caminho}`];
    if (responder) return responder();
    inesperadas.push(`${metodo} ${caminho}`);
    return respostaJson(
      { erro: { codigo: "nao_encontrado", mensagem: "Rota não encontrada" } },
      404,
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return { chamadas, inesperadas };
}

const sessaoDe = (usuario: UsuarioSessao) => () => respostaJson({ usuario });

function painelDoMenu() {
  const botao = screen.getByRole("button", { name: "Menu" });
  const painel = document.getElementById(
    botao.getAttribute("aria-controls") ?? "",
  );
  if (!painel) throw new Error("painel do menu não encontrado");
  return painel;
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("CA2: guarda das telas da coordenação", () => {
  it("sem sessão: confere com GET /api/sessao (carregando acessível) e vai para /entrar guardando a tela; depois do link, volta para ela", async () => {
    let responderSessao: (resposta: Response) => void = () => {};
    const api = simularApi({
      "GET /api/sessao": () =>
        new Promise<Response>((resolver) => (responderSessao = resolver)),
    });
    const { roteador, unmount } = renderizarRota("/coordenacao/pedidos", {
      usuario: null,
    });

    // Enquanto confere: só o carregando (role="status"), sem menu e sem a tela.
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Conferindo o seu acesso…",
    );
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Pedidos" }),
    ).not.toBeInTheDocument();
    await act(async () => responderSessao(SEM_SESSAO()));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Entrar" }),
    ).toBeInTheDocument();
    expect(roteador.state.location.pathname).toBe("/entrar");
    expect(roteador.state.location.state).toEqual({
      de: "/coordenacao/pedidos",
      motivo: "sem_sessao",
    });
    expect(
      screen.getByText(
        "Depois de entrar, você volta para a tela em que estava.",
      ),
    ).toBeInTheDocument();
    expect(api.chamadas).toEqual([{ metodo: "GET", caminho: "/api/sessao" }]);
    unmount();

    // A pessoa abre o link pessoal (outra página, outra aba): entra e volta para /coordenacao/pedidos.
    simularApi({ "POST /api/sessao": sessaoDe(USUARIO_DE_TESTE) });
    const segunda = renderizarRota(`/acesso/${TOKEN}`, { usuario: null });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Pedidos" }),
    ).toBeInTheDocument();
    expect(segunda.roteador.state.location.pathname).toBe(
      "/coordenacao/pedidos",
    );
    expect(retirarDestino()).toBeNull();
  });

  it("com sessão (GET /api/sessao 200): mostra a tela pedida, com o menu do papel", async () => {
    const api = simularApi({
      "GET /api/sessao": sessaoDe(ADMIN_DE_TESTE),
      // A tela do bumbo (RIFA-011) pede a mensagem do dia à rota aberta: aqui, ainda sem campanha.
      "GET /api/publico/bumbo": () =>
        respostaJson(
          {
            erro: {
              codigo: "nao_encontrado",
              mensagem: "A campanha ainda não foi configurada",
            },
          },
          404,
        ),
    });
    const { roteador } = renderizarRota("/coordenacao/bumbo", {
      usuario: null,
    });

    expect(
      await screen.findByRole("heading", { level: 1, name: "Bumbo" }),
    ).toBeInTheDocument();
    expect(roteador.state.location.pathname).toBe("/coordenacao/bumbo");
    expect(
      within(screen.getByRole("navigation", { name: "Coordenação" })).getByRole(
        "link",
        { name: "Acessos" },
      ),
    ).toBeInTheDocument();
    expect(api.inesperadas).toEqual([]);
  });

  it("falha ao conferir (sem conexão): avisa com 'Tentar de novo', sem sair da tela; tentando de novo, entra", async () => {
    let tentativas = 0;
    simularApi({
      "GET /api/sessao": () => {
        tentativas += 1;
        if (tentativas === 1) throw new TypeError("Failed to fetch");
        return respostaJson({ usuario: USUARIO_DE_TESTE });
      },
    });
    const { roteador } = renderizarRota("/coordenacao/rankings", {
      usuario: null,
    });

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Não foi possível conferir o seu acesso.");
    expect(roteador.state.location.pathname).toBe("/coordenacao/rankings");
    fireEvent.click(
      within(alerta).getByRole("button", { name: "Tentar de novo" }),
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Rankings" }),
    ).toBeInTheDocument();
    expect(tentativas).toBe(2);
  });

  it("um 401 de qualquer rota durante o uso leva a /entrar ('sessão terminou'), guardando a tela", async () => {
    simularApi({ "GET /api/admin/campanha": SEM_SESSAO });
    const { roteador } = renderizarRota("/coordenacao/campanha");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Entrar" }),
    ).toBeInTheDocument();
    expect(roteador.state.location.pathname).toBe("/entrar");
    expect(screen.getByText("Sua sessão terminou.")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(retirarDestino()).toBe("/coordenacao/campanha");
  });

  it("depois do 401, voltar a uma tela da coordenação manda de novo para /entrar (a sessão não volta sozinha)", async () => {
    simularApi({ "GET /api/admin/campanha": SEM_SESSAO });
    const { roteador } = renderizarRota("/coordenacao/campanha");
    await screen.findByRole("heading", { level: 1, name: "Entrar" });

    await act(() => roteador.navigate("/coordenacao/pedidos"));

    await waitFor(() =>
      expect(roteador.state.location.pathname).toBe("/entrar"),
    );
    expect(
      screen.queryByRole("heading", { name: "Pedidos" }),
    ).not.toBeInTheDocument();
  });
});

describe("CA4: nome de quem está conectado, Sair e menu conforme o papel", () => {
  it("mostra o nome e o papel no painel do menu", () => {
    renderizarRota("/coordenacao");

    const painel = painelDoMenu();
    expect(painel).toHaveTextContent("Conectado como Pessoa de Teste");
    expect(within(painel).getByText("Coordenação")).toBeInTheDocument();
    expect(
      within(painel).getByRole("button", { name: "Sair" }),
    ).toBeInTheDocument();
  });

  it("Sair faz POST /api/sessao/sair e vai para /entrar, sem guardar tela para voltar", async () => {
    const api = simularApi({
      "POST /api/sessao/sair": () => new Response(null, { status: 204 }),
    });
    const { roteador } = renderizarRota("/coordenacao/pedidos");
    // Um destino que tinha ficado guardado (ex.: por um 401 em outra aba) também é apagado.
    guardarDestino("/coordenacao/hierarquia");

    fireEvent.click(screen.getByRole("button", { name: "Sair" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Entrar" }),
    ).toBeInTheDocument();
    expect(roteador.state.location.pathname).toBe("/entrar");
    // Da sessão, só o POST de sair (a tela Pedidos faz as chamadas dela, que não vêm ao caso).
    expect(
      api.chamadas.filter(({ caminho }) => caminho.startsWith("/api/sessao")),
    ).toEqual([{ metodo: "POST", caminho: "/api/sessao/sair" }]);
    expect(
      screen.getByText("Você saiu do sistema neste aparelho."),
    ).toBeInTheDocument();
    expect(retirarDestino()).toBeNull();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("se sair falhar (sem conexão), avisa e continua na tela", async () => {
    simularApi({
      "POST /api/sessao/sair": () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const { roteador } = renderizarRota("/coordenacao/pedidos");

    fireEvent.click(screen.getByRole("button", { name: "Sair" }));

    // O aviso fica no painel do menu, junto do "Sair" (a tela pode ter os avisos dela).
    expect(await within(painelDoMenu()).findByRole("alert")).toHaveTextContent(
      "Não foi possível sair: Não foi possível conectar à API.",
    );
    expect(roteador.state.location.pathname).toBe("/coordenacao/pedidos");
    expect(screen.getByRole("button", { name: "Sair" })).toBeEnabled();
  });

  it("o menu da coordenação não tem 'Acessos'; o do admin tem", () => {
    const { unmount } = renderizarRota("/coordenacao");
    const menu = screen.getByRole("navigation", { name: "Coordenação" });
    expect(
      within(menu).queryByRole("link", { name: "Acessos" }),
    ).not.toBeInTheDocument();
    unmount();

    renderizarRota("/coordenacao", { usuario: ADMIN_DE_TESTE });
    expect(
      within(screen.getByRole("navigation", { name: "Coordenação" })).getByRole(
        "link",
        { name: "Acessos" },
      ),
    ).toHaveAttribute("href", "/coordenacao/acessos");
    expect(painelDoMenu()).toHaveTextContent("Conectado como Admin de Teste");
    expect(within(painelDoMenu()).getByText("Admin")).toBeInTheDocument();
  });
});
