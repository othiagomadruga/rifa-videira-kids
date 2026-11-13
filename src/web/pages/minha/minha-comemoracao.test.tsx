// RIFA-051 (P3.3, D25): a comemoração da meta batida na /minha, pela rota de verdade. O número grande comemora
// (useComemoracao, "ao-aparecer-e-ao-bater", uma vez por dia): ao abrir a página com a meta já batida ou quando uma
// atualização faz a meta bater, o pulso e as partículas, uma vez; a atualização de cada minuto (ainda batida) não
// repete e recarregar a página no mesmo dia também não; com prefers-reduced-motion: reduce, nada se mexe. O jsdom
// não tem matchMedia nem Element.animate: os ajudantes de test/movimento.ts simulam os dois.
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RespostaVisaoIndividual } from "../../../shared/contracts/api";
import {
  DURACAO_COMEMORACAO_MS,
  PARTICULAS,
  PREFIXO_ARMAZENAMENTO,
} from "../../lib/useComemoracao";
import {
  desfazerMovimento,
  espiarAnimate,
  simularPreferencia,
} from "../../test/movimento";
import { renderizarRota } from "../../test/renderizar";
import { CHAVE_COMEMORACAO_MINHA } from "./Destaque";
import {
  comPercentualDaCampanha,
  criarApiFalsa,
  sessaoDaVisao,
  visaoDe,
  type ApiFalsa,
} from "./teste-apoio";

const CAMINHO_VISAO = "/api/minha/visao";
/** O primeiro teste do arquivo carrega o pacote da visão (lazy). */
const ESPERA_DO_PACOTE = { timeout: 5000 };
/** Depois da comemoração, as partículas saem do DOM (com folga para a máquina carregada). */
const ESPERA_DO_FIM = { timeout: DURACAO_COMEMORACAO_MS + 3000 };

const numero = () =>
  document.querySelector<HTMLElement>(".minha-destaque__numero");
const particulas = () =>
  document.querySelectorAll(".minha-destaque__numero .mov-confete");

/** As chamadas do Element.animate simulado feitas nas partículas e no número (o pulso). */
function animacoes(animate: ReturnType<typeof espiarAnimate>) {
  const contextos = animate.mock.contexts as Element[];
  return {
    particulas: contextos.filter((elemento) =>
      elemento.classList.contains("mov-confete"),
    ).length,
    pulsos: contextos.filter((elemento) =>
      elemento.classList.contains("minha-destaque__numero"),
    ).length,
  };
}

async function abrir(api: ApiFalsa, visao: RespostaVisaoIndividual) {
  vi.stubGlobal("fetch", api.fetch);
  const tela = renderizarRota("/minha", { usuario: sessaoDaVisao(visao) });
  await screen.findByRole(
    "heading",
    { level: 2, name: "Ranking" },
    ESPERA_DO_PACOTE,
  );
  return tela;
}

