// RIFA-073 (D33): em /entrar, a opção "Sou administrador" troca o formulário da célula pelo do admin (usuário e senha),
// que chama POST /api/sessao/admin e leva à coordenação. A recusa é genérica (não diz se o usuário existe) e o 429
// avisa para esperar. API simulada (fetch trocado).
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_DE_TESTE,
  renderizarRota,
  respostaJson,
} from "../../test/renderizar";
import { TEXTOS, TEXTOS_ADMIN } from "./textos";

const SENHA_FICTICIA = "senha ficticia de teste";

function simularApi(respostaDoLogin: () => Response) {
  const corpos: unknown[] = [];
  const fetchMock = vi.fn(
    async (entrada: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(entrada), window.location.origin);
      const metodo = init?.method ?? "GET";
      if (metodo === "GET" && url.pathname === "/api/sessao")
        return respostaJson(
          { erro: { codigo: "nao_autenticado", mensagem: "Sem sessão" } },
          401,
        );
      if (metodo === "POST" && url.pathname === "/api/sessao/admin") {
        corpos.push(JSON.parse(String(init?.body)));
        return respostaDoLogin();
      }
      // A coordenação, depois de entrar: o resto das chamadas não importa aqui.
      return respostaJson(
        { erro: { codigo: "erro_interno", mensagem: "Fora do teste" } },
        500,
      );
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return { corpos, fetchMock };
}

async function abrirComoAdmin() {
  const resultado = renderizarRota("/entrar", { usuario: null });
  fireEvent.click(await screen.findByRole("button", { name: TEXTOS.souAdmin }));
  return {
    ...resultado,
    usuario: (await screen.findByLabelText("Usuário")) as HTMLInputElement,
    senha: screen.getByLabelText("Senha") as HTMLInputElement,
    entrar: screen.getByRole("button", { name: "Entrar" }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("RIFA-073: Sou administrador em /entrar", () => {
  it("troca o formulário: usuário e senha do admin, com as dicas próprias; o botão volta para a célula", async () => {
    simularApi(() => respostaJson({}, 500));
    const { usuario } = await abrirComoAdmin();
    expect(
      screen.getByRole("heading", { level: 2, name: TEXTOS_ADMIN.tituloSenha }),
    ).toBeInTheDocument();
    expect(
      [...document.querySelectorAll("input")].map((campo) => campo.name),
    ).toEqual(["usuario", "senha"]);
    expect(usuario).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText("Senha")).toHaveAttribute("type", "password");

    fireEvent.click(
      screen.getByRole("button", { name: TEXTOS_ADMIN.souCelula }),
    );
    expect(await screen.findByLabelText("Célula")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: TEXTOS.souAdmin })).toHaveFocus();
  });

  it("usuário e senha certos: POST /api/sessao/admin com os dois e vai para a coordenação", async () => {
    const { corpos } = simularApi(() =>
      respostaJson({ usuario: ADMIN_DE_TESTE }),
    );
    const { roteador, usuario, senha, entrar } = await abrirComoAdmin();
    fireEvent.change(usuario, { target: { value: "pastor.teste" } });
    fireEvent.change(senha, { target: { value: SENHA_FICTICIA } });
    fireEvent.click(entrar);

    await waitFor(() =>
      expect(roteador.state.location.pathname).toBe("/coordenacao"),
    );
    expect(corpos).toEqual([
      { usuario: "pastor.teste", senha: SENHA_FICTICIA },
    ]);
    // A senha não vai para o endereço.
    expect(roteador.state.location.search).toBe("");
  });

  it("campos vazios nem vão à API", async () => {
    const { corpos } = simularApi(() => respostaJson({}, 500));
    const { entrar } = await abrirComoAdmin();
    fireEvent.click(entrar);
    expect(await screen.findByText(TEXTOS_ADMIN.faltaNome)).toBeInTheDocument();
    expect(corpos).toEqual([]);
  });

  it("401: a recusa genérica (não diz se o usuário existe); 429: espere um minuto", async () => {
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
    const { usuario, senha, entrar } = await abrirComoAdmin();
    fireEvent.change(usuario, { target: { value: "pastor.teste" } });
    fireEvent.change(senha, { target: { value: "senha errada" } });
    fireEvent.click(entrar);
    expect(await screen.findByText(TEXTOS_ADMIN.recusada)).toBeInTheDocument();
    expect(TEXTOS_ADMIN.recusada).not.toMatch(/existe/i);

    status = 429;
    fireEvent.click(entrar);
    expect(
      await screen.findByText(TEXTOS_ADMIN.muitasTentativas),
    ).toBeInTheDocument();
  });
});
