// RIFA-083 (D38): os maiores compradores na /minha do discipulador, pela rota de verdade e com a API falsa
// (teste-apoio.ts, respostas que passam no schema estrito do contrato). O bloco aparece só para o discipulador,
// depois do ranking das células ("Suas células"), com a troca "Esta semana" / "Campanha toda", a lista (posição,
// nome, célula e bilhetes; nunca telefone nem dinheiro) e o vazio. Nomes fictícios.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PapelHierarquia } from "../../../shared/contracts";
import { renderizarRota } from "../../test/renderizar";
import {
  COMPRADORES_DA_SEMANA,
  criarApiFalsa,
  meusCompradoresDe,
  respostaErro,
  sessaoDaVisao,
  visaoDe,
  type ApiFalsa,
} from "./teste-apoio";

const CAMINHO = "/api/minha/maiores-compradores";

async function abrir(papel: PapelHierarquia, api?: ApiFalsa) {
  const visao = visaoDe({ papel });
  const falsa =
    api ??
    criarApiFalsa(visao, null, null, (janela) =>
      meusCompradoresDe(
        janela,
        janela === "campanha"
          ? [
              {
                posicao: 1,
                nome: "Rita Fictícia",
                bilhetes: 30,
                celula: "Célula Ágape",
              },
            ]
          : COMPRADORES_DA_SEMANA,
      ),
    );
  vi.stubGlobal("fetch", falsa.fetch);
  renderizarRota("/minha", { usuario: sessaoDaVisao(visao) });
  await screen.findByRole("heading", { level: 2, name: "Ranking" });
  return falsa;
}

/** O cartão "Maiores compradores". */
async function bloco(): Promise<HTMLElement> {
  const titulo = await screen.findByRole("heading", {
    level: 2,
    name: "Maiores compradores",
  });
  const cartao = titulo.closest<HTMLElement>(".minha-compradores");
  if (!cartao) throw new Error("sem o cartão dos compradores");
  return cartao;
}

/** Os itens da lista, como texto. */
function itens(cartao: HTMLElement): string[] {
  return within(cartao)
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RIFA-083: maiores compradores na /minha do discipulador", () => {
  it("depois de 'Suas células': a semana (padrão), com posição (empate dividido), nome, célula e bilhetes", async () => {
    const api = await abrir("discipulador");
    const cartao = await bloco();
    await waitFor(() => expect(itens(cartao)).toHaveLength(4));
    expect(itens(cartao)).toEqual([
      "1º Rita Fictícia Célula Ágape 12 bilhetes",
      "2º Caio Fictício Célula Betel 5 bilhetes",
      "2º Lia Fictícia Célula Canaã 5 bilhetes",
      "4º Sem nome Célula Ágape 1 bilhete",
    ]);
    expect(cartao).toHaveTextContent("Semana 2 · 03/12 a 09/12");
    expect(
      within(cartao).getByRole("button", { name: "Esta semana" }),
    ).toHaveAttribute("aria-pressed", "true");
    // Depois do ranking das células.
    const celulas = screen.getByRole("heading", {
      level: 2,
      name: "Suas células",
    });
    expect(
      celulas.compareDocumentPosition(cartao) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(api.chamadasA("GET", CAMINHO).map((c) => c.caminho)).toEqual([
      `${CAMINHO}?janela=atual`,
    ]);
    // Nunca telefone nem dinheiro.
    expect(cartao.textContent).not.toMatch(/R\$|\(\d{2}\)|wa\.me|telefone/i);
    expect(cartao.querySelector("a")).toBeNull();
  });

  it("a troca de janela: 'Campanha toda' pede a campanha e mostra a lista dela; volta para a semana", async () => {
    const api = await abrir("discipulador");
    const cartao = await bloco();
    await waitFor(() => expect(itens(cartao)).toHaveLength(4));

    fireEvent.click(
      within(cartao).getByRole("button", { name: "Campanha toda" }),
    );
    await waitFor(() =>
      expect(itens(cartao)).toEqual([
        "1º Rita Fictícia Célula Ágape 30 bilhetes",
      ]),
    );
    expect(cartao).toHaveTextContent("Campanha inteira · 23/11 a 16/12");
    expect(
      within(cartao).getByRole("button", { name: "Campanha toda" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(cartao).getByRole("button", { name: "Esta semana" }),
    ).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(
      within(cartao).getByRole("button", { name: "Esta semana" }),
    );
    await waitFor(() => expect(itens(cartao)).toHaveLength(4));
    expect(api.chamadasA("GET", CAMINHO).map((c) => c.caminho)).toEqual([
      `${CAMINHO}?janela=atual`,
      `${CAMINHO}?janela=campanha`,
      `${CAMINHO}?janela=atual`,
    ]);
  });

  it("sem compras: 'Ainda não há compras nesta semana.' (e, na campanha, 'na campanha')", async () => {
    const api = criarApiFalsa(visaoDe({ papel: "discipulador" }));
    await abrir("discipulador", api);
    const cartao = await bloco();
    await within(cartao).findByText("Ainda não há compras nesta semana.");
    expect(within(cartao).queryByRole("list")).toBeNull();
    fireEvent.click(
      within(cartao).getByRole("button", { name: "Campanha toda" }),
    );
    await within(cartao).findByText("Ainda não há compras na campanha.");
  });

  it("falha ao carregar: a explicação e 'Tentar de novo', que pede de novo", async () => {
    const api = criarApiFalsa(visaoDe({ papel: "discipulador" }));
    api.proxima(
      "GET",
      CAMINHO,
      respostaErro(500, "erro_interno", "Erro interno"),
    );
    await abrir("discipulador", api);
    const cartao = await bloco();
    await within(cartao).findByText(
      "Não foi possível carregar os compradores.",
    );
    fireEvent.click(
      within(cartao).getByRole("button", { name: "Tentar de novo" }),
    );
    await within(cartao).findByText("Ainda não há compras nesta semana.");
    expect(api.chamadasA("GET", CAMINHO)).toHaveLength(2);
  });

  it.each(["lider", "rede"] as const)(
    "%s: sem o bloco e sem pedir a rota (é só do discipulador)",
    async (papel) => {
      const api = await abrir(papel);
      await waitFor(() =>
        expect(api.chamadasA("GET", "/api/minha/links-vendas")).toHaveLength(1),
      );
      expect(
        screen.queryByRole("heading", { name: "Maiores compradores" }),
      ).toBeNull();
      expect(api.chamadasA("GET", CAMINHO)).toEqual([]);
    },
  );
});
