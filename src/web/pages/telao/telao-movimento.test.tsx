// RIFA-020 no telão (/telao), pela rota de verdade, com a API simulada em rodadas. CA5: o topo tem o lugar da fase
// e da linha "Atualizado às" desde o carregando (nada empurra nada quando os dados chegam). CA4: com
// prefers-reduced-motion nada anima; com movimento, os itens entram em sequência quando os dados chegam e uma
// atualização sem mudança não mexe em nada (no telão, o movimento só acontece quando os dados mudam).
// RIFA-050: P2.4, a comemoração (pulso e partículas) só quando uma célula passa a bater a meta numa atualização
// (abrir a página com células batidas só pulsa); P2.3, o "↑ subiu" de quem subiu até a próxima mudança de ordem.
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { respostaRankingPublicoSchema } from "../../../shared/contracts/api";
import type {
  Divisao,
  ReferenciaCampanha,
} from "../../../shared/contracts/calculos";
import {
  controlarQuadros,
  desfazerMovimento,
  espiarAnimate,
  simularPreferencia,
} from "../../test/movimento";
import { renderizarRota, respostaJson } from "../../test/renderizar";
import { DURACAO_CONTAGEM_MS } from "../../lib/movimento";
import { ATRASO_PULSO_MS } from "../../lib/usePulsoDaMeta";
import { INTERVALO_ATUALIZACAO_MS } from "../ranking-publico/useRankingPublico";

const DURANTE: ReferenciaCampanha = {
  data: "2026-12-04",
  fase: "durante",
  data_inicio: "2026-11-23",
  data_fim: "2026-12-16",
  duracao_dias: 24,
  dia_campanha: 12,
  dias_restantes: 13,
  dias_para_inicio: null,
  periodo: null,
};

type Rodada = Record<Divisao, [number, string, number][]>;

const ITENS: Rodada = {
  jovens: [
    [1, "Célula Ágape", 12000],
    [2, "Célula Betel", 9500],
  ],
  adultos: [[1, "Célula Dorcas", 7000]],
};

/** Betel (95%) passa Ágape e bate a meta (115%); nos adultos, nada muda. */
const BETEL_PASSA: Rodada = {
  ...ITENS,
  jovens: [
    [1, "Célula Betel", 11500],
    [2, "Célula Ágape", 12000],
  ],
};

/** Só o % de Ágape sobe: ninguém troca de lugar. */
const SO_O_PERCENTUAL: Rodada = {
  ...BETEL_PASSA,
  jovens: [
    [1, "Célula Betel", 11500],
    [2, "Célula Ágape", 12100],
  ],
};

/** Ágape volta ao 1º lugar. */
const AGAPE_VOLTA: Rodada = {
  ...ITENS,
  jovens: [
    [1, "Célula Ágape", 12500],
    [2, "Célula Betel", 11500],
  ],
};

/**
 * A API do ranking aberto, em rodadas (cada atualização pede jovens e adultos: a rodada avança a cada par); `segurar`
 * deixa a primeira resposta esperando (para ver o carregando).
 */
function simularApi({
  segurar = false,
  rodadas = [ITENS],
}: { segurar?: boolean; rodadas?: Rodada[] } = {}) {
  let pedidos = 0;
  let soltar: () => void = () => {};
  const espera = new Promise<void>((resolver) => {
    soltar = resolver;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL) => {
      if (segurar) await espera;
      const divisao = new URL(
        String(entrada),
        "http://localhost",
      ).searchParams.get("divisao") as Divisao;
      const rodada = rodadas[Math.min(pedidos++ >> 1, rodadas.length - 1)];
      return respostaJson(
        respostaRankingPublicoSchema.parse({
          nivel: "celula",
          divisao,
          janela: {
            tipo: "atual",
            ordem: 2,
            nome: "Semana 2",
            data_inicio: "2026-12-03",
            data_fim: "2026-12-09",
          },
          criterio: "percentual_meta",
          referencia: DURANTE,
          itens: rodada[divisao].map(([posicao, nome, bp]) => ({
            posicao,
            nome,
            divisao,
            percentual_meta_bp: bp,
          })),
          atualizado_em: "2026-12-04T18:30:00.000Z",
        }),
      );
    }),
  );
  return { soltar };
}

