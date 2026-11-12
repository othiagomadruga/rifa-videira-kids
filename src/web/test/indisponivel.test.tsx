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
  especificidade,
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

  it("segue a cascata (RIFA-047): o seletor mais específico vence e, no empate, a regra que vem depois; cada propriedade na sua", () => {
    const geral =
      '.ui-button:disabled, .ui-button[aria-disabled="true"] { opacity: 0.55; cursor: not-allowed; } .ui-button { cursor: pointer; }';
    const tela =
      '.tela-rodape button[aria-disabled="true"] { opacity: 0.55; cursor: progress; }';
    render(
      <div className="tela-rodape">
        <Button aria-disabled>Carregando…</Button>
      </div>,
    );
    const botao = screen.getByRole("button", { name: "Carregando…" });
    const naoPermitido = { opacity: "0.55", cursor: "not-allowed" };
    const deEspera = { opacity: "0.55", cursor: "progress" };

    expect(caraDeIndisponivel(botao, geral)).toEqual(naoPermitido);
    // A tela sobrepõe a regra geral (mais específica), antes ou depois dela.
    expect(caraDeIndisponivel(botao, geral, tela)).toEqual(deEspera);
    expect(caraDeIndisponivel(botao, tela, geral)).toEqual(deEspera);
    // Uma regra menos específica que vem depois não desfaz.
    expect(
      caraDeIndisponivel(
        botao,
        geral,
        "button { opacity: 1; cursor: default; }",
      ),
    ).toEqual(naoPermitido);
    // Mesma especificidade: vale a que vem depois. Só o cursor muda: a opacidade continua a da outra regra.
    const outra = '.ui-button[aria-disabled="true"] { cursor: wait; }';
    expect(caraDeIndisponivel(botao, geral, outra)).toEqual({
      opacity: "0.55",
      cursor: "wait",
    });
    expect(caraDeIndisponivel(botao, outra, geral)).toEqual(naoPermitido);
    // Sem opacidade em regra nenhuma (só o cursor do .ui-button): não tem a cara.
    expect(
      caraDeIndisponivel(botao, ".ui-button { cursor: pointer; }"),
    ).toBeNull();
  });
});

describe("especificidade()", () => {
  it("conta ids, classes (com atributos e pseudo-classes) e tipos; :not, :is e :has pelo argumento mais específico; :where, nada", () => {
    expect(especificidade("button")).toEqual([0, 0, 1]);
    expect(especificidade(".ui-button:disabled")).toEqual([0, 2, 0]);
    expect(especificidade('.ui-button[aria-disabled="true"]')).toEqual([
      0, 2, 0,
    ]);
    expect(especificidade('.tela button[aria-disabled="true"]')).toEqual([
      0, 2, 1,
    ]);
    expect(especificidade("#conteudo .a > b::before")).toEqual([1, 1, 2]);
    expect(
      especificidade(
        '.ui-button--primario:hover:not(:disabled):not([aria-disabled="true"])',
      ),
    ).toEqual([0, 4, 0]);
    expect(
      especificidade('.campanha-opcao:has(input[aria-disabled="true"])'),
    ).toEqual([0, 2, 1]);
    expect(especificidade(":is(#a, .b) c")).toEqual([1, 0, 1]);
    expect(especificidade(":where(#a, .b) c")).toEqual([0, 0, 1]);
  });
});
