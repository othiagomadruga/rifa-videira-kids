import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Abas, idDaAba } from ".";

function Exemplo() {
  const [aba, setAba] = useState<"celulas" | "redes" | "importar">("celulas");
  return (
    <Abas
      id="exemplo"
      rotulo="Partes da hierarquia"
      abaAtiva={aba}
      aoMudar={setAba}
      abas={[
        {
          id: "celulas",
          rotulo: "Células",
          conteudo: <p>Tabela de células</p>,
        },
        {
          id: "redes",
          rotulo: "Redes",
          conteudo: <input aria-label="Filtro de redes" />,
        },
        { id: "importar", rotulo: "Importar", conteudo: <p>Importação</p> },
      ]}
    />
  );
}

function aba(nome: string) {
  return screen.getByRole("tab", { name: nome });
}

describe("Abas", () => {
  it("segue o padrão tablist/tab/tabpanel e mostra só o painel da aba atual", () => {
    render(<Exemplo />);

    const lista = screen.getByRole("tablist", { name: "Partes da hierarquia" });
    expect(within(lista).getAllByRole("tab")).toHaveLength(3);
    expect(aba("Células")).toHaveAttribute("aria-selected", "true");
    expect(aba("Redes")).toHaveAttribute("aria-selected", "false");

    const painel = screen.getByRole("tabpanel");
    expect(painel).toHaveAccessibleName("Células");
    expect(painel).toHaveTextContent("Tabela de células");
    expect(aba("Células")).toHaveAttribute("aria-controls", painel.id);
    expect(aba("Células").id).toBe(idDaAba("exemplo", "celulas"));
    expect(screen.queryByText("Importação")).not.toBeVisible();
  });

  it("só a aba atual entra no Tab (tabindex itinerante)", () => {
    render(<Exemplo />);

    expect(aba("Células")).toHaveAttribute("tabindex", "0");
    expect(aba("Redes")).toHaveAttribute("tabindex", "-1");
    expect(aba("Importar")).toHaveAttribute("tabindex", "-1");
  });

  it("clicar troca de aba e o que foi digitado em outra aba continua lá", () => {
    render(<Exemplo />);

    fireEvent.click(aba("Redes"));
    expect(aba("Redes")).toHaveAttribute("aria-selected", "true");
    fireEvent.change(screen.getByRole("textbox", { name: "Filtro de redes" }), {
      target: { value: "Norte" },
    });

    fireEvent.click(aba("Células"));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Tabela de células");
    fireEvent.click(aba("Redes"));
    expect(
      screen.getByRole("textbox", { name: "Filtro de redes" }),
    ).toHaveValue("Norte");
  });

  it("setas (dão a volta), Home e End trocam de aba e levam o foco junto", () => {
    render(<Exemplo />);
    act(() => aba("Células").focus());

    fireEvent.keyDown(aba("Células"), { key: "ArrowRight" });
    expect(aba("Redes")).toHaveAttribute("aria-selected", "true");
    expect(aba("Redes")).toHaveFocus();

    fireEvent.keyDown(aba("Redes"), { key: "End" });
    expect(aba("Importar")).toHaveFocus();
    fireEvent.keyDown(aba("Importar"), { key: "ArrowRight" });
    expect(aba("Células")).toHaveFocus();
    expect(aba("Células")).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(aba("Células"), { key: "ArrowLeft" });
    expect(aba("Importar")).toHaveFocus();
    fireEvent.keyDown(aba("Importar"), { key: "Home" });
    expect(aba("Células")).toHaveFocus();

    // Outras teclas não mudam nada.
    fireEvent.keyDown(aba("Células"), { key: "ArrowDown" });
    expect(aba("Células")).toHaveAttribute("aria-selected", "true");
  });
});