/** A aba volta a ficar visível: a visão atualiza na hora (como a atualização de cada minuto). */
async function atualizar(api: ApiFalsa, chamadas: number) {
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await waitFor(() =>
    expect(api.chamadasA("GET", CAMINHO_VISAO)).toHaveLength(chamadas),
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  desfazerMovimento();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe("a comemoração da meta batida na /minha", () => {
  it("abre com a meta já batida: o pulso e as partículas no número, uma vez; a atualização (ainda batida) não repete", async () => {
    simularPreferencia(false);
    const animate = espiarAnimate();
    const visao = comPercentualDaCampanha(visaoDe(), 11_300);
    const api = criarApiFalsa(visao);
    await abrir(api, visao);

    // As partículas ficam dentro do número (a camada só visual), sem mudar o texto dele.
    expect(particulas()).toHaveLength(PARTICULAS.length);
    expect(numero()).toHaveTextContent(/^113%$/);
    expect(
      numero()?.querySelector(".mov-comemoracao[aria-hidden='true']"),
    ).not.toBeNull();
    expect(animacoes(animate)).toEqual({
      particulas: PARTICULAS.length,
      pulsos: 1,
    });
    // O cartão em volta recorta as partículas (nada de rolagem lateral): a classe que o CSS prende.
    expect(numero()?.closest(".minha-destaque__cartao")).not.toBeNull();

    await waitFor(() => expect(particulas()).toHaveLength(0), ESPERA_DO_FIM);
    await atualizar(api, 2);
    expect(particulas()).toHaveLength(0);
    expect(animacoes(animate)).toEqual({
      particulas: PARTICULAS.length,
      pulsos: 1,
    });
  });

  it("recarregar a página no mesmo dia não solta as partículas de novo (a data fica no sessionStorage)", async () => {
    simularPreferencia(false);
    const animate = espiarAnimate();
    const visao = comPercentualDaCampanha(visaoDe(), 11_300);
    const primeira = await abrir(criarApiFalsa(visao), visao);
    expect(particulas()).toHaveLength(PARTICULAS.length);
    expect(
      window.sessionStorage.getItem(
        `${PREFIXO_ARMAZENAMENTO}${CHAVE_COMEMORACAO_MINHA}`,
      ),
    ).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    primeira.unmount();
    animate.mockClear();

    await abrir(criarApiFalsa(visao), visao);
    expect(numero()).toHaveTextContent(/^113%$/);
    expect(particulas()).toHaveLength(0);
    expect(animacoes(animate).particulas).toBe(0);
  });

  it("bate a meta numa atualização: o selo aparece e o número comemora na hora", async () => {
    simularPreferencia(false);
    const animate = espiarAnimate();
    let percentual = 9_500;
    const api = criarApiFalsa(() =>
      comPercentualDaCampanha(visaoDe(), percentual),
    );
    await abrir(api, visaoDe());
    const destaque = screen
      .getByRole("heading", { level: 2, name: "Meta da campanha" })
      .closest("section") as HTMLElement;
    expect(numero()).toHaveTextContent(/^95%$/);
    expect(within(destaque).queryByText("Meta batida")).toBeNull();
    expect(particulas()).toHaveLength(0);
    expect(animacoes(animate)).toEqual({ particulas: 0, pulsos: 0 });

    percentual = 10_100;
    await atualizar(api, 2);
    await waitFor(() => expect(numero()).toHaveTextContent(/^101%$/));
    expect(
      within(destaque).getByText("Meta batida", {
        selector: ".minha-destaque__selo",
      }),
    ).toBeInTheDocument();
    expect(particulas()).toHaveLength(PARTICULAS.length);
    expect(animacoes(animate)).toEqual({
      particulas: PARTICULAS.length,
      pulsos: 1,
    });
  });

  it("com prefers-reduced-motion: reduce, nada se mexe: nem partícula no DOM nem animação (o selo fica)", async () => {
    simularPreferencia(true);
    const animate = espiarAnimate();
    const visao = comPercentualDaCampanha(visaoDe(), 11_300);
    await abrir(criarApiFalsa(visao), visao);
    expect(numero()).toHaveTextContent(/^113%$/);
    expect(
      screen.getByText("Meta batida", { selector: ".minha-destaque__selo" }),
    ).toBeInTheDocument();
    expect(particulas()).toHaveLength(0);
    expect(document.querySelector(".mov-comemoracao")).toBeNull();
    expect(animate).not.toHaveBeenCalled();
    // E nada guardado: com reduce, a comemoração nem chega a acontecer.
    expect(
      window.sessionStorage.getItem(
        `${PREFIXO_ARMAZENAMENTO}${CHAVE_COMEMORACAO_MINHA}`,
      ),
    ).toBeNull();
  });

  it("abaixo da meta: sem selo, sem pulso e sem partículas", async () => {
    simularPreferencia(false);
    const animate = espiarAnimate();
    const visao = visaoDe();
    await abrir(criarApiFalsa(visao), visao);
    expect(numero()).toHaveTextContent(/^35%$/);
    expect(document.querySelector(".minha-destaque__selo")).toBeNull();
    expect(particulas()).toHaveLength(0);
    expect(animacoes(animate)).toEqual({ particulas: 0, pulsos: 0 });
  });
});
