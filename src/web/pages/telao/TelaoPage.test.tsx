// Telão (/telao), renderizado pela rota de verdade com GET /api/publico/ranking simulado (cada resposta
// passa pelo schema estrito do contrato). CA2: a disputa de jovens e adultos lado a lado, a fase, o
// relógio, a atualização a cada 60 s (timers falsos), sem navegação e sem cursor parado; CA3: nada de
// dinheiro nem quantidades na tela, em nenhum estado, e só a rota aberta do ranking.
import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { respostaRankingPublicoSchema } from "../../../shared/contracts/api";
import type {
  Divisao,
  ItemRankingPublico,
  JanelaRanking,
  JanelaRankingResposta,
  ReferenciaCampanha,
  RespostaRankingPublico,
} from "../../../shared/contracts/calculos";
import { renderizarRota, respostaJson } from "../../test/renderizar";
import { INTERVALO_ATUALIZACAO_MS } from "../ranking-publico/useRankingPublico";
import { LINHAS_POR_DIVISAO } from "./textos";
import { CURSOR_PARADO_MS } from "./useTelao";

// ---------------------------------------------------------------------------------------------------
// Respostas de exemplo (o exemplo de docs/api.md: 04/12/2026 às 15:30, dia 12 de 24, Semana 2).
// ---------------------------------------------------------------------------------------------------

const ATUALIZADO_EM = "2026-12-04T18:30:00.000Z";

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

const ANTES: ReferenciaCampanha = {
  ...DURANTE,
  data: "2026-11-20",
  fase: "antes",
  dia_campanha: null,
  dias_restantes: 24,
  dias_para_inicio: 3,
  periodo: null,
};

const ULTIMO_DIA: ReferenciaCampanha = {
  ...DURANTE,
  data: "2026-12-16",
  dia_campanha: 24,
  dias_restantes: 1,
  periodo: {
    ordem: 3,
    nome: "Semana 3",
    data_inicio: "2026-12-10",
    data_fim: "2026-12-16",
    dias: 7,
    dia_no_periodo: 7,
    dias_restantes: 1,
  },
};

const ENCERRADA: ReferenciaCampanha = {
  ...DURANTE,
  data: "2026-12-17",
  fase: "encerrada",
  dia_campanha: null,
  dias_restantes: 0,
  periodo: null,
};

const JANELAS: Record<JanelaRanking, JanelaRankingResposta> = {
  atual: {
    tipo: "atual",
    ordem: 2,
    nome: "Semana 2",
    data_inicio: "2026-12-03",
    data_fim: "2026-12-09",
  },
  campanha: {
    tipo: "campanha",
    ordem: null,
    nome: "Campanha inteira",
    data_inicio: "2026-11-23",
    data_fim: "2026-12-16",
  },
};

function itens(
  divisao: Divisao,
  ...lista: [posicao: number, nome: string, percentual?: number][]
): ItemRankingPublico[] {
  return lista.map(([posicao, nome, percentual]) => ({
    posicao,
    nome,
    divisao,
    ...(percentual === undefined ? {} : { percentual_meta_bp: percentual }),
  }));
}

const JOVENS = itens(
  "jovens",
  [1, "Célula Ágape"],
  [2, "Célula Betel"],
  [3, "Célula Canaã"],
);
const ADULTOS = itens("adultos", [1, "Célula Dorcas"], [2, "Célula Éfeso"]);

type Cenario = {
  referencia: ReferenciaCampanha;
  itens: Record<Divisao, ItemRankingPublico[]>;
  /** Quantas das próximas chamadas falham sem conexão. */
  falhas: number;
  /** Erro fixo da API (ex.: 404 sem campanha ativa). */
  erro: { status: number; codigo: string; mensagem: string } | null;
};

let api: { cenario: Cenario; caminhos: string[] };

function simularApi(cenario: Partial<Cenario> = {}) {
  const completo: Cenario = {
    referencia: DURANTE,
    itens: { jovens: JOVENS, adultos: ADULTOS },
    falhas: 0,
    erro: null,
    ...cenario,
  };
  const caminhos: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL) => {
      const caminho = String(entrada);
      caminhos.push(caminho);
      const url = new URL(caminho, "http://localhost");
      if (url.pathname !== "/api/publico/ranking")
        return respostaJson(
          { erro: { codigo: "nao_encontrado", mensagem: "Rota inesperada" } },
          404,
        );
      if (completo.falhas > 0) {
        completo.falhas -= 1;
        throw new TypeError("Failed to fetch");
      }
      if (completo.erro) {
        const { status, codigo, mensagem } = completo.erro;
        return respostaJson({ erro: { codigo, mensagem } }, status);
      }
      const periodo = url.searchParams.get("periodo") as JanelaRanking;
      const divisao = url.searchParams.get("divisao") as Divisao;
      const resposta: RespostaRankingPublico =
        respostaRankingPublicoSchema.parse({
          nivel: "celula",
          divisao,
          janela: JANELAS[periodo],
          criterio: "percentual_meta",
          referencia: completo.referencia,
          itens: completo.itens[divisao],
          atualizado_em: ATUALIZADO_EM,
        });
      return respostaJson(resposta);
    }),
  );
  api = { cenario: completo, caminhos };
  return api;
}