/** Volta para a aba: o telão se atualiza na hora (mesmos dados). */
async function atualizar() {
  for (const estado of ["hidden", "visible"] as const) {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => estado,
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  }
  await act(() => new Promise((resolver) => setTimeout(resolver, 0)));
  await act(() => new Promise((resolver) => setTimeout(resolver, 0)));
}

afterEach(() => {
  desfazerMovimento();
  Reflect.deleteProperty(document, "visibilityState");
});

describe("CA5: o topo do telão não muda de tamanho quando os dados chegam", () => {
  it("o lugar da fase e o da linha da atualização existem desde o carregando", async () => {
    const api = simularApi({ segurar: true });
    renderizarRota("/telao");
    expect(screen.getByText("Carregando o ranking…")).toBeInTheDocument();

    // No carregando: vazios, mas no lugar (o relógio já fica na coluna da direita, ao lado do selo do Kids).
    const topo = document.querySelector(".telao__topo");
    expect([...(topo?.children ?? [])].map((filho) => filho.className)).toEqual(
      ["telao__marca", "telao__fase", "telao__hora"],
    );
    expect(document.querySelector(".telao__fase")).toBeEmptyDOMElement();
    expect(document.querySelector(".telao__atualizado")).toBeEmptyDOMElement();

    api.soltar();
    await screen.findByText(/^Atualizado às 15:30$/);
    expect(document.querySelector(".telao__fase")).toHaveTextContent(
      "Dia 12 de 24Faltam 13 dias",
    );
  });
});

describe("1º lugar e meta batida no telão", () => {
  it("marcam o item; o texto continua o mesmo", async () => {
    simularApi();
    renderizarRota("/telao");
    await screen.findByText(/^Atualizado às 15:30$/);
    const itens = within(
      screen.getByRole("region", { name: "Jovens" }),
    ).getAllByRole("listitem");
    expect(itens.map((item) => item.textContent)).toEqual([
      "1º Célula Ágape 120% da meta",
      "2º Célula Betel 95% da meta",
    ]);
    expect(itens.map((item) => item.hasAttribute("data-primeiro"))).toEqual([
      true,
      false,
    ]);
    expect(itens.map((item) => item.hasAttribute("data-meta-batida"))).toEqual([
      true,
      false,
    ]);
  });
});

describe("CA4: movimento no telão", () => {
  it("com prefers-reduced-motion: reduce, nada anima e o % já aparece final", async () => {
    simularPreferencia(true);
    const animate = espiarAnimate();
    const quadros = controlarQuadros();
    simularApi();
    renderizarRota("/telao");
    await screen.findByText(/^Atualizado às 15:30$/);
    await atualizar();

    expect(animate).not.toHaveBeenCalled();
    expect(quadros.pendentes()).toBe(0);
    expect(document.querySelector(".mov-contagem")).toBeNull();
    expect(screen.getByText("120%")).toBeInTheDocument();
  });

  it("com movimento: os itens entram quando os dados chegam; a atualização sem mudança não mexe em nada", async () => {
    simularPreferencia(false);
    const animate = espiarAnimate();
    const quadros = controlarQuadros();
    simularApi();
    renderizarRota("/telao");
    await screen.findByText(/^Atualizado às 15:30$/);

    // Os 3 itens entram e a pílula de Ágape (120%, já batida) pulsa, sem partículas (abrir a página não comemora).
    const animados = animate.mock.contexts.map(
      (elemento) => (elemento as Element).classList,
    );
    expect(
      animados.filter((nome) => nome.contains("telao__item")),
    ).toHaveLength(3);
    expect(
      animados.filter((nome) => nome.contains("telao__percentual")),
    ).toHaveLength(1);
    expect(document.querySelector(".mov-confete")).toBeNull();
    // Cada contagem pede o primeiro quadro num efeito, que pode rodar um instante depois do findBy.
    await waitFor(() => expect(quadros.pendentes()).toBe(3));
    act(() => quadros.quadro(0));
    act(() => quadros.quadro(1000));
    expect(document.querySelector(".mov-contagem")).toBeNull();
    animate.mockClear();

    await atualizar();
    expect(animate).not.toHaveBeenCalled();
    expect(document.querySelector(".mov-contagem")).toBeNull();
    expect(quadros.pendentes()).toBe(0);
  });
});

