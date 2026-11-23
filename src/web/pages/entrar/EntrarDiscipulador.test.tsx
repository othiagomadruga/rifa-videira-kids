// RIFA-082 (D37): em /entrar, a opção "Sou discipulador" (ao lado de "Sou administrador") troca o formulário da célula
// pelo do discipulador (o nome dele e a senha padrão), que chama POST /api/sessao/discipulador e leva à /minha dele. A
// recusa é genérica (não diz se o discipulador existe) e o 429 avisa para esperar. API simulada (fetch trocado).
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { controlesSemDica } from "../../test/dicas";
import { renderizarRota, respostaJson } from "../../test/renderizar";
import { DISCIPULADOR, criarApiFalsa, visaoDe } from "../minha/teste-apoio";
import {
  DICAS_DISCIPULADOR,
  TEXTOS,
  TEXTOS_ADMIN,
  TEXTOS_DISCIPULADOR,
} from "./textos";

/** A API falsa da /minha do discipulador (GET /api/sessao sem sessão), anotando o corpo de cada login dele. */
function simularApi(respostaDoLogin: () => Response | Promise<Response>) {
  const api = criarApiFalsa(visaoDe({ papel: "discipulador" }));
  const corpos: unknown[] = [];
  const fetchMock = vi.fn(
    async (entrada: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(entrada), window.location.origin);
      if (
        (init?.method ?? "GET") === "POST" &&
        url.pathname === "/api/sessao/discipulador"
      ) {
        corpos.push(JSON.parse(String(init?.body)));
        return respostaDoLogin();
      }
      return api.fetch(entrada, init);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return { corpos, fetchMock };
}

async function abrirComoDiscipulador() {
  const resultado = renderizarRota("/entrar", { usuario: null });
  fireEvent.click(
    await screen.findByRole("button", {
      name: TEXTOS_DISCIPULADOR.souDiscipulador,
    }),
  );
  return {
    ...resultado,
    nome: (await screen.findByLabelText("Discipulador")) as HTMLInputElement,
    senha: screen.getByLabelText("Senha") as HTMLInputElement,
    entrar: screen.getByRole("button", { name: "Entrar" }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("RIFA-082: Sou discipulador em /entrar", () => {
  it("na entrada da célula, 'Sou discipulador' e 'Sou administrador' ficam embaixo do formulário, com dica", async () => {
    simularApi(() => respostaJson({}, 500));
    renderizarRota("/entrar", { usuario: null });
    const discipulador = await screen.findByRole("button", {
      name: TEXTOS_DISCIPULADOR.souDiscipulador,
    });
    const admin = screen.getByRole("button", { name: TEXTOS.souAdmin });
    const form = screen.getByLabelText("Célula").closest("form")!;
    // Os dois depois do formulário, no mesmo cartão, nesta ordem.
    expect(discipulador.closest(".ui-card")).toBe(form.closest(".ui-card"));
    expect(
      form.compareDocumentPosition(discipulador) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      discipulador.compareDocumentPosition(admin) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(controlesSemDica()).toEqual([]);
  });

  it("troca o formulário: 'Discipulador' e 'Senha', com o título, a explicação, as dicas e a ajuda próprias; o foco vai para o botão de voltar", async () => {
    simularApi(() => respostaJson({}, 500));
    const { nome, senha } = await abrirComoDiscipulador();
    const titulo = screen.getByRole("heading", {
      level: 2,
      name: TEXTOS_DISCIPULADOR.tituloSenha,
    });
    const cartao = titulo.closest(".ui-card");
    expect(cartao).toHaveTextContent(TEXTOS_DISCIPULADOR.explicacaoSenha);
    expect(cartao?.querySelector("svg")).toHaveAttribute(
      "data-icone",
      "pessoas",
    );
    expect(
      [...document.querySelectorAll("input")].map((campo) => campo.name),
    ).toEqual(["discipulador", "senha"]);
    expect(nome).toHaveAttribute("autocomplete", "username");
    expect(nome).toHaveAttribute("autocapitalize", "words");
    expect(nome).toHaveAttribute("spellcheck", "false");
    expect(senha).toHaveAttribute("type", "password");
    expect(senha).toHaveAttribute("autocomplete", "current-password");
    expect(senha).toHaveAttribute("autocapitalize", "none");
    // Do modo de antes (a célula) para este: o foco no botão que volta, e o outro (admin) continua.
    const volta = screen.getByRole("button", { name: TEXTOS_ADMIN.souCelula });
    expect(volta).toHaveFocus();
    expect(
      screen.getByRole("button", { name: TEXTOS.souAdmin }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: TEXTOS_DISCIPULADOR.souDiscipulador,
      }),
    ).toBeNull();
    expect(controlesSemDica()).toEqual([]);

    // Para o admin e de volta: cada troca começa o formulário do zero.
    fireEvent.change(nome, { target: { value: "Alisson" } });
    fireEvent.click(screen.getByRole("button", { name: TEXTOS.souAdmin }));
    expect(await screen.findByLabelText("Usuário")).toHaveValue("");
    expect(
      screen.getByRole("button", {
        name: TEXTOS_DISCIPULADOR.souDiscipulador,
      }),
    ).toHaveFocus();
    fireEvent.click(
      screen.getByRole("button", { name: TEXTOS_DISCIPULADOR.souDiscipulador }),
    );
    expect(await screen.findByLabelText("Discipulador")).toHaveValue("");
    expect(screen.getByRole("button", { name: TEXTOS.souAdmin })).toHaveFocus();
  });

  it("nome e senha certos: POST /api/sessao/discipulador com os dois, como digitados, e vai para a /minha do discipulador", async () => {
    const { corpos } = simularApi(() =>
      respostaJson({ usuario: DISCIPULADOR }),
    );
    const { roteador, nome, senha, entrar } = await abrirComoDiscipulador();
    fireEvent.change(nome, { target: { value: "  Pr. Fábio " } });
    fireEvent.change(senha, { target: { value: "@prfabio1234" } });
    fireEvent.click(entrar);

    await waitFor(() =>
      expect(roteador.state.location.pathname).toBe("/minha"),
    );
    expect(corpos).toEqual([
      { discipulador: "  Pr. Fábio ", senha: "@prfabio1234" },
    ]);
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: DISCIPULADOR.alvo?.nome,
      }),
    ).toBeInTheDocument();
    // A senha não vai para o endereço nem para o título.
    expect(roteador.state.location.search).toBe("");
    expect(document.title).not.toContain("1234");
  });

  it("campos vazios: o aviso em cada campo, o foco no primeiro que falta, e nada vai para a API", async () => {
    const { corpos } = simularApi(() =>
      respostaJson({ usuario: DISCIPULADOR }),
    );
    const { nome, senha, entrar } = await abrirComoDiscipulador();
    fireEvent.click(entrar);
    expect(
      await screen.findByText(TEXTOS_DISCIPULADOR.faltaNome),
    ).toBeVisible();
    expect(screen.getByText(TEXTOS_DISCIPULADOR.faltaSenha)).toBeVisible();
    expect(nome).toHaveAttribute("aria-invalid", "true");
    expect(senha).toHaveAttribute("aria-invalid", "true");
    expect(nome).toHaveFocus();
    expect(corpos).toEqual([]);
  });

  it("401: a recusa genérica (não diz se o discipulador existe), com o foco na mensagem; 429: espere um minuto", async () => {
    let status = 401;
    simularApi(() =>
      respostaJson(
        {
          erro: {
            codigo: status === 401 ? "nao_autenticado" : "muitas_requisicoes",
            mensagem: "x",
          },
        },
        status,
      ),
    );
    const { roteador, nome, senha, entrar } = await abrirComoDiscipulador();
    fireEvent.change(nome, { target: { value: "Alisson" } });
    fireEvent.change(senha, { target: { value: "@errada1234" } });
    fireEvent.click(entrar);
    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent(TEXTOS_DISCIPULADOR.recusada);
    expect(alerta).toHaveTextContent(TEXTOS_DISCIPULADOR.recusadaDetalhe);
    expect(TEXTOS_DISCIPULADOR.recusada).not.toMatch(/existe/i);
    await waitFor(() =>
      expect(document.querySelector(".entrar-resultado")).toHaveFocus(),
    );
    expect(nome).toHaveValue("Alisson");
    expect(roteador.state.location.pathname).toBe("/entrar");

    status = 429;
    fireEvent.click(entrar);
    expect(
      await screen.findByText(TEXTOS_DISCIPULADOR.muitasTentativas),
    ).toBeInTheDocument();
  });

  it("as dicas dizem de onde vem a senha (começa com @ e termina com 1234)", () => {
    expect(DICAS_DISCIPULADOR.senha).toMatch(/@.*1234/);
    expect(DICAS_DISCIPULADOR.nome).toMatch(/acentos/);
  });
});
