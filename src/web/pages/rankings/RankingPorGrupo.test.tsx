// RIFA-084 (D39): o ranking por grupo do discipulador nos Rankings da coordenação, embaixo do ranking de todas: no mesmo
// nível (células ou discipuladores) e na mesma janela, um bloco por grupo com a tabela de sempre e a posição dentro do
// grupo. Sem grupo com células, a seção não aparece. Na aba Redes, nem é pedida.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GrupoRanking } from "../../../shared/contracts/calculos";
import { renderizarRota, respostaJson } from "../../test/renderizar";
import {
  item,
  respostaDaConsulta,
  respostaDosGrupos,
  simularApiRanking,
  type ResponderGrupos,
} from "./teste-apoio";

const TELA = "/coordenacao/rankings";

const TODAS = [
  item({
    posicao: 1,
    id: 1,
    nome: "Célula Ficticia 01",
    realizado: 7,
    meta: 29,
    esperado: 5,
  }),
  item({
    posicao: 2,
    id: 2,
    nome: "Célula Ficticia 02",
    realizado: 2,
    meta: 22,
    esperado: 4,
  }),
  item({
    posicao: 3,
    id: 3,
    nome: "Célula Ficticia 03",
    realizado: 1,
    meta: 36,
    esperado: 6,
  }),
];

/** Dois grupos: a posição é a de dentro de cada um (a 02 é a 1ª da noite, embora seja a 2ª de todas). */
const GRUPOS: GrupoRanking[] = [
  {
    id: 1,
    nome: "Adultos da manhã",
    ordem: 1,
    itens: [
      item({
        posicao: 1,
        id: 1,
        nome: "Célula Ficticia 01",
        realizado: 7,
        meta: 29,
        esperado: 5,
      }),
    ],
  },
  {
    id: 2,
    nome: "Adultos da noite",
    ordem: 2,
    itens: [
      item({
        posicao: 1,
        id: 2,
        nome: "Célula Ficticia 02",
        realizado: 2,
        meta: 22,
        esperado: 4,
      }),
      item({
        posicao: 2,
        id: 3,
        nome: "Célula Ficticia 03",
        realizado: 1,
        meta: 36,
        esperado: 6,
      }),
    ],
  },
];

let api: ReturnType<typeof simularApiRanking>;

afterEach(() => {
  expect(api.inesperadas).toEqual([]);
  vi.unstubAllGlobals();
});

function abrir(
  grupos: ResponderGrupos = (consulta) => respostaDosGrupos(consulta, GRUPOS),
) {
  api = simularApiRanking((consulta) => respostaDaConsulta(consulta, TODAS), {
    grupos,
  });
  return renderizarRota(TELA);
}

const secao = () => screen.findByRole("region", { name: "Ranking por grupo" });

/** O nome de cada grupo e as linhas dele (posição e nome). */
function blocos(regiao: HTMLElement) {
  return within(regiao)
    .getAllByRole("region")
    .map((bloco) => ({
      grupo: within(bloco).getByRole("heading", { level: 3 }).textContent,
      linhas: within(bloco)
        .getAllByRole("row")
        .slice(1)
        .map((linha) =>
          [
            linha.querySelector(".rankings-posicao")?.textContent,
            linha.querySelector(".rankings-linha__titulo")?.textContent,
          ].join(" "),
        ),
    }));
}