function abrir(cenario: Partial<Cenario> = {}) {
  simularApi(cenario);
  return renderizarRota("/telao");
}

const caminho = (divisao: Divisao, periodo: JanelaRanking) =>
  `/api/publico/ranking?nivel=celula&divisao=${divisao}&periodo=${periodo}`;

const esperarRanking = () =>
  screen.findByText(/^Atualizado às 15:30/, undefined, { timeout: 3000 });

/** Os itens da lista de uma divisão, como texto ("1º Célula Ágape", "1º Célula Ágape 75% da meta"). */
function lista(divisao: "Jovens" | "Adultos"): string[] {
  return within(screen.getByRole("region", { name: divisao }))
    .queryAllByRole("listitem")
    .map((item) => item.textContent ?? "");
}

/** Sem navegação: nada para clicar nem para onde ir. */
function esperarSemNavegacao() {
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  expect(screen.queryAllByRole("link")).toHaveLength(0);
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  expect(screen.queryAllByRole("combobox")).toHaveLength(0);
}

const raiz = () => document.querySelector<HTMLElement>(".telao");

afterEach(() => {
  // CA3: só a rota aberta do ranking (nada da coordenação, nem a sessão)...
  expect(
    api.caminhos.filter(
      (pedido) => !pedido.startsWith("/api/publico/ranking?"),
    ),
  ).toEqual([]);
  // ... e, em nenhum estado, dinheiro ou quantidades na tela.
  expect(document.body.textContent).not.toMatch(/R\$|bilhete|centavo/i);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "visibilityState");
});

