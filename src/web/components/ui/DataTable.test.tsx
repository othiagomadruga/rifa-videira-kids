import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatarNumero } from "../../lib/formatadores";
import { DataTable, type ColunaTabela } from "./DataTable";

type Celula = { id: number; nome: string; lider: string; bilhetes: number };

const COLUNAS: ColunaTabela<Celula>[] = [
  { chave: "nome", titulo: "Célula", celula: (c) => c.nome, principal: true },
  { chave: "lider", titulo: "Líder", celula: (c) => c.lider },
  {
    chave: "bilhetes",
    titulo: "Bilhetes",
    celula: (c) => formatarNumero(c.bilhetes),
    alinhamento: "fim",
  },
];

const LINHAS: Celula[] = [
  { id: 1, nome: "Célula Ágape", lider: "Ana", bilhetes: 1200 },
  { id: 2, nome: "Célula Betel", lider: "Bruno", bilhetes: 85 },
];

function renderizarTabela(linhas: Celula[] = LINHAS) {
  return render(
    <DataTable
      colunas={COLUNAS}
      linhas={linhas}
      chaveDaLinha={(c) => c.id}
      legenda="Bilhetes por célula"
    />,
  );
}

describe("DataTable", () => {
  it("mostra os cabeçalhos e uma linha por registro", () => {
    renderizarTabela();

    const tabela = screen.getByRole("table", { name: "Bilhetes por célula" });
    expect(
      within(tabela)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["Célula", "Líder", "Bilhetes"]);

    const linhas = within(tabela).getAllByRole("row").slice(1);
    expect(linhas).toHaveLength(2);
    expect(
      within(linhas[0])
        .getAllByRole("cell")
        .map((td) => td.textContent),
    ).toEqual(["Célula Ágape", "Ana", "1.200"]);
    expect(
      within(linhas[1])
        .getAllByRole("cell")
        .map((td) => td.textContent),
    ).toEqual(["Célula Betel", "Bruno", "85"]);
  });

  it("cada célula leva o rótulo da coluna para o cartão do celular", () => {
    renderizarTabela();

    const [, primeiraLinha] = screen.getAllByRole("row");
    const [nome, lider, bilhetes] = within(primeiraLinha).getAllByRole("cell");
    expect(nome).toHaveAttribute("data-principal");
    expect(lider).toHaveAttribute("data-rotulo", "Líder");
    expect(lider).not.toHaveAttribute("data-principal");
    expect(bilhetes).toHaveAttribute("data-rotulo", "Bilhetes");
    expect(bilhetes).toHaveAttribute("data-alinhamento", "fim");
  });

  it("sem linhas mostra o estado vazio (padrão ou o informado)", () => {
    const { unmount } = renderizarTabela([]);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(
      screen.getByText("Nenhum registro para mostrar."),
    ).toBeInTheDocument();
    unmount();

    render(
      <DataTable
        colunas={COLUNAS}
        linhas={[]}
        chaveDaLinha={(c) => c.id}
        legenda="Bilhetes por célula"
        vazio={<p>Nenhuma célula cadastrada.</p>}
      />,
    );
    expect(screen.getByText("Nenhuma célula cadastrada.")).toBeInTheDocument();
  });
});
