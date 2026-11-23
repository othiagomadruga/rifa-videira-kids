// CA1 (RIFA-014): o link pessoal leva cada papel para a sua área (/minha para líder, discipulador e rede;
// /coordenacao para admin e coordenação), o destino guardado só vale na área do papel e o endereço da outra
// área redireciona. Sem sessão em /minha, o mesmo fluxo da coordenação (tela de entrar, e volta depois do
// link). Pelas rotas de verdade, com a API falsa de teste-apoio.ts.
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UsuarioSessao } from "../../../shared/contracts";
import { MENSAGEM_SEM_CONEXAO } from "../../lib/api";
import { guardarDestino, retirarDestino } from "../../lib/sessao";
import {
  conferirIndisponivel,
  esperarDisponivel,
  lerCss,
} from "../../test/indisponivel";
import {
  ADMIN_DE_TESTE,
  USUARIO_DE_TESTE,
  renderizarRota,
  respostaJson,
} from "../../test/renderizar";
import {
  DISCIPULADOR,
  LIDER,
  REDE,
  criarApiFalsa,
  respostaErro,
  visaoDe,
  type ApiFalsa,
} from "./teste-apoio";
import { DICAS_DA_MOLDURA } from "./textos-moldura";

/** Token fictício no formato do contrato (43 caracteres base64url). */
const TOKEN = "TokenFicticioDeTeste_0123456789-abcdefghijk";

const VISOES = {
  lider: visaoDe({ papel: "lider" }),
  discipulador: visaoDe({ papel: "discipulador" }),
  rede: visaoDe({ papel: "rede" }),
};

/** API falsa com a visão do papel da sessão (a coordenação não tem visão) e, opcionalmente, o login. */
function simular(usuario: UsuarioSessao, { comLogin = false } = {}) {
  const visao =
    usuario.papel === "lider" ||
    usuario.papel === "discipulador" ||
    usuario.papel === "rede"
      ? VISOES[usuario.papel]
      : VISOES.lider;
  const api = criarApiFalsa(visao, usuario);
  if (comLogin) api.proxima("POST", "/api/sessao", respostaJson({ usuario }));
  vi.stubGlobal("fetch", api.fetch);
  return api;
}