describe("RIFA-084: o ranking por grupo nos Rankings", () => {
  it("embaixo do ranking de todas: um bloco por grupo, na ordem, com a posição dentro do grupo", async () => {
    abrir();
    const regiao = await secao();
    expect(api.pedidosDosGrupos).toEqual([
      "/api/painel/ranking-grupos?nivel=celula&janela=atual",
    ]);
    // A seção vem depois da tabela do ranking de todas.
    const [geral] = screen.getAllByRole("table");
    expect(
      geral.compareDocumentPosition(regiao) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(regiao).getByRole("heading", { level: 2 })).toHaveTextContent(
      "Ranking por grupo",
    );
    expect(blocos(regiao)).toEqual([
      { grupo: "Adultos da manhã", linhas: ["1º Célula Ficticia 01"] },
      {
        grupo: "Adultos da noite",
        linhas: ["1º Célula Ficticia 02", "2º Célula Ficticia 03"],
      },
    ]);
    // Cada tabela diz o grupo na legenda (para o leitor de tela).
    expect(
      within(regiao).getByRole("table", {
        name: "Ranking: células · Semana 2 · Adultos da noite",
      }),
    ).toBeInTheDocument();
  });

  it("sem grupo com células (grupos vazio): a seção não aparece", async () => {
    abrir((consulta) => respostaDosGrupos(consulta));
    await screen.findByRole("table");
    await waitFor(() => expect(api.pedidosDosGrupos).toHaveLength(1));
    expect(
      screen.queryByRole("region", { name: "Ranking por grupo" }),
    ).toBeNull();
    expect(screen.queryByText("Ranking por grupo")).toBeNull();
  });

  it("segue a aba e a janela: discipuladores e campanha pedem de novo; na aba Redes, a seção some", async () => {
    abrir();
    await secao();
    fireEvent.click(screen.getByRole("tab", { name: "Discipuladores" }));
    await waitFor(() =>
      expect(api.pedidosDosGrupos.at(-1)).toBe(
        "/api/painel/ranking-grupos?nivel=discipulador&janela=atual",
      ),
    );
    fireEvent.change(screen.getByLabelText("Janela"), {
      target: { value: "campanha" },
    });
    await waitFor(() =>
      expect(api.pedidosDosGrupos.at(-1)).toBe(
        "/api/painel/ranking-grupos?nivel=discipulador&janela=campanha",
      ),
    );
    await secao();

    const pedidos = api.pedidosDosGrupos.length;
    fireEvent.click(screen.getByRole("tab", { name: "Redes" }));
    await waitFor(() =>
      expect(api.caminhos.at(-1)).toBe(
        "/api/painel/ranking?nivel=rede&periodo=campanha",
      ),
    );
    await screen.findByRole("table");
    expect(
      screen.queryByRole("region", { name: "Ranking por grupo" }),
    ).toBeNull();
    expect(api.pedidosDosGrupos).toHaveLength(pedidos);
  });

  it("falha: o aviso com 'Tentar de novo' na seção, sem derrubar o ranking de cima; a nova tentativa mostra os grupos", async () => {
    let falhar = true;
    abrir((consulta) =>
      falhar
        ? respostaJson(
            { erro: { codigo: "erro_interno", mensagem: "Erro interno" } },
            500,
          )
        : respostaDosGrupos(consulta, GRUPOS),
    );
    const regiao = await secao();
    expect(
      within(regiao).getByText(
        "Não foi possível carregar o ranking por grupo.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("table")).toHaveLength(1);
    falhar = false;
    fireEvent.click(
      within(regiao).getByRole("button", { name: "Tentar de novo" }),
    );
    await waitFor(() =>
      expect(
        blocos(screen.getByRole("region", { name: "Ranking por grupo" })),
      ).toHaveLength(2),
    );
  });
});

describe("RIFA-085 (D39, adendo): o grupo próprio da célula", () => {
  it("a descrição da seção: nas células, diz que a célula de grupo próprio fica no grupo dela; nos discipuladores, o grupo do discipulador", async () => {
    abrir();
    const descricao = async () =>
      (await secao()).querySelector(".rankings-grupos__descricao")?.textContent;
    expect(await descricao()).toBe(
      "A mesma disputa, separada por grupo: a posição é dentro do grupo. Cada célula fica no grupo do discipulador, ou no grupo próprio dela, se tiver.",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Discipuladores" }));
    await waitFor(() =>
      expect(api.pedidosDosGrupos.at(-1)).toBe(
        "/api/painel/ranking-grupos?nivel=discipulador&janela=atual",
      ),
    );
    await waitFor(async () =>
      expect(await descricao()).toBe(
        "A mesma disputa, separada pelo grupo do discipulador: a posição é dentro do grupo.",
      ),
    );
  });
});
