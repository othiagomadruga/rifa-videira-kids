// RIFA-045 (correção dos indisponíveis): os ajudantes de test/indisponivel.ts não passam por acaso. O Enter e o espaço
// simulados clicam num botão disponível (o "não faz nada" dos testes das telas não é de graça), o Tab respeita a trava
// de um diálogo e pula o `disabled`, e a cara de indisponível vem de uma regra que casa de verdade com o elemento.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button, Dialogo } from "../components/ui";
import {
  ativarPeloTeclado,
  caraDeIndisponivel,
  caraDoDesabilitado,
  chegarPeloTab,
  ordemDoTab,
  tab,
} from "./indisponivel";

describe("ativarPeloTeclado()", () => {
  it("o Enter e o espaço clicam no botão disponível, como no navegador", () => {
    const aoClicar = vi.fn();
    render(<Button onClick={aoClicar}>Gravar</Button>);
    const botao = screen.getByRole("button", { name: "Gravar" });

    ativarPeloTeclado(botao, "Enter");
    ativarPeloTeclado(botao, " ");

    expect(aoClicar).toHaveBeenCalledTimes(2);
  });

  it("tecla cancelada pela tela não vira clique", () => {
    const aoClicar = vi.fn();
    render(
      <Button
        onClick={aoClicar}
        onKeyDown={(evento) => evento.preventDefault()}
      >
        Gravar
      </Button>,
    );
    const botao = screen.getByRole("button", { name: "Gravar" });

    ativarPeloTeclado(botao, "Enter");
    ativarPeloTeclado(botao, " ");

    expect(aoClicar).not.toHaveBeenCalled();
  });
});

describe("ordemDoTab(), tab() e chegarPeloTab()", () => {
  it("o `disabled` sai do Tab e o aria-disabled fica", () => {
    render(
      <>
        <Button>Antes</Button>
        <Button disabled>Desabilitado</Button>
        <Button aria-disabled>Indisponível</Button>
      </>,
    );
    const nomes = () => ordemDoTab().map((elemento) => elemento.textContent);
    expect(nomes()).toEqual(["Antes", "Indisponível"]);

    chegarPeloTab(screen.getByRole("button", { name: "Indisponível" }));
    expect(() =>
      chegarPeloTab(screen.getByRole("button", { name: "Desabilitado" })),
    ).toThrow(/não está na ordem do Tab/);
  });

  it("num diálogo aberto, o Tab dá a volta pela trava dele e não sai", () => {
    render(
      <>
        <Button>Fora</Button>
        <Dialogo aberto titulo="Confirmar" aoFechar={() => {}}>
          <Button>Primeiro</Button>
          <Button>Último</Button>
        </Dialogo>
      </>,
    );
    // O foco inicial é o primeiro do corpo. A ordem do diálogo: o × (Fechar, no cabeçalho), Primeiro e Último; do
    // Último, o Tab volta ao ×, e do ×, o Shift+Tab vai ao Último. "Fora" (inert) nunca recebe o foco.
    expect(screen.getByRole("button", { name: "Primeiro" })).toHaveFocus();
    const nomes = [tab(), tab(), tab(), tab(true), tab(true)].map(
      (elemento) => elemento.getAttribute("aria-label") ?? elemento.textContent,
    );
    expect(nomes).toEqual(["Último", "Fechar", "Primeiro", "Fechar", "Último"]);
  });
});

describe("caraDeIndisponivel()", () => {
  it("lê a regra que casa com o elemento (a do :disabled do Button.css: 0,55 e not-allowed)", () => {
    expect(caraDoDesabilitado()).toEqual({
      opacity: "0.55",
      cursor: "not-allowed",
    });
  });

  it("sem regra que case, devolve null (o seletor da tela é conferido de verdade)", () => {
    const css =
      '.tela-acoes button[aria-disabled="true"] { opacity: 0.55; cursor: not-allowed; }';
    render(
      <div className="tela-acoes">
        <Button aria-disabled>Dentro</Button>
        <Button>Disponível</Button>
      </div>,
    );
    const fora = document.createElement("button");
    fora.setAttribute("aria-disabled", "true");

    expect(
      caraDeIndisponivel(screen.getByRole("button", { name: "Dentro" }), css),
    ).toEqual({ opacity: "0.55", cursor: "not-allowed" });
    expect(
      caraDeIndisponivel(
        screen.getByRole("button", { name: "Disponível" }),
        css,
      ),
    ).toBeNull();
    expect(caraDeIndisponivel(fora, css)).toBeNull();
  });
});