/** Nenhuma rota de outra área foi chamada. */
function chamouSo(api: ApiFalsa, area: "hierarquia" | "coordenacao") {
  const caminhos = api.chamadas.map((chamada) => chamada.caminho);
  if (area === "hierarquia") {
    expect(
      caminhos.filter((caminho) => /^\/api\/(admin|painel)\//.test(caminho)),
    ).toEqual([]);
  } else {
    expect(
      caminhos.filter((caminho) => caminho.startsWith("/api/minha")),
    ).toEqual([]);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("CA1: o link pessoal leva cada papel para a sua área", () => {
  it.each([
    ["lider", LIDER, "Célula Ágape"],
    ["discipulador", DISCIPULADOR, "Davi Fictício"],
    ["rede", REDE, "Rede Jovem Fictícia"],
  ] as const)(
    "%s: entra pelo link e vai para /minha (a visão do próprio alvo)",
    async (_papel, usuario, titulo) => {
      const api = simular(usuario, { comLogin: true });
      const { roteador } = renderizarRota(`/acesso/${TOKEN}`, {
        usuario: null,
      });

      fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

      expect(
        await screen.findByRole("heading", { level: 1, name: titulo }),
      ).toBeInTheDocument();
      expect(roteador.state.location.pathname).toBe("/minha");
      await screen.findByRole("heading", { level: 2, name: "Ranking" });
      expect(api.chamadasA("POST", "/api/sessao")).toHaveLength(1);
      expect(api.chamadasA("GET", "/api/minha/visao")).toHaveLength(1);
      chamouSo(api, "hierarquia");
      // Sem o menu da coordenação.
      expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    },
  );

  it.each([
    ["admin", ADMIN_DE_TESTE],
    ["coordenacao", USUARIO_DE_TESTE],
  ] as const)(
    "%s: entra pelo link e vai para /coordenacao",
    async (_papel, usuario) => {
      const api = simular(usuario, { comLogin: true });
      const { roteador } = renderizarRota(`/acesso/${TOKEN}`, {
        usuario: null,
      });

      fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

      expect(
        await screen.findByRole("heading", { level: 1, name: "Visão geral" }),
      ).toBeInTheDocument();
      expect(roteador.state.location.pathname).toBe("/coordenacao");
      chamouSo(api, "coordenacao");
    },
  );

  it("o destino guardado só vale se for da área do papel", async () => {
    // Um destino da coordenação ficou guardado neste aparelho; quem entra é um líder: vai para /minha.
    guardarDestino("/coordenacao/pedidos");
    simular(LIDER, { comLogin: true });
    const primeira = renderizarRota(`/acesso/${TOKEN}`, { usuario: null });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await waitFor(() =>
      expect(primeira.roteador.state.location.pathname).toBe("/minha"),
    );
    // Usado ou não, o destino sai do aparelho.
    expect(retirarDestino()).toBeNull();
    primeira.unmount();

    // Um destino da visão individual; quem entra é a coordenação: vai para /coordenacao.
    guardarDestino("/minha");
    simular(USUARIO_DE_TESTE, { comLogin: true });
    const segunda = renderizarRota(`/acesso/${TOKEN}`, { usuario: null });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await waitFor(() =>
      expect(segunda.roteador.state.location.pathname).toBe("/coordenacao"),
    );
    segunda.unmount();

    // A tela da coordenação guardada, para a coordenação: volta para ela.
    guardarDestino("/coordenacao/pedidos");
    simular(USUARIO_DE_TESTE, { comLogin: true });
    const terceira = renderizarRota(`/acesso/${TOKEN}`, { usuario: null });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Pedidos" }),
    ).toBeInTheDocument();
    expect(terceira.roteador.state.location.pathname).toBe(
      "/coordenacao/pedidos",
    );
  });
});

describe("CA1: endereço da outra área redireciona", () => {
  it.each([
    "/coordenacao",
    "/coordenacao/pedidos",
    "/coordenacao/acessos",
    "/coordenacao/nao-existe",
  ])(
    "líder, discipulador e rede em %s vão para /minha, sem a tela nem o menu da coordenação",
    async (caminho) => {
      for (const usuario of [LIDER, DISCIPULADOR, REDE]) {
        const api = simular(usuario);
        const { roteador, unmount } = renderizarRota(caminho, { usuario });

        await waitFor(() =>
          expect(roteador.state.location.pathname).toBe("/minha"),
        );
        expect(
          await screen.findByRole("heading", {
            level: 1,
            name: usuario.alvo?.nome,
          }),
        ).toBeInTheDocument();
        expect(
          screen.queryByRole("navigation", { name: "Coordenação" }),
        ).not.toBeInTheDocument();
        await screen.findByRole("heading", { level: 2, name: "Ranking" });
        chamouSo(api, "hierarquia");
        unmount();
      }
    },
  );

  it.each([
    ["admin", ADMIN_DE_TESTE],
    ["coordenacao", USUARIO_DE_TESTE],
  ] as const)(
    "%s em /minha vai para /coordenacao, sem pedir a visão individual",
    async (_papel, usuario) => {
      const api = simular(usuario);
      const { roteador } = renderizarRota("/minha", { usuario });

      expect(
        await screen.findByRole("heading", { level: 1, name: "Visão geral" }),
      ).toBeInTheDocument();
      expect(roteador.state.location.pathname).toBe("/coordenacao");
      chamouSo(api, "coordenacao");
    },
  );

  it("com a sessão de um líder, /entrar vai para /minha (e ignora um destino da coordenação no histórico)", async () => {
    simular(LIDER);
    const { roteador } = renderizarRota("/entrar", { usuario: LIDER });

    await waitFor(() =>
      expect(roteador.state.location.pathname).toBe("/minha"),
    );
    await act(() =>
      roteador.navigate("/entrar", {
        state: { de: "/coordenacao/bumbo", motivo: "sem_sessao" },
      }),
    );
    await waitFor(() =>
      expect(roteador.state.location.pathname).toBe("/minha"),
    );
  });
});

describe("CA1: /minha sem sessão segue o fluxo da coordenação", () => {
  it("confere com GET /api/sessao, vai para /entrar guardando /minha e, depois do link, volta para /minha", async () => {
    const api = criarApiFalsa(VISOES.lider, null);
    vi.stubGlobal("fetch", api.fetch);
    const { roteador, unmount } = renderizarRota("/minha", { usuario: null });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Conferindo o seu acesso…",
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "Entrar" }),
    ).toBeInTheDocument();
    expect(roteador.state.location.pathname).toBe("/entrar");
    expect(roteador.state.location.state).toEqual({
      de: "/minha",
      motivo: "sem_sessao",
    });
    expect(
      screen.getByText(
        "Depois de entrar, você volta para a tela em que estava.",
      ),
    ).toBeInTheDocument();
    expect(api.chamadas).toEqual([{ metodo: "GET", caminho: "/api/sessao" }]);
    unmount();

    // O líder abre o link pessoal (outra aba): entra e volta para /minha.
    simular(LIDER, { comLogin: true });
    const segunda = renderizarRota(`/acesso/${TOKEN}`, { usuario: null });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Célula Ágape" }),
    ).toBeInTheDocument();
    expect(segunda.roteador.state.location.pathname).toBe("/minha");
    expect(retirarDestino()).toBeNull();
  });

  it("com sessão de líder no GET /api/sessao, mostra a visão", async () => {
    const api = criarApiFalsa(VISOES.lider, LIDER);
    vi.stubGlobal("fetch", api.fetch);
    renderizarRota("/minha", { usuario: null });

    expect(
      await screen.findByRole("heading", { level: 1, name: "Célula Ágape" }),
    ).toBeInTheDocument();
    await screen.findByRole("heading", { level: 2, name: "Ranking" });
    // A visão e, uma vez, o link de vendas (RIFA-046) e quem comprou (RIFA-089, só o líder).
    await waitFor(() =>
      expect(api.chamadas.map((chamada) => chamada.caminho)).toEqual([
        "/api/sessao",
        "/api/minha/visao?periodo=atual",
        "/api/minha/links-vendas",
        "/api/minha/compradores?limite=20",
      ]),
    );
  });

  it("o topo já tem o lugar da linha do papel enquanto a sessão chega (RIFA-051: nada pula quando ela chega)", async () => {
    const api = criarApiFalsa(VISOES.lider, LIDER);
    let responder: ((resposta: Response) => void) | null = null;
    api.proxima(
      "GET",
      "/api/sessao",
      () => new Promise<Response>((resolver) => (responder = resolver)),
    );
    vi.stubGlobal("fetch", api.fetch);
    renderizarRota("/minha", { usuario: null });

    const topo = document.querySelector<HTMLElement>(".minha-moldura__topo");
    if (!topo) throw new Error("sem a barra do topo");
    const complemento = () =>
      topo.querySelector(".ui-marca__complemento")?.textContent;
    // Ainda sem o papel e sem o "Sair": o lugar da linha do papel é reservado só no CSS (minha-css.test.ts), sem
    // texto de mentira na marca (nem um espaço) para o leitor de tela encontrar.
    expect(topo.querySelector(".ui-marca__complemento")).toBeNull();
    expect(topo.querySelector(".ui-marca__textos")?.textContent).toBe(
      "Projeto Videira Kids",
    );
    expect(within(topo).queryByRole("button")).toBeNull();
    await waitFor(() => expect(responder).not.toBeNull());

    await act(async () =>
      responder?.(
        new Response(JSON.stringify({ usuario: LIDER }), { status: 200 }),
      ),
    );
    await waitFor(() => expect(complemento()).toBe("Líder"));
    expect(
      within(topo).getByRole("button", { name: "Sair" }),
    ).toBeInTheDocument();
  });

  it("falha ao conferir a sessão: avisa com 'Tentar de novo', sem sair de /minha", async () => {
    const api = criarApiFalsa(VISOES.lider, LIDER);
    api.proxima("GET", "/api/sessao", () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", api.fetch);
    const { roteador } = renderizarRota("/minha", { usuario: null });

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Não foi possível conferir o seu acesso.");
    // Sem conexão (RIFA-051): o cartão neutro, sem o vermelho.
    expect(alerta).toHaveClass("ui-estado--conexao");
    expect(alerta).toHaveTextContent(MENSAGEM_SEM_CONEXAO);
    expect(roteador.state.location.pathname).toBe("/minha");
    fireEvent.click(
      within(alerta).getByRole("button", { name: "Tentar de novo" }),
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "Célula Ágape" }),
    ).toBeInTheDocument();
  });

  it("um 401 no meio do uso leva a /entrar ('sessão terminou') e guarda /minha", async () => {
    const api = criarApiFalsa(VISOES.lider);
    api.proxima(
      "GET",
      "/api/minha/visao",
      respostaErro(401, "nao_autenticado", "Sessão inválida"),
    );
    vi.stubGlobal("fetch", api.fetch);
    const { roteador } = renderizarRota("/minha", { usuario: LIDER });

    expect(
      await screen.findByRole("heading", { level: 1, name: "Entrar" }),
    ).toBeInTheDocument();
    expect(roteador.state.location.pathname).toBe("/entrar");
    expect(screen.getByText("Sua sessão terminou.")).toBeInTheDocument();
    expect(retirarDestino()).toBe("/minha");
  });
});

