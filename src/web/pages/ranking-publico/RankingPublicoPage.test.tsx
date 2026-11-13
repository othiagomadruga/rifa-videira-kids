import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
import { TITULO_SEM_CONEXAO } from "../../components/ui";
import { MENSAGEM_SEM_CONEXAO } from "../../lib/api";
import { renderizarRota, respostaJson } from "../../test/renderizar";
import { INTERVALO_ATUALIZACAO_MS } from "./useRankingPublico";

// ---------------------------------------------------------------------------------------------------
// Respostas de exemplo de GET /api/publico/ranking (cada uma passa pelo schema estrito do contrato) e
// uma API falsa que responde conforme a divisão e a janela pedidas e guarda todos os caminhos pedidos.
// ---------------------------------------------------------------------------------------------------

/** 04/12/2026 às 15:30 em Belém (o exemplo de docs/api.md: dia 12 de 24, 2º dia da Semana 2). */
const AGORA = "2026-12-04T18:30:00.000Z";

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
  /** Itens de cada janela e divisão. */
  itens: Record<JanelaRanking, Record<Divisao, ItemRankingPublico[]>>;
  /** Quantas das próximas chamadas falham sem conexão. */
  falhas: number;
  /** Erro fixo da API (ex.: 404 sem campanha ativa). */
  erro: { status: number; codigo: string; mensagem: string } | null;
};

let api: {
  cenario: Cenario;
  caminhos: string[];
  /** Quantas chamadas por janela (cada atualização pede jovens e adultos). */
  contagem: () => Record<JanelaRanking, number>;
};

function simularApi(cenario: Partial<Cenario> = {}) {
  const completo: Cenario = {
    referencia: DURANTE,
    itens: {
      atual: { jovens: JOVENS, adultos: ADULTOS },
      campanha: { jovens: JOVENS, adultos: ADULTOS },
    },
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
      if (url.pathname !== "/api/publico/ranking") {
        return respostaJson(
          { erro: { codigo: "nao_encontrado", mensagem: "Rota inesperada" } },
          404,
        );
      }
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
          itens: completo.itens[periodo][divisao],
          atualizado_em: AGORA,
        });
      return respostaJson(resposta);
    }),
  );
  api = {
    cenario: completo,
    caminhos,
    contagem: () => ({
      atual: caminhos.filter((c) => c.endsWith("periodo=atual")).length,
      campanha: caminhos.filter((c) => c.endsWith("periodo=campanha")).length,
    }),
  };
  return api;
}

function abrir(
  cenario: Partial<Cenario> = {},
  opcoes: Parameters<typeof renderizarRota>[1] = {},
) {
  simularApi(cenario);
  return renderizarRota("/", opcoes);
}

const caminho = (divisao: Divisao, periodo: JanelaRanking) =>
  `/api/publico/ranking?nivel=celula&divisao=${divisao}&periodo=${periodo}`;

/** O texto que o leitor de tela lê num elemento: sem o que é só visual (aria-hidden, ex.: o "↑ subiu"). */
function textoLido(elemento: Element): string {
  const copia = elemento.cloneNode(true) as Element;
  for (const visual of copia.querySelectorAll('[aria-hidden="true"]'))
    visual.remove();
  return copia.textContent ?? "";
}

/** Os itens da lista de uma divisão, como texto ("1º Célula Ágape", "1º Célula Ágape 75% da meta"). */
function lista(divisao: "Jovens" | "Adultos"): string[] {
  const secao = screen.getByRole("region", { name: divisao });
  return within(secao).queryAllByRole("listitem").map(textoLido);
}

const destaques = (divisao: "Jovens" | "Adultos") =>
  within(screen.getByRole("region", { name: divisao }))
    .getAllByRole("listitem")
    .map((item) => item.hasAttribute("data-destaque"));

const esperarRanking = () =>
  screen.findByText(/^Atualizado às 15:30\./, undefined, { timeout: 3000 });

