// RIFA-073 (D33): a tela Minha senha (só admin): mostra se há senha, cria e troca (com a confirmação e as regras do
// contrato), avisa o usuário em uso e remove com confirmação. API simulada (fetch trocado).
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ROTAS_ACESSO } from "../../../shared/contracts";
import {
  ADMIN_DE_TESTE,
  USUARIO_DE_TESTE,
  renderizarRota,
  respostaJson,
} from "../../test/renderizar";
import { CAMINHO_MINHA_SENHA } from "./minha-senha-api";
import { TEXTOS } from "./textos";

const SENHA_FICTICIA = "senha ficticia de teste";
const SEM_SENHA = { definida: false, usuario: null, atualizada_em: null };

type Chamada = { metodo: string; corpo: unknown };

function simularApi(
  inicial: unknown,
  aoSalvar: (corpo: { usuario: string }) => Response = (corpo) =>
    respostaJson({
      definida: true,
      usuario: corpo.usuario.trim().toLowerCase(),
      atualizada_em: "2026-11-19T15:00:00.000Z",
    }),
) {
  const chamadas: Chamada[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(entrada), window.location.origin);
      const metodo = init?.method ?? "GET";
      if (url.pathname !== CAMINHO_MINHA_SENHA)
        return respostaJson({ itens: [] });
      const corpo = init?.body ? JSON.parse(String(init.body)) : undefined;
      chamadas.push({ metodo, corpo });
      if (metodo === "GET") return respostaJson(inicial);
      if (metodo === "PUT") return aoSalvar(corpo as { usuario: string });
      return new Response(null, { status: 204 });
    }),
  );
  return chamadas;
}

/** O campo pelo name (os rótulos "Senha nova" e "Repita a senha nova" se parecem). */
function campo(nome: string): HTMLInputElement {
  const encontrado = document.querySelector<HTMLInputElement>(
    `input[name="${nome}"]`,
  );
  if (encontrado === null) throw new Error(`campo ${nome} não encontrado`);
  return encontrado;
}

function preencher(usuario: string, senha: string, confirmacao = senha) {
  fireEvent.change(campo("usuario"), { target: { value: usuario } });
  fireEvent.change(campo("nova-senha"), { target: { value: senha } });
  fireEvent.change(campo("confirmacao"), { target: { value: confirmacao } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RIFA-073: tela Minha senha", () => {
  it("o caminho é o do contrato; a tela está no menu só do admin", async () => {
    expect(CAMINHO_MINHA_SENHA).toBe(ROTAS_ACESSO.obterMinhaSenhaAdmin.caminho);
    expect(CAMINHO_MINHA_SENHA).toBe(
      ROTAS_ACESSO.definirMinhaSenhaAdmin.caminho,
    );
    expect(CAMINHO_MINHA_SENHA).toBe(
      ROTAS_ACESSO.removerMinhaSenhaAdmin.caminho,
    );

    simularApi(SEM_SENHA);
    renderizarRota("/coordenacao/minha-senha", { usuario: USUARIO_DE_TESTE });
    expect(
      screen.queryByRole("link", { name: /Minha senha/ }),
    ).not.toBeInTheDocument();
  });

  it("sem senha: cria com usuário, senha e confirmação; o PUT leva os dois e a tela limpa a senha", async () => {
    const chamadas = simularApi(SEM_SENHA);
    renderizarRota("/coordenacao/minha-senha", { usuario: ADMIN_DE_TESTE });
    expect(await screen.findByText(TEXTOS.semSenha)).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: /Minha senha/ }).length,
    ).toBeGreaterThan(0);

    preencher("Pastor.Teste", SENHA_FICTICIA);
    fireEvent.click(screen.getByRole("button", { name: TEXTOS.salvar }));

    expect(await screen.findByText(TEXTOS.salvaCriada)).toBeInTheDocument();
    expect(chamadas.filter((c) => c.metodo === "PUT")).toEqual([
      {
        metodo: "PUT",
        corpo: { usuario: "Pastor.Teste", senha: SENHA_FICTICIA },
      },
    ]);
    expect(screen.getByText(TEXTOS.comSenha)).toBeInTheDocument();
    expect(screen.getByText("pastor.teste")).toBeInTheDocument();
    expect(campo("nova-senha")).toHaveValue("");
    expect(campo("confirmacao")).toHaveValue("");
    // A senha não aparece na tela.
    expect(document.body.textContent).not.toContain(SENHA_FICTICIA);
  });

  it("senha curta, confirmação diferente e usuário fora do formato não vão à API", async () => {
    const chamadas = simularApi(SEM_SENHA);
    renderizarRota("/coordenacao/minha-senha", { usuario: ADMIN_DE_TESTE });
    await screen.findByText(TEXTOS.semSenha);
    const salvar = screen.getByRole("button", { name: TEXTOS.salvar });

    preencher("pastor", "curta");
    fireEvent.click(salvar);
    expect(
      await screen.findByText(/pelo menos 10 caracteres/),
    ).toBeInTheDocument();

    preencher("pastor", SENHA_FICTICIA, "outra coisa qualquer");
    fireEvent.click(salvar);
    expect(
      await screen.findByText(TEXTOS.confirmacaoDiferente),
    ).toBeInTheDocument();

    preencher("joão", SENHA_FICTICIA);
    fireEvent.click(salvar);
    // A mensagem repete a ajuda do campo: o que conta é o campo marcado como inválido.
    await waitFor(() =>
      expect(campo("usuario")).toHaveAttribute("aria-invalid", "true"),
    );

    expect(chamadas.filter((c) => c.metodo === "PUT")).toEqual([]);
  });

  it("409 em_uso: o aviso fica no campo Usuário", async () => {
    simularApi(SEM_SENHA, () =>
      respostaJson({ erro: { codigo: "em_uso", mensagem: "x" } }, 409),
    );
    renderizarRota("/coordenacao/minha-senha", { usuario: ADMIN_DE_TESTE });
    await screen.findByText(TEXTOS.semSenha);
    preencher("pastor", SENHA_FICTICIA);
    fireEvent.click(screen.getByRole("button", { name: TEXTOS.salvar }));
    expect(await screen.findByText(TEXTOS.emUso)).toBeInTheDocument();
  });

  it("com senha: mostra o usuário e remove só depois de confirmar", async () => {
    const chamadas = simularApi({
      definida: true,
      usuario: "pastor.teste",
      atualizada_em: "2026-11-19T15:00:00.000Z",
    });
    renderizarRota("/coordenacao/minha-senha", { usuario: ADMIN_DE_TESTE });
    expect(await screen.findByText(TEXTOS.comSenha)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: TEXTOS.tituloFormularioTrocar }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: TEXTOS.remover }));
    const dialogo = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialogo).getByRole("button", { name: TEXTOS.cancelar }),
    );
    expect(chamadas.filter((c) => c.metodo === "DELETE")).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: TEXTOS.remover }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: TEXTOS.removerConfirmar,
      }),
    );
    expect(await screen.findByText(TEXTOS.removida)).toBeInTheDocument();
    await waitFor(() =>
      expect(chamadas.filter((c) => c.metodo === "DELETE")).toHaveLength(1),
    );
    expect(screen.getByText(TEXTOS.semSenha)).toBeInTheDocument();
  });
});
