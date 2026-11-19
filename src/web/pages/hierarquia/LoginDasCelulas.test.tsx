// RIFA-064 (D29): na Hierarquia (admin e coordenação), o aviso das células que não entram pela senha padrão (nomes
// iguais depois da normalização, ou sem letra nem número) e a senha de cada célula com "Copiar", para repassar ao líder.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { controlesSemDica } from "../../test/dicas";
import { renderizarRota } from "../../test/renderizar";
import { LoginDasCelulas } from "./LoginDasCelulas";
import {
  criarApiFalsa,
  criarCelula,
  criarDiscipulador,
  criarRede,
  hierarquiaExemplo,
} from "./teste-apoio";

const rede = criarRede(1, "Rede Fictícia", "jovens");
const disc = criarDiscipulador(11, "Discipulador Fictício", rede);

afterEach(() => {
  vi.unstubAllGlobals();
});

function linhas() {
  return screen
    .getAllByRole("listitem")
    .filter((item) => item.classList.contains("hierarquia-login__item"))
    .map((item) => item.textContent);
}

describe("RIFA-064: o login das células na Hierarquia", () => {
  it("a senha de cada célula, em ordem de nome, com 'Copiar' (copia a senha da célula e diz qual)", async () => {
    const escrever = vi.fn(async () => {});
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: escrever },
    });
    render(
      <LoginDasCelulas
        celulas={[
          criarCelula(2, "Geração que Clama", disc),
          criarCelula(1, "Kairós1", disc),
          criarCelula(3, "Pão Vivo", disc),
        ]}
      />,
    );

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Login das células com senha",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/não entra com a senha padrão/)).toBeNull();
    expect(linhas()).toEqual([
      "Geração que Clama@geracaoqueclama1234Copiar",
      "Kairós1@kairos11234Copiar",
      "Pão Vivo@paovivo1234Copiar",
    ]);
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Copiar a senha da Kairós1" }),
      ),
    );
    expect(escrever).toHaveBeenCalledWith("@kairos11234");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Senha da Kairós1 copiada.",
    );
    expect(controlesSemDica()).toEqual([]);
  });

  it("sem a área de transferência: diz para copiar da lista", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    render(<LoginDasCelulas celulas={[criarCelula(1, "Betel", disc)]} />);
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Copiar a senha da Betel" }),
      ),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Não deu para copiar sozinho: copie a senha da Betel da lista.",
    );
  });

  it("nomes iguais no login e nome sem letra nem número: o aviso diz quais e como resolver, e elas ficam sem senha", () => {
    render(
      <LoginDasCelulas
        celulas={[
          criarCelula(1, "Pão Vivo", disc),
          criarCelula(2, "Betel", disc),
          criarCelula(3, "Pao Vivo", disc),
          criarCelula(4, "!!!", disc),
        ]}
      />,
    );

    const aviso = screen
      .getByText("3 células não entram com a senha padrão")
      .closest(".ui-aviso") as HTMLElement;
    expect(aviso).toBeInTheDocument();
    expect(
      within(aviso)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "“Pão Vivo” e “Pao Vivo” ficam com o mesmo nome no login. Mude o nome de uma delas (Editar, na aba Células) para que entrem.",
      "“!!!”: o nome não tem letra nem número. Mude o nome para que ela entre.",
    ]);
    expect(linhas()).toEqual([
      "!!!Não entra pela senha (veja o aviso).",
      "Betel@betel1234Copiar",
      "Pão VivoNão entra pela senha (veja o aviso).",
      "Pao VivoNão entra pela senha (veja o aviso).",
    ]);
    expect(
      screen.queryByRole("button", { name: /Copiar a senha da P/ }),
    ).toBeNull();
  });

  it("sem células: nada aparece", () => {
    const { container } = render(<LoginDasCelulas celulas={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("na tela Hierarquia, logo depois do resumo, com as células da API", async () => {
    vi.stubGlobal("fetch", criarApiFalsa(hierarquiaExemplo()).fetch);
    renderizarRota("/coordenacao/hierarquia");
    const titulo = await screen.findByRole(
      "heading",
      { level: 2, name: "Login das células com senha" },
      { timeout: 5000 },
    );
    const resumo = screen.getByRole("region", { name: "Resumo" });
    expect(
      resumo.compareDocumentPosition(titulo) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Copiar a senha da Célula Esperança",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("@celulaesperanca1234")).toBeInTheDocument();
  });
});
