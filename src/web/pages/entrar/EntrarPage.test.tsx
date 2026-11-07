// CA3: /entrar explica a entrada pelo link pessoal (sem senha, pelo WhatsApp) e, se já houver sessão,
// vai para a coordenação. API simulada (fetch trocado).
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App";
import { SessaoInicial } from "../../lib/sessao";
import { rotas } from "../../rotas";
import {
  USUARIO_DE_TESTE,
  renderizarRota,
  respostaJson,
} from "../../test/renderizar";

const SEM_SESSAO = () =>
  respostaJson(
    { erro: { codigo: "nao_autenticado", mensagem: "Sessão inválida" } },
    401,
  );

/** fetch simulado: GET /api/sessao responde com `aoConferir`; outra rota é falha do teste. */
function simularSessao(aoConferir: () => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (caminho: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "GET" && caminho === "/api/sessao") {
      return aoConferir();
    }
    throw new Error(`chamada inesperada: ${init?.method} ${caminho}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("CA3: /entrar", () => {
  it("sem sessão: confere (carregando) e explica que o acesso é pelo link pessoal, sem senha, que chega pelo WhatsApp", async () => {
    const fetchMock = simularSessao(SEM_SESSAO);
    const { roteador } = renderizarRota("/entrar", { usuario: null });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Conferindo o seu acesso…",
    );
    const titulo = await screen.findByRole("heading", {
      level: 2,
      name: "Como entrar",
    });

    const explicacao = titulo.closest(".ui-card");
    expect(explicacao).toHaveTextContent(
      "O acesso é pelo seu link pessoal, sem senha. O link chega pelo WhatsApp, mandado pela coordenação.",
    );
    expect(explicacao).toHaveTextContent(
      "Abra a conversa do WhatsApp em que você recebeu o link.",
    );
    expect(explicacao).toHaveTextContent(
      "Não achou o link ou ele não funciona mais? Peça um link novo à coordenação.",
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Entrar" }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Entrar · Rifa Videira Kids");
    // Não há campo de senha nem de e-mail: não há formulário de login.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(document.querySelector("input")).toBeNull();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(roteador.state.location.pathname).toBe("/entrar");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("com sessão (GET /api/sessao 200): vai para /coordenacao", async () => {
    simularSessao(() => respostaJson({ usuario: USUARIO_DE_TESTE }));
    const { roteador } = renderizarRota("/entrar", { usuario: null });

    expect(
      await screen.findByRole("heading", { level: 1, name: "Visão geral" }),
    ).toBeInTheDocument();
    expect(roteador.state.location.pathname).toBe("/coordenacao");
  });

  it("com a sessão já conhecida, vai direto para /coordenacao sem perguntar de novo à API", async () => {
    const fetchMock = simularSessao(SEM_SESSAO);
    const { roteador } = renderizarRota("/entrar");

    await waitFor(() =>
      expect(roteador.state.location.pathname).toBe("/coordenacao"),
    );
    // Só a sessão conta aqui: a Visão geral (/coordenacao) carrega os próprios dados.
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/sessao",
      expect.anything(),
    );
  });

  it("veio da guarda com a tela pedida e a sessão já existe (entrou em outra aba e recarregou): volta para a tela", async () => {
    simularSessao(() => respostaJson({ usuario: USUARIO_DE_TESTE }));
    const roteador = createMemoryRouter(rotas, {
      initialEntries: [
        {
          pathname: "/entrar",
          state: { de: "/coordenacao/bumbo", motivo: "sem_sessao" },
        },
      ],
    });
    render(
      <SessaoInicial value={null}>
        <App roteador={roteador} />
      </SessaoInicial>,
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Bumbo" }),
    ).toBeInTheDocument();
    expect(roteador.state.location.pathname).toBe("/coordenacao/bumbo");
  });

  it("um destino de fora da coordenação no histórico é ignorado: vai para /coordenacao", async () => {
    simularSessao(() => respostaJson({ usuario: USUARIO_DE_TESTE }));
    const roteador = createMemoryRouter(rotas, {
      initialEntries: [
        { pathname: "/entrar", state: { de: "//site-malicioso.example/x" } },
      ],
    });
    render(
      <SessaoInicial value={null}>
        <App roteador={roteador} />
      </SessaoInicial>,
    );

    await waitFor(() =>
      expect(roteador.state.location.pathname).toBe("/coordenacao"),
    );
  });

  it("sem conexão ao conferir: mostra a explicação mesmo assim", async () => {
    simularSessao(() => {
      throw new TypeError("Failed to fetch");
    });
    renderizarRota("/entrar", { usuario: null });

    expect(
      await screen.findByRole("heading", { level: 2, name: "Como entrar" }),
    ).toBeInTheDocument();
  });
});