describe("CA1 e CA5: Sair e endereço desconhecido em /minha", () => {
  it("Sair faz POST /api/sessao/sair e vai para /entrar ('Você saiu'), sem guardar destino", async () => {
    const api = simular(LIDER);
    const { roteador } = renderizarRota("/minha", { usuario: LIDER });
    await screen.findByRole("heading", { level: 2, name: "Ranking" });
    guardarDestino("/minha");

    fireEvent.click(screen.getByRole("button", { name: "Sair" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Entrar" }),
    ).toBeInTheDocument();
    expect(roteador.state.location.pathname).toBe("/entrar");
    expect(
      screen.getByText("Você saiu do sistema neste aparelho."),
    ).toBeInTheDocument();
    expect(api.chamadasA("POST", "/api/sessao/sair")).toHaveLength(1);
    expect(retirarDestino()).toBeNull();
  });

  it("se sair falhar (sem conexão): avisa e continua na visão, com o botão de novo disponível", async () => {
    const api = simular(LIDER);
    api.proxima("POST", "/api/sessao/sair", () => {
      throw new TypeError("Failed to fetch");
    });
    const { roteador } = renderizarRota("/minha", { usuario: LIDER });
    await screen.findByRole("heading", { level: 2, name: "Ranking" });

    fireEvent.click(screen.getByRole("button", { name: "Sair" }));

    expect(
      await screen.findByText(`Não foi possível sair: ${MENSAGEM_SEM_CONEXAO}`),
    ).toHaveAttribute("role", "alert");
    expect(roteador.state.location.pathname).toBe("/minha");
    esperarDisponivel(screen.getByRole("button", { name: "Sair" }));
  });

  it("saindo: 'Saindo…' fica indisponível com aria-disabled (no Tab, com o motivo) e não manda outro POST", async () => {
    const api = simular(LIDER);
    let responder: (resposta: Response) => void = () => {};
    api.proxima(
      "POST",
      "/api/sessao/sair",
      () => new Promise<Response>((resolver) => (responder = resolver)),
    );
    const { roteador } = renderizarRota("/minha", { usuario: LIDER });
    await screen.findByRole("heading", { level: 2, name: "Ranking" });
    const sair = screen.getByRole("button", { name: "Sair" });
    esperarDisponivel(sair);

    act(() => sair.focus());
    fireEvent.click(sair);
    // RIFA-045: o mesmo botão, com o foco (com o disabled, caía no <body>); clique, Enter e espaço não fazem nada.
    expect(sair).toHaveTextContent("Saindo…");
    expect(sair).toHaveFocus();
    await conferirIndisponivel(sair, {
      dica: DICAS_DA_MOLDURA.saindo,
      semEfeito: () => {
        expect(api.chamadasA("POST", "/api/sessao/sair")).toHaveLength(1);
        expect(roteador.state.location.pathname).toBe("/minha");
      },
      css: [
        lerCss("components/ui/Button.css"),
        lerCss("pages/minha/minha-moldura.css"),
      ],
    });

    await act(async () => responder(new Response(null, { status: 204 })));
    await waitFor(() =>
      expect(roteador.state.location.pathname).toBe("/entrar"),
    );
    expect(api.chamadasA("POST", "/api/sessao/sair")).toHaveLength(1);
  });

  it("endereço desconhecido dentro de /minha: a 404 na moldura, com o início em /minha", async () => {
    simular(LIDER);
    renderizarRota("/minha/nao-existe", { usuario: LIDER });

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Página não encontrada",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Voltar ao início" }),
    ).toHaveAttribute("href", "/minha");
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
  });
});
