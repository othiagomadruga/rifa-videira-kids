// RIFA-045: a dica (tooltip) dos botões e campos. CA1: aparece com o mouse parado e com o foco do teclado, e some
// ao tirar o mouse, ao perder o foco e com Esc (WCAG 1.4.13: dispensável, dá para passar o mouse por cima,
// persistente). CA2: role="tooltip" e o aria-describedby juntando com a descrição que o controle já tinha. CA3 (a
// conta): acima do controle, abaixo se não couber, sempre dentro da tela a 390 e a 1366 px (a medida na tela de
// verdade está nas capturas do Playwright). No toque, nada muda.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dicaDe,
  focarPeloTeclado,
  passarOMouse,
  tirarOMouse,
} from "../../test/dicas";
import { Button } from "./Button";
import { Input } from "./Campos";
import { Dialogo } from "./Dialogo";
import { ATRASO_DA_DICA_MS, ComDica, FOLGA_DA_DICA_MS } from "./Dica";

const TEXTO = "Grava as mudanças. A tela mostra o resultado logo abaixo.";

function esperar(ms: number) {
  act(() => vi.advanceTimersByTime(ms));
}

function botao(nome = "Salvar") {
  return screen.getByRole("button", { name: nome });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CA1: aparece com o mouse parado e com o foco, e some ao sair, ao perder o foco e com Esc", () => {
  it("mouse parado: aparece depois do tempo da dica (não antes) e some ao tirar o mouse, depois da folga", () => {
    render(
      <ComDica texto={TEXTO}>
        <Button>Salvar</Button>
      </ComDica>,
    );
    passarOMouse(botao());
    esperar(ATRASO_DA_DICA_MS - 1);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    esperar(1);
    expect(screen.getByRole("tooltip")).toHaveTextContent(TEXTO);

    tirarOMouse(botao());
    // A folga deixa levar o mouse até a dica.
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    esperar(FOLGA_DA_DICA_MS);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(botao()).not.toHaveAttribute("aria-describedby");
  });

  it("mouse mexendo: a contagem recomeça a cada movimento (a dica espera o mouse parar)", () => {
    render(
      <ComDica texto={TEXTO}>
        <Button>Salvar</Button>
      </ComDica>,
    );
    passarOMouse(botao());
    esperar(ATRASO_DA_DICA_MS - 100);
    fireEvent.pointerMove(botao(), { pointerType: "mouse" });
    esperar(ATRASO_DA_DICA_MS - 100);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    esperar(100);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("mouse que só passa (sai antes do tempo): a dica não aparece", () => {
    render(
      <ComDica texto={TEXTO}>
        <Button>Salvar</Button>
      </ComDica>,
    );
    passarOMouse(botao());
    esperar(300);
    tirarOMouse(botao());
    esperar(ATRASO_DA_DICA_MS);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("foco do teclado: aparece na hora e some ao perder o foco", () => {
    render(
      <>
        <ComDica texto={TEXTO}>
          <Button>Salvar</Button>
        </ComDica>
        <Button>Outro</Button>
      </>,
    );
    focarPeloTeclado(botao());
    expect(screen.getByRole("tooltip")).toHaveTextContent(TEXTO);

    focarPeloTeclado(botao("Outro"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("foco de um clique ou de um toque (ponteiro antes do foco) não abre a dica", () => {
    render(
      <ComDica texto={TEXTO}>
        <Button>Salvar</Button>
      </ComDica>,
    );
    fireEvent.keyDown(document.body, { key: "Tab" });
    fireEvent.pointerDown(botao(), { pointerType: "mouse" });
    act(() => botao().focus());
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("foco que não veio de uma tecla de navegação (ex.: um diálogo devolvendo o foco depois do Esc) não abre", () => {
    render(
      <ComDica texto={TEXTO}>
        <Button>Salvar</Button>
      </ComDica>,
    );
    fireEvent.keyDown(document.body, { key: "Escape" });
    act(() => botao().focus());
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    // Mesmo logo depois de um Tab: o Esc (ou o Enter) no meio apaga a marca do teclado.
    act(() => botao().blur());
    fireEvent.keyDown(document.body, { key: "Tab" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    act(() => botao().focus());
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    // Shift+Tab abre (o Shift sozinho não apaga a marca).
    act(() => botao().blur());
    fireEvent.keyDown(document.body, { key: "Tab", shiftKey: true });
    fireEvent.keyDown(document.body, { key: "Shift", shiftKey: true });
    act(() => botao().focus());
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("Esc fecha a dica aberta pelo mouse sem mover o mouse, e ela só volta com o mouse entrando de novo", () => {
    render(
      <ComDica texto={TEXTO}>
        <Button>Salvar</Button>
      </ComDica>,
    );
    passarOMouse(botao());
    esperar(ATRASO_DA_DICA_MS);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.pointerMove(botao(), { pointerType: "mouse" });
    esperar(ATRASO_DA_DICA_MS * 2);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    tirarOMouse(botao());
    passarOMouse(botao());
    esperar(ATRASO_DA_DICA_MS);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("Esc fecha a dica aberta pelo foco sem tirar o foco; esse Esc fica na dica (a camada de cima) e o seguinte segue para quem mais o escuta", () => {
    const aoTeclar = vi.fn();
    render(
      <div onKeyDown={(evento) => aoTeclar(evento.key)}>
        <ComDica texto={TEXTO}>
          <Button>Salvar</Button>
        </ComDica>
      </div>,
    );
    focarPeloTeclado(botao());
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.keyDown(botao(), { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(botao()).toHaveFocus();
    expect(aoTeclar).not.toHaveBeenCalled();

    fireEvent.keyDown(botao(), { key: "Escape" });
    expect(aoTeclar).toHaveBeenCalledWith("Escape");
  });

  it("revisão: num diálogo, o Esc com a dica aberta só fecha a dica (o que foi digitado fica); o Esc seguinte fecha o diálogo", () => {
    const aoFechar = vi.fn();
    render(
      <Dialogo aberto titulo="Nova pessoa" aoFechar={aoFechar}>
        <Input rotulo="Nome" />
        <ComDica texto="Só para saber quem é.">
          <Input rotulo="E-mail" />
        </ComDica>
      </Dialogo>,
    );
    const nome = screen.getByRole("textbox", { name: "Nome" });
    const email = screen.getByRole("textbox", { name: "E-mail" });
    fireEvent.change(nome, { target: { value: "Fulano" } });
    focarPeloTeclado(email);
    expect(dicaDe(email)).toHaveTextContent("Só para saber quem é.");

    fireEvent.keyDown(email, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(aoFechar).not.toHaveBeenCalled();
    expect(email).toHaveFocus();
    expect(nome).toHaveValue("Fulano");

    fireEvent.keyDown(email, { key: "Escape" });
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("dá para passar o mouse por cima da dica: ela fica enquanto o mouse está nela e some ao sair dela", () => {
    render(
      <ComDica texto={TEXTO}>
        <Button>Salvar</Button>
      </ComDica>,
    );
    passarOMouse(botao());
    esperar(ATRASO_DA_DICA_MS);
    const dica = screen.getByRole("tooltip");

    tirarOMouse(botao());
    esperar(FOLGA_DA_DICA_MS / 2);
    passarOMouse(dica);
    esperar(FOLGA_DA_DICA_MS * 5);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    tirarOMouse(dica);
    esperar(FOLGA_DA_DICA_MS);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("persistente: aberta pelo mouse e pelo foco, só some quando os dois saem", () => {
    render(
      <ComDica texto={TEXTO}>
        <Button>Salvar</Button>
      </ComDica>,
    );
    focarPeloTeclado(botao());
    passarOMouse(botao());
    tirarOMouse(botao());
    esperar(FOLGA_DA_DICA_MS * 5);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    passarOMouse(botao());
    act(() => botao().blur());
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    tirarOMouse(botao());
    esperar(FOLGA_DA_DICA_MS);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("o clique fecha a dica (ela sai da frente do que vem depois) e não atrapalha o clique", () => {
    const aoClicar = vi.fn();
    render(
      <ComDica texto={TEXTO}>
        <Button onClick={aoClicar}>Salvar</Button>
      </ComDica>,
    );
    passarOMouse(botao());
    esperar(ATRASO_DA_DICA_MS);
    fireEvent.pointerDown(botao(), { pointerType: "mouse" });
    fireEvent.click(botao());
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(aoClicar).toHaveBeenCalledTimes(1);
  });

  it("no toque (celular): o toque não abre a dica e o clique segue normal", () => {
    const aoClicar = vi.fn();
    render(
      <ComDica texto={TEXTO}>
        <Button onClick={aoClicar}>Salvar</Button>
      </ComDica>,
    );
    fireEvent.pointerEnter(botao(), { pointerType: "touch" });
    fireEvent.pointerDown(botao(), { pointerType: "touch" });
    act(() => botao().focus());
    fireEvent.click(botao());
    esperar(ATRASO_DA_DICA_MS * 3);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(aoClicar).toHaveBeenCalledTimes(1);
  });

  it("controle com aria-disabled: a dica continua (pelo mouse e pelo foco), dizendo por que está indisponível", () => {
    const motivo = "Indisponível enquanto carrega. Espere terminar.";
    render(
      <ComDica texto={motivo}>
        <Button aria-disabled>Carregar mais</Button>
      </ComDica>,
    );
    const controle = botao("Carregar mais");
    passarOMouse(controle);
    esperar(ATRASO_DA_DICA_MS);
    expect(screen.getByRole("tooltip")).toHaveTextContent(motivo);
    tirarOMouse(controle);
    esperar(FOLGA_DA_DICA_MS);

    focarPeloTeclado(controle);
    expect(controle).toHaveAccessibleDescription(motivo);
  });

  it("os eventos do próprio controle continuam chamados (o envoltório encadeia, não troca)", () => {
    const eventos: string[] = [];
    render(
      <ComDica texto={TEXTO}>
        <Button
          onFocus={() => eventos.push("foco")}
          onBlur={() => eventos.push("saiu")}
          onPointerEnter={() => eventos.push("entrou")}
          onPointerLeave={() => eventos.push("deixou")}
          onPointerDown={() => eventos.push("pressionou")}
        >
          Salvar
        </Button>
      </ComDica>,
    );
    passarOMouse(botao());
    fireEvent.pointerDown(botao(), { pointerType: "mouse" });
    tirarOMouse(botao());
    focarPeloTeclado(botao());
    act(() => botao().blur());
    expect(eventos).toEqual(["entrou", "pressionou", "deixou", "foco", "saiu"]);
  });

  it("sem texto, o controle fica como está (sem dica)", () => {
    render(
      <ComDica texto="">
        <Button>Salvar</Button>
      </ComDica>,
    );
    passarOMouse(botao());
    esperar(ATRASO_DA_DICA_MS);
    focarPeloTeclado(botao());
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});

describe("CA2: role tooltip e aria-describedby juntando com a descrição que já existia", () => {
  it("aberta, a dica é role=tooltip e o id dela vai no fim do aria-describedby, depois do que o controle já tinha", () => {
    render(
      <>
        <p id="ja-tinha">Indisponível: é o texto padrão.</p>
        <ComDica texto={TEXTO}>
          <Button aria-describedby="ja-tinha">Voltar ao texto padrão</Button>
        </ComDica>
      </>,
    );
    const controle = botao("Voltar ao texto padrão");
    expect(controle).toHaveAttribute("aria-describedby", "ja-tinha");

    passarOMouse(controle);
    esperar(ATRASO_DA_DICA_MS);
    const dica = screen.getByRole("tooltip");
    expect(dica.id).toBeTruthy();
    expect(controle).toHaveAttribute("aria-describedby", `ja-tinha ${dica.id}`);
    expect(controle).toHaveAccessibleDescription(
      `Indisponível: é o texto padrão. ${TEXTO}`,
    );
    expect(dicaDe(controle)).toBe(dica);
    // A dica descreve: o nome do controle não muda.
    expect(controle).toHaveAccessibleName("Voltar ao texto padrão");

    tirarOMouse(controle);
    esperar(FOLGA_DA_DICA_MS);
    expect(controle).toHaveAttribute("aria-describedby", "ja-tinha");
  });

  it("num campo (Input), junta com a dica visível, o erro e a descrição de fora, sem tirar nenhuma", () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <>
        <p id="de-fora">Só o admin muda.</p>
        <ComDica texto="O nome que aparece no ranking.">
          <Input
            ref={ref}
            rotulo="Nome da campanha"
            dica="Ex.: Projeto Videira Kids."
            erro="Informe o nome."
            aria-describedby="de-fora"
          />
        </ComDica>
      </>,
    );
    const campo = screen.getByRole("textbox", { name: "Nome da campanha" });
    expect(ref.current).toBe(campo);
    expect(campo).toHaveAccessibleDescription(
      "Só o admin muda. Ex.: Projeto Videira Kids. Informe o nome.",
    );

    focarPeloTeclado(campo);
    expect(campo).toHaveAccessibleDescription(
      "Só o admin muda. O nome que aparece no ranking. Ex.: Projeto Videira Kids. Informe o nome.",
    );
    expect(campo).toHaveAttribute("aria-invalid", "true");
  });

  it("caixa de marcar dentro de um <label>: a dica fica na linha toda (o mouse no texto abre) e na descrição da caixa (id dado)", () => {
    render(
      <ComDica id="caixa-dica" texto="Marcada, o telão mostra o %.">
        <label htmlFor="caixa">
          <input id="caixa" type="checkbox" aria-describedby="caixa-dica" />
          <span>Mostrar o percentual</span>
        </label>
      </ComDica>,
    );
    const caixa = screen.getByRole("checkbox", {
      name: "Mostrar o percentual",
    });
    // Fechada, o id não aponta para nada e fica de fora da descrição.
    expect(caixa).not.toHaveAccessibleDescription();

    passarOMouse(screen.getByText("Mostrar o percentual"));
    esperar(ATRASO_DA_DICA_MS);
    expect(screen.getByRole("tooltip")).toHaveAttribute("id", "caixa-dica");
    expect(caixa).toHaveAccessibleDescription("Marcada, o telão mostra o %.");
    expect(dicaDe(caixa)).toBe(screen.getByRole("tooltip"));
    // O <label> não ganha aria-describedby.
    expect(caixa.closest("label")).not.toHaveAttribute("aria-describedby");

    tirarOMouse(screen.getByText("Mostrar o percentual"));
    esperar(FOLGA_DA_DICA_MS);
    focarPeloTeclado(caixa);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("cada controle tem a sua dica, com id próprio", () => {
    render(
      <>
        <ComDica texto="Primeira dica.">
          <Button>Um</Button>
        </ComDica>
        <ComDica texto="Segunda dica.">
          <Button>Dois</Button>
        </ComDica>
      </>,
    );
    focarPeloTeclado(botao("Um"));
    const primeira = dicaDe(botao("Um"));
    focarPeloTeclado(botao("Dois"));
    const segunda = dicaDe(botao("Dois"));
    expect(primeira?.id).not.toBe(segunda?.id);
    expect(segunda).toHaveTextContent("Segunda dica.");
    expect(screen.getAllByRole("tooltip")).toHaveLength(1);
  });

  it("uma dica por vez (RIFA-047): a aberta pelo teclado fecha quando o mouse abre a de outro controle, e a do mouse fecha quando o teclado abre outra", () => {
    render(
      <>
        <ComDica texto="Primeira dica.">
          <Button>Um</Button>
        </ComDica>
        <ComDica texto="Segunda dica.">
          <Button>Dois</Button>
        </ComDica>
        <ComDica texto="Terceira dica.">
          <Button>Três</Button>
        </ComDica>
      </>,
    );
    focarPeloTeclado(botao("Um"));
    expect(dicaDe(botao("Um"))).toHaveTextContent("Primeira dica.");

    // O mouse para em "Dois": a dica dele abre e a de "Um" fecha (o foco continua em "Um").
    passarOMouse(botao("Dois"));
    esperar(ATRASO_DA_DICA_MS - 1);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Primeira dica.");
    esperar(1);
    expect(screen.getAllByRole("tooltip")).toHaveLength(1);
    expect(dicaDe(botao("Dois"))).toHaveTextContent("Segunda dica.");
    expect(dicaDe(botao("Um"))).toBeNull();
    expect(botao("Um")).toHaveFocus();

    // O Tab leva o foco a "Três", com o mouse ainda em "Dois": fica só a dica de "Três".
    focarPeloTeclado(botao("Três"));
    expect(screen.getAllByRole("tooltip")).toHaveLength(1);
    expect(dicaDe(botao("Três"))).toHaveTextContent("Terceira dica.");
    expect(dicaDe(botao("Dois"))).toBeNull();
    // Tirar o mouse de "Dois" não mexe na de "Três"; o Esc fecha a que está aberta.
    tirarOMouse(botao("Dois"));
    esperar(FOLGA_DA_DICA_MS);
    expect(dicaDe(botao("Três"))).toHaveTextContent("Terceira dica.");
    fireEvent.keyDown(botao("Três"), { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});

/** Simula o layout que o jsdom não faz: o retângulo do controle, o tamanho da dica e o tamanho da tela. */
function simularLayout({
  tela,
  controle,
  dica,
}: {
  tela: { largura: number; altura: number };
  controle: { left: number; top: number; width: number; height: number };
  dica: { width: number; height: number };
}) {
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(
    tela.largura,
  );
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(
    tela.altura,
  );
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const caixa =
        this.getAttribute("role") === "tooltip"
          ? { left: 0, top: 0, ...dica }
          : controle;
      return {
        ...caixa,
        x: caixa.left,
        y: caixa.top,
        right: caixa.left + caixa.width,
        bottom: caixa.top + caixa.height,
        toJSON: () => caixa,
      } as DOMRect;
    },
  );
}

function abrirEPosicionar() {
  render(
    <ComDica texto={TEXTO}>
      <Button>Salvar</Button>
    </ComDica>,
  );
  focarPeloTeclado(botao());
  const dica = screen.getByRole("tooltip");
  return {
    dica,
    left: Number.parseFloat(dica.style.left),
    top: Number.parseFloat(dica.style.top),
    seta: Number.parseFloat(dica.style.getPropertyValue("--dica-seta")),
  };
}

describe("CA3 (a conta da posição): acima, abaixo se não couber, sempre dentro da tela", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("390 px: acima do controle, centrada nele, com a seta no meio", () => {
    simularLayout({
      tela: { largura: 390, altura: 844 },
      controle: { left: 145, top: 400, width: 100, height: 44 },
      dica: { width: 200, height: 60 },
    });
    const { dica, left, top, seta } = abrirEPosicionar();
    expect(dica).toHaveAttribute("data-lado", "acima");
    expect(top).toBe(400 - 8 - 60);
    expect(left).toBe(95);
    expect(seta).toBe(100);
  });

  it("390 px, controle colado na borda direita: a dica fica dentro da tela (8 px de margem) e a seta segue o controle", () => {
    simularLayout({
      tela: { largura: 390, altura: 844 },
      controle: { left: 300, top: 400, width: 80, height: 44 },
      dica: { width: 288, height: 80 },
    });
    const { left, seta } = abrirEPosicionar();
    expect(left).toBe(390 - 8 - 288);
    expect(left + 288).toBeLessThanOrEqual(390 - 8);
    expect(seta).toBe(340 - left);
  });

  it("390 px, controle colado na borda esquerda: a dica começa na margem", () => {
    simularLayout({
      tela: { largura: 390, altura: 844 },
      controle: { left: 16, top: 400, width: 44, height: 44 },
      dica: { width: 288, height: 80 },
    });
    const { left, seta } = abrirEPosicionar();
    expect(left).toBe(8);
    expect(seta).toBe(30);
  });

  it("sem lugar acima (controle no topo da tela): a dica vai para baixo dele", () => {
    simularLayout({
      tela: { largura: 390, altura: 844 },
      controle: { left: 145, top: 20, width: 100, height: 44 },
      dica: { width: 200, height: 60 },
    });
    const { dica, top } = abrirEPosicionar();
    expect(dica).toHaveAttribute("data-lado", "abaixo");
    expect(top).toBe(20 + 44 + 8);
  });

  it("1366 px: acima do controle, centrada, longe das bordas", () => {
    simularLayout({
      tela: { largura: 1366, altura: 768 },
      controle: { left: 1200, top: 300, width: 120, height: 44 },
      dica: { width: 288, height: 60 },
    });
    const { left, top } = abrirEPosicionar();
    expect(top).toBe(300 - 8 - 60);
    expect(left).toBe(1366 - 8 - 288);
  });

  it("tela baixa, sem lugar inteiro nos dois lados: o lado com mais espaço, preso dentro da tela", () => {
    simularLayout({
      tela: { largura: 390, altura: 300 },
      controle: { left: 145, top: 100, width: 100, height: 44 },
      dica: { width: 288, height: 200 },
    });
    const { dica, top } = abrirEPosicionar();
    expect(dica).toHaveAttribute("data-lado", "abaixo");
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top + 200).toBeLessThanOrEqual(300 - 8);
  });
});
