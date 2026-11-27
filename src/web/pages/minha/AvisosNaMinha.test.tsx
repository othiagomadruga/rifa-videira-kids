// RIFA-094 (D42): os avisos de venda também na /minha (líder, discipulador e rede), com o mesmo componente e a mesma
// rota aberta do ranking aberto: ao entrar, as vendas recentes aparecem com "há N min" (RIFA-096); a seguinte mostra o
// aviso; o botão "Som das vendas" fica no cabeçalho da tela, só com os avisos ligados; sem a palavra "rede" para o
// discipulador (D30).
// O comportamento inteiro (fila, celular, som) está em components/avisos-de-venda/AvisosDeVenda.test.tsx.
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ItemVendaRecente,
  RespostaVendasRecentes,
} from "../../../shared/contracts/api";
import { controlesSemDica } from "../../test/dicas";
import { renderizarRota, respostaJson } from "../../test/renderizar";
import {
  ESTADO_NOTIFICACOES_LIGADAS,
  simularWebPush,
} from "../../test/web-push";
import { criarApiFalsa, sessaoDaVisao, visaoDe } from "./teste-apoio";

const AGORA = "2026-12-04T18:30:00.000Z";
const venda = (n: number, celula: string, bilhetes: number, em = AGORA) =>
  ({
    k: n.toString(16).padStart(16, "0"),
    celula,
    bilhetes,
    em,
  }) satisfies ItemVendaRecente;
const resposta = (
  itens: ItemVendaRecente[],
  ligados = true,
): RespostaVendasRecentes => ({ ligados, itens, agora: AGORA });

async function abrir(
  papel: "lider" | "discipulador" | "rede",
  ...respostas: RespostaVendasRecentes[]
) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const visao = visaoDe({ papel });
  const api = criarApiFalsa(visao);
  api.responderAvisos(...respostas);
  vi.stubGlobal("fetch", api.fetch);
  renderizarRota("/minha", { usuario: sessaoDaVisao(visao) });
  await screen.findByRole(
    "heading",
    { level: 2, name: "Ranking" },
    { timeout: 5000 },
  );
  return api;
}

const proximaConsulta = () => act(() => vi.advanceTimersByTimeAsync(15_000));

const avisos = () =>
  [...document.querySelectorAll("[data-aviso-de-venda]")].map(
    (aviso) => aviso.textContent,
  );

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("RIFA-094: os avisos de venda na /minha", () => {
  it.each(["lider", "discipulador", "rede"] as const)(
    "%s: ao entrar, a venda de 2 min atrás aparece (RIFA-096); a seguinte vira o aviso, e o 'Som das vendas' fica no cabeçalho da tela",
    async (papel) => {
      const antiga = venda(1, "Shekinah", 2, "2026-12-04T18:28:00.000Z");
      const nova = venda(2, "Bunker", 3);
      const api = await abrir(
        papel,
        resposta([antiga]),
        resposta([nova, antiga]),
      );
      expect(api.avisos[0]).toBe("/api/publico/vendas-recentes");
      await waitFor(() =>
        expect(avisos()).toEqual([
          "A célula Shekinah vendeu 2 bilhetes! há 2 min · Projeto Videira Kids",
        ]),
      );

      await proximaConsulta();

      expect(avisos()).toEqual([
        "A célula Bunker vendeu 3 bilhetes! agora mesmo · Projeto Videira Kids",
      ]);
      // O "Som das vendas" no cabeçalho da tela (ao lado do título, como no ranking aberto), com dica (RIFA-045).
      const cabecalho = screen
        .getByRole("heading", { level: 1 })
        .closest("header")!;
      expect(
        within(cabecalho).getByRole("button", { name: "Som das vendas" }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(controlesSemDica(cabecalho)).toEqual([]);
      // A barra de cima continua só com o "Sair" (com o som, ela quebraria em duas linhas no celular).
      expect(
        within(document.querySelector(".minha-moldura__topo") as HTMLElement)
          .getAllByRole("button")
          .map((botao) => botao.textContent),
      ).toEqual(["Sair"]);
      // O discipulador não vê "rede" (D30).
      if (papel === "discipulador")
        expect(document.body.textContent).not.toMatch(/\brede\b/i);
    },
  );

  it("RIFA-096: o 'Avisos no celular' fica no cabeçalho da tela, ao lado do 'Som das vendas' (não mais como cartão na visão)", async () => {
    const desfazer = simularWebPush();
    try {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const visao = visaoDe({ papel: "lider" });
      const api = criarApiFalsa(visao);
      api.proxima(
        "GET",
        "/api/publico/notificacoes",
        respostaJson(ESTADO_NOTIFICACOES_LIGADAS),
      );
      vi.stubGlobal("fetch", api.fetch);
      renderizarRota("/minha", { usuario: sessaoDaVisao(visao) });
      const celular = await screen.findByRole(
        "button",
        { name: "Avisos no celular" },
        { timeout: 5000 },
      );
      const cabecalho = screen
        .getByRole("heading", { level: 1 })
        .closest("header")!;
      expect(cabecalho).toContainElement(celular);
      const acoes = celular.closest(".ui-page-header__acoes")!;
      expect(
        within(acoes as HTMLElement)
          .getAllByRole("button")
          .map((botao) => botao.textContent),
      ).toEqual(["Som das vendas", "Avisos no celular"]);
      // Um botão só (o cabeçalho do esqueleto, antes da visão, fica sem: não monta duas vezes).
      expect(
        screen.getAllByRole("button", { name: "Avisos no celular" }),
      ).toHaveLength(1);
      expect(document.querySelector("section.avisos-celular")).toBeNull();
      expect(controlesSemDica(cabecalho)).toEqual([]);
    } finally {
      desfazer();
    }
  });

  it("com os avisos desligados na campanha, nem aviso nem o botão do som", async () => {
    await abrir("lider", resposta([], false));
    await proximaConsulta();

    expect(avisos()).toEqual([]);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Som das vendas" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
  });
});
