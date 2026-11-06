import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "./ProgressBar";

describe("ProgressBar", () => {
  it("expõe o percentual da meta com aria-valuenow/min/max e um nome", () => {
    render(<ProgressBar rotulo="Meta da campanha" valor={350} meta={1000} />);

    const barra = screen.getByRole("progressbar", { name: "Meta da campanha" });
    expect(barra).toHaveAttribute("aria-valuemin", "0");
    expect(barra).toHaveAttribute("aria-valuemax", "100");
    expect(barra).toHaveAttribute("aria-valuenow", "35");
    expect(barra).toHaveAttribute("aria-valuetext", "35%");
    expect(screen.getByText("35%")).toBeInTheDocument();
  });

  it("não expõe o valor bruto (ex.: centavos), só o percentual", () => {
    render(
      <ProgressBar rotulo="Arrecadado" valor={1_234_500} meta={5_000_000} />,
    );

    const barra = screen.getByRole("progressbar", { name: "Arrecadado" });
    expect(barra).toHaveAttribute("aria-valuenow", "24");
    expect(barra).toHaveAttribute("aria-valuetext", "24%");
    expect(document.body.textContent).not.toMatch(/1234500|1\.234\.500/);
  });

  it("acima da meta: barra cheia, texto com o percentual real", () => {
    const { container } = render(
      <ProgressBar rotulo="Célula Ágape" valor={120} meta={100} />,
    );

    const barra = screen.getByRole("progressbar", { name: "Célula Ágape" });
    expect(barra).toHaveAttribute("aria-valuenow", "100");
    expect(barra).toHaveAttribute("aria-valuetext", "120%");
    expect(container.querySelector(".ui-progress")).toHaveAttribute(
      "data-completa",
    );
  });

  it("perto da meta não arredonda para 100%", () => {
    render(<ProgressBar rotulo="Quase" valor={9_999} meta={10_000} />);

    const barra = screen.getByRole("progressbar", { name: "Quase" });
    expect(barra).toHaveAttribute("aria-valuenow", "99");
    expect(barra).toHaveAttribute("aria-valuetext", "99%");
  });

  it("meta zero ou valor negativo ficam em 0%", () => {
    render(
      <>
        <ProgressBar rotulo="Sem meta" valor={50} meta={0} />
        <ProgressBar rotulo="Negativo" valor={-5} meta={10} />
      </>,
    );

    for (const nome of ["Sem meta", "Negativo"]) {
      const barra = screen.getByRole("progressbar", { name: nome });
      expect(barra).toHaveAttribute("aria-valuenow", "0");
      expect(barra).toHaveAttribute("aria-valuetext", "0%");
    }
  });

  it("aceita um texto próprio para o valor", () => {
    render(
      <ProgressBar
        rotulo="Bilhetes"
        valor={300}
        meta={1000}
        textoValor="300 de 1.000"
      />,
    );

    const barra = screen.getByRole("progressbar", { name: "Bilhetes" });
    expect(barra).toHaveAttribute("aria-valuenow", "30");
    expect(barra).toHaveAttribute("aria-valuetext", "300 de 1.000");
  });
});
