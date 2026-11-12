// RIFA-045 (revisão): a varredura `controlesSemDica()` pega de verdade o que ficou sem dica (a fase 2 depende dela):
// botão sem envoltório, envoltório com texto vazio, caixa de marcar sem o id da dica na descrição, link do menu,
// campo, dica que não some; e confere só o diálogo quando há um aberto.
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button, ComDica, Dialogo, Input } from "../components/ui";
import { contarControles, controlesSemDica } from "./dicas";

afterEach(() => {
  vi.useRealTimers();
});

describe("controlesSemDica()", () => {
  it("devolve cada controle sem dica (e o que tem dica passa); o que está em painel oculto fica de fora", () => {
    render(
      <>
        <ComDica texto="Grava as mudanças.">
          <Button>Com dica</Button>
        </ComDica>
        <Button>Sem dica</Button>
        <ComDica texto="">
          <Button>Texto vazio</Button>
        </ComDica>
        <ComDica id="caixa-dica" texto="Marcada, o telão mostra o percentual.">
          <label htmlFor="caixa">
            <input id="caixa" type="checkbox" />
            <span>Caixa sem descrição</span>
          </label>
        </ComDica>
        <nav aria-label="Menu">
          <a href="/coordenacao">Link solto</a>
        </nav>
        <Input rotulo="Campo solto" />
        <div hidden>
          <Button>Oculto</Button>
        </div>
      </>,
    );
    expect(contarControles()).toBe(6);
    expect(controlesSemDica()).toEqual([
      'button "Sem dica": sem dica',
      'button "Texto vazio": sem dica',
      'input checkbox "Caixa sem descrição": sem dica',
      'a "Link solto": sem dica',
      'input text "Campo solto": sem dica',
    ]);
  });

  it("dica que não some ao tirar o mouse também falha", () => {
    render(
      <>
        <button type="button" aria-describedby="fixa">
          Fixa
        </button>
        <div id="fixa" role="tooltip">
          Sempre aqui.
        </div>
      </>,
    );
    expect(controlesSemDica()).toEqual(['button "Fixa": a dica não sumiu']);
  });

  it("com um diálogo aberto, confere só o diálogo (o resto fica inert)", () => {
    render(
      <>
        <Button>Fora do diálogo</Button>
        <Dialogo aberto titulo="Confirmar" aoFechar={() => {}}>
          <Button>Cancelar</Button>
        </Dialogo>
      </>,
    );
    // O × do diálogo já tem dica; o "Cancelar" não.
    expect(contarControles()).toBe(2);
    expect(controlesSemDica()).toEqual(['button "Cancelar": sem dica']);
  });

  it("num teste com o relógio falso, a varredura usa o dele e o deixa ligado", () => {
    vi.useFakeTimers();
    render(
      <ComDica texto="Grava as mudanças.">
        <Button>Salvar</Button>
      </ComDica>,
    );
    expect(controlesSemDica()).toEqual([]);
    expect(vi.isFakeTimers()).toBe(true);
  });
});
