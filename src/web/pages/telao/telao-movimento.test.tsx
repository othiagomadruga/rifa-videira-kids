// RIFA-020 no telão (/telao), pela rota de verdade, com a API simulada em rodadas. CA5: o topo tem o lugar da fase
// e da linha "Atualizado às" desde o carregando (nada empurra nada quando os dados chegam). CA4: com
// prefers-reduced-motion nada anima; com movimento, os itens entram em sequência quando os dados chegam e uma
// atualização sem mudança não mexe em nada (no telão, o movimento só acontece quando os dados mudam).
import { act, screen, within } from "@testing-library/react";
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

const ITENS: Record<Divisao, [number, string, number][]> = {
  jovens: [
    [1, "Célula Ágape", 12000],
    [2, "Célula Betel", 9500],
  ],
  adultos: [[1, "Célula Dorcas", 7000]],
};

/** A API do ranking aberto; `segurar` deixa a primeira resposta esperando (para ver o carregando). */
function simularApi({ segurar = false } = {}) {
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
          itens: ITENS[divisao].map(([posicao, nome, bp]) => ({
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

    expect(animate).toHaveBeenCalledTimes(3);
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
