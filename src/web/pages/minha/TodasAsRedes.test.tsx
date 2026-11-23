// RIFA-090 (adendo da D12): o ranking geral na /minha do discipulador (e da rede), pela rota de verdade e com a API
// falsa (teste-apoio-todas-as-redes.ts, respostas que passam no schema estrito do contrato). O cartão aparece embaixo de
// tudo o que ele já vê, com a troca "Esta semana" / "Campanha toda", as duas listas (discipuladores e células: posição,
// nome, % da meta e bilhetes), as linhas dele em destaque, as 10 primeiras e o "Ver todas". O líder não vê. Nomes
// fictícios.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PapelHierarquia } from "../../../shared/contracts";
import { renderizarRota, respostaJson } from "../../test/renderizar";
import {
  ALVO_DISCIPULADOR,
  criarApiFalsa,
  respostaErro,
  sessaoDaVisao,
  visaoDe,
  type ApiFalsa,
} from "./teste-apoio";
import { todasAsRedesDe } from "./teste-apoio-todas-as-redes";

const CAMINHO = "/api/minha/todas-as-redes";

async function abrir(papel: PapelHierarquia, api?: ApiFalsa) {
  const visao = visaoDe({ papel });
  const falsa = api ?? criarApiFalsa(visao);
  vi.stubGlobal("fetch", falsa.fetch);
  renderizarRota("/minha", { usuario: sessaoDaVisao(visao) });
  await screen.findByRole("heading", { level: 2, name: "Ranking" });
  return falsa;
}

/** O cartão "Ranking geral". */
async function cartao(): Promise<HTMLElement> {
  const titulo = await screen.findByRole("heading", {
    level: 2,
    name: "Ranking geral",
  });
  const elemento = titulo.closest<HTMLElement>(".minha-todas");
  if (!elemento) throw new Error("sem o cartão do ranking geral");
  return elemento;
}

/** A seção de uma das listas ("Discipuladores" ou "Células"). */
function secao(dentro: HTMLElement, titulo: string): HTMLElement {
  const elemento = within(dentro)
    .getByRole("heading", { level: 3, name: titulo })
    .closest<HTMLElement>("section");
  if (!elemento) throw new Error(`sem a seção ${titulo}`);
  return elemento;
}

/** Os itens de uma lista, como texto. */
function itens(dentro: HTMLElement): string[] {
  return within(dentro)
    .queryAllByRole("listitem")
    .map((item) => item.textContent ?? "");
}