function definirVisibilidade(estado: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => estado,
  });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

afterEach(() => {
  // CA2: a tela pública só chama a rota aberta do ranking (nada da coordenação, nem a sessão).
  expect(
    api.caminhos.filter(
      (pedido) => !pedido.startsWith("/api/publico/ranking?"),
    ),
  ).toEqual([]);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "visibilityState");
});

describe("CA2: ranking público (/)", () => {
  it("durante a campanha: fase, a disputa do período e os rankings de jovens e de adultos, só com posição e nome", async () => {
    abrir();
    expect(
      screen.getByRole("heading", { level: 1, name: "Ranking da campanha" }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Ranking da campanha · Rifa Videira Kids");
    await esperarRanking();

    expect(api.caminhos).toEqual([
      caminho("jovens", "atual"),
      caminho("adultos", "atual"),
    ]);
    expect(screen.getByText("Dia 12 de 24")).toBeInTheDocument();
    expect(screen.getByText("Faltam 13 dias")).toBeInTheDocument();
    // RIFA-050: a linha do tempo da campanha na faixa (dia 12 de 24 = metade), só visual: o texto já diz o dia.
    const linha = document.querySelector(".ranking-publico__linha-do-tempo");
    expect(linha).toHaveAttribute("aria-hidden", "true");
    expect(linha).toHaveTextContent("23/1116/12");
    expect(
      linha?.querySelector<HTMLElement>(".ranking-publico__percorrido")?.style
        .width,
    ).toBe("50%");
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
    // Sem % na resposta (a configuração não libera): nenhum % e nenhuma legenda.
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Atualizado às 15:30. A página se atualiza sozinha a cada minuto.",
      ),
    ).toBeInTheDocument();
    // Tela aberta: sem a navegação da coordenação.
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("empates na última posição entram todos (1º, 2º, 3º, 3º); o destaque vai até o 3º lugar", async () => {
    abrir({
      itens: {
        atual: {
          jovens: itens(
            "jovens",
            [1, "Célula Ágape"],
            [2, "Célula Betel"],
            [3, "Célula Canaã"],
            [3, "Célula Dorcas"],
          ),
          // Sem limite (limite_ranking null): todos os que venderam.
          adultos: itens(
            "adultos",
            [1, "Célula Éfeso"],
            [1, "Célula Filadélfia"],
            [3, "Célula Getsêmani"],
            [4, "Célula Hebrom"],
            [5, "Célula Israel"],
          ),
        },
        campanha: { jovens: [], adultos: [] },
      },
    });
    await esperarRanking();

    expect(lista("Jovens")).toEqual([
      "1º Célula Ágape",
      "2º Célula Betel",
      "3º Célula Canaã",
      "3º Célula Dorcas",
    ]);
    expect(destaques("Jovens")).toEqual([true, true, true, true]);
    expect(lista("Adultos")).toEqual([
      "1º Célula Éfeso",
      "1º Célula Filadélfia",
      "3º Célula Getsêmani",
      "4º Célula Hebrom",
      "5º Célula Israel",
    ]);
    expect(destaques("Adultos")).toEqual([true, true, true, false, false]);
  });

  it("com o % liberado pela campanha, cada célula mostra o seu % da meta (e quem não tem meta fica sem)", async () => {
    abrir({
      itens: {
        atual: {
          jovens: itens(
            "jovens",
            [1, "Célula Ágape", 12_050],
            [2, "Célula Betel", 7_599],
            [3, "Célula Canaã"],
          ),
          adultos: itens("adultos", [1, "Célula Dorcas", 4_000]),
        },
        campanha: { jovens: [], adultos: [] },
      },
    });
    await esperarRanking();

    expect(lista("Jovens")).toEqual([
      "1º Célula Ágape 120% da meta",
      "2º Célula Betel 75% da meta",
      "3º Célula Canaã",
    ]);
    expect(lista("Adultos")).toEqual(["1º Célula Dorcas 40% da meta"]);
    expect(
      screen.getByText("O % é quanto cada célula já fez da própria meta."),
    ).toBeInTheDocument();
  });

  it("divisão sem vendas: aviso na seção dela, e a outra continua com o ranking", async () => {
    abrir({
      itens: {
        atual: { jovens: JOVENS, adultos: [] },
        campanha: { jovens: [], adultos: [] },
      },
    });
    await esperarRanking();

    expect(lista("Jovens")).toHaveLength(3);
    const adultos = screen.getByRole("region", { name: "Adultos" });
    expect(
      within(adultos).getByText("Ainda sem vendas nesta divisão."),
    ).toBeInTheDocument();
    expect(within(adultos).queryByRole("list")).not.toBeInTheDocument();
  });

  it("antes da primeira venda: estado vazio (com o troféu e o convite do primeiro dia), com a contagem regressiva antes do início", async () => {
    const vazio = {
      atual: { jovens: [], adultos: [] },
      campanha: { jovens: [], adultos: [] },
    };
    const { unmount } = abrir({ referencia: ANTES, itens: vazio });
    expect(
      await screen.findByText("Faltam 3 dias para começar"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Vendas de 23/11/2026 a 16/12/2026"),
    ).toBeInTheDocument();
    const titulo = screen.getByText("O ranking aparece com a primeira venda.");
    expect(
      screen.getByText(
        "As vendas começam em 23/11/2026. Qual célula vai ser a primeira?",
      ),
    ).toBeInTheDocument();
    // RIFA-050: o troféu (só visual) no estado vazio; antes do início, sem a linha do tempo.
    const estadoVazio = titulo.closest(".ui-estado");
    expect(
      estadoVazio?.querySelector(
        '[aria-hidden="true"] svg[data-icone="trofeu"]',
      ),
    ).not.toBeNull();
    expect(
      document.querySelector(".ranking-publico__linha-do-tempo"),
    ).toBeNull();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    unmount();

    // Véspera.
    const { unmount: fechar } = abrir({
      referencia: { ...ANTES, dias_para_inicio: 1 },
      itens: vazio,
    });
    expect(await screen.findByText("Começa amanhã")).toBeInTheDocument();
    fechar();

    // A data do início vem da campanha (a referencia da resposta), não do código.
    const { unmount: fecharOutra } = abrir({
      referencia: {
        ...ANTES,
        data_inicio: "2027-03-01",
        data_fim: "2027-03-24",
      },
      itens: vazio,
    });
    expect(
      await screen.findByText(
        "As vendas começam em 01/03/2027. Qual célula vai ser a primeira?",
      ),
    ).toBeInTheDocument();
    fecharOutra();

    // Durante, mas ninguém vendeu ainda na semana.
    const { unmount: fecharDurante } = abrir({ itens: vazio });
    expect(
      await screen.findByText(
        "Semana 2: ainda sem vendas. Qual célula vai ser a primeira?",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Dia 12 de 24")).toBeInTheDocument();
    fecharDurante();

    // Depois do fim, sem nenhuma venda: o aviso, sem o convite (não há primeira venda a esperar).
    abrir({ referencia: ENCERRADA, itens: vazio });
    expect(
      await screen.findByText("Campanha inteira: ainda sem vendas."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Qual célula vai ser a primeira\?/),
    ).not.toBeInTheDocument();
  });

  it("no último dia: 'Hoje é o último dia'", async () => {
    abrir({ referencia: ULTIMO_DIA });
    expect(await screen.findByText("Dia 24 de 24")).toBeInTheDocument();
    expect(screen.getByText("Hoje é o último dia")).toBeInTheDocument();
  });

  it("sem campanha ativa (404): avisa que o ranking ainda não está disponível, sem erro", async () => {
    abrir({
      erro: {
        status: 404,
        codigo: "nao_encontrado",
        mensagem: "Nenhuma campanha ativa",
      },
    });

    expect(
      await screen.findByText("O ranking ainda não está disponível."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("não chama nenhuma rota da coordenação, nem a da sessão (mesmo sem sessão conhecida)", async () => {
    abrir({}, { usuario: null });
    await esperarRanking();

    expect(api.caminhos).toEqual([
      caminho("jovens", "atual"),
      caminho("adultos", "atual"),
    ]);
    expect(api.caminhos.some((pedido) => pedido.includes("/api/sessao"))).toBe(
      false,
    );
  });
});

describe("CA2: atualização automática e falhas", () => {
  beforeEach(() => {
    // Só os temporizadores: as promessas e o agendador do React continuam reais.
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
  });

  it("atualiza sozinha a cada 60 s com a aba visível; para com a aba oculta e, ao voltar, atualiza na hora", async () => {
    expect(INTERVALO_ATUALIZACAO_MS).toBe(60_000);
    abrir();
    await esperarRanking();
    expect(api.contagem().atual).toBe(2);

    // O relógio falso também anda com o tempo real: a margem de 2 s cobre a duração do teste.
    await act(() =>
      vi.advanceTimersByTimeAsync(INTERVALO_ATUALIZACAO_MS - 2000),
    );
    expect(api.contagem().atual).toBe(2);
    api.cenario.itens.atual.jovens = itens(
      "jovens",
      [1, "Célula Betel"],
      [2, "Célula Ágape"],
    );
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(api.contagem().atual).toBe(4);
    await waitFor(() =>
      expect(lista("Jovens")).toEqual(["1º Célula Betel", "2º Célula Ágape"]),
    );
    // RIFA-050: Betel subiu: o chip "↑ subiu" (só visual) fica até a próxima mudança de ordem.
    const chips = document.querySelectorAll(".ranking-publico__subiu");
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveAttribute("aria-hidden", "true");
    expect(chips[0]).toHaveTextContent("subiu");
    expect(chips[0].closest("li")).toHaveTextContent(/^1º Célula Betel/);

    // Aba oculta: nenhuma consulta, por mais tempo que passe.
    definirVisibilidade("hidden");
    await act(() => vi.advanceTimersByTimeAsync(5 * INTERVALO_ATUALIZACAO_MS));
    expect(api.contagem().atual).toBe(4);

    // Voltou: atualiza na hora e retoma o ritmo.
    definirVisibilidade("visible");
    expect(api.contagem().atual).toBe(6);
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ATUALIZACAO_MS));
    expect(api.contagem().atual).toBe(8);
  });

  it("falha numa atualização: o ranking continua na tela com um aviso, e a seguinte volta ao normal", async () => {
    abrir();
    await esperarRanking();
    api.cenario.falhas = 2;

    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ATUALIZACAO_MS));
    expect(
      await screen.findByText(
        "Não foi possível atualizar agora. A página tenta de novo em 1 minuto.",
      ),
    ).toHaveAttribute("role", "status");
    expect(lista("Jovens")).toHaveLength(3);

    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ATUALIZACAO_MS));
    await waitFor(() =>
      expect(
        screen.queryByText(/^Não foi possível atualizar agora/),
      ).not.toBeInTheDocument(),
    );
    expect(lista("Jovens")).toHaveLength(3);
  });

  it("erro de conexão na primeira carga: o estado neutro 'Sem conexão agora' (sem o vermelho), com 'Tentar de novo', e nova tentativa sozinha depois de 60 s", async () => {
    // Cada carga pede jovens e adultos: 4 falhas = a 1ª carga e o "Tentar de novo".
    abrir({ falhas: 4 });

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent(TITULO_SEM_CONEXAO);
    expect(alerta).not.toHaveTextContent(
      "Não foi possível carregar o ranking.",
    );
    expect(alerta).toHaveTextContent(
      `${MENSAGEM_SEM_CONEXAO} A página tenta de novo sozinha a cada minuto.`,
    );
    expect(alerta).toHaveClass("ui-estado--conexao");
    expect(alerta).not.toHaveClass("ui-estado--erro");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(screen.getByText("Carregando o ranking…")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // A 2ª falha (no "Tentar de novo") volta ao erro; a tentativa automática seguinte carrega.
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ATUALIZACAO_MS));
    await esperarRanking();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(lista("Adultos")).toEqual(["1º Célula Dorcas", "2º Célula Éfeso"]);
  });

  it("outra falha na primeira carga (500): o erro de verdade, em vermelho, com 'Tentar de novo'", async () => {
    abrir({
      erro: { status: 500, codigo: "erro_interno", mensagem: "Falhou." },
    });

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Não foi possível carregar o ranking.");
    expect(alerta).toHaveTextContent(
      "Falhou. A página tenta de novo sozinha a cada minuto.",
    );
    expect(alerta).toHaveClass("ui-estado--erro");
    expect(
      screen.getByRole("button", { name: "Tentar de novo" }),
    ).toBeInTheDocument();
  });

  it("campanha encerrada: mostra o resultado final da campanha inteira; as atualizações seguintes já vão direto nele", async () => {
    abrir({
      referencia: ENCERRADA,
      itens: {
        // A janela "atual" depois do fim é a última semana; o público vê a campanha inteira.
        atual: {
          jovens: itens("jovens", [1, "Célula Betel"]),
          adultos: [],
        },
        campanha: {
          jovens: itens("jovens", [1, "Célula Ágape"], [2, "Célula Betel"]),
          adultos: itens("adultos", [1, "Célula Dorcas"]),
        },
      },
    });
    await esperarRanking();

    expect(api.caminhos).toEqual([
      caminho("jovens", "atual"),
      caminho("adultos", "atual"),
      caminho("jovens", "campanha"),
      caminho("adultos", "campanha"),
    ]);
    expect(screen.getByText("Campanha encerrada")).toBeInTheDocument();
    expect(screen.getByText("Terminou em 16/12/2026")).toBeInTheDocument();
    // Depois do fim, sem a linha do tempo (o texto da faixa já diz tudo).
    expect(
      document.querySelector(".ranking-publico__linha-do-tempo"),
    ).toBeNull();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Resultado final da campanha",
      }),
    ).toBeInTheDocument();
    expect(lista("Jovens")).toEqual(["1º Célula Ágape", "2º Célula Betel"]);
    expect(lista("Adultos")).toEqual(["1º Célula Dorcas"]);

    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ATUALIZACAO_MS));
    await waitFor(() => expect(api.contagem().campanha).toBe(4));
    expect(api.contagem().atual).toBe(2);
  });
});

