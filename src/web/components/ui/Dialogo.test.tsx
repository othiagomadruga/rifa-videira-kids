import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode, useRef, useState, type ComponentProps } from "react";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { Button, Dialogo } from ".";

type PropsDialogo = ComponentProps<typeof Dialogo>;

// Página mínima: um botão abre o diálogo; Esc, × e Cancelar fecham.
function Exemplo(props: Partial<PropsDialogo>) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setAberto(true)}>
        Abrir
      </button>
      <Dialogo
        aberto={aberto}
        titulo="Editar célula"
        descricao="Célula Exemplo 01"
        aoFechar={() => setAberto(false)}
        rodape={
          <>
            <Button variante="secundario" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button type="submit">Salvar</Button>
          </>
        }
        {...props}
      >
        <label>
          Nome
          <input />
        </label>
      </Dialogo>
    </>
  );
}

function abrir() {
  const botao = screen.getByRole("button", { name: "Abrir" });
  act(() => botao.focus());
  fireEvent.click(botao);
  return { botao, dialogo: screen.getByRole("dialog") };
}

describe("Dialogo", () => {
  it("fechado não renderiza nada; aberto é um diálogo modal com nome e descrição, num portal no <body>", () => {
    render(<Exemplo />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const { dialogo } = abrir();

    expect(dialogo).toHaveAccessibleName("Editar célula");
    expect(dialogo).toHaveAccessibleDescription("Célula Exemplo 01");
    expect(dialogo).toHaveAttribute("aria-modal", "true");
    expect(
      within(dialogo).getByRole("heading", { level: 2, name: "Editar célula" }),
    ).toBeInTheDocument();
    expect(dialogo.parentElement?.parentElement).toBe(document.body);
  });

  it("ao abrir, o foco vai para o primeiro campo do corpo (ou para focoInicial)", () => {
    const { unmount } = render(<Exemplo />);
    abrir();
    expect(screen.getByRole("textbox", { name: "Nome" })).toHaveFocus();
    unmount();

    function ComFocoInicial() {
      const ref = useRef<HTMLButtonElement>(null);
      return (
        <Dialogo
          aberto
          titulo="Excluir?"
          aoFechar={() => {}}
          focoInicial={ref}
          rodape={
            <>
              <Button>Excluir</Button>
              <Button ref={ref}>Cancelar</Button>
            </>
          }
        />
      );
    }
    render(<ComFocoInicial />);
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
  });

  it("sem nada focável no corpo, o foco vai para o primeiro botão do rodapé", () => {
    render(
      <Dialogo
        aberto
        papel="alertdialog"
        titulo="Excluir a rede?"
        aoFechar={() => {}}
        rodape={
          <>
            <Button>Cancelar</Button>
            <Button variante="perigo">Excluir</Button>
          </>
        }
      >
        <p>Isso não pode ser desfeito.</p>
      </Dialogo>,
    );
    expect(
      screen.getByRole("alertdialog", { name: "Excluir a rede?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
  });

  it("prende o foco: Tab no último volta ao primeiro e Shift+Tab no primeiro vai ao último", () => {
    render(<Exemplo />);
    const { dialogo } = abrir();
    const fechar = within(dialogo).getByRole("button", { name: "Fechar" });
    // O × é o Icone (RIFA-049): só visual, o nome do botão continua "Fechar".
    expect(fechar.querySelector("svg")).toHaveAttribute("data-icone", "fechar");
    expect(fechar.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    const nome = within(dialogo).getByRole("textbox", { name: "Nome" });
    const salvar = within(dialogo).getByRole("button", { name: "Salvar" });

    // No meio, o Tab segue o navegador (o diálogo não interfere).
    expect(fireEvent.keyDown(nome, { key: "Tab" })).toBe(true);
    expect(nome).toHaveFocus();

    act(() => salvar.focus());
    expect(fireEvent.keyDown(salvar, { key: "Tab" })).toBe(false);
    expect(fechar).toHaveFocus();

    expect(fireEvent.keyDown(fechar, { key: "Tab", shiftKey: true })).toBe(
      false,
    );
    expect(salvar).toHaveFocus();
  });

  it("Esc e o botão × pedem para fechar; ao fechar, o foco volta para quem abriu", () => {
    render(<Exemplo />);
    let { botao, dialogo } = abrir();

    fireEvent.keyDown(within(dialogo).getByRole("textbox"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(botao).toHaveFocus();

    ({ botao, dialogo } = abrir());
    fireEvent.click(within(dialogo).getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(botao).toHaveFocus();
  });

  it("quem usa decide se fecha (aoFechar pode ignorar o pedido)", () => {
    const aoFechar = vi.fn();
    render(
      <Dialogo aberto titulo="Salvando" aoFechar={aoFechar}>
        <input aria-label="Campo" />
      </Dialogo>,
    );

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });

    expect(aoFechar).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("deixa o resto da página inert e sem rolagem enquanto aberto, e desfaz ao fechar", () => {
    const jaInerte = document.createElement("div");
    jaInerte.setAttribute("inert", "");
    document.body.append(jaInerte);
    const { container } = render(<Exemplo />);

    abrir();
    expect(container).toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(container).not.toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("");
    // O que já estava inert antes continua.
    expect(jaInerte).toHaveAttribute("inert");
    jaInerte.remove();
  });

  it("focoAoFechar leva o foco para outro elemento ao fechar", () => {
    function ComDestino() {
      const [aberto, setAberto] = useState(true);
      const destino = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={destino} type="button">
            Destino
          </button>
          <Dialogo
            aberto={aberto}
            titulo="Excluir?"
            aoFechar={() => setAberto(false)}
            focoAoFechar={destino}
          >
            <button type="button">Dentro</button>
          </Dialogo>
        </>
      );
    }
    render(<ComDestino />);

    fireEvent.keyDown(screen.getByRole("button", { name: "Dentro" }), {
      key: "Escape",
    });

    expect(screen.getByRole("button", { name: "Destino" })).toHaveFocus();
  });

  it("com aoEnviar, o botão submit do rodapé envia o formulário sem recarregar a página", () => {
    const aoEnviar = vi.fn((evento: { defaultPrevented: boolean }) =>
      expect(evento.defaultPrevented).toBe(true),
    );
    render(<Exemplo aoEnviar={aoEnviar} />);
    const { dialogo } = abrir();

    fireEvent.click(within(dialogo).getByRole("button", { name: "Salvar" }));

    expect(aoEnviar).toHaveBeenCalledOnce();
    expect(
      within(dialogo).getByRole("textbox").closest("form"),
    ).toHaveAttribute("novalidate");
  });

  it("clicar no véu (fora do painel) não tira o foco do diálogo nem fecha", () => {
    render(<Exemplo />);
    const { dialogo } = abrir();
    const veu = dialogo.parentElement as HTMLElement;

    expect(fireEvent.mouseDown(veu)).toBe(false);
    expect(fireEvent.mouseDown(within(dialogo).getByRole("textbox"))).toBe(
      true,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Esc num diálogo aberto por cima fecha só ele", () => {
    const fecharDeBaixo = vi.fn();
    function Empilhados() {
      const [deCima, setDeCima] = useState(true);
      return (
        <Dialogo aberto titulo="De baixo" aoFechar={fecharDeBaixo}>
          <button type="button">Botão de baixo</button>
          <Dialogo
            aberto={deCima}
            titulo="De cima"
            aoFechar={() => setDeCima(false)}
          >
            <button type="button">Botão de cima</button>
          </Dialogo>
        </Dialogo>
      );
    }
    render(<Empilhados />);
    const deBaixo = screen.getByRole("dialog", { name: "De baixo" });
    expect(deBaixo.parentElement).toHaveAttribute("inert");

    fireEvent.keyDown(screen.getByRole("button", { name: "Botão de cima" }), {
      key: "Escape",
    });

    expect(
      screen.queryByRole("dialog", { name: "De cima" }),
    ).not.toBeInTheDocument();
    expect(fecharDeBaixo).not.toHaveBeenCalled();
    expect(deBaixo.parentElement).not.toHaveAttribute("inert");
  });

  // O React desmonta o de baixo antes do de cima quando os dois saem juntos (ex.: a tela muda com a
  // confirmação aberta) e monta o de cima antes do de baixo quando os dois entram juntos.
  describe("empilhados: a rolagem só volta quando o último fecha, em qualquer ordem", () => {
    function Empilhados({ juntos }: { juntos: boolean }) {
      const [deCima, setDeCima] = useState(juntos);
      return (
        <Dialogo aberto titulo="De baixo" aoFechar={() => {}}>
          <button type="button" onClick={() => setDeCima(true)}>
            Abrir o de cima
          </button>
          <Dialogo
            aberto={deCima}
            titulo="De cima"
            aoFechar={() => setDeCima(false)}
          >
            <button type="button">Botão de cima</button>
          </Dialogo>
        </Dialogo>
      );
    }

    it("abertos um depois do outro e desmontados juntos, a página volta a rolar", () => {
      document.body.style.overflow = "auto";
      onTestFinished(() => {
        document.body.style.overflow = "";
      });
      const { unmount } = render(<Empilhados juntos={false} />);
      fireEvent.click(screen.getByRole("button", { name: "Abrir o de cima" }));
      expect(
        screen.getByRole("dialog", { name: "De cima" }),
      ).toBeInTheDocument();
      expect(document.body.style.overflow).toBe("hidden");

      unmount();

      expect(document.body.style.overflow).toBe("auto");
    });

    it("abertos juntos, fechar o de cima não solta a rolagem do de baixo", () => {
      const { unmount } = render(<Empilhados juntos />);

      fireEvent.keyDown(screen.getByRole("button", { name: "Botão de cima" }), {
        key: "Escape",
      });

      expect(
        screen.getByRole("dialog", { name: "De baixo" }),
      ).toBeInTheDocument();
      expect(document.body.style.overflow).toBe("hidden");
      unmount();
      expect(document.body.style.overflow).toBe("");
    });

    it("no StrictMode (efeito duplo) e com estilo de antes no body: a trava compensa a barra e devolve o estilo uma vez só", () => {
      document.body.style.overflow = "auto";
      document.body.style.paddingRight = "4px";
      // O jsdom não faz layout: uma barra de rolagem de 15 px.
      Object.defineProperty(document.documentElement, "clientWidth", {
        configurable: true,
        value: window.innerWidth - 15,
      });
      onTestFinished(() => {
        Reflect.deleteProperty(document.documentElement, "clientWidth");
        document.body.style.overflow = "";
        document.body.style.paddingRight = "";
      });
      const { unmount } = render(
        <StrictMode>
          <Empilhados juntos />
        </StrictMode>,
      );
      expect(document.body.style.overflow).toBe("hidden");
      expect(document.body.style.paddingRight).toBe("15px");

      fireEvent.keyDown(screen.getByRole("button", { name: "Botão de cima" }), {
        key: "Escape",
      });
      expect(document.body.style.overflow).toBe("hidden");
      expect(document.body.style.paddingRight).toBe("15px");

      fireEvent.click(screen.getByRole("button", { name: "Abrir o de cima" }));
      expect(
        screen.getByRole("dialog", { name: "De cima" }),
      ).toBeInTheDocument();
      unmount();

      expect(document.body.style.overflow).toBe("auto");
      expect(document.body.style.paddingRight).toBe("4px");
    });
  });
});
