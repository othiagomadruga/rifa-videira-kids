// CA3: /entrar explica a entrada pelo link pessoal (sem senha, pelo WhatsApp) e, se já houver sessão,
// vai para a coordenação. RIFA-064 (D29): o login da célula com o nome e a senha padrão, que leva à /minha.
// API simulada (fetch trocado).
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App";
import { SessaoInicial } from "../../lib/sessao";
import { rotas } from "../../rotas";
import { conferirIndisponivel, lerCss } from "../../test/indisponivel";
import { LIDER, criarApiFalsa } from "../minha/teste-apoio";
import { DICAS } from "./textos";
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
      name: "Como entrar pelo link",
    });

    const explicacao = titulo.closest(".ui-card");
    expect(titulo).toHaveTextContent("Como entrar pelo link");
    // RIFA-050: o ícone do link no topo do cartão, antes do título, só visual.
    const icone = explicacao?.querySelector(".ui-icone-da-tela");
    expect(icone).toHaveAttribute("aria-hidden", "true");
    expect(icone?.querySelector("svg")).toHaveAttribute("data-icone", "link");
    expect(
      (icone?.compareDocumentPosition(titulo) ?? 0) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(explicacao).toHaveTextContent(
      "Coordenação e discipuladores (e o líder que recebeu um) entram pelo link pessoal, sem senha. O link chega pelo WhatsApp, mandado pela coordenação.",
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
    // RIFA-064: o único formulário é o da célula (nome e senha); nada de e-mail.
    expect(
      [...document.querySelectorAll("input")].map((campo) => campo.name),
    ).toEqual(["celula", "senha"]);
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
      await screen.findByRole("heading", {
        level: 2,
        name: "Como entrar pelo link",
      }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------
// RIFA-064 (D29): o login da célula com o nome e a senha padrão
// ---------------------------------------------------------------------------------------------------

describe("RIFA-064: entrar com a célula", () => {
  /** A API falsa da /minha (GET /api/sessao sem sessão), anotando o corpo de cada POST /api/sessao/senha. */
  function simularApiDaCelula(
    respostaDoLogin: () => Response | Promise<Response>,
  ) {
    const api = criarApiFalsa();
    const corpos: unknown[] = [];
    const fetchComCorpo = vi.fn(
      async (entrada: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(entrada), window.location.origin);
        if (
          (init?.method ?? "GET") === "POST" &&
          url.pathname === "/api/sessao/senha"
        ) {
          corpos.push(JSON.parse(String(init?.body)));
          return respostaDoLogin();
        }
        return api.fetch(entrada, init);
      },
    );
    vi.stubGlobal("fetch", fetchComCorpo);
    return { corpos };
  }

  async function abrirFormulario() {
    const resultado = renderizarRota("/entrar", { usuario: null });
    const celula = await screen.findByLabelText("Célula");
    return {
      ...resultado,
      celula: celula as HTMLInputElement,
      senha: screen.getByLabelText("Senha") as HTMLInputElement,
      entrar: screen.getByRole("button", { name: "Entrar" }),
    };
  }

  function preencher(
    campos: { celula: HTMLInputElement; senha: HTMLInputElement },
    celula: string,
    senha: string,
  ) {
    fireEvent.change(campos.celula, { target: { value: celula } });
    fireEvent.change(campos.senha, { target: { value: senha } });
  }

  it("o formulário: 'Célula' e 'Senha' (escondida, sem corretor), com o título e a explicação, antes do cartão do link", async () => {
    simularApiDaCelula(() => respostaJson({ usuario: LIDER }));
    const { celula, senha, entrar } = await abrirFormulario();

    const titulo = screen.getByRole("heading", {
      level: 2,
      name: "Entrar com a sua célula",
    });
    const cartao = titulo.closest(".ui-card");
    expect(cartao).toHaveTextContent(
      "Para líderes de célula: o nome da célula e a senha que a coordenação passou.",
    );
    expect(cartao?.querySelector("svg")).toHaveAttribute(
      "data-icone",
      "celula",
    );
    expect(celula).toHaveAttribute("autocomplete", "username");
    expect(senha).toHaveAttribute("type", "password");
    expect(senha).toHaveAttribute("autocomplete", "current-password");
    expect(senha).toHaveAttribute("autocapitalize", "none");
    expect(senha).toHaveAttribute("spellcheck", "false");
    expect(entrar).toHaveAttribute("type", "submit");
    expect(entrar.closest("form")).toBe(celula.closest("form"));
    // O login da célula vem antes do cartão do link.
    const link = screen.getByRole("heading", {
      level: 2,
      name: "Como entrar pelo link",
    });
    expect(
      titulo.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("campos vazios: o aviso em cada campo, o foco no primeiro que falta, e nada vai para a API", async () => {
    const { corpos } = simularApiDaCelula(() =>
      respostaJson({ usuario: LIDER }),
    );
    const { celula, senha, entrar } = await abrirFormulario();

    fireEvent.click(entrar);
    expect(await screen.findByText("Escreva o nome da célula.")).toBeVisible();
    expect(screen.getByText("Escreva a senha.")).toBeVisible();
    expect(celula).toHaveAttribute("aria-invalid", "true");
    expect(senha).toHaveAttribute("aria-invalid", "true");
    expect(celula).toHaveFocus();

    fireEvent.change(celula, { target: { value: "Célula Ágape" } });
    expect(screen.queryByText("Escreva o nome da célula.")).toBeNull();
    fireEvent.click(entrar);
    expect(senha).toHaveFocus();
    // Só espaços também é vazio.
    fireEvent.change(senha, { target: { value: "   " } });
    fireEvent.click(entrar);
    expect(screen.getByText("Escreva a senha.")).toBeVisible();
    expect(corpos).toEqual([]);
  });

  it("certo: manda a célula e a senha como digitadas e vai para a /minha da célula", async () => {
    const { corpos } = simularApiDaCelula(() =>
      respostaJson({ usuario: LIDER }),
    );
    const campos = await abrirFormulario();
    preencher(campos, "  Célula Ágape ", "@Célula Ágape 1234");
    fireEvent.click(campos.entrar);

    await waitFor(() =>
      expect(campos.roteador.state.location.pathname).toBe("/minha"),
    );
    expect(corpos).toEqual([
      { celula: "  Célula Ágape ", senha: "@Célula Ágape 1234" },
    ]);
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: LIDER.alvo?.nome,
      }),
    ).toBeInTheDocument();
    // A senha não vai para o endereço nem para o título.
    expect(campos.roteador.state.location.search).toBe("");
    expect(document.title).not.toContain("1234");
  });

  it("401: 'Célula ou senha não conferem', curto, com o foco na mensagem; os campos ficam para corrigir e tentar de novo", async () => {
    const respostas = [
      () =>
        respostaJson(
          {
            erro: {
              codigo: "nao_autenticado",
              mensagem: "Não foi possível entrar com esta célula e esta senha",
            },
          },
          401,
        ),
      () => respostaJson({ usuario: LIDER }),
    ];
    const { corpos } = simularApiDaCelula(() => respostas.shift()!());
    const campos = await abrirFormulario();
    preencher(campos, "Célula Ágape", "@errada1234");
    fireEvent.click(campos.entrar);

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Célula ou senha não conferem.");
    expect(alerta).toHaveTextContent(
      "Confira o nome da célula e a senha e tente de novo. Se não der certo, fale com a coordenação.",
    );
    await waitFor(() =>
      expect(document.querySelector(".entrar-resultado")).toHaveFocus(),
    );
    expect(campos.celula).toHaveValue("Célula Ágape");
    expect(campos.roteador.state.location.pathname).toBe("/entrar");

    fireEvent.change(campos.senha, {
      target: { value: "@celulaagape1234" },
    });
    fireEvent.click(campos.entrar);
    await waitFor(() =>
      expect(campos.roteador.state.location.pathname).toBe("/minha"),
    );
    expect(corpos).toHaveLength(2);
  });

  it("429: espere um minuto; sem conexão: a falha, e dá para tentar de novo", async () => {
    const respostas: (() => Response | Promise<Response>)[] = [
      () =>
        respostaJson(
          {
            erro: {
              codigo: "muitas_requisicoes",
              mensagem: "Muitas requisições",
            },
          },
          429,
        ),
      () => {
        throw new TypeError("Failed to fetch");
      },
    ];
    simularApiDaCelula(() => respostas.shift()!());
    const campos = await abrirFormulario();
    preencher(campos, "Célula Ágape", "@celulaagape1234");

    fireEvent.click(campos.entrar);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Muitas tentativas seguidas.Espere um minuto e tente de novo.",
    );
    fireEvent.click(campos.entrar);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Não foi possível entrar agora.",
      ),
    );
  });

  it("enquanto entra, o botão fica ocupado (aria-disabled: no Tab, com o motivo) e um segundo envio não repete o POST", async () => {
    let responder: (resposta: Response) => void = () => {};
    const { corpos } = simularApiDaCelula(
      () => new Promise<Response>((resolver) => (responder = resolver)),
    );
    const campos = await abrirFormulario();
    preencher(campos, "Célula Ágape", "@celulaagape1234");
    act(() => campos.entrar.focus());
    fireEvent.click(campos.entrar);

    const ocupado = await screen.findByRole("button", { name: "Entrando…" });
    expect(ocupado).toBe(campos.entrar);
    await conferirIndisponivel(ocupado, {
      dica: DICAS.entrando,
      semEfeito: () => expect(corpos).toHaveLength(1),
      css: [
        lerCss("components/ui/Button.css"),
        lerCss("pages/entrar/entrar.css"),
      ],
    });
    fireEvent.submit(campos.celula.closest("form")!);
    expect(corpos).toHaveLength(1);

    await act(async () => responder(respostaJson({ usuario: LIDER })));
    await waitFor(() =>
      expect(campos.roteador.state.location.pathname).toBe("/minha"),
    );
  });

  it("depois de 'Sair' da /minha, a /entrar volta com o formulário e o aviso de que saiu", async () => {
    simularApiDaCelula(() => respostaJson({ usuario: LIDER }));
    const campos = await abrirFormulario();
    preencher(campos, "Célula Ágape", "@celulaagape1234");
    fireEvent.click(campos.entrar);
    await waitFor(() =>
      expect(campos.roteador.state.location.pathname).toBe("/minha"),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Sair" }));
    expect(
      await screen.findByText("Você saiu do sistema neste aparelho."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Para entrar de novo, use o nome da célula e a senha ou abra o seu link pessoal.",
      ),
    ).toBeInTheDocument();
    expect(campos.roteador.state.location.pathname).toBe("/entrar");
    expect(await screen.findByLabelText("Célula")).toHaveValue("");
  });
});
