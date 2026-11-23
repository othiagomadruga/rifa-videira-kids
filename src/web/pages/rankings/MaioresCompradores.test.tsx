// RIFA-083 (D38): os maiores compradores na tela Rankings da coordenação, só para o admin. Pela rota de verdade, com
// uma API falsa que responde o ranking (o de sempre), a lista das redes e GET /api/admin/maiores-compradores (cada
// resposta passa pelo schema estrito do contrato). O bloco: a troca "Esta semana" / "Campanha toda", a lista
// (posição, nome, células, bilhetes, total em R$ e o telefone com o link do WhatsApp) e o vazio. A coordenação não vê
// o bloco nem pede a rota. Nomes e telefones fictícios.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  respostaMaioresCompradoresSchema,
  type ItemMaiorComprador,
  type RespostaMaioresCompradores,
} from "../../../shared/contracts/api";
import { ehListaDasRedes, respostaRedes } from "../../test/redes";
import {
  ADMIN_DE_TESTE,
  USUARIO_DE_TESTE,
  renderizarRota,
  respostaJson,
} from "../../test/renderizar";
import {
  JANELA_CAMPANHA,
  JANELA_SEMANA_2,
  item,
  respostaDaConsulta,
  respostaDosGrupos,
} from "./teste-apoio";

const CAMINHO = "/api/admin/maiores-compradores";

const DA_SEMANA: ItemMaiorComprador[] = [
  {
    posicao: 1,
    nome: "Rita Ficticia",
    telefone: "(91) 98888-7777",
    whatsapp: "5591988887777",
    bilhetes: 12,
    total_centavos: 24_000,
    pedidos: 3,
    celulas: ["Célula Ficticia 01", "Célula Ficticia 02"],
    sem_celula: false,
  },
  {
    posicao: 2,
    nome: null,
    telefone: null,
    whatsapp: null,
    bilhetes: 1,
    total_centavos: 2000,
    pedidos: 1,
    celulas: [],
    sem_celula: true,
  },
];

const DA_CAMPANHA: ItemMaiorComprador[] = [
  { ...DA_SEMANA[0], bilhetes: 40, total_centavos: 80_000, pedidos: 9 },
];

function resposta(
  janela: string | null,
  itens: ItemMaiorComprador[],
): RespostaMaioresCompradores {
  return respostaMaioresCompradoresSchema.parse({
    janela: janela === "campanha" ? JANELA_CAMPANHA : JANELA_SEMANA_2,
    itens,
    atualizado_em: "2026-12-04T18:30:00.000Z",
  });
}

/** O fetch falso: o ranking (uma célula), as redes e os maiores compradores (`compradores` por janela). */
function simularApi(
  compradores: (janela: string | null) => ItemMaiorComprador[] = (janela) =>
    janela === "campanha" ? DA_CAMPANHA : DA_SEMANA,
) {
  const pedidos: string[] = [];
  const fetchMock = vi.fn(async (entrada: RequestInfo | URL) => {
    const caminho = String(entrada);
    const url = new URL(caminho, "http://localhost");
    if (ehListaDasRedes(caminho)) return respostaRedes(2);
    // RIFA-084: o ranking por grupo, sem grupo (a seção não aparece).
    if (url.pathname === "/api/painel/ranking-grupos")
      return respostaJson(respostaDosGrupos(url.searchParams));
    if (url.pathname === CAMINHO) {
      pedidos.push(`${url.pathname}${url.search}`);
      const janela = url.searchParams.get("janela");
      return respostaJson(resposta(janela, compradores(janela)));
    }
    return respostaJson(
      respostaDaConsulta(url.searchParams, [
        item({
          posicao: 1,
          id: 1,
          nome: "Célula Ficticia 01",
          realizado: 7,
          meta: 29,
          esperado: 5,
        }),
      ]),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return { pedidos };
}

async function bloco(): Promise<HTMLElement> {
  const titulo = await screen.findByRole(
    "heading",
    { level: 2, name: "Maiores compradores" },
    { timeout: 5000 },
  );
  const cartao = titulo.closest<HTMLElement>(".rankings-compradores");
  if (!cartao) throw new Error("sem o cartão dos compradores");
  return cartao;
}

const itens = (cartao: HTMLElement) =>
  within(cartao)
    .queryAllByRole("listitem")
    .map((linha) => linha.textContent ?? "");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RIFA-083: maiores compradores nos Rankings (só o admin)", () => {
  it("admin: a semana (padrão), com posição, nome, células, telefone com o WhatsApp, bilhetes e total em R$", async () => {
    const { pedidos } = simularApi();
    renderizarRota("/coordenacao/rankings", { usuario: ADMIN_DE_TESTE });
    const cartao = await bloco();
    await waitFor(() => expect(itens(cartao)).toHaveLength(2));
    const [primeiro, segundo] = within(cartao).getAllByRole("listitem");
    expect(primeiro).toHaveTextContent(
      /^1º Rita Ficticia Célula Ficticia 01, Célula Ficticia 02 \(91\) 98888-7777 \(abre o WhatsApp em outra aba\) 12 bilhetes R\$\s240,00$/,
    );
    expect(within(primeiro).getByRole("link")).toHaveAttribute(
      "href",
      "https://wa.me/5591988887777",
    );
    expect(within(primeiro).getByRole("link")).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(segundo).toHaveTextContent(
      /^2º Sem nome Sem célula Sem telefone 1 bilhete R\$\s20,00$/,
    );
    expect(within(segundo).queryByRole("link")).toBeNull();
    expect(cartao).toHaveTextContent("Semana 2: 03/12/2026 a 09/12/2026");
    expect(
      within(cartao).getByRole("button", { name: "Esta semana" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(pedidos).toEqual([`${CAMINHO}?janela=atual`]);
  });

  it("a troca de janela: 'Campanha toda' pede a campanha e mostra a lista dela", async () => {
    const { pedidos } = simularApi();
    renderizarRota("/coordenacao/rankings", { usuario: ADMIN_DE_TESTE });
    const cartao = await bloco();
    await waitFor(() => expect(itens(cartao)).toHaveLength(2));
    fireEvent.click(
      within(cartao).getByRole("button", { name: "Campanha toda" }),
    );
    await waitFor(() => expect(itens(cartao)).toHaveLength(1));
    expect(itens(cartao)[0]).toMatch(/40 bilhetes R\$\s800,00$/);
    expect(cartao).toHaveTextContent(
      "Campanha inteira: 23/11/2026 a 16/12/2026",
    );
    expect(
      within(cartao).getByRole("button", { name: "Campanha toda" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(pedidos).toEqual([
      `${CAMINHO}?janela=atual`,
      `${CAMINHO}?janela=campanha`,
    ]);
  });

  it("sem compras: 'Ainda não há compras nesta semana.'", async () => {
    simularApi(() => []);
    renderizarRota("/coordenacao/rankings", { usuario: ADMIN_DE_TESTE });
    const cartao = await bloco();
    await within(cartao).findByText("Ainda não há compras nesta semana.");
    expect(within(cartao).queryByRole("list")).toBeNull();
  });

  it("coordenação: sem o bloco e sem pedir a rota (telefone e R$ do comprador são só do admin)", async () => {
    const { pedidos } = simularApi();
    renderizarRota("/coordenacao/rankings", { usuario: USUARIO_DE_TESTE });
    await screen.findByRole("table", undefined, { timeout: 5000 });
    expect(
      screen.queryByRole("heading", { name: "Maiores compradores" }),
    ).toBeNull();
    expect(pedidos).toEqual([]);
  });
});
