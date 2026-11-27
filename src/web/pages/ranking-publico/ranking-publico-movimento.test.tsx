// CA4 (RIFA-020) no ranking público ("/"), renderizado pela rota de verdade, com a API simulada em rodadas (cada
// atualização pede jovens e adultos). Com movimento: os itens entram em sequência, uma atualização sem mudança não
// mexe em nada, e a que muda a ordem faz quem trocou de lugar deslizar (FLIP) e o % contar até o valor novo.
// Com prefers-reduced-motion: reduce, nada anima e o % já aparece final. O jsdom não faz layout: o lugar de cada
// item é simulado (60 px por linha). RIFA-050 (P2.4): a comemoração (pulso e partículas) só quando uma célula passa
// a bater a meta numa atualização; abrir a página com células batidas só pulsa.
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { respostaRankingPublicoSchema } from "../../../shared/contracts/api";
import type {
  Divisao,
  ReferenciaCampanha,
} from "../../../shared/contracts/calculos";
import { DURACAO_CONTAGEM_MS } from "../../lib/movimento";
import { ATRASO_PULSO_MS } from "../../lib/usePulsoDaMeta";
import {
  controlarQuadros,
  desfazerMovimento,
  espiarAnimate,
  simularPreferencia,
} from "../../test/movimento";
import { renderizarRota, respostaJson } from "../../test/renderizar";

const ALTURA_DA_LINHA = 60;

const DURANTE: ReferenciaCampanha = {
  data: "2026-12-04",
  fase: "durante",
  data_inicio: "2026-11-23",
  data_fim: "2026-12-16",
  duracao_dias: 24,
  dia_campanha: 12,
  dias_restantes: 13,
  dias_para_inicio: null,
  periodo: {
    ordem: 2,
    nome: "Semana 2",
    data_inicio: "2026-12-03",
    data_fim: "2026-12-09",
    dias: 7,
    dia_no_periodo: 2,
    dias_restantes: 6,
  },
};

type Linha = [posicao: number, nome: string, percentualBp: number];
type Rodada = Record<Divisao, Linha[]>;

const PRIMEIRA: Rodada = {
  jovens: [
    [1, "Célula Ágape", 11200],
    [2, "Célula Betel", 9600],
    [3, "Célula Canaã", 8100],
  ],
  adultos: [
    [1, "Célula Dorcas", 8800],
    [2, "Célula Éfeso", 7400],
  ],
};

/** Ágape e Betel já bateram a meta. */
const DUAS_BATIDAS: Rodada = {
  ...PRIMEIRA,
  jovens: [
    [1, "Célula Ágape", 11200],
    [2, "Célula Betel", 10500],
    [3, "Célula Canaã", 8100],
  ],
};

/** As duas que já tinham batido só trocam de lugar. */
const DUAS_BATIDAS_TROCAM: Rodada = {
  ...PRIMEIRA,
  jovens: [
    [1, "Célula Betel", 11800],
    [2, "Célula Ágape", 11400],
    [3, "Célula Canaã", 8100],
  ],
};

/** Betel passa Ágape; o resto fica igual. */
const BETEL_PASSA: Rodada = {
  ...PRIMEIRA,
  jovens: [
    [1, "Célula Betel", 11800],
    [2, "Célula Ágape", 11400],
    [3, "Célula Canaã", 8100],
  ],
};

let rodadas: Rodada[] = [];

function simularApi(...lista: Rodada[]) {
  rodadas = lista;
  let pedidos = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL) => {
      const url = new URL(String(entrada), "http://localhost");
      // RIFA-094 (D42): os avisos de venda (testes próprios em components/avisos-de-venda) ficam de fora: 404, sem
      // gastar uma rodada do ranking.
      if (url.pathname === "/api/publico/vendas-recentes")
        return respostaJson(
          { erro: { codigo: "nao_encontrado", mensagem: "Fora do teste" } },
          404,
        );
      const divisao = url.searchParams.get("divisao") as Divisao;
      // Cada atualização pede as duas divisões: a rodada avança a cada par.
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
}

/** Volta para a aba: o ranking se atualiza na hora (useRankingPublico). */
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
  // As duas respostas chegam e a tela renderiza.
  await act(() => new Promise((resolver) => setTimeout(resolver, 0)));
  await act(() => new Promise((resolver) => setTimeout(resolver, 0)));
}

