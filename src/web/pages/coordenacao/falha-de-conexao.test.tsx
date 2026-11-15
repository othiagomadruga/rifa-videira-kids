// RIFA-053 (D25): a falha de conexão não é erro vermelho em nenhuma tela da coordenação. Quando a primeira carga de
// uma tela falha sem resposta (sem internet: o fetch rejeita), o ErrorState fica neutro (o ícone de sem conexão e o
// "Tentar de novo" com o ícone de atualizar), com o MESMO título da tela; quando a API responde com falha (500), o
// vermelho continua. A Visão geral e a /minha já tinham os testes delas (VisaoGeralPage.test.tsx, MinhaPage.test.tsx).
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UsuarioSessao } from "../../../shared/contracts";
import { TITULO_SEM_CONEXAO } from "../../components/ui";
import {
  ADMIN_DE_TESTE,
  USUARIO_DE_TESTE,
  renderizarRota,
  respostaJson,
} from "../../test/renderizar";

/** As telas com pacote à parte (lazy) demoram mais na primeira vez. */
const ESPERA_DO_PACOTE = { timeout: 5000 };

type Caso = {
  tela: string;
  caminho: string;
  usuario?: UsuarioSessao | null;
  /** O que fazer depois de abrir (ex.: trocar de aba). */
  agirAsync?: () => Promise<void>;
  /** O título da falha (o mesmo nos dois modos, salvo onde a tela usa o título padrão do ErrorState). */
  titulo: string;
  tituloSemConexao?: string;
};

const abrirAba = (nome: RegExp) => async () => {
  fireEvent.click(await screen.findByRole("tab", { name: nome }));
};

const CASOS: Caso[] = [
  {
    tela: "Hierarquia",
    caminho: "/coordenacao/hierarquia",
    titulo: "Não foi possível carregar a hierarquia.",
  },
  {
    tela: "Adesão (o título padrão)",
    caminho: "/coordenacao/adesao",
    titulo: "Não foi possível carregar os dados.",
    tituloSemConexao: TITULO_SEM_CONEXAO,
  },
  {
    tela: "Pedidos",
    caminho: "/coordenacao/pedidos",
    titulo: "Não foi possível carregar os pedidos.",
  },
  {
    tela: "Pedidos, entregas do webhook",
    caminho: "/coordenacao/pedidos?aba=entregas",
    titulo: "Não foi possível carregar as entregas.",
  },
  {
    tela: "Pedidos suspeitos",
    caminho: "/coordenacao/pedidos-suspeitos",
    titulo: "Não foi possível carregar os pedidos suspeitos.",
  },
  {
    tela: "Campanha",
    caminho: "/coordenacao/campanha",
    titulo: "Não foi possível carregar a campanha.",
  },
  {
    tela: "Rankings",
    caminho: "/coordenacao/rankings",
    titulo: "Não foi possível carregar o ranking.",
  },
  {
    tela: "Mapa",
    caminho: "/coordenacao/mapa",
    titulo: "Não foi possível carregar o mapa.",
  },
  {
    tela: "Bumbo",
    caminho: "/coordenacao/bumbo",
    titulo: "Não foi possível carregar a mensagem.",
  },
  {
    tela: "Conferência (as recuperações feitas)",
    caminho: "/coordenacao/conferencia",
    titulo: "Não foi possível carregar as recuperações",
  },
  {
    tela: "Acessos, coordenação",
    caminho: "/coordenacao/acessos",
    usuario: ADMIN_DE_TESTE,
    titulo: "Não foi possível carregar as pessoas.",
  },
  {
    tela: "Acessos, líderes, discipuladores e redes",
    caminho: "/coordenacao/acessos",
    usuario: ADMIN_DE_TESTE,
    agirAsync: abrirAba(/^Líderes/),
    titulo: "Não foi possível carregar os acessos.",
  },
  {
    tela: "Acessos, webhook da Rifei",
    caminho: "/coordenacao/acessos",
    usuario: ADMIN_DE_TESTE,
    agirAsync: abrirAba(/^Webhook/),
    titulo: "Não foi possível carregar o token do webhook.",
  },
  {
    tela: "Trilha",
    caminho: "/coordenacao/trilha",
    usuario: ADMIN_DE_TESTE,
    titulo: "Não foi possível carregar a trilha.",
  },
  {
    tela: "a guarda da coordenação (conferir o acesso)",
    caminho: "/coordenacao",
    usuario: null,
    titulo: "Não foi possível conferir o seu acesso.",
  },
];

/** Toda chamada à API rejeita, como o fetch sem internet. */
function semInternet() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }),
  );
}

/** Toda chamada à API responde 500, no formato de erro da API. */
function apiComFalha() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      respostaJson(
        { erro: { codigo: "erro_interno", mensagem: "Erro interno." } },
        500,
      ),
    ),
  );
}

async function alertaCom(titulo: string): Promise<HTMLElement> {
  const texto = await screen.findByText(titulo, {}, ESPERA_DO_PACOTE);
  const alerta = texto.closest<HTMLElement>('[role="alert"]');
  if (!alerta) throw new Error(`"${titulo}" fora de um alerta`);
  expect(texto).toHaveClass("ui-estado__titulo");
  return alerta;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RIFA-053: a falha de conexão neutra nas telas da coordenação", () => {
  it.each(CASOS)(
    "$tela: sem internet, o estado neutro com o título da tela",
    async ({ caminho, usuario, agirAsync, titulo, tituloSemConexao }) => {
      semInternet();
      renderizarRota(caminho, {
        usuario: usuario === undefined ? USUARIO_DE_TESTE : usuario,
      });
      await agirAsync?.();
      const alerta = await alertaCom(tituloSemConexao ?? titulo);
      expect(alerta).toHaveClass("ui-estado--conexao");
      expect(alerta).not.toHaveClass("ui-estado--erro");
      expect(alerta.querySelector(".ui-estado__icone svg")).toHaveAttribute(
        "data-icone",
        "sem-conexao",
      );
      const tentar = alerta.querySelector("button");
      expect(tentar).toHaveTextContent(/^Tentar de novo$/);
      expect(tentar?.querySelector("svg")).toHaveAttribute(
        "data-icone",
        "atualizar",
      );
      // Nenhum vermelho na tela por causa da conexão.
      expect(document.querySelector(".ui-estado--erro")).toBeNull();
    },
  );

  it.each(CASOS.filter(({ usuario }) => usuario !== null))(
    "$tela: a API responde com falha (500): o vermelho continua, com o mesmo título",
    async ({ caminho, usuario, agirAsync, titulo }) => {
      apiComFalha();
      renderizarRota(caminho, { usuario: usuario ?? USUARIO_DE_TESTE });
      await agirAsync?.();
      const alerta = await alertaCom(titulo);
      expect(alerta).toHaveClass("ui-estado--erro");
      expect(alerta.querySelector(".ui-estado__icone")).toBeNull();
    },
  );
});
