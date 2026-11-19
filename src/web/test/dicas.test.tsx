// RIFA-045 (revisão): a varredura `controlesSemDica()` pega de verdade o que ficou sem dica (a fase 2 depende dela):
// botão sem envoltório, envoltório com texto vazio, caixa de marcar sem o id da dica na descrição, link do menu,
// campo, dica que não some; e confere só o diálogo quando há um aberto. RIFA-066: a varredura das ajudas
// (`titulosSemAjuda()`) pega o título de seção, o subtítulo, o rótulo de campo e de número sem explicação.
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Button,
  Card,
  ComAjuda,
  ComDica,
  Dialogo,
  Input,
  PageHeader,
  Stat,
  ajudasSobDemanda,
} from "../components/ui";
import {
  contarAjudas,
  contarControles,
  controlesSemDica,
  titulosSemAjuda,
} from "./dicas";

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

describe("titulosSemAjuda() (RIFA-066)", () => {
  it("devolve cada título e rótulo sem explicação; o com ajuda passa; diálogo, só-leitor e data-sem-ajuda ficam de fora", async () => {
    render(
      <>
        <PageHeader titulo="Campanha" ajuda="Onde se definem as regras." />
        <Card titulo="Com ajuda" ajuda="Explica a seção.">
          <h3>Períodos</h3>
          <Input rotulo="Nome" ajuda="Como a campanha se chama." />
          <Input rotulo="Dias" />
          <Stat rotulo="Vendidos" valor="12" />
          <h3 data-sem-ajuda="nome da célula">Célula Betel</h3>
          <h2 className="visualmente-oculto">Resumo</h2>
        </Card>
        <Card titulo="Sem ajuda">
          <p>Nada</p>
        </Card>
      </>,
    );
    expect(contarAjudas()).toBe(7);
    expect(await titulosSemAjuda()).toEqual([
      'h3 "Períodos": sem ajuda',
      'label "Dias": sem ajuda',
      'p "Vendidos": sem ajuda',
      'h2 "Sem ajuda": sem ajuda',
    ]);
  });

  it("explicação sob demanda que ainda não chegou: espera chegar (e confere o texto, não o 'Carregando…')", async () => {
    const ajuda = ajudasSobDemanda(() =>
      Promise.resolve({ AJUDA: { secao: "Chegou depois." } }),
    );
    render(
      <Card titulo="Seção" ajuda={ajuda("secao")}>
        <p>Nada</p>
      </Card>,
    );
    expect(await titulosSemAjuda()).toEqual([]);
  });

  it('sem o "?" (só o mouse) falha, menos com semBotao (o telão); explicação que não some também falha', async () => {
    render(
      <>
        <ComAjuda texto="Só no mouse." idDoTitulo="so-mouse" semBotao>
          <h2 id="so-mouse">Ranking</h2>
        </ComAjuda>
        <div data-ajuda="fixa">
          <h2>Fixa</h2>
        </div>
        <div id="fixa" role="tooltip">
          Sempre aqui.
        </div>
      </>,
    );
    expect(await titulosSemAjuda()).toEqual([
      'h2 "Ranking": sem o "?" ao lado',
      'h2 "Fixa": a explicação não sumiu',
      'h2 "Fixa": sem o "?" ao lado',
    ]);
    expect(await titulosSemAjuda(document.body, { semBotao: true })).toEqual([
      'h2 "Fixa": a explicação não sumiu',
    ]);
  });

  it("com um diálogo aberto: confere os rótulos dele, não o título (o diálogo tem descrição)", async () => {
    render(
      <>
        <Card titulo="Fora">
          <p>Nada</p>
        </Card>
        <Dialogo aberto titulo="Desconsiderar" aoFechar={() => {}}>
          <Input rotulo="Motivo" />
          <Button>Ok</Button>
        </Dialogo>
      </>,
    );
    expect(await titulosSemAjuda()).toEqual(['label "Motivo": sem ajuda']);
  });
});