/** As chamadas do element.animate em elementos com a classe. */
const animadosCom = (
  animate: ReturnType<typeof espiarAnimate>,
  classe: string,
) =>
  animate.mock.contexts.filter((elemento) =>
    (elemento as Element).classList.contains(classe),
  );

/** A pílula do % de uma célula. */
const pilula = (nome: string) =>
  screen.getByText(nome).closest("li")?.querySelector(".telao__percentual");

describe("RIFA-050 (P2.4): comemoração da meta batida no telão", () => {
  it("abrir a página com células já batidas: só o pulso, nenhuma partícula", async () => {
    simularPreferencia(false);
    const animate = espiarAnimate();
    controlarQuadros();
    simularApi({ rodadas: [AGAPE_VOLTA] });
    renderizarRota("/telao");
    await screen.findByText(/^Atualizado às 15:30$/);

    // Ágape (125%) e Betel (115%) já chegam batidas: as duas pulsam, nada de confete.
    expect(animadosCom(animate, "telao__percentual")).toHaveLength(2);
    expect(animadosCom(animate, "mov-confete")).toHaveLength(0);
    expect(document.querySelector(".mov-comemoracao")).toBeNull();
  });

  it("quem passa a bater a meta numa atualização comemora uma vez (pulso e partículas na pílula); a atualização igual, não", async () => {
    simularPreferencia(false);
    const animate = espiarAnimate();
    controlarQuadros();
    simularApi({ rodadas: [ITENS, BETEL_PASSA, BETEL_PASSA] });
    renderizarRota("/telao");
    await screen.findByText(/^Atualizado às 15:30$/);
    animate.mockClear();

    await atualizar();
    // Betel passou de 95% para 115%: a pílula dela pulsa e solta as partículas (só visuais), dentro dela.
    const camada = pilula("Célula Betel")?.querySelector(".mov-comemoracao");
    expect(camada).toHaveAttribute("aria-hidden", "true");
    const particulas = camada?.querySelectorAll(".mov-confete") ?? [];
    expect(particulas.length).toBeGreaterThanOrEqual(10);
    expect(particulas.length).toBeLessThanOrEqual(14);
    expect(animadosCom(animate, "mov-confete")).toHaveLength(particulas.length);
    // RIFA-053: o confete chega com o 100% (e a pílula amarela): nenhuma partícula sai antes de o % terminar de contar;
    // a primeira sai junto com o pulso.
    const atrasos = animate.mock.calls
      .filter((_, indice) =>
        (animate.mock.contexts[indice] as Element).classList.contains(
          "mov-confete",
        ),
      )
      .map(([, opcoes]) => Number((opcoes as KeyframeAnimationOptions).delay));
    expect(Math.min(...atrasos)).toBe(ATRASO_PULSO_MS);
    expect(Math.min(...atrasos)).toBeGreaterThanOrEqual(DURACAO_CONTAGEM_MS);
    expect(
      animadosCom(animate, "telao__percentual").map(
        (elemento) =>
          (elemento as Element).closest("li")?.querySelector(".telao__nome")
            ?.textContent,
      ),
    ).toEqual(["Célula Betel"]);
    // Ágape já estava batida: só desliza, sem comemorar de novo.
    expect(pilula("Célula Ágape")?.querySelector(".mov-confete")).toBeNull();
    // A lista em volta corta as partículas na borda dela (telao.css: overflow: clip na .telao__lista).
    expect(pilula("Célula Betel")?.closest("ol")).toHaveClass("telao__lista");
    animate.mockClear();

    await atualizar();
    expect(animadosCom(animate, "mov-confete")).toHaveLength(0);
    expect(animadosCom(animate, "telao__percentual")).toHaveLength(0);
  });

  it("com prefers-reduced-motion: reduce, nada: nem pulso nem partícula no DOM", async () => {
    simularPreferencia(true);
    const animate = espiarAnimate();
    simularApi({ rodadas: [ITENS, BETEL_PASSA] });
    renderizarRota("/telao");
    await screen.findByText(/^Atualizado às 15:30$/);
    await atualizar();

    expect(screen.getByText("115%")).toBeInTheDocument();
    expect(animate).not.toHaveBeenCalled();
    expect(document.querySelector(".mov-comemoracao")).toBeNull();
  });
});

