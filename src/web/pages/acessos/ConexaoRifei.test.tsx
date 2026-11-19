// RIFA-070 (D32): a aba "Conexão com a Rifei" de /coordenacao/acessos (só admin), pela rota de verdade e com uma API
// falsa. Colar o token manda o PUT e esvazia o campo; a tela nunca mostra o token, só desde quando, o final e o último
// teste; a recusa da Rifei aparece com o pedido de colar um novo; testar e apagar. Os caminhos são os do contrato.
import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ROTAS_CONEXAO_RIFEI } from "../../../shared/contracts/api";
import {
  ADMIN_DE_TESTE,
  renderizarRota,
  respostaJson,
} from "../../test/renderizar";
import {
  CAMINHO_CONEXAO_RIFEI,
  CAMINHO_TESTAR_CONEXAO_RIFEI,
  type EstadoConexaoRifei,
} from "./conexao-rifei-api";
import { criarApiFalsa, respostaErro } from "./teste-apoio";

const ABA = "Conexão com a Rifei";
const TOKEN = "token-ficticio-colado-pelo-pastor-wxyz";

const SEM_CONEXAO: EstadoConexaoRifei = {
  origem: null,
  conectado_em: null,
  final: null,
  testado_em: null,
  recusado_em: null,
  expira_em: null,
  chave_configurada: true,
  token_legivel: false,
  segredo_configurado: false,
};
const CONECTADO: EstadoConexaoRifei = {
  ...SEM_CONEXAO,
  origem: "tela",
  conectado_em: "2026-11-19T13:00:00.000Z",
  final: "wxyz",
  testado_em: "2026-11-19T13:00:00.000Z",
  expira_em: "2026-12-19T13:00:00.000Z",
  token_legivel: true,
};

type Chamada = { metodo: string; caminho: string; corpo?: unknown };

function criarApi(inicial: EstadoConexaoRifei) {
  const outras = criarApiFalsa();
  const chamadas: Chamada[] = [];
  let estado = inicial;
  let respostaDoPut: (() => Response) | null = null;
  const fetch = vi.fn(
    async (entrada: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(entrada), window.location.origin);
      const metodo = init?.method ?? "GET";
      if (!url.pathname.startsWith("/api/admin/rifei/"))
        return outras.fetch(entrada, init);
      chamadas.push({
        metodo,
        caminho: url.pathname,
        corpo:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (url.pathname === CAMINHO_TESTAR_CONEXAO_RIFEI)
        return respostaJson({ estado, campanha_rifei_id: "1671784" });
      if (metodo === "PUT") {
        if (respostaDoPut) return respostaDoPut();
        estado = CONECTADO;
        return respostaJson({ estado, campanha_rifei_id: "1671784" });
      }
      if (metodo === "DELETE") {
        estado = SEM_CONEXAO;
        return respostaJson(estado);
      }
      return respostaJson(estado);
    },
  );
  return {
    fetch,
    chamadas,
    recusarPut(resposta: () => Response) {
      respostaDoPut = resposta;
    },
  };
}

async function abrirAba(api: ReturnType<typeof criarApi>) {
  vi.stubGlobal("fetch", api.fetch);
  renderizarRota("/coordenacao/acessos", { usuario: ADMIN_DE_TESTE });
  await screen.findByRole("heading", { level: 2, name: "Admin de Teste" });
  const aba = screen.getByRole("tab", { name: ABA });
  act(() => aba.focus());
  fireEvent.click(aba);
  await screen.findByRole("heading", { level: 2, name: "Situação" });
  return screen.getByRole("tabpanel", { name: ABA });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RIFA-070 (D32): Conexão com a Rifei", () => {
  it("os caminhos são os do contrato, todos só de admin", () => {
    expect(CAMINHO_CONEXAO_RIFEI).toBe(
      ROTAS_CONEXAO_RIFEI.obterConexaoRifei.caminho,
    );
    expect(CAMINHO_TESTAR_CONEXAO_RIFEI).toBe(
      ROTAS_CONEXAO_RIFEI.testarConexaoRifei.caminho,
    );
    for (const rota of Object.values(ROTAS_CONEXAO_RIFEI))
      expect(rota.papeis).toEqual(["admin"]);
  });

  it("colar: o passo a passo, o PUT com o token, o campo vazio depois e só o final do token na tela", async () => {
    const api = criarApi(SEM_CONEXAO);
    const painel = await abrirAba(api);
    expect(within(painel).getByText(/Sem conexão com a Rifei/)).toBeVisible();
    expect(within(painel).getByText("janela anônima")).toBeInTheDocument();
    expect(
      within(painel).getByText('Feche a janela anônima sem clicar em "Sair"'),
    ).toBeInTheDocument();

    const campo = within(painel).getByLabelText("Token da Rifei");
    expect(campo).toHaveAttribute("type", "password");
    fireEvent.change(campo, { target: { value: TOKEN } });
    fireEvent.click(
      within(painel).getByRole("button", { name: "Salvar e testar" }),
    );
    expect(
      await within(painel).findByText(
        "Conectado: testado 19/11/2026 às 10:00.",
      ),
    ).toBeInTheDocument();
    expect(campo).toHaveValue("");
    expect(
      within(painel).getByText("19/11/2026, termina em …wxyz"),
    ).toBeInTheDocument();
    expect(within(painel).getByText("19/12/2026 10:00")).toBeInTheDocument();
    expect(painel.textContent).not.toContain(TOKEN);
    expect(api.chamadas.filter((c) => c.metodo === "PUT")).toEqual([
      {
        metodo: "PUT",
        caminho: CAMINHO_CONEXAO_RIFEI,
        corpo: { token: TOKEN },
      },
    ]);
  });

  it("a Rifei recusou o token colado: a mensagem clara; e a recusa gravada aparece na situação", async () => {
    const mensagem =
      "A Rifei recusou o token: cole um novo em Conexão com a Rifei (Acessos → Conexão com a Rifei).";
    const api = criarApi({
      ...CONECTADO,
      recusado_em: "2026-11-19T18:30:00.000Z",
    });
    const painel = await abrirAba(api);
    expect(
      within(painel).getByText(
        /A Rifei recusou o token \(19\/11\/2026 às 15:30\): cole um novo/,
      ),
    ).toBeInTheDocument();
    api.recusarPut(() =>
      respostaErro(502, "rifei_falhou", mensagem, { motivo: "token_invalido" }),
    );
    fireEvent.change(within(painel).getByLabelText("Token da Rifei"), {
      target: { value: TOKEN },
    });
    fireEvent.click(
      within(painel).getByRole("button", { name: "Salvar e testar" }),
    );
    expect(
      await within(painel).findByText(mensagem, {
        selector: ":not(.visualmente-oculto)",
      }),
    ).toBeInTheDocument();
  });

  it("testar e apagar (com confirmação)", async () => {
    const api = criarApi(CONECTADO);
    const painel = await abrirAba(api);
    fireEvent.click(
      within(painel).getByRole("button", { name: "Testar conexão" }),
    );
    await within(painel).findByText(/a Rifei aceitou o token/, {
      selector: ":not(.visualmente-oculto)",
    });
    fireEvent.click(
      within(painel).getByRole("button", { name: "Apagar o token" }),
    );
    const dialogo = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Apagar o token" }),
    );
    expect(
      await within(painel).findByText(/Sem conexão com a Rifei/),
    ).toBeInTheDocument();
    expect(api.chamadas.map((c) => c.metodo)).toEqual([
      "GET",
      "POST",
      "DELETE",
    ]);
  });
});
