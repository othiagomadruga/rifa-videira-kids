import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Input, Select, Textarea } from "./Campos";

type ModuloFs = { readFileSync(caminho: string, codificacao: "utf8"): string };
const { process } = globalThis as unknown as {
  process: { getBuiltinModule(nome: "node:fs"): ModuloFs };
};
// O caminho vai numa variável: com um texto fixo, o Vite trocaria o new URL(..., import.meta.url) pela URL do asset.
const lerCss = (relativo: string) =>
  process
    .getBuiltinModule("node:fs")
    .readFileSync(
      decodeURIComponent(new URL(relativo, import.meta.url).pathname),
      "utf8",
    )
    .replace(/\/\*[\s\S]*?\*\//g, "");

// RIFA-049 (P1.10, A-12): no foco, a borda do campo vira o roxo da marca (além do anel do foco); o campo com erro
// continua com a borda vermelha. O jsdom não aplica CSS: o seletor da regra é conferido com matches.
describe("campos: a borda no foco", () => {
  const regras = [
    ...lerCss("./Campos.css").matchAll(/([^{}]+)\{([^{}]*)\}/g),
  ].map(([, seletor, corpo]) => ({ seletor: seletor.trim(), corpo }));
  const doFoco = regras.filter(
    ({ seletor, corpo }) =>
      /:focus/.test(seletor) &&
      /border-color:\s*var\(--cor-primaria\)/.test(corpo),
  );

  it("o campo focado ganha a borda roxa; o com erro, não", () => {
    expect(doFoco).toHaveLength(1);
    const { seletor } = doFoco[0];
    render(
      <>
        <Input rotulo="Nome" />
        <Input rotulo="Telefone" erro="Telefone inválido." />
      </>,
    );
    const nome = screen.getByLabelText("Nome");
    const telefone = screen.getByLabelText("Telefone");
    expect(nome.matches(seletor)).toBe(false);
    act(() => nome.focus());
    expect(nome.matches(seletor)).toBe(true);
    act(() => telefone.focus());
    expect(telefone.matches(seletor)).toBe(false);
    // O anel do foco continua (o global do base.css).
    expect(lerCss("../../tema/base.css")).toMatch(
      /:focus-visible\s*\{[^}]*outline:\s*var\(--foco-anel\);/,
    );
  });
});

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