describe("CA2: o telão (/telao)", () => {
  it("durante a campanha: título, dia N de T, jovens e adultos lado a lado (posição e nome), relógio e hora da atualização", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-04T18:31:20.000Z"));
    abrir();
    expect(
      screen.getByRole("heading", { level: 1, name: "Telão" }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Telão · Rifa Videira Kids");
    expect(screen.getByText("Carregando o ranking…")).toBeInTheDocument();
    await esperarRanking();

    expect(screen.getByText("Rifa Videira Kids")).toBeInTheDocument();
    expect(screen.getByText("Dia 12 de 24")).toBeInTheDocument();
    expect(screen.getByText("Faltam 13 dias")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Semana 2 · 03/12 a 09/12",
      }),
    ).toBeInTheDocument();
    expect(lista("Jovens")).toEqual([
      "1º Célula Ágape",
      "2º Célula Betel",
      "3º Célula Canaã",
    ]);
    expect(lista("Adultos")).toEqual(["1º Célula Dorcas", "2º Célula Éfeso"]);
    // Relógio em Belém (a hora de agora) e a hora dos dados.
    expect(document.querySelector(".telao__relogio")).toHaveTextContent(
      "Agora são 15:31",
    );
    expect(screen.getByText(/^Atualizado às 15:30$/)).toBeInTheDocument();
    // Sem % quando a resposta não traz.
    expect(document.body.textContent).not.toContain("%");
    expect(api.caminhos).toEqual([
      caminho("jovens", "atual"),
      caminho("adultos", "atual"),
    ]);
    esperarSemNavegacao();
  });

  it("o % da meta aparece só quando a resposta traz (com a legenda em cada divisão)", async () => {
    abrir({
      itens: {
        jovens: itens(
          "jovens",
          [1, "Célula Ágape", 7500],
          [2, "Célula Betel", 5025],
        ),
        adultos: itens("adultos", [1, "Célula Dorcas", 12000]),
      },
    });
    await esperarRanking();

    expect(lista("Jovens")).toEqual([
      "1º Célula Ágape 75% da meta",
      "2º Célula Betel 50% da meta",
    ]);
    expect(lista("Adultos")).toEqual(["1º Célula Dorcas 120% da meta"]);
    expect(document.querySelectorAll(".telao__legenda")).toHaveLength(2);
  });

  it("o pódio (até o 3º lugar, empatados inclusive) fica em destaque", async () => {
    abrir({
      itens: {
        jovens: itens(
          "jovens",
          [1, "Célula Ágape"],
          [2, "Célula Betel"],
          [3, "Célula Canaã"],
          [3, "Célula Dorcas"],
        ),
        adultos: ADULTOS,
      },
    });
    await esperarRanking();

    const destaques = within(screen.getByRole("region", { name: "Jovens" }))
      .getAllByRole("listitem")
      .map((item) => item.hasAttribute("data-destaque"));
    expect(destaques).toEqual([true, true, true, true]);
  });

  it.each([
    [ANTES, "Começa em 3 dias"],
    [{ ...ANTES, data: "2026-11-22", dias_para_inicio: 1 }, "Começa amanhã"],
  ])(
    "antes do início: a contagem regressiva no topo e o ranking vem com a primeira venda (%#)",
    async (referencia, contagem) => {
      abrir({ referencia, itens: { jovens: [], adultos: [] } });
      await esperarRanking();

      expect(screen.getByText(contagem)).toBeInTheDocument();
      expect(screen.getByText("Vendas de 23/11 a 16/12")).toBeInTheDocument();
      expect(
        screen.getByText("O ranking aparece aqui depois da primeira venda."),
      ).toBeInTheDocument();
      expect(
        screen.getByText("As vendas começam em 23/11/2026."),
      ).toBeInTheDocument();
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
      esperarSemNavegacao();
    },
  );

  it("no último dia, o topo avisa", async () => {
    abrir({ referencia: ULTIMO_DIA });
    await esperarRanking();

    expect(screen.getByText("Dia 24 de 24")).toBeInTheDocument();
    expect(screen.getByText("Hoje é o último dia")).toBeInTheDocument();
  });

  it("campanha encerrada: o resultado final da campanha inteira", async () => {
    abrir({ referencia: ENCERRADA });
    await esperarRanking();

    expect(screen.getByText("Campanha encerrada")).toBeInTheDocument();
    expect(screen.getByText("Terminou em 16/12/2026")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Resultado final da campanha",
      }),
    ).toBeInTheDocument();
    expect(lista("Jovens")).toHaveLength(3);
    // A 1ª consulta descobre a fase; a janela certa é a da campanha inteira.
    expect(api.caminhos.slice(-2)).toEqual([
      caminho("jovens", "campanha"),
      caminho("adultos", "campanha"),
    ]);
  });

  it("durante, sem venda no período: o aviso no lugar da disputa", async () => {
    abrir({ itens: { jovens: [], adultos: [] } });
    await esperarRanking();

    expect(
      screen.getByText("O ranking aparece aqui depois da primeira venda."),
    ).toBeInTheDocument();
    expect(screen.getByText("Semana 2: ainda sem vendas.")).toBeInTheDocument();
  });

  it("uma divisão ainda sem vendas: a coluna diz isso, a outra mostra o ranking", async () => {
    abrir({ itens: { jovens: JOVENS, adultos: [] } });
    await esperarRanking();

    expect(lista("Jovens")).toHaveLength(3);
    expect(
      within(screen.getByRole("region", { name: "Adultos" })).getByText(
        "Ainda sem vendas nesta divisão.",
      ),
    ).toBeInTheDocument();
  });

  it(`mais de ${LINHAS_POR_DIVISAO} nomes numa divisão: os primeiros e uma linha com os que faltam (cabe sem rolagem)`, async () => {
    const nomes = [
      "Ágape",
      "Betel",
      "Canaã",
      "Dorcas",
      "Éfeso",
      "Filadélfia",
      "Gileade",
    ];
    abrir({
      itens: {
        // Empate no 3º lugar (a API manda todos os empatados no limite).
        jovens: itens(
          "jovens",
          ...nomes.map((nome, indice): [number, string] => [
            Math.min(indice + 1, 3),
            `Célula ${nome}`,
          ]),
        ),
        // Sem limite na campanha: posições diferentes.
        adultos: itens(
          "adultos",
          ...nomes
            .slice(0, 6)
            .map((nome, indice): [number, string] => [
              indice + 1,
              `Célula ${nome} A`,
            ]),
        ),
      },
    });
    await esperarRanking();

    expect(lista("Jovens")).toEqual([
      "1º Célula Ágape",
      "2º Célula Betel",
      "3º Célula Canaã",
      "3º Célula Dorcas",
    ]);
    expect(
      within(screen.getByRole("region", { name: "Jovens" })).getByText(
        "e mais 3 empatadas no 3º lugar",
      ),
    ).toBeInTheDocument();
    expect(lista("Adultos")).toHaveLength(LINHAS_POR_DIVISAO - 1);
    expect(
      within(screen.getByRole("region", { name: "Adultos" })).getByText(
        "e mais 2 células",
      ),
    ).toBeInTheDocument();
  });

  it(`exatamente ${LINHAS_POR_DIVISAO} nomes: todos aparecem, sem a linha do resto`, async () => {
    abrir({
      itens: {
        jovens: itens(
          "jovens",
          [1, "Célula Ágape"],
          [2, "Célula Betel"],
          [3, "Célula Canaã"],
          [3, "Célula Dorcas"],
          [3, "Célula Éfeso"],
        ),
        adultos: ADULTOS,
      },
    });
    await esperarRanking();

    expect(lista("Jovens")).toHaveLength(5);
    expect(screen.queryByText(/^e mais/)).not.toBeInTheDocument();
  });

  it("sem campanha (404): a mensagem, sem botão nem navegação", async () => {
    abrir({
      erro: {
        status: 404,
        codigo: "nao_encontrado",
        mensagem: "A campanha ainda não foi configurada",
      },
    });

    expect(
      await screen.findByText("O ranking ainda não está disponível."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Ele aparece aqui quando a campanha estiver ativa."),
    ).toBeInTheDocument();
    esperarSemNavegacao();
  });

  it("o cursor some com o mouse parado: aparece ao mexer e some de novo depois de 3 s", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    abrir();
    expect(CURSOR_PARADO_MS).toBe(3000);
    expect(raiz()).toHaveAttribute("data-cursor", "escondido");

    fireEvent.mouseMove(document);
    expect(raiz()).not.toHaveAttribute("data-cursor");

    act(() => vi.advanceTimersByTime(CURSOR_PARADO_MS - 1));
    fireEvent.mouseMove(document);
    act(() => vi.advanceTimersByTime(CURSOR_PARADO_MS - 1));
    expect(raiz()).not.toHaveAttribute("data-cursor");

    act(() => vi.advanceTimersByTime(1));
    expect(raiz()).toHaveAttribute("data-cursor", "escondido");
  });
});

