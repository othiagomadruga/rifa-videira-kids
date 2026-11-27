// RIFA-094 (D42): os avisos de venda também na /minha (líder, discipulador e rede), com o mesmo componente e a mesma
// rota aberta do ranking aberto: a primeira resposta só marca as vendas; a seguinte mostra o aviso; o botão "Som das
// vendas" fica na barra, ao lado do "Sair", só com os avisos ligados; sem a palavra "rede" para o discipulador (D30).
// O comportamento inteiro (fila, celular, som) está em components/avisos-de-venda/AvisosDeVenda.test.tsx.
import { act, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ItemVendaRecente,
  RespostaVendasRecentes,
} from "../../../shared/contracts/api";
import { controlesSemDica } from "../../test/dicas";
import { renderizarRota } from "../../test/renderizar";
import { criarApiFalsa, sessaoDaVisao, visaoDe } from "./teste-apoio";

const AGORA = "2026-12-04T18:30:00.000Z";
const venda = (n: number, celula: string, bilhetes: number) =>
  ({
    k: n.toString(16).padStart(16, "0"),
    celula,
    bilhetes,
    em: AGORA,
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
    "%s: a 1ª resposta só marca; a venda seguinte vira o aviso, e o 'Som das vendas' fica na barra com o 'Sair'",
    async (papel) => {
      const antiga = venda(1, "Shekinah", 2);
      const nova = venda(2, "Bunker", 3);
      const api = await abrir(
        papel,
        resposta([antiga]),
        resposta([nova, antiga]),
      );
      expect(api.avisos[0]).toBe("/api/publico/vendas-recentes");
      expect(avisos()).toEqual([]);

      await proximaConsulta();

      expect(avisos()).toEqual([
        "A célula Bunker vendeu 3 bilhetes! agora mesmo · Projeto Videira Kids",
      ]);
      const barra = document.querySelector(".minha-moldura__acoes")!;
      expect(
        within(barra as HTMLElement)
          .getAllByRole("button")
          .map((botao) => botao.textContent),
      ).toEqual(["Som das vendas", "Sair"]);
      // A barra segue com dica em todo botão (RIFA-045), e o discipulador não vê "rede" (D30).
      expect(controlesSemDica(barra as HTMLElement)).toEqual([]);
      if (papel === "discipulador")
        expect(document.body.textContent).not.toMatch(/\brede\b/i);
    },
  );

  it("com os avisos desligados na campanha, nem aviso nem o botão do som", async () => {
    await abrir("lider", resposta([], false));
    await proximaConsulta();

    expect(avisos()).toEqual([]);
    expect(
      screen.queryByRole("button", { name: "Som das vendas" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
  });
});