/** O texto lido de cada item (sem o que é só visual: o "↑ subiu" e o número que conta por cima). */
const lista = (divisao: "Jovens" | "Adultos") =>
  within(screen.getByRole("region", { name: divisao }))
    .getAllByRole("listitem")
    .map((item) => {
      const copia = item.cloneNode(true) as Element;
      for (const visual of copia.querySelectorAll('[aria-hidden="true"]'))
        visual.remove();
      return copia.textContent;
    });

/** As chamadas do element.animate num tipo de elemento: o nome do item, os quadros e as opções. */
function chamadasEm(
  animate: ReturnType<typeof espiarAnimate>,
  eh: (elemento: Element) => boolean,
) {
  return animate.mock.contexts.flatMap((contexto, indice) => {
    const elemento = contexto as Element;
    if (!eh(elemento)) return [];
    return [
      {
        item: elemento.closest("li")?.querySelector(".ranking-publico__nome")
          ?.textContent,
        quadros: animate.mock.calls[indice][0] as unknown as Keyframe[],
        opcoes: animate.mock.calls[
          indice
        ][1] as unknown as KeyframeAnimationOptions,
      },
    ];
  });
}

/** Entrada e troca de lugar: as animações dos itens (<li>). */
const animacoes = (animate: ReturnType<typeof espiarAnimate>) =>
  chamadasEm(animate, (elemento) => elemento.tagName === "LI");

/** O pulso da meta batida: as animações da pílula do %. */
const pulsos = (animate: ReturnType<typeof espiarAnimate>) =>
  chamadasEm(animate, (elemento) =>
    elemento.classList.contains("ranking-publico__percentual"),
  );

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetTop", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.tagName !== "LI" || !this.parentElement) return 0;
      return [...this.parentElement.children].indexOf(this) * ALTURA_DA_LINHA;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get(this: HTMLElement) {
      return this.parentElement;
    },
  });
});

afterEach(() => {
  desfazerMovimento();
  Reflect.deleteProperty(document, "visibilityState");
  for (const propriedade of ["offsetTop", "offsetParent"])
    Reflect.deleteProperty(HTMLElement.prototype, propriedade);
});

describe("CA4: ranking público com prefers-reduced-motion: reduce", () => {
  it("nada anima (entrada, troca de posição e %): tudo aparece pronto, na hora", async () => {
    simularPreferencia(true);
    const animate = espiarAnimate();
    const quadros = controlarQuadros();
    simularApi(PRIMEIRA, BETEL_PASSA);
    renderizarRota("/");
    await screen.findByText(/^Atualizado às/);

    expect(lista("Jovens")).toEqual([
      "1º Célula Ágape 112% da meta",
      "2º Célula Betel 96% da meta",
      "3º Célula Canaã 81% da meta",
    ]);
    await atualizar();
    expect(lista("Jovens")).toEqual([
      "1º Célula Betel 118% da meta",
      "2º Célula Ágape 114% da meta",
      "3º Célula Canaã 81% da meta",
    ]);
    expect(animate).not.toHaveBeenCalled();
    expect(quadros.pendentes()).toBe(0);
    expect(document.querySelector(".mov-contagem")).toBeNull();
  });
});