/** Os itens destacados (as linhas de quem vê). */
function destacados(dentro: HTMLElement): string[] {
  return within(dentro)
    .queryAllByRole("listitem")
    .filter((item) => item.getAttribute("aria-current") === "true")
    .map((item) => item.textContent ?? "");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RIFA-090: o ranking geral na /minha do discipulador", () => {
  it("embaixo de tudo o que ele já vê: as duas listas da semana, com as 10 primeiras e as linhas dele em destaque", async () => {
    const api = await abrir("discipulador");
    const geral = await cartao();
    const discipuladores = secao(geral, "Discipuladores");
    const celulas = secao(geral, "Células");
    await waitFor(() => expect(itens(discipuladores)).toHaveLength(10));
    expect(geral).toHaveTextContent("Semana 2 · 03/12 a 09/12");
    expect(geral).toHaveTextContent("A ordem é pelo % da meta de cada um.");
    expect(itens(discipuladores).slice(0, 3)).toEqual([
      "1º Ester Fictícia 82% da meta 120 bilhetes",
      "2º Gabriel Fictício 75% da meta 98 bilhetes",
      "3º Davi Fictício Você 64% da meta 87 bilhetes",
    ]);
    // O empate divide a posição (9º e 9º).
    expect(itens(discipuladores).slice(8)).toEqual([
      "9º Natã Fictício 30% da meta 33 bilhetes",
      "9º Otávio Fictício 30% da meta 31 bilhetes",
    ]);
    expect(destacados(discipuladores)).toEqual([
      "3º Davi Fictício Você 64% da meta 87 bilhetes",
    ]);
    // As células: as 10 primeiras e, abaixo do corte, a Canaã (13ª), que é dele; o discipulador de cada uma.
    expect(itens(celulas)).toHaveLength(11);
    expect(itens(celulas)[0]).toBe(
      "1º Célula Siloé Ester Fictícia 95% da meta 40 bilhetes",
    );
    expect(destacados(celulas)).toEqual([
      "2º Célula Ágape Sua Davi Fictício 88% da meta 44 bilhetes",
      "5º Célula Betel Sua Davi Fictício 70% da meta 28 bilhetes",
      "13º Célula Canaã Sua Davi Fictício 12% da meta 6 bilhetes",
    ]);
    const canaa = within(celulas).getAllByRole("listitem")[10];
    expect(canaa).toHaveAttribute("data-depois-do-corte");
    expect(
      within(discipuladores)
        .getAllByRole("listitem")
        .some((item) => item.hasAttribute("data-depois-do-corte")),
    ).toBe(false);
    // Embaixo de tudo: depois dos maiores compradores e dos links das células.
    for (const anterior of [
      "Suas células",
      "Maiores compradores",
      "Links de vendas das suas células",
    ]) {
      const titulo = await screen.findByRole("heading", {
        level: 2,
        name: anterior,
      });
      expect(
        titulo.compareDocumentPosition(geral) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(api.chamadasA("GET", CAMINHO).map((c) => c.caminho)).toEqual([
      `${CAMINHO}?janela=atual`,
    ]);
    // Nunca dinheiro nem comprador.
    expect(geral.textContent).not.toMatch(/R\$|telefone|wa\.me/i);
    expect(geral.querySelector("a")).toBeNull();
  });

  it("'Ver todos' e 'Ver todas' mostram a lista inteira na própria página; 'Mostrar só' volta às 10 primeiras", async () => {
    await abrir("discipulador");
    const geral = await cartao();
    const discipuladores = secao(geral, "Discipuladores");
    const celulas = secao(geral, "Células");
    await waitFor(() => expect(itens(discipuladores)).toHaveLength(10));

    const verTodos = within(discipuladores).getByRole("button", {
      name: "Ver todos os 12 discipuladores",
    });
    expect(verTodos).toHaveAttribute("aria-expanded", "false");
    expect(verTodos).toHaveAttribute(
      "aria-controls",
      within(discipuladores).getByRole("list").id,
    );
    fireEvent.click(verTodos);
    expect(itens(discipuladores)).toHaveLength(12);
    expect(itens(discipuladores)[11]).toBe(
      "12º Rute Fictícia 0% da meta 0 bilhetes",
    );
    const menos = within(discipuladores).getByRole("button", {
      name: "Mostrar só os 10 primeiros",
    });
    expect(menos).toHaveAttribute("aria-expanded", "true");
    // A outra lista não muda.
    expect(itens(celulas)).toHaveLength(11);

    fireEvent.click(
      within(celulas).getByRole("button", {
        name: "Ver todas as 14 células",
      }),
    );
    expect(itens(celulas)).toHaveLength(14);
    expect(itens(celulas)[12]).toBe(
      "13º Célula Canaã Sua Davi Fictício 12% da meta 6 bilhetes",
    );
    expect(itens(celulas)[13]).toBe(
      "14º Célula Elim Rute Fictícia Sem meta 0 bilhetes",
    );
    expect(
      within(celulas)
        .getAllByRole("listitem")
        .some((item) => item.hasAttribute("data-depois-do-corte")),
    ).toBe(false);

    fireEvent.click(menos);
    expect(itens(discipuladores)).toHaveLength(10);
    within(discipuladores).getByRole("button", {
      name: "Ver todos os 12 discipuladores",
    });
  });

  it("a troca de janela: 'Campanha toda' pede a campanha e mostra o ranking dela; volta para a semana", async () => {
    const api = await abrir("discipulador");
    const geral = await cartao();
    const discipuladores = secao(geral, "Discipuladores");
    await waitFor(() => expect(itens(discipuladores)).toHaveLength(10));
    const janelas = within(
      within(geral).getByRole("group", { name: "Período do ranking geral" }),
    );
    expect(
      janelas.getByRole("button", { name: "Esta semana" }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(janelas.getByRole("button", { name: "Campanha toda" }));
    // Enquanto a outra janela chega, as listas saem (nunca as da janela anterior): a seção é outra.
    await waitFor(() =>
      expect(itens(secao(geral, "Discipuladores"))[0]).toBe(
        "1º Gabriel Fictício 82% da meta 360 bilhetes",
      ),
    );
    expect(geral).toHaveTextContent("Campanha inteira");
    expect(
      janelas.getByRole("button", { name: "Campanha toda" }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(janelas.getByRole("button", { name: "Esta semana" }));
    await waitFor(() =>
      expect(itens(secao(geral, "Discipuladores"))[0]).toBe(
        "1º Ester Fictícia 82% da meta 120 bilhetes",
      ),
    );
    expect(api.chamadasA("GET", CAMINHO).map((c) => c.caminho)).toEqual([
      `${CAMINHO}?janela=atual`,
      `${CAMINHO}?janela=campanha`,
      `${CAMINHO}?janela=atual`,
    ]);
    // A troca do ranking geral não mexe nos maiores compradores (cada cartão tem a sua).
    expect(
      api
        .chamadasA("GET", "/api/minha/maiores-compradores")
        .map((c) => c.caminho),
    ).toEqual(["/api/minha/maiores-compradores?janela=atual"]);
  });

  it("falha ao carregar: a explicação e 'Tentar de novo', que pede de novo", async () => {
    const api = criarApiFalsa(visaoDe({ papel: "discipulador" }));
    api.proxima(
      "GET",
      CAMINHO,
      respostaErro(500, "erro_interno", "Erro interno"),
    );
    await abrir("discipulador", api);
    const geral = await cartao();
    await within(geral).findByText(
      "Não foi possível carregar o ranking geral.",
    );
    fireEvent.click(
      within(geral).getByRole("button", { name: "Tentar de novo" }),
    );
    await waitFor(() =>
      expect(itens(secao(geral, "Discipuladores"))).toHaveLength(10),
    );
    expect(api.chamadasA("GET", CAMINHO)).toHaveLength(2);
  });

  it("sem células na campanha: as duas listas vazias, sem 'Ver todas'", async () => {
    const api = criarApiFalsa(visaoDe({ papel: "discipulador" }));
    api.proxima("GET", CAMINHO, () =>
      respostaJson(todasAsRedesDe("atual", ALVO_DISCIPULADOR, { vazia: true })),
    );
    await abrir("discipulador", api);
    const geral = await cartao();
    await within(geral).findByText("Ainda não há células na campanha.");
    expect(geral).toHaveTextContent("Ainda não há discipuladores com células.");
    expect(within(geral).queryByRole("list")).toBeNull();
    expect(
      within(geral).queryByRole("button", { name: /^Ver todo/ }),
    ).toBeNull();
  });
});

describe("RIFA-090: quem vê o ranking geral", () => {
  it("a rede também vê, com os discipuladores e as células dela em destaque ('Sua rede')", async () => {
    await abrir("rede");
    const geral = await cartao();
    const discipuladores = secao(geral, "Discipuladores");
    await waitFor(() => expect(itens(discipuladores)).toHaveLength(10));
    expect(destacados(discipuladores)).toEqual([
      "1º Ester Fictícia Sua rede 82% da meta 120 bilhetes",
      "3º Davi Fictício Sua rede 64% da meta 87 bilhetes",
      "4º Helio Fictício Sua rede 60% da meta 70 bilhetes",
    ]);
    expect(destacados(secao(geral, "Células"))).toHaveLength(6);
  });

  it("o líder da célula não vê o cartão nem pede a rota (o PO pediu só para os discipuladores)", async () => {
    const api = await abrir("lider");
    await waitFor(() =>
      expect(api.chamadasA("GET", "/api/minha/links-vendas")).toHaveLength(1),
    );
    expect(screen.queryByRole("heading", { name: "Ranking geral" })).toBeNull();
    expect(api.chamadasA("GET", CAMINHO)).toEqual([]);
  });
});
