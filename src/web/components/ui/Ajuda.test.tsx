// RIFA-066: a ajuda dos títulos e rótulos. O PO passou o mouse em "Períodos" (na Campanha) e nada apareceu. CA: todo
// título de seção e todo rótulo de campo tem explicação ao passar o mouse (no próprio título e no "?" ao lado), no
// foco do teclado e ao tocar no "?"; o "?" se chama "Ajuda: <título>" e leva a explicação no aria-describedby; Esc
// fecha só a ajuda; uma por vez; o título e o rótulo não mudam de nome. A posição dentro da tela (390 px) é a mesma
// conta da dica dos botões (Dica.test.tsx, CA3), conferida aqui com o grupo do título colado na borda.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dicaDe,
  focarPeloTeclado,
  passarOMouse,
  tirarOMouse,
} from "../../test/dicas";
import { CARREGANDO_A_AJUDA, ComAjuda, ajudasSobDemanda } from "./Ajuda";
import { Input, Select, Textarea } from "./Campos";
import { Card } from "./Card";
import { DataTable } from "./DataTable";
import { Dialogo } from "./Dialogo";
import { ATRASO_DA_DICA_MS, FOLGA_DA_DICA_MS } from "./Dica";
import { PageHeader } from "./PageHeader";
import { SeletorArquivo } from "./SeletorArquivo";
import { Stat } from "./Stat";

const PERIODOS =
  "A campanha é dividida em etapas, normalmente semanas. Cada etapa tem uma parte da meta e um ranking próprio.";

function esperar(ms: number) {
  act(() => vi.advanceTimersByTime(ms));
}

function ajuda(nome: string) {
  return screen.getByRole("button", { name: `Ajuda: ${nome}` });
}

