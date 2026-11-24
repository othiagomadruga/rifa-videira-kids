// RIFA-093 (adendo da D36): a tela "Quem comprou" do admin, pela rota de verdade e com a API falsa (teste-apoio.ts).
// Só o admin vê (menu e rota); as células em cartões, na ordem da API, com a busca sem acento; tocar abre as compras
// ali mesmo (uma célula por vez, guardada em ?celula=), com o nome (ou "Comprador sem nome"), "dd/mm às hh:mm", os
// bilhetes, o telefone com o WhatsApp e "atribuída à mão"; "Ver mais" e "Abrir em Pedidos". Sem R$; toda dica e ajuda.
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  contarControles,
  controlesSemDica,
  titulosSemAjuda,
} from "../../test/dicas";
import {
  ADMIN_DE_TESTE,
  USUARIO_DE_TESTE,
  renderizarRota,
} from "../../test/renderizar";
import { caminhoDeQuemComprou } from "./quem-comprou-api";
import { CELULAS, criarApiQuemComprou } from "./teste-apoio";
import { DICAS } from "./textos";

const TELA = "/coordenacao/quem-comprou";

// As varreduras de dica e ajuda passam o mouse em cada controle (como em coordenacao/dicas.test.tsx).
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function abrir(
  caminho = TELA,
  api = criarApiQuemComprou(),
  usuario = ADMIN_DE_TESTE,
) {
  vi.stubGlobal("fetch", api.fetch);
  const render = renderizarRota(caminho, { usuario });
  await screen.findByRole("heading", { level: 1, name: "Quem comprou" });
  return { api, ...render };
}

/** Os cartões das células, depois de a lista chegar. */
async function cartoes(): Promise<HTMLElement[]> {
  await screen.findAllByRole("button", { expanded: false });
  return Array.from(
    document.querySelectorAll<HTMLElement>(".quem-comprou-celula"),
  );
}

const contagem = () => document.querySelector(".quem-comprou__contagem");

const cartaoDe = (nome: string) =>
  screen.getByRole("button", { name: new RegExp(`^${nome},`) });

function acionar(elemento: HTMLElement) {
  act(() => elemento.focus());
  fireEvent.click(elemento);
}

