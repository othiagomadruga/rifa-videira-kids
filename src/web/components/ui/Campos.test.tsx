import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Input, Select, Textarea } from "./Campos";

describe("campos de formulário", () => {
  it("Input: rótulo ligado ao campo e repassa as props nativas", () => {
    const aoMudar = vi.fn();
    render(
      <Input rotulo="E-mail" type="email" name="email" onChange={aoMudar} />,
    );

    const campo = screen.getByLabelText("E-mail");
    expect(campo).toHaveAttribute("type", "email");
    expect(campo).toHaveAttribute("name", "email");
    expect(campo).not.toHaveAttribute("aria-invalid");
    expect(campo).not.toHaveAttribute("aria-describedby");

    fireEvent.change(campo, { target: { value: "ana@exemplo.com" } });
    expect(aoMudar).toHaveBeenCalledOnce();
  });

  it("Input: dica e erro descrevem o campo, e o erro o marca como inválido", () => {
    render(
      <Input
        rotulo="Meta (R$)"
        dica="Valor total que a campanha quer arrecadar."
        erro="Informe um valor maior que zero."
      />,
    );

    const campo = screen.getByLabelText("Meta (R$)");
    expect(campo).toHaveAttribute("aria-invalid", "true");
    expect(campo).toHaveAccessibleDescription(
      "Valor total que a campanha quer arrecadar. Informe um valor maior que zero.",
    );
  });

  it("Input: usa o id informado", () => {
    render(<Input rotulo="Nome" id="campo-nome" dica="Como na Rifei." />);

    const campo = screen.getByLabelText("Nome");
    expect(campo).toHaveAttribute("id", "campo-nome");
    expect(campo).toHaveAttribute("aria-describedby", "campo-nome-dica");
  });

  it("Select: rótulo, opções e erro", () => {
    render(
      <Select rotulo="Célula" defaultValue="" erro="Escolha uma célula.">
        <option value="" disabled>
          Escolha…
        </option>
        <option value="agape">Célula Ágape</option>
      </Select>,
    );

    const campo = screen.getByRole("combobox", { name: "Célula" });
    expect(campo).toHaveAttribute("aria-invalid", "true");
    expect(campo).toHaveAccessibleDescription("Escolha uma célula.");
    expect(
      screen.getByRole("option", { name: "Célula Ágape" }),
    ).toBeInTheDocument();
  });

  it("Textarea: rótulo e dica", () => {
    render(<Textarea rotulo="Observação" dica="Opcional." rows={3} />);

    const campo = screen.getByRole("textbox", { name: "Observação" });
    expect(campo.tagName).toBe("TEXTAREA");
    expect(campo).toHaveAccessibleDescription("Opcional.");
    expect(campo).not.toHaveAttribute("aria-invalid");
  });
});