/** O toque do dedo no "?": o ponteiro de toque desce e o clique vem depois (o toque não foca o botão no iPhone). */
function tocar(elemento: Element) {
  fireEvent.pointerDown(elemento, { pointerType: "touch" });
  fireEvent.pointerUp(elemento, { pointerType: "touch" });
  fireEvent.click(elemento);
  fireEvent.pointerLeave(elemento, { pointerType: "touch" });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("o título com ajuda (Card)", () => {
  function renderizar() {
    render(
      <Card titulo="Períodos" ajuda={PERIODOS}>
        <p>Conteúdo</p>
      </Card>,
    );
  }

  it("o título continua com o mesmo nome; o \"?\" ao lado é um botão 'Ajuda: Períodos', fora do <h2>", () => {
    renderizar();
    const titulo = screen.getByRole("heading", { level: 2, name: "Períodos" });
    expect(titulo).toBeInTheDocument();
    expect(titulo).not.toContainElement(ajuda("Períodos"));
    expect(ajuda("Períodos")).toHaveAttribute("type", "button");
    // Fechada, nada na tela e nada na descrição.
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(ajuda("Períodos")).not.toHaveAccessibleDescription();
  });

  it("mouse parado no próprio título (o que o PO tentou): a explicação aparece depois do tempo da dica e some ao tirar o mouse", () => {
    renderizar();
    const titulo = screen.getByRole("heading", { name: "Períodos" });
    passarOMouse(titulo);
    esperar(ATRASO_DA_DICA_MS - 1);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    esperar(1);
    expect(screen.getByRole("tooltip")).toHaveTextContent(PERIODOS);
    // Aberta, a explicação é a descrição do "?".
    expect(ajuda("Períodos")).toHaveAccessibleDescription(PERIODOS);
    expect(dicaDe(ajuda("Períodos"))).toBe(screen.getByRole("tooltip"));

    tirarOMouse(titulo);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    esperar(FOLGA_DA_DICA_MS);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it('do título para o "?" com o mouse: a explicação fica aberta (é o mesmo grupo)', () => {
    renderizar();
    passarOMouse(screen.getByRole("heading", { name: "Períodos" }));
    esperar(ATRASO_DA_DICA_MS);
    const aberta = screen.getByRole("tooltip");
    // O ponteiro sai do título para o "?", sem sair do grupo.
    fireEvent.pointerOut(screen.getByRole("heading", { name: "Períodos" }), {
      pointerType: "mouse",
      relatedTarget: ajuda("Períodos"),
    });
    fireEvent.pointerOver(ajuda("Períodos"), {
      pointerType: "mouse",
      relatedTarget: screen.getByRole("heading", { name: "Períodos" }),
    });
    esperar(FOLGA_DA_DICA_MS + ATRASO_DA_DICA_MS);
    expect(screen.getByRole("tooltip")).toBe(aberta);
  });

  it('foco do teclado no "?": aparece na hora, ligada pelo aria-describedby; Esc fecha só ela, sem tirar o foco', () => {
    renderizar();
    focarPeloTeclado(ajuda("Períodos"));
    expect(screen.getByRole("tooltip")).toHaveTextContent(PERIODOS);
    expect(ajuda("Períodos")).toHaveAccessibleDescription(PERIODOS);

    const outroOuvinte = vi.fn();
    document.addEventListener("keydown", outroOuvinte);
    fireEvent.keyDown(ajuda("Períodos"), { key: "Escape" });
    document.removeEventListener("keydown", outroOuvinte);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(ajuda("Períodos")).toHaveFocus();
    // O Esc fica na ajuda (a camada de cima): não chega ao diálogo nem ao menu.
    expect(outroOuvinte).not.toHaveBeenCalled();
  });

  it('toque no "?" (celular, sem mouse): abre na hora e fica; o toque seguinte no "?" fecha', () => {
    renderizar();
    tocar(ajuda("Períodos"));
    expect(screen.getByRole("tooltip")).toHaveTextContent(PERIODOS);
    expect(ajuda("Períodos")).toHaveAccessibleDescription(PERIODOS);
    // O dedo sai da tela (pointerleave de toque) e o tempo passa: continua aberta para ler.
    esperar(5000);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    tocar(ajuda("Períodos"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("toque fora fecha a aberta pelo toque; toque na própria explicação não fecha", () => {
    render(
      <>
        <Card titulo="Períodos" ajuda={PERIODOS}>
          <p>Conteúdo</p>
        </Card>
        <p>Outro lugar</p>
      </>,
    );
    tocar(ajuda("Períodos"));
    fireEvent.pointerDown(screen.getByRole("tooltip"), {
      pointerType: "touch",
    });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByText("Outro lugar"), {
      pointerType: "touch",
    });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it('clique do mouse no "?": abre na hora e fica com o mouse saindo; o clique seguinte fecha; aberta pelo mouse parado, o clique fixa', () => {
    renderizar();
    fireEvent.pointerDown(ajuda("Períodos"), { pointerType: "mouse" });
    fireEvent.click(ajuda("Períodos"));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    tirarOMouse(ajuda("Períodos"));
    esperar(FOLGA_DA_DICA_MS * 5);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.click(ajuda("Períodos"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    passarOMouse(ajuda("Períodos"));
    esperar(ATRASO_DA_DICA_MS);
    fireEvent.click(ajuda("Períodos"));
    tirarOMouse(ajuda("Períodos"));
    esperar(FOLGA_DA_DICA_MS * 5);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it('Enter e espaço no "?" (o clique do teclado) fixam a aberta pelo foco; Tab para fora fecha', () => {
    render(
      <>
        <Card titulo="Períodos" ajuda={PERIODOS}>
          <button type="button">Depois</button>
        </Card>
      </>,
    );
    focarPeloTeclado(ajuda("Períodos"));
    fireEvent.click(ajuda("Períodos"));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    focarPeloTeclado(screen.getByRole("button", { name: "Depois" }));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("uma por vez: a ajuda que abre fecha a outra (do toque e do mouse)", () => {
    render(
      <>
        <Card titulo="Períodos" ajuda={PERIODOS}>
          <p>Um</p>
        </Card>
        <Card
          titulo="Bilhete e meta"
          ajuda="Quanto custa o bilhete e quanto cada célula deve vender."
        >
          <p>Dois</p>
        </Card>
      </>,
    );
    tocar(ajuda("Períodos"));
    tocar(ajuda("Bilhete e meta"));
    expect(screen.getAllByRole("tooltip")).toHaveLength(1);
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Quanto custa o bilhete",
    );
    passarOMouse(screen.getByRole("heading", { name: "Períodos" }));
    esperar(ATRASO_DA_DICA_MS);
    expect(screen.getAllByRole("tooltip")).toHaveLength(1);
    expect(screen.getByRole("tooltip")).toHaveTextContent(PERIODOS);
  });

  it('sem ajuda, o título fica como antes (sem o "?" e sem o grupo)', () => {
    const { container } = render(
      <Card titulo="Sem ajuda">
        <p>Conteúdo</p>
      </Card>,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.querySelector("[data-ajuda]")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Sem ajuda" }),
    ).toBeInTheDocument();
  });
});

describe("os rótulos de campo (Input, Select, Textarea, SeletorArquivo) e as caixas de marcar", () => {
  it("o rótulo continua dando o nome do campo; o \"?\" se chama 'Ajuda: <rótulo>', com a parte só para o leitor de tela", () => {
    render(
      <>
        <Input
          rotulo={
            <>
              Percentual (%)
              <span className="visualmente-oculto"> do período 1</span>
            </>
          }
          ajuda="Quanto da meta total se espera vender nesta etapa. Ex.: meta de 40 bilhetes e 25% → 10 bilhetes."
        />
        <Select rotulo="Unidade da meta" ajuda="Em que a meta é contada.">
          <option>Bilhetes</option>
        </Select>
        <Textarea rotulo="Mensagem" ajuda="O texto que vai pelo WhatsApp." />
        <SeletorArquivo
          rotulo="Arquivo da Rifei"
          ajuda="A planilha de vendas que a Rifei manda baixar."
          arquivo={null}
          aoEscolher={() => {}}
        />
      </>,
    );
    expect(
      screen.getByLabelText("Percentual (%) do período 1"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Ajuda: Percentual (%) do período 1",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Unidade da meta" }),
    ).toBeInTheDocument();
    expect(ajuda("Unidade da meta")).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Mensagem" }),
    ).toBeInTheDocument();
    expect(ajuda("Mensagem")).toBeInTheDocument();
    expect(screen.getByLabelText("Arquivo da Rifei")).toBeInTheDocument();
    expect(ajuda("Arquivo da Rifei")).toBeInTheDocument();

    passarOMouse(screen.getByText("Unidade da meta"));
    esperar(ATRASO_DA_DICA_MS);
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Em que a meta é contada.",
    );
    // A explicação é também a dica do campo: aberta, entra no fim da descrição dele.
    expect(
      screen.getByRole("combobox", { name: "Unidade da meta" }),
    ).toHaveAccessibleDescription("Em que a meta é contada.");
  });

  it("campo com ajuda: o mouse no próprio campo e o foco do teclado nele abrem a mesma explicação (é a dica dele), depois da dica visível e do erro", () => {
    render(
      <Input
        rotulo="Dias"
        dica="Número inteiro."
        erro="Use um número."
        ajuda="Quantos dias esta etapa dura. Ex.: 7 dias = uma semana."
      />,
    );
    const campo = screen.getByRole("textbox", { name: "Dias" });
    expect(campo).toHaveAccessibleDescription("Número inteiro. Use um número.");
    passarOMouse(campo);
    esperar(ATRASO_DA_DICA_MS);
    expect(campo).toHaveAccessibleDescription(
      "Número inteiro. Use um número. Quantos dias esta etapa dura. Ex.: 7 dias = uma semana.",
    );
    expect(dicaDe(campo)).toBe(screen.getByRole("tooltip"));
    tirarOMouse(campo);
    esperar(FOLGA_DA_DICA_MS);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    focarPeloTeclado(campo);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Quantos dias");
    // O clique no campo (para digitar) tira a explicação da frente.
    fireEvent.pointerDown(campo, { pointerType: "mouse" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it('caixa de marcar dentro do <label>: o mouse na linha abre, o foco do teclado na caixa abre (id dado) e o "?" também', () => {
    const texto =
      "Marcado, o telão mostra quanto da meta cada célula fez. Ex.: 80%.";
    render(
      <ComAjuda id="caixa-ajuda" texto={texto} idDoTitulo="caixa-texto">
        <label htmlFor="caixa">
          <input id="caixa" type="checkbox" aria-describedby="caixa-ajuda" />
          <span id="caixa-texto">Mostrar o percentual</span>
        </label>
      </ComAjuda>,
    );
    const caixa = screen.getByRole("checkbox", {
      name: "Mostrar o percentual",
    });
    expect(ajuda("Mostrar o percentual")).toBeInTheDocument();
    passarOMouse(screen.getByText("Mostrar o percentual"));
    esperar(ATRASO_DA_DICA_MS);
    expect(caixa).toHaveAccessibleDescription(texto);
    tirarOMouse(screen.getByText("Mostrar o percentual"));
    esperar(FOLGA_DA_DICA_MS);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    focarPeloTeclado(caixa);
    expect(dicaDe(caixa)).toHaveTextContent(texto);
    // Marcar a caixa com o clique não abre nem fixa a ajuda (só o "?" fixa).
    fireEvent.pointerDown(caixa, { pointerType: "mouse" });
    fireEvent.click(caixa);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(caixa).toBeChecked();
  });
});

describe("num diálogo", () => {
  it('o foco começa no primeiro campo, não no "?" do rótulo (que vem antes dele)', () => {
    render(
      <Dialogo aberto titulo="Editar célula" aoFechar={() => {}}>
        <Input
          rotulo="Nome da célula"
          ajuda="Como a célula aparece nos rankings."
        />
      </Dialogo>,
    );
    expect(screen.getByLabelText("Nome da célula")).toHaveFocus();
    expect(ajuda("Nome da célula")).toBeInTheDocument();
  });
});

describe("título da tela, números e colunas", () => {
  it('PageHeader, Stat e o cabeçalho da DataTable: o "?" com o nome do título, sem mudar o nome do título', () => {
    render(
      <>
        <PageHeader
          titulo="Campanha"
          ajuda="Onde a coordenação define as regras."
        />
        <Stat rotulo="Vendidos" valor="12" ajuda="Bilhetes pagos até agora." />
        <DataTable
          legenda="Células"
          colunas={[
            {
              chave: "meta",
              titulo: "Meta",
              ajuda: "Quantos bilhetes a célula deve vender.",
              celula: (linha: { meta: number }) => linha.meta,
            },
          ]}
          linhas={[{ meta: 10 }]}
          chaveDaLinha={(_linha, indice) => indice}
        />
      </>,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Campanha" }),
    ).toBeInTheDocument();
    expect(ajuda("Campanha")).toBeInTheDocument();
    expect(ajuda("Vendidos")).toBeInTheDocument();
    expect(ajuda("Meta")).toBeInTheDocument();
    tocar(ajuda("Meta"));
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Quantos bilhetes a célula deve vender.",
    );
  });

  it("sem o botão (o telão, sem controles): só o mouse no título abre", () => {
    render(
      <ComAjuda texto="O ranking desta semana." idDoTitulo="t" semBotao>
        <h2 id="t">Semana 1</h2>
      </ComAjuda>,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    passarOMouse(screen.getByRole("heading", { name: "Semana 1" }));
    esperar(ATRASO_DA_DICA_MS);
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "O ranking desta semana.",
    );
  });
});

describe("texto sob demanda (as telas que carregam com o site: o JS inicial não leva os textos)", () => {
  it("carrega o módulo uma vez só para todas as ajudas da tela; enquanto chega, 'Carregando…'; depois, o texto", async () => {
    vi.useRealTimers();
    let liberar: (modulo: { AJUDA: Record<string, string> }) => void = () => {};
    const carregar = vi.fn(
      () =>
        new Promise<{ AJUDA: Record<string, string> }>((resolver) => {
          liberar = resolver;
        }),
    );
    const sobDemanda = ajudasSobDemanda(carregar);
    expect(sobDemanda("a")).toBe(sobDemanda("a"));
    render(
      <>
        <Card titulo="Primeiro" ajuda={sobDemanda("a")}>
          <p>1</p>
        </Card>
        <Card titulo="Segundo" ajuda={sobDemanda("b")}>
          <p>2</p>
        </Card>
      </>,
    );
    expect(carregar).toHaveBeenCalledTimes(1);
    fireEvent.click(ajuda("Primeiro"));
    expect(screen.getByRole("tooltip")).toHaveTextContent(CARREGANDO_A_AJUDA);
    await act(async () => {
      liberar({ AJUDA: { a: "Texto do primeiro.", b: "Texto do segundo." } });
      await Promise.resolve();
    });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Texto do primeiro.");
    fireEvent.click(ajuda("Segundo"));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Texto do segundo.");
    expect(carregar).toHaveBeenCalledTimes(1);
  });

  it("se o pedaço não chega (sem conexão), diz isso e tenta de novo na próxima vez", async () => {
    vi.useRealTimers();
    const carregar = vi
      .fn<() => Promise<{ AJUDA: Record<string, string> }>>()
      .mockRejectedValueOnce(new Error("sem conexão"))
      .mockResolvedValueOnce({ AJUDA: { a: "Chegou." } });
    const sobDemanda = ajudasSobDemanda(carregar);
    const { unmount } = render(
      <Card titulo="Primeiro" ajuda={sobDemanda("a")}>
        <p>1</p>
      </Card>,
    );
    await act(async () => {});
    fireEvent.click(ajuda("Primeiro"));
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Explicação indisponível agora.",
    );
    unmount();
    render(
      <Card titulo="Primeiro" ajuda={sobDemanda("a")}>
        <p>1</p>
      </Card>,
    );
    await act(async () => {});
    fireEvent.click(ajuda("Primeiro"));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Chegou.");
    expect(carregar).toHaveBeenCalledTimes(2);
  });
});

describe("a posição: sempre dentro da tela a 390 px, mesmo com o título colado na borda", () => {
  it("campo no topo da tela, sem lugar acima do rótulo: a explicação vai para baixo do campo inteiro (não cobre o que se digita), apontando para o rótulo", () => {
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(
      390,
    );
    vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(
      844,
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const caixa = this.matches("[role='tooltip']")
          ? { left: 0, top: 0, width: 288, height: 90 }
          : this.matches("[data-ajuda-ancora]")
            ? { left: 16, top: 10, width: 80, height: 24 }
            : { left: 16, top: 10, width: 358, height: 90 };
        return {
          ...caixa,
          right: caixa.left + caixa.width,
          bottom: caixa.top + caixa.height,
          x: caixa.left,
          y: caixa.top,
          toJSON: () => caixa,
        } as DOMRect;
      },
    );
    render(<Input rotulo="Dias" ajuda="Quantos dias esta etapa dura." />);
    tocar(ajuda("Dias"));
    const aberta = screen.getByRole("tooltip");
    expect(aberta).toHaveAttribute("data-lado", "abaixo");
    // Abaixo do campo inteiro (10 + 90) e não logo abaixo do rótulo (10 + 24).
    expect(Number.parseInt(aberta.style.top, 10)).toBe(10 + 90 + 8);
    // A seta aponta para o meio do rótulo (16 + 40 = 56 px da borda), não do campo.
    expect(Number.parseInt(aberta.style.left, 10)).toBe(8);
    expect(aberta.style.getPropertyValue("--dica-seta")).toBe("48px");
  });

  it("o grupo do título na borda direita: a explicação começa e termina dentro da tela (8 px de margem)", () => {
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(
      390,
    );
    vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(
      844,
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const caixa = this.matches("[role='tooltip']")
          ? { left: 0, top: 0, width: 288, height: 90 }
          : { left: 250, top: 300, width: 132, height: 28 };
        return {
          ...caixa,
          right: caixa.left + caixa.width,
          bottom: caixa.top + caixa.height,
          x: caixa.left,
          y: caixa.top,
          toJSON: () => caixa,
        } as DOMRect;
      },
    );
    render(
      <Card titulo="Períodos" ajuda={PERIODOS}>
        <p>Conteúdo</p>
      </Card>,
    );
    tocar(ajuda("Períodos"));
    const aberta = screen.getByRole("tooltip");
    const esquerda = Number.parseInt(aberta.style.left, 10);
    expect(esquerda).toBeGreaterThanOrEqual(8);
    expect(esquerda + 288).toBeLessThanOrEqual(390 - 8);
    expect(aberta).toHaveAttribute("data-lado", "acima");
  });
});