describe("CA3: o público nunca vê dinheiro nem quantidades", () => {
  it("nenhum R$ nem número de bilhetes na tela, com e sem %, em todos os estados", async () => {
    const VALORES = /R\$|\d[\d.\s]*bilhetes?|centavos/i;
    const cenarios: Partial<Cenario>[] = [
      {},
      {
        itens: {
          atual: {
            jovens: itens("jovens", [1, "Célula Ágape", 7_500]),
            adultos: itens("adultos", [1, "Célula Dorcas", 4_000]),
          },
          campanha: { jovens: [], adultos: [] },
        },
      },
      { referencia: ANTES },
      { referencia: ENCERRADA },
      {
        erro: {
          status: 404,
          codigo: "nao_encontrado",
          mensagem: "Nenhuma campanha ativa",
        },
      },
      { falhas: 2 },
    ];
    for (const cenario of cenarios) {
      const { unmount } = abrir(cenario);
      await waitFor(() =>
        expect(screen.queryByText("Carregando o ranking…")).toBeNull(),
      );
      expect(document.body.textContent).not.toMatch(VALORES);
      expect(
        api.caminhos.every((pedido) =>
          pedido.startsWith("/api/publico/ranking?"),
        ),
      ).toBe(true);
      unmount();
    }
  });
});
