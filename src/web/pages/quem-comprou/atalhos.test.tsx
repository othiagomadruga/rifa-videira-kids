// RIFA-093: o toque na célula em Rankings (o nome, no ranking de células) e na Hierarquia (o botão "Quem comprou" da
// linha) leva a Quem comprou com a célula já aberta, SÓ para o admin; para a coordenação, o nome continua só texto e o
// botão não aparece (o telefone do comprador é só do admin, D36). Com a dica e a varredura de dicas e ajuda do admin.
import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { controlesSemDica, titulosSemAjuda } from "../../test/dicas";
import {
  ADMIN_DE_TESTE,
  USUARIO_DE_TESTE,
  renderizarRota,
} from "../../test/renderizar";
import { criarApiFalsa as criarApiHierarquia } from "../hierarquia/teste-apoio";
import { DICAS as DICAS_HIERARQUIA } from "../hierarquia/textos";
import {
  item,
  respostaDaConsulta,
  simularApiRanking,
} from "../rankings/teste-apoio";
import { DICAS as DICAS_RANKINGS } from "../rankings/textos";

vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const CELULA = item({
  posicao: 1,
  id: 7,
  nome: "Célula Ficticia 07",
  realizado: 7,
  meta: 29,
  esperado: 5,
});

function textoDaDica(elemento: HTMLElement): string | undefined {
  fireEvent.pointerEnter(elemento, { pointerType: "mouse" });
  act(() => vi.advanceTimersByTime(1000));
  const ids = (elemento.getAttribute("aria-describedby") ?? "").split(/\s+/);
  const dica = ids
    .map((id) => document.getElementById(id))
    .find((alvo) => alvo?.getAttribute("role") === "tooltip");
  fireEvent.pointerLeave(elemento, { pointerType: "mouse" });
  act(() => vi.advanceTimersByTime(1000));
  return dica?.textContent ?? undefined;
}

describe("Rankings: o nome da célula leva a Quem comprou", () => {
  it("admin: no ranking de células, o nome é um link para /coordenacao/quem-comprou?celula=<id>, com a dica; o toque leva lá", async () => {
    simularApiRanking((consulta) => respostaDaConsulta(consulta, [CELULA]));
    const { roteador } = renderizarRota("/coordenacao/rankings", {
      usuario: ADMIN_DE_TESTE,
    });
    const tabela = await screen.findByRole("table", undefined, {
      timeout: 5000,
    });
    const link = within(tabela).getByRole("link", {
      name: "Célula Ficticia 07",
    });
    expect(link).toHaveAttribute("href", "/coordenacao/quem-comprou?celula=7");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    expect(textoDaDica(link)).toBe(DICAS_RANKINGS.quemComprou);
    vi.useRealTimers();
    expect(controlesSemDica()).toEqual([]);
    expect(await titulosSemAjuda()).toEqual([]);
    fireEvent.click(link);
    expect(roteador.state.location.pathname).toBe("/coordenacao/quem-comprou");
    expect(roteador.state.location.search).toBe("?celula=7");
  });

  it("admin: nos níveis de discipulador e rede, o nome continua só texto", async () => {
    simularApiRanking((consulta) =>
      respostaDaConsulta(consulta, [
        item({ ...CELULA, nome: "Discipulador Ficticio" }),
      ]),
    );
    renderizarRota("/coordenacao/rankings?nivel=discipulador", {
      usuario: ADMIN_DE_TESTE,
    });
    const tabela = await screen.findByRole("table", undefined, {
      timeout: 5000,
    });
    expect(within(tabela).queryByRole("link")).toBeNull();
  });

  it("coordenação: o nome da célula é só texto (nenhum link para Quem comprou)", async () => {
    simularApiRanking((consulta) => respostaDaConsulta(consulta, [CELULA]));
    renderizarRota("/coordenacao/rankings", { usuario: USUARIO_DE_TESTE });
    const tabela = await screen.findByRole("table", undefined, {
      timeout: 5000,
    });
    expect(within(tabela).getByText("Célula Ficticia 07")).toBeInTheDocument();
    expect(within(tabela).queryByRole("link")).toBeNull();
    expect(
      document.querySelector('a[href^="/coordenacao/quem-comprou"]'),
    ).toBeNull();
  });
});

describe("Hierarquia: o botão 'Quem comprou' da linha da célula", () => {
  async function abrir(usuario = ADMIN_DE_TESTE) {
    const api = criarApiHierarquia();
    vi.stubGlobal("fetch", api.fetch);
    const render = renderizarRota("/coordenacao/hierarquia", { usuario });
    await screen.findByRole("region", { name: "Resumo" }, { timeout: 5000 });
    return render;
  }

  it("admin: cada célula tem 'Quem comprou' (com a dica) que leva a /coordenacao/quem-comprou?celula=<id>", async () => {
    const { roteador } = await abrir();
    const links = screen.getAllByRole("link", { name: /^Quem comprou / });
    expect(links.length).toBeGreaterThan(1);
    const daAgape = screen.getByRole("link", {
      name: "Quem comprou Célula Ágape",
    });
    expect(daAgape).toHaveAttribute(
      "href",
      "/coordenacao/quem-comprou?celula=103",
    );
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    expect(textoDaDica(daAgape)).toBe(DICAS_HIERARQUIA.quemComprou);
    vi.useRealTimers();
    expect(controlesSemDica()).toEqual([]);
    expect(await titulosSemAjuda()).toEqual([]);
    fireEvent.click(daAgape);
    expect(roteador.state.location.pathname).toBe("/coordenacao/quem-comprou");
    expect(roteador.state.location.search).toBe("?celula=103");
  });

  it("coordenação: sem o botão (só Editar e Excluir)", async () => {
    await abrir(USUARIO_DE_TESTE);
    expect(
      screen.getAllByRole("button", { name: /^Excluir/ }).length,
    ).toBeGreaterThan(1);
    expect(screen.queryByRole("link", { name: /^Quem comprou/ })).toBeNull();
  });
});
