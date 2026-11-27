// RIFA-094 (D42): os avisos de venda no ranking aberto (/), com o componente de components/avisos-de-venda: a primeira
// resposta só marca as vendas; a seguinte mostra o aviso; o botão "Som das vendas" fica ao lado do título, só com os
// avisos ligados na campanha. O comportamento inteiro (fila, celular, som) está em AvisosDeVenda.test.tsx.
import { act, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  respostaRankingPublicoSchema,
  respostaVendasRecentesSchema,
  type ItemVendaRecente,
} from "../../../shared/contracts/api";
import { controlesSemDica } from "../../test/dicas";
import { renderizarRota, respostaJson } from "../../test/renderizar";

const AGORA = "2026-12-04T18:30:00.000Z";
const RANKING = respostaRankingPublicoSchema.parse({
  nivel: "celula",
  divisao: null,
  por_divisao: false,
  janela: {
    tipo: "atual",
    ordem: 2,
    nome: "Semana 2",
    data_inicio: "2026-12-03",
    data_fim: "2026-12-09",
  },
  criterio: "percentual_meta",
  referencia: {
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
  },
  itens: [{ posicao: 1, nome: "Bunker", divisao: "jovens" }],
  atualizado_em: AGORA,
});

const venda = (n: number, celula: string, bilhetes: number) =>
  ({
    k: n.toString(16).padStart(16, "0"),
    celula,
    bilhetes,
    em: AGORA,
  }) satisfies ItemVendaRecente;

function simularApi(
  ...avisos: { ligados: boolean; itens: ItemVendaRecente[] }[]
) {
  let consultas = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL) => {
      const url = new URL(String(entrada), "http://localhost");
      if (url.pathname === "/api/publico/vendas-recentes") {
        const resposta = avisos[Math.min(consultas++, avisos.length - 1)];
        return respostaJson(
          respostaVendasRecentesSchema.parse({ ...resposta, agora: AGORA }),
        );
      }
      return respostaJson(RANKING);
    }),
  );
}

const avisosNaTela = () =>
  [...document.querySelectorAll("[data-aviso-de-venda]")].map(
    (aviso) => aviso.textContent,
  );

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("RIFA-094: os avisos de venda no ranking aberto", () => {
  it("a 1ª resposta só marca; a venda seguinte vira o aviso; o 'Som das vendas' fica ao lado do título, com dica", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const antiga = venda(1, "Shekinah", 2);
    simularApi(
      { ligados: true, itens: [antiga] },
      { ligados: true, itens: [venda(2, "Bunker", 3), antiga] },
    );
    renderizarRota("/");
    await screen.findByText(/^Atualizado às/);
    expect(avisosNaTela()).toEqual([]);

    await act(() => vi.advanceTimersByTimeAsync(15_000));

    expect(avisosNaTela()).toEqual([
      "A célula Bunker vendeu 3 bilhetes! agora mesmo · Projeto Videira Kids",
    ]);
    const cabecalho = screen
      .getByRole("heading", { level: 1, name: "Ranking da campanha" })
      .closest("header")!;
    expect(
      within(cabecalho).getByRole("button", { name: "Som das vendas" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(controlesSemDica()).toEqual([]);
  });

  it("com os avisos desligados na campanha, nem aviso nem o botão do som", async () => {
    simularApi({ ligados: false, itens: [] });
    renderizarRota("/");
    await screen.findByText(/^Atualizado às/);

    expect(avisosNaTela()).toEqual([]);
    expect(
      screen.queryByRole("button", { name: "Som das vendas" }),
    ).not.toBeInTheDocument();
  });
});