describe("CA4: ranking público com movimento", () => {
  beforeEach(() => {
    simularPreferencia(false);
  });

  it("o ranking chega: os itens de cada divisão entram em sequência e o % conta até o valor", async () => {
    const animate = espiarAnimate();
    const quadros = controlarQuadros();
    simularApi(PRIMEIRA);
    renderizarRota("/");
    await screen.findByText(/^Atualizado às/);

    const entradas = animacoes(animate);
    expect(entradas.map(({ item }) => item)).toEqual([
      "Célula Ágape",
      "Célula Betel",
      "Célula Canaã",
      "Célula Dorcas",
      "Célula Éfeso",
    ]);
    // A sequência recomeça em cada divisão (as duas listas aparecem juntas).
    expect(entradas.map(({ opcoes }) => opcoes.delay)).toEqual([
      0, 45, 90, 0, 45,
    ]);
    for (const { quadros: passos } of entradas)
      expect(passos[0]).toMatchObject({ opacity: 0 });

    // O % conta: o texto final fica no lugar (para o leitor de tela) e o que conta vai por cima.
    const contando = document.querySelectorAll(".mov-contagem__quadro");
    expect(contando).toHaveLength(5);
    for (const quadro of contando)
      expect(quadro).toHaveAttribute("aria-hidden", "true");
    // Cada contagem pede o primeiro quadro num efeito, que pode rodar um instante depois do findBy.
    await waitFor(() => expect(quadros.pendentes()).toBe(5));
    act(() => quadros.quadro(0));
    act(() => quadros.quadro(DURACAO_CONTAGEM_MS));
    expect(document.querySelector(".mov-contagem")).toBeNull();
    expect(lista("Jovens")).toEqual([
      "1º Célula Ágape 112% da meta",
      "2º Célula Betel 96% da meta",
      "3º Célula Canaã 81% da meta",
    ]);
  });

  it("uma atualização sem mudança não mexe em nada; a que muda a ordem desliza só quem trocou de lugar", async () => {
    const animate = espiarAnimate();
    const quadros = controlarQuadros();
    simularApi(PRIMEIRA, PRIMEIRA, BETEL_PASSA);
    renderizarRota("/");
    await screen.findByText(/^Atualizado às/);
    await waitFor(() => expect(quadros.pendentes()).toBe(5));
    act(() => quadros.quadro(0));
    act(() => quadros.quadro(DURACAO_CONTAGEM_MS));
    animate.mockClear();

    await atualizar();
    expect(animate).not.toHaveBeenCalled();
    expect(document.querySelector(".mov-contagem")).toBeNull();

    await atualizar();
    expect(
      animacoes(animate).map(({ item, quadros: passos }) => [item, passos[0]]),
    ).toEqual([
      [
        "Célula Betel",
        { transform: `translate(0px, ${ALTURA_DA_LINHA}px)`, zIndex: "1" },
      ],
      ["Célula Ágape", { transform: `translate(0px, ${-ALTURA_DA_LINHA}px)` }],
    ]);
    // Os % que mudaram contam do valor antigo até o novo; o de Canaã (igual) fica parado.
    const contando = [...document.querySelectorAll(".mov-contagem__final")].map(
      (final) => final.textContent,
    );
    expect(contando).toEqual(["118%", "114%"]);
    act(() => quadros.quadro(10_000));
    act(() => quadros.quadro(10_000 + DURACAO_CONTAGEM_MS));
    expect(lista("Jovens")).toEqual([
      "1º Célula Betel 118% da meta",
      "2º Célula Ágape 114% da meta",
      "3º Célula Canaã 81% da meta",
    ]);
  });
});

// B1 da revisão: o pulso era uma animação de CSS e recomeçava quando o React movia o <li> (insertBefore), então
// uma célula só ultrapassada pulsava de novo. Agora é Web Animations API, disparada só quando a meta passa a
// estar batida (ou o item já aparece batido).
describe("pulso da meta batida", () => {
  it("quem bate a meta numa atualização pulsa uma vez (2 repetições), depois que o % conta", async () => {
    simularPreferencia(false);
    const animate = espiarAnimate();
    controlarQuadros();
    simularApi(PRIMEIRA, BETEL_PASSA);
    renderizarRota("/");
    await screen.findByText(/^Atualizado às/);
    // Ágape já aparece batida (112%): pulsa ao chegar.
    expect(pulsos(animate).map(({ item }) => item)).toEqual(["Célula Ágape"]);
    animate.mockClear();

    await atualizar();
    const [pulso, ...outros] = pulsos(animate);
    expect(outros).toHaveLength(0);
    expect(pulso.item).toBe("Célula Betel");
    expect(pulso.opcoes).toMatchObject({
      duration: 450,
      delay: ATRASO_PULSO_MS,
      iterations: 2,
    });
    expect(pulso.quadros).toEqual([
      { transform: "scale(1)" },
      { transform: "scale(1.12)", offset: 0.45 },
      { transform: "scale(1)" },
    ]);
    // O pulso começa depois que o % termina de contar.
    expect(ATRASO_PULSO_MS).toBeGreaterThan(DURACAO_CONTAGEM_MS);
  });

  it("quem já tinha batido e só troca de lugar não pulsa de novo (só desliza)", async () => {
    simularPreferencia(false);
    const animate = espiarAnimate();
    controlarQuadros();
    simularApi(DUAS_BATIDAS, DUAS_BATIDAS_TROCAM);
    renderizarRota("/");
    await screen.findByText(/^Atualizado às/);
    expect(pulsos(animate)).toHaveLength(2);
    animate.mockClear();

    await atualizar();
    expect(pulsos(animate)).toEqual([]);
    expect(animacoes(animate).map(({ item }) => item)).toEqual([
      "Célula Betel",
      "Célula Ágape",
    ]);
  });

  it("com prefers-reduced-motion: reduce, nenhum pulso (nem ao chegar, nem ao bater a meta)", async () => {
    simularPreferencia(true);
    const animate = espiarAnimate();
    simularApi(PRIMEIRA, BETEL_PASSA);
    renderizarRota("/");
    await screen.findByText(/^Atualizado às/);
    await atualizar();
    expect(lista("Jovens")[0]).toBe("1º Célula Betel 118% da meta");
    expect(animate).not.toHaveBeenCalled();
  });
});

