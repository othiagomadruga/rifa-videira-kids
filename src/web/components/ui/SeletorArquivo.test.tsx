import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ATRASO_DA_DICA_MS, FOLGA_DA_DICA_MS, SeletorArquivo } from ".";
import {
  dicaDe,
  focarPeloTeclado,
  passarOMouse,
  tirarOMouse,
} from "../../test/dicas";

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

  it("dica do botão (RIFA-045): abre com o mouse no botão e com o foco do teclado no campo, e entra no fim da descrição do campo", () => {
    vi.useFakeTimers();
    try {
      render(
        <SeletorArquivo
          rotulo="Planilha em CSV"
          dica="Salve como CSV UTF-8."
          arquivo={null}
          aoEscolher={() => {}}
          dicaEscolher="Abre a escolha do arquivo no aparelho."
        />,
      );
      const campo = screen.getByLabelText("Planilha em CSV");
      // Fechada, a dica não existe e fica de fora da descrição.
      expect(dicaDe(campo)).toBeNull();
      expect(campo).toHaveAccessibleDescription(
        "Salve como CSV UTF-8. Nenhum arquivo escolhido",
      );

      // O mouse fica no botão (o <label> visível); a dica é do campo escondido.
      passarOMouse(screen.getByText("Escolher arquivo"));
      act(() => vi.advanceTimersByTime(ATRASO_DA_DICA_MS));
      expect(dicaDe(campo)).toHaveTextContent(
        "Abre a escolha do arquivo no aparelho.",
      );
      expect(campo).toHaveAccessibleDescription(
        "Salve como CSV UTF-8. Nenhum arquivo escolhido Abre a escolha do arquivo no aparelho.",
      );
      tirarOMouse(screen.getByText("Escolher arquivo"));
      act(() => vi.advanceTimersByTime(FOLGA_DA_DICA_MS));
      expect(screen.queryByRole("tooltip")).toBeNull();

      // O teclado foca o campo de verdade: a dica abre na hora e some quando o foco sai.
      focarPeloTeclado(campo);
      expect(dicaDe(campo)).toHaveTextContent(
        "Abre a escolha do arquivo no aparelho.",
      );
      act(() => campo.blur());
      expect(screen.queryByRole("tooltip")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("vários arquivos (RIFA-074): o campo é múltiplo, entrega todos e mostra o texto de quem usa", () => {
    const aoEscolher = vi.fn();
    const aoEscolherVarios = vi.fn();
    render(
      <SeletorArquivo
        rotulo="Arquivos"
        arquivo={null}
        aoEscolher={aoEscolher}
        aoEscolherVarios={aoEscolherVarios}
        textoArquivo="2 arquivos escolhidos"
      />,
    );
    const campo = screen.getByLabelText("Arquivos");
    expect(campo).toHaveAttribute("multiple");
    expect(screen.getByText("2 arquivos escolhidos")).toBeInTheDocument();
    const um = new File(["a"], "a.pdf");
    const dois = new File(["b"], "b.pdf");
    fireEvent.change(campo, { target: { files: [um, dois] } });
    expect(aoEscolherVarios).toHaveBeenCalledWith([um, dois]);
    expect(aoEscolher).not.toHaveBeenCalled();
  });
});
