// RIFA-051 (P3.1, A-20): o menu da coordenação com um ícone por tela. Cada tela de TELAS_COORDENACAO tem um ícone que
// existe em components/ui/icones.ts, diferente dos outros (a coordenação acha a tela pelo desenho); o ícone vai ao
// AppShell pelo itensDaNavegacao e fica só visual: o nome acessível do link continua o rótulo.
import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ICONES, ehNomeDeIcone } from "../../components/ui";
import {
  ADMIN_DE_TESTE,
  USUARIO_DE_TESTE,
  renderizarRota,
  respostaJson,
} from "../../test/renderizar";
import { TELAS_COORDENACAO, itensDaNavegacao, telaVisivelPara } from "./telas";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A API responde 404 a tudo: aqui só importa a moldura (o menu), não o conteúdo da tela. */
function semApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      respostaJson(
        { erro: { codigo: "nao_encontrado", mensagem: "Rota não encontrada" } },
        404,
      ),
    ),
  );
}

describe("P3.1: o ícone de cada tela do menu", () => {
  it("toda tela tem um ícone que existe em icones.ts", () => {
    for (const tela of TELAS_COORDENACAO) {
      expect(ehNomeDeIcone(tela.icone), tela.rotulo).toBe(true);
      expect(ICONES[tela.icone], tela.rotulo).toMatch(/^M/);
    }
  });

  it("cada tela tem o seu ícone (nenhum repetido no menu)", () => {
    const icones = TELAS_COORDENACAO.map((tela) => tela.icone);
    expect(new Set(icones).size).toBe(icones.length);
  });

  it.each(["admin", "coordenacao"] as const)(
    "o itensDaNavegacao do papel %s leva o ícone de cada tela que ele vê",
    (papel) => {
      const visiveis = TELAS_COORDENACAO.filter((tela) =>
        telaVisivelPara(tela, papel),
      );
      expect(
        itensDaNavegacao(papel).map(({ rotulo, icone }) => [rotulo, icone]),
      ).toEqual(visiveis.map(({ rotulo, icone }) => [rotulo, icone]));
    },
  );

  it.each([
    ["admin", ADMIN_DE_TESTE],
    ["coordenação", USUARIO_DE_TESTE],
  ] as const)(
    "no menu (%s), cada link tem o desenho da tela, aria-hidden, e o nome acessível continua o rótulo",
    async (_papel, usuario) => {
      semApi();
      renderizarRota("/coordenacao/bumbo", { usuario });
      const menu = await screen.findByRole("navigation", {
        name: "Coordenação",
      });
      const esperados = TELAS_COORDENACAO.filter((tela) =>
        telaVisivelPara(tela, usuario.papel),
      );
      const links = within(menu).getAllByRole("link");
      expect(links.map((link) => link.textContent)).toEqual(
        esperados.map((tela) => tela.rotulo),
      );
      links.forEach((link, indice) => {
        const tela = esperados[indice];
        expect(link).toHaveAccessibleName(tela.rotulo);
        const desenhos = link.querySelectorAll("svg");
        expect(desenhos).toHaveLength(1);
        expect(desenhos[0]).toHaveAttribute("data-icone", tela.icone);
        expect(desenhos[0]).toHaveAttribute("aria-hidden", "true");
        expect(desenhos[0]).toHaveAttribute("focusable", "false");
        expect(desenhos[0].querySelector("title")).toBeNull();
      });
      expect(within(menu).getByRole("link", { name: "Bumbo" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    },
  );
});