describe("Quem comprou (só o admin)", () => {
  it("a coordenação não vê no menu e, pela URL, vê 'sem permissão' sem nada pedido à API", async () => {
    const api = criarApiQuemComprou();
    vi.stubGlobal("fetch", api.fetch);
    renderizarRota(TELA, { usuario: USUARIO_DE_TESTE });
    expect(
      await screen.findByText("Sem permissão para esta tela"),
    ).toBeInTheDocument();
    const menu = screen.getByRole("navigation", { name: "Coordenação" });
    expect(
      within(menu).queryByRole("link", { name: "Quem comprou" }),
    ).not.toBeInTheDocument();
    expect(api.pedidos.filter((p) => p.includes("compr"))).toEqual([]);
  });

  it("o admin vê no menu, logo depois de Pedidos; as células vêm em cartões, na ordem da API, com discipulador, bilhetes e compras; nenhuma aberta", async () => {
    const { api } = await abrir();
    const menu = screen.getByRole("navigation", { name: "Coordenação" });
    const rotulos = within(menu)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(rotulos[rotulos.indexOf("Pedidos") + 1]).toBe("Quem comprou");
    const lista = await cartoes();
    expect(lista.map((cartao) => cartao.textContent)).toEqual([
      "Célula Betel, Discipulador Abel, 12 bilhetes · 1 compra",
      "Célula Canaã, Discipulador Boaz, 12 bilhetes · 4 compras",
      "Célula Ágape, Discipulador Abel, 7 bilhetes · 1 compra",
      "Célula Dorcas, Discipulador Caleb, 0 bilhetes · 0 compras",
    ]);
    expect(contagem()).toHaveTextContent(
      "4 células, de quem vendeu mais para quem vendeu menos",
    );
    expect(screen.queryByRole("region", { name: /^Compras da/ })).toBeNull();
    // Só a lista das células: as compras vêm ao abrir o cartão.
    expect(api.pedidos).toEqual(["/api/admin/quem-comprou/celulas"]);
    expect(document.body.textContent).not.toMatch(/R\$|reais/);
  });

  it("tocar no cartão abre as compras ali mesmo (com a célula na URL): nome, quando, bilhetes, telefone com WhatsApp e 'atribuída à mão'; 'Ver mais' e 'Abrir em Pedidos'", async () => {
    const { api, roteador } = await abrir();
    await cartoes();
    acionar(cartaoDe("Célula Canaã"));
    expect(cartaoDe("Célula Canaã")).toHaveAttribute("aria-expanded", "true");
    expect(roteador.state.location.search).toBe("?celula=3");
    const painel = await screen.findByRole("region", {
      name: "Compras da Célula Canaã",
    });
    await within(painel).findByText("Comprador Ficticio Atribuido");
    expect(api.pedidos).toContain("/api/admin/celulas/3/compradores?limite=20");
    const compras = within(painel).getAllByRole("listitem");
    expect(compras.map((compra) => compra.textContent)).toEqual([
      "Comprador Ficticio Atribuido 24/11 às 10:00 · atribuída à mão 5 bilhetes (91) 90000-0004 (abre o WhatsApp em outra aba)",
      "Compradora Ficticia Tres 24/11 às 09:30 1 bilhete",
    ]);
    const whatsapp = within(compras[0]).getByRole("link", {
      name: /\(91\) 90000-0004/,
    });
    expect(whatsapp).toHaveAttribute("href", "https://wa.me/5591900000004");
    expect(whatsapp).toHaveAttribute("target", "_blank");
    expect(
      within(painel).getByRole("link", { name: "Abrir em Pedidos" }),
    ).toHaveAttribute("href", "/coordenacao/pedidos?celula_id=3");

    acionar(within(painel).getByRole("button", { name: "Ver mais" }));
    await within(painel).findByText("Comprador sem nome");
    expect(api.pedidos).toContain(
      "/api/admin/celulas/3/compradores?limite=20&antes_de=cursor-2",
    );
    const todas = within(painel).getAllByRole("listitem");
    expect(todas).toHaveLength(4);
    expect(todas[2]).toHaveTextContent(
      "Comprador sem nome 23/11 às 14:03 4 bilhetes (91) 90000-0002",
    );
    // A primeira compra nova recebe o foco; acabou: o "Ver mais" some.
    await waitFor(() => expect(todas[2]).toHaveFocus());
    expect(
      within(painel).queryByRole("button", { name: "Ver mais" }),
    ).toBeNull();
    // Nada de R$, DDD ou id do pedido à vista.
    expect(painel.textContent).not.toMatch(/R\$|DDD|ATRIBUIDA|CANAA-/);
  });

  it("uma célula aberta por vez: abrir outra fecha a anterior; tocar de novo fecha e tira a célula da URL", async () => {
    const { roteador } = await abrir();
    await cartoes();
    acionar(cartaoDe("Célula Canaã"));
    await screen.findByRole("region", { name: "Compras da Célula Canaã" });
    acionar(cartaoDe("Célula Ágape"));
    const agape = await screen.findByRole("region", {
      name: "Compras da Célula Ágape",
    });
    expect(
      screen.queryByRole("region", { name: "Compras da Célula Canaã" }),
    ).toBeNull();
    expect(cartaoDe("Célula Canaã")).toHaveAttribute("aria-expanded", "false");
    expect(roteador.state.location.search).toBe("?celula=1");
    await within(agape).findByText("Comprador Ficticio da Célula Ágape");
    acionar(cartaoDe("Célula Ágape"));
    expect(screen.queryByRole("region", { name: /^Compras da/ })).toBeNull();
    expect(roteador.state.location.search).toBe("");
    // Sem compras: o aviso, sem "Ver mais".
    acionar(cartaoDe("Célula Dorcas"));
    const dorcas = await screen.findByRole("region", {
      name: "Compras da Célula Dorcas",
    });
    expect(
      await within(dorcas).findByText(
        "Ainda não há compras pagas desta célula.",
      ),
    ).toBeInTheDocument();
  });

  it("chegando com ?celula= (de Rankings ou da Hierarquia), a célula já vem aberta", async () => {
    await abrir(caminhoDeQuemComprou(3));
    const painel = await screen.findByRole("region", {
      name: "Compras da Célula Canaã",
    });
    expect(
      await within(painel).findByText("Comprador Ficticio Atribuido"),
    ).toBeInTheDocument();
    expect(cartaoDe("Célula Canaã")).toHaveAttribute("aria-expanded", "true");
  });

  it("a busca filtra enquanto digita, sem acento nem maiúscula; sem resultado, 'Limpar busca' volta tudo", async () => {
    await abrir();
    await cartoes();
    const busca = screen.getByRole("searchbox", { name: /Buscar célula/ });
    fireEvent.change(busca, { target: { value: "CANAA" } });
    expect(
      Array.from(document.querySelectorAll(".quem-comprou-celula__nome")).map(
        (nome) => nome.textContent,
      ),
    ).toEqual(["Célula Canaã"]);
    expect(contagem()).toHaveTextContent("1 de 4 células");
    fireEvent.change(busca, { target: { value: "agape" } });
    expect(cartaoDe("Célula Ágape")).toBeInTheDocument();
    fireEvent.change(busca, { target: { value: "nenhuma assim" } });
    expect(
      screen.getByText("Nenhuma célula com esse nome."),
    ).toBeInTheDocument();
    acionar(screen.getByRole("button", { name: "Limpar busca" }));
    expect(busca).toHaveValue("");
    expect(document.querySelectorAll(".quem-comprou-celula")).toHaveLength(
      CELULAS.length,
    );
  });

  it("sem campanha ativa: o aviso com o link para Campanha; falha: 'Tentar de novo'", async () => {
    await abrir(TELA, criarApiQuemComprou({ celulas: 404 }));
    expect(
      await screen.findByText("Nenhuma campanha ativa."),
    ).toBeInTheDocument();
    vi.unstubAllGlobals();
    const api = criarApiQuemComprou({ celulas: 500 });
    vi.stubGlobal("fetch", api.fetch);
    renderizarRota(TELA, { usuario: ADMIN_DE_TESTE });
    expect(
      await screen.findByText("Não foi possível carregar as células."),
    ).toBeInTheDocument();
  });

  it("dicas e ajuda: fechada, aberta (com 'Ver mais', o WhatsApp e 'Abrir em Pedidos') e a busca sem resultado", async () => {
    await abrir();
    await cartoes();
    expect(contarControles()).toBeGreaterThanOrEqual(CELULAS.length + 1);
    expect(controlesSemDica()).toEqual([]);
    expect(await titulosSemAjuda()).toEqual([]);

    acionar(cartaoDe("Célula Canaã"));
    const painel = await screen.findByRole("region", {
      name: "Compras da Célula Canaã",
    });
    await within(painel).findByRole("button", { name: "Ver mais" });
    expect(controlesSemDica()).toEqual([]);
    expect(await titulosSemAjuda()).toEqual([]);

    fireEvent.change(screen.getByRole("searchbox", { name: /Buscar célula/ }), {
      target: { value: "nenhuma assim" },
    });
    expect(controlesSemDica()).toEqual([]);
    expect(DICAS.limparBusca).toMatch(/\.$/);
  });
});