describe('RIFA-050 (P2.3): "↑ subiu" no telão', () => {
  const subiram = () =>
    [...document.querySelectorAll(".telao__subiu")].map(
      (chip) => chip.closest("li")?.querySelector(".telao__nome")?.textContent,
    );

  it("ao abrir, ninguém; quem sobe numa atualização ganha o chip (só visual, sem mudar o texto lido), que fica até a próxima mudança de ordem", async () => {
    simularApi({
      rodadas: [ITENS, ITENS, BETEL_PASSA, SO_O_PERCENTUAL, AGAPE_VOLTA],
    });
    renderizarRota("/telao");
    await screen.findByText(/^Atualizado às 15:30$/);
    expect(subiram()).toEqual([]);

    // Atualização igual: nada muda.
    await atualizar();
    expect(subiram()).toEqual([]);

    // Betel passa Ágape: só Betel subiu.
    await atualizar();
    expect(subiram()).toEqual(["Célula Betel"]);
    const chip = document.querySelector(".telao__subiu");
    expect(chip).toHaveAttribute("aria-hidden", "true");
    expect(chip).toHaveTextContent("subiu");
    expect(chip?.querySelector("svg")).toHaveAttribute("data-icone", "subiu");
    // O que a lista diz não muda: a posição já está no texto.
    const itens = within(
      screen.getByRole("region", { name: "Jovens" }),
    ).getAllByRole("listitem");
    const lido = itens[0].cloneNode(true) as Element;
    for (const visual of lido.querySelectorAll('[aria-hidden="true"]'))
      visual.remove();
    expect(lido.textContent).toBe("1º Célula Betel 115% da meta");

    // Só o % muda (ninguém troca de lugar): o chip fica (sem temporizador).
    await atualizar();
    expect(screen.getByText("121%")).toBeInTheDocument();
    expect(subiram()).toEqual(["Célula Betel"]);

    // Ágape volta ao 1º lugar: agora só ela subiu.
    await atualizar();
    expect(subiram()).toEqual(["Célula Ágape"]);
  });

  it("nenhum temporizador: o chip continua depois de muito tempo sem dado novo", async () => {
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    simularApi({ rodadas: [ITENS, BETEL_PASSA] });
    renderizarRota("/telao");
    await screen.findByText(/^Atualizado às 15:30$/);
    await atualizar();
    expect(subiram()).toEqual(["Célula Betel"]);

    // 59 s depois (antes da próxima atualização automática): o chip continua.
    await act(() => vi.advanceTimersByTimeAsync(59_000));
    expect(subiram()).toEqual(["Célula Betel"]);
    // E depois de 5 atualizações automáticas com os mesmos dados (5 min): continua (revisão: um temporizador mais
    // longo que o minuto também falha aqui).
    await act(() => vi.advanceTimersByTimeAsync(5 * INTERVALO_ATUALIZACAO_MS));
    expect(subiram()).toEqual(["Célula Betel"]);
    vi.useRealTimers();
  });
});
