import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SeletorArquivo } from ".";

function Exemplo({ aoEscolher }: { aoEscolher: (arquivo: File) => void }) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  return (
    <SeletorArquivo
      rotulo="Planilha em CSV"
      dica="Salve como CSV UTF-8."
      aceitar=".csv,text/csv"
      arquivo={arquivo}
      aoEscolher={(novo) => {
        setArquivo(novo);
        aoEscolher(novo);
      }}
    />
  );
}

describe("SeletorArquivo", () => {
  it("é um campo de arquivo com rótulo, dica e o nome escolhido ligados a ele", () => {
    render(<Exemplo aoEscolher={() => {}} />);

    const campo = screen.getByLabelText("Planilha em CSV");
    expect(campo).toHaveAttribute("type", "file");
    expect(campo).toHaveAttribute("accept", ".csv,text/csv");
    // O botão é outro rótulo do mesmo campo: clicar nele abre o seletor.
    expect(screen.getByText("Escolher arquivo").tagName).toBe("LABEL");
    expect(campo).toHaveAccessibleName("Planilha em CSV Escolher arquivo");
    expect(campo).toHaveAccessibleDescription(
      "Salve como CSV UTF-8. Nenhum arquivo escolhido",
    );
  });

  it("avisa o arquivo escolhido, mostra o nome e limpa o campo para poder escolher o mesmo de novo", () => {
    const aoEscolher = vi.fn();
    render(<Exemplo aoEscolher={aoEscolher} />);
    const campo = screen.getByLabelText("Planilha em CSV");
    const arquivo = new File(["rede;divisao"], "hierarquia.csv", {
      type: "text/csv",
    });

    fireEvent.change(campo, { target: { files: [arquivo] } });

    expect(aoEscolher).toHaveBeenCalledWith(arquivo);
    expect(screen.getByText("hierarquia.csv")).toBeInTheDocument();
    expect(campo).toHaveAccessibleDescription(
      "Salve como CSV UTF-8. hierarquia.csv",
    );
    expect(campo).toHaveValue("");
  });

  it("sem arquivo na mudança (cancelou a escolha), não avisa nada", () => {
    const aoEscolher = vi.fn();
    render(<Exemplo aoEscolher={aoEscolher} />);

    fireEvent.change(screen.getByLabelText("Planilha em CSV"), {
      target: { files: [] },
    });

    expect(aoEscolher).not.toHaveBeenCalled();
  });

  it("com erro fica inválido; desabilitado não deixa escolher", () => {
    render(
      <SeletorArquivo
        rotulo="Planilha"
        erro="Escolha um arquivo .csv."
        arquivo={null}
        aoEscolher={() => {}}
        textoSemArquivo="Nada ainda"
        desabilitado
      />,
    );

    const campo = screen.getByLabelText("Planilha");
    expect(campo).toHaveAttribute("aria-invalid", "true");
    expect(campo).toHaveAccessibleDescription(
      "Escolha um arquivo .csv. Nada ainda",
    );
    expect(campo).toBeDisabled();
  });
});
