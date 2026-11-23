// RIFA-089 (adendo da D38): "Quem comprou" na /minha do líder da célula, pela rota de verdade e com a API falsa
// (teste-apoio.ts, respostas que passam no schema estrito do contrato). Só o líder vê o cartão; a lista vem da mais
// recente para a mais antiga com o nome (ou "Comprador sem nome"), "dd/mm às hh:mm" no fuso da campanha e os bilhetes;
// "Ver mais" traz a próxima página; nunca telefone nem dinheiro; todo controle com dica e o título com a ajuda.
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ItemQuemComprou,
  PapelHierarquia,
} from "../../../shared/contracts";
import { controlesSemDica, titulosSemAjuda } from "../../test/dicas";
import { renderizarRota, respostaJson } from "../../test/renderizar";
import { QuemComprou } from "./QuemComprou";
import {
  QUEM_COMPROU,
  criarApiFalsa,
  meusCompradoresDe,
  quemComprouDe,
  sessaoDaVisao,
  visaoDe,
} from "./teste-apoio";
import { quandoComprou } from "./textos";

const CAMINHO = "/api/minha/compradores";

async function abrir(
  papel: PapelHierarquia,
  quemComprou: (
    antesDe: string | null,
  ) => ReturnType<typeof quemComprouDe> = () => quemComprouDe(QUEM_COMPROU),
) {
  const visao = visaoDe({ papel });
  const api = criarApiFalsa(
    visao,
    null,
    null,
    (janela) => meusCompradoresDe(janela),
    quemComprou,
  );
  vi.stubGlobal("fetch", api.fetch);
  renderizarRota("/minha", { usuario: sessaoDaVisao(visao) });
  await screen.findByRole("heading", { level: 2, name: "Ranking" });
  return api;
}

async function cartao(): Promise<HTMLElement> {
  const titulo = await screen.findByRole("heading", {
    level: 2,
    name: "Quem comprou",
  });
  const elemento = titulo.closest<HTMLElement>(".minha-quem-comprou");
  if (!elemento) throw new Error("sem o cartão Quem comprou");
  return elemento;
}