describe("1º lugar e meta batida", () => {
  it("marcam o item (o destaque de comemoração é só visual: o texto continua o mesmo)", async () => {
    simularApi(PRIMEIRA);
    renderizarRota("/");
    await screen.findByText(/^Atualizado às/);

    const itens = within(
      screen.getByRole("region", { name: "Jovens" }),
    ).getAllByRole("listitem");
    expect(itens.map((item) => item.hasAttribute("data-primeiro"))).toEqual([
      true,
      false,
      false,
    ]);
    expect(itens.map((item) => item.hasAttribute("data-meta-batida"))).toEqual([
      true,
      false,
      false,
    ]);
    expect(itens[0]).toHaveTextContent("1º Célula Ágape 112% da meta");
  });
});

describe("RIFA-050 (P2.4): comemoração da meta batida no ranking público", () => {
  /** As animações das partículas (só visuais) e em qual célula estão. */
  const particulas = (animate: ReturnType<typeof espiarAnimate>) =>
    chamadasEm(animate, (elemento) =>
      elemento.classList.contains("mov-confete"),
    );

  it("abrir a página com células já batidas: só o pulso, nenhuma partícula", async () => {
    simularPreferencia(false);
    const animate = espiarAnimate();
    controlarQuadros();
    simularApi(DUAS_BATIDAS);
    renderizarRota("/");
    await screen.findByText(/^Atualizado às/);

    expect(pulsos(animate)).toHaveLength(2);
    expect(particulas(animate)).toEqual([]);
    expect(document.querySelector(".mov-comemoracao")).toBeNull();
  });

  it("quem passa a bater a meta numa atualização comemora uma vez, na pílula dele; a atualização igual não", async () => {
    simularPreferencia(false);
    const animate = espiarAnimate();
    const quadros = controlarQuadros();
    simularApi(PRIMEIRA, BETEL_PASSA, BETEL_PASSA);
    renderizarRota("/");
    await screen.findByText(/^Atualizado às/);
    animate.mockClear();

    await atualizar();
    // Betel: de 96% para 118%. As partículas saem da pílula dela, numa camada só visual.
    const voando = particulas(animate);
    expect(voando.length).toBeGreaterThanOrEqual(10);
    expect(voando.length).toBeLessThanOrEqual(14);
    expect(new Set(voando.map(({ item }) => item))).toEqual(
      new Set(["Célula Betel"]),
    );
    for (const { quadros: passos, opcoes } of voando) {
      expect(Number(opcoes.duration)).toBeLessThanOrEqual(450);
      for (const passo of passos)
        expect(
          Object.keys(passo).filter((chave) => chave !== "offset"),
        ).toEqual(["transform", "opacity"]);
    }
    const camada = document.querySelector(".mov-comemoracao");
    expect(camada).toHaveAttribute("aria-hidden", "true");
    expect(camada?.closest(".ranking-publico__percentual")).not.toBeNull();
    // Ágape já tinha batido: não comemora de novo.
    expect(pulsos(animate).map(({ item }) => item)).toEqual(["Célula Betel"]);
    // O texto da lista não muda (as partículas não têm texto), depois que o % termina de contar.
    act(() => quadros.quadro(10_000));
    act(() => quadros.quadro(10_000 + DURACAO_CONTAGEM_MS));
    expect(lista("Jovens")[0]).toBe("1º Célula Betel 118% da meta");
    animate.mockClear();

    await atualizar();
    expect(particulas(animate)).toEqual([]);
    expect(pulsos(animate)).toEqual([]);
  });

  it("com prefers-reduced-motion: reduce, nenhuma partícula no DOM", async () => {
    simularPreferencia(true);
    espiarAnimate();
    simularApi(PRIMEIRA, BETEL_PASSA);
    renderizarRota("/");
    await screen.findByText(/^Atualizado às/);
    await atualizar();
    expect(lista("Jovens")[0]).toBe("1º Célula Betel 118% da meta");
    expect(document.querySelector(".mov-comemoracao")).toBeNull();
  });
});