describe("CA2: o telão se atualiza sozinho (timers falsos)", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
  });

  it("a cada 60 s pede o ranking de novo e mostra as posições novas", async () => {
    expect(INTERVALO_ATUALIZACAO_MS).toBe(60_000);
    abrir();
    await esperarRanking();
    expect(api.caminhos).toHaveLength(2);

    await act(() =>
      vi.advanceTimersByTimeAsync(INTERVALO_ATUALIZACAO_MS - 2000),
    );
    expect(api.caminhos).toHaveLength(2);
    api.cenario.itens.jovens = itens(
      "jovens",
      [1, "Célula Betel"],
      [2, "Célula Ágape"],
      [3, "Célula Canaã"],
    );
    await act(() => vi.advanceTimersByTimeAsync(2000));

    expect(api.caminhos).toHaveLength(4);
    expect(api.caminhos.slice(2)).toEqual([
      caminho("jovens", "atual"),
      caminho("adultos", "atual"),
    ]);
    await vi.waitFor(() =>
      expect(lista("Jovens")).toEqual([
        "1º Célula Betel",
        "2º Célula Ágape",
        "3º Célula Canaã",
      ]),
    );

    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ATUALIZACAO_MS));
    expect(api.caminhos).toHaveLength(6);
  });

  it("uma atualização que falha não apaga a tela: os dados ficam com o aviso 'sem conexão'; a seguinte volta ao normal", async () => {
    abrir();
    await esperarRanking();

    api.cenario.falhas = 2;
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ATUALIZACAO_MS));

    const aviso = await screen.findByText("· sem conexão", { exact: false });
    expect(aviso).toHaveAttribute("role", "status");
    expect(lista("Jovens")).toHaveLength(3);
    expect(document.querySelector(".telao__atualizado")).toHaveAttribute(
      "data-falhou",
    );
    esperarSemNavegacao();

    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ATUALIZACAO_MS));
    // Espera a volta de verdade ("Atualizado às 15:30" fica na tela também durante a falha).
    await vi.waitFor(() =>
      expect(document.querySelector(".telao__atualizado")).not.toHaveAttribute(
        "data-falhou",
      ),
    );
    expect(aviso).toHaveTextContent("");
    expect(screen.getByText(/^Atualizado às 15:30$/)).toBeInTheDocument();
  });

  it("a primeira carga falha: a mensagem, sem botão, e o telão tenta de novo sozinho em 1 minuto", async () => {
    abrir({ falhas: 1 });

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Não foi possível carregar o ranking.");
    expect(alerta).toHaveTextContent(
      "A tela tenta de novo sozinha a cada minuto.",
    );
    esperarSemNavegacao();

    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ATUALIZACAO_MS));

    await esperarRanking();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(lista("Adultos")).toEqual(["1º Célula Dorcas", "2º Célula Éfeso"]);
  });

  it("o relógio anda sozinho, na hora de Belém", async () => {
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "Date",
      ],
    });
    vi.setSystemTime(new Date("2026-12-04T18:30:58.000Z"));
    abrir();
    const relogio = () => document.querySelector(".telao__relogio");
    expect(relogio()).toHaveTextContent("Agora são 15:30");

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(relogio()).toHaveTextContent("Agora são 15:31");

    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(relogio()).toHaveTextContent("Agora são 15:32");
  });
});