function itens(elemento: HTMLElement): string[] {
  return within(elemento)
    .queryAllByRole("listitem")
    .map((item) => item.textContent ?? "");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RIFA-089: quem comprou na /minha do líder", () => {
  it("a data e a hora no fuso da campanha: '23/11 às 14:03'", () => {
    expect(quandoComprou("2026-11-23T17:03:00.000Z", "America/Belem")).toBe(
      "23/11 às 14:03",
    );
    expect(quandoComprou("2026-11-24T02:59:00.000Z", "America/Belem")).toBe(
      "23/11 às 23:59",
    );
  });

  it("a lista, da mais recente para a mais antiga, com nome (ou 'Comprador sem nome'), dia e hora e bilhetes; sem telefone nem R$", async () => {
    const api = await abrir("lider");
    const elemento = await cartao();
    await waitFor(() => expect(itens(elemento)).toHaveLength(3));
    expect(itens(elemento)).toEqual([
      "Rita Fictícia 04/12 às 14:03 4 bilhetes",
      "Comprador sem nome 04/12 às 09:30 1 bilhete",
      "Caio Fictício 03/12 às 19:15 2 bilhetes",
    ]);
    expect(elemento.textContent).not.toMatch(/R\$|\+55|telefone/i);
    expect(
      api.chamadasA("GET", CAMINHO).map((chamada) => chamada.caminho),
    ).toEqual([`${CAMINHO}?limite=20`]);
    expect(
      within(elemento).queryByRole("button", { name: "Ver mais" }),
    ).toBeNull();
  });

  it("'Ver mais' traz a próxima página pelo cursor, põe o foco na primeira compra nova e some na última", async () => {
    const primeira: ItemQuemComprou[] = QUEM_COMPROU.slice(0, 2);
    const api = await abrir("lider", (antesDe) =>
      antesDe === null
        ? quemComprouDe(primeira, "CURSOR_FICTICIO")
        : quemComprouDe(QUEM_COMPROU.slice(2)),
    );
    const elemento = await cartao();
    await waitFor(() => expect(itens(elemento)).toHaveLength(2));
    const botao = within(elemento).getByRole("button", { name: "Ver mais" });
    act(() => botao.focus());
    fireEvent.click(botao);
    await waitFor(() => expect(itens(elemento)).toHaveLength(3));
    expect(
      api.chamadasA("GET", CAMINHO).map((chamada) => chamada.caminho),
    ).toContain(`${CAMINHO}?limite=20&antes_de=CURSOR_FICTICIO`);
    expect(within(elemento).getAllByRole("listitem")[2]).toHaveFocus();
    expect(
      within(elemento).queryByRole("button", { name: "Ver mais" }),
    ).toBeNull();
  });

  it("sem compras: o aviso; e o cartão não aparece para o discipulador nem para a rede", async () => {
    await abrir("lider", () => quemComprouDe());
    expect(await cartao()).toHaveTextContent(
      "Ainda não há compras pagas da sua célula.",
    );
    vi.unstubAllGlobals();
    for (const papel of ["discipulador", "rede"] as const) {
      document.body.innerHTML = "";
      const api = await abrir(papel);
      expect(
        screen.queryByRole("heading", { level: 2, name: "Quem comprou" }),
      ).toBeNull();
      expect(api.chamadasA("GET", CAMINHO)).toEqual([]);
      vi.unstubAllGlobals();
    }
  });

  it("a primeira página atualizada enquanto o 'Ver mais' carregava: a página de antes não entra (não pula compras)", async () => {
    const [a, b, c] = QUEM_COMPROU;
    const nova: ItemQuemComprou = {
      nome: "Compra Nova Ficticia",
      aprovado_em: "2026-12-04T20:00:00.000Z",
      bilhetes: 3,
    };
    const resposta = (
      itensDaPagina: ItemQuemComprou[],
      proximo: string | null,
    ) =>
      respostaJson({
        fuso_horario: "America/Belem",
        itens: itensDaPagina,
        proximo,
        atualizado_em: "2026-12-04T20:01:00.000Z",
      });
    let soltarVerMais: (r: Response) => void = () => {};
    const primeiras = [
      resposta([a, b], "CURSOR_A"),
      resposta([nova, a], "CURSOR_B"),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn((entrada: RequestInfo | URL) =>
        String(entrada).includes("antes_de=CURSOR_A")
          ? new Promise<Response>((soltar) => (soltarVerMais = soltar))
          : Promise.resolve(primeiras.shift()!),
      ),
    );
    const { container, rerender } = render(
      <QuemComprou atualizadoEm="2026-12-04T20:00:00.000Z" />,
    );
    await waitFor(() => expect(itens(container)).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Ver mais" }));
    // A visão atualizou (novo atualizado_em) antes de o "Ver mais" responder: a primeira página é lida de novo.
    rerender(<QuemComprou atualizadoEm="2026-12-04T20:01:00.000Z" />);
    await waitFor(() =>
      expect(itens(container)[0]).toContain("Compra Nova Ficticia"),
    );
    // A página do cursor de antes chega depois: não se junta à primeira página nova (pularia a compra B).
    await act(async () => soltarVerMais(resposta([c], null)));
    expect(itens(container)).toHaveLength(2);
    expect(itens(container)[1]).toContain(a.nome ?? "Comprador sem nome");
    expect(
      screen.getByRole("button", { name: "Ver mais" }),
    ).toBeInTheDocument();
  });

  it("dicas e ajuda: o 'Ver mais' tem dica e o título tem a explicação", async () => {
    await abrir("lider", (antesDe) =>
      antesDe === null
        ? quemComprouDe(QUEM_COMPROU.slice(0, 1), "CURSOR_FICTICIO")
        : quemComprouDe(),
    );
    const elemento = await cartao();
    await within(elemento).findByRole("button", { name: "Ver mais" });
    expect(controlesSemDica(elemento)).toEqual([]);
    expect(await titulosSemAjuda(elemento)).toEqual([]);
  });
});
