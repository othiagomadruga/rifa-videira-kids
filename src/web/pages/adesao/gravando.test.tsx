// RIFA-045 (a convenção da RIFA-045c nesta tela): gravando, os botões da Adesão ficam indisponíveis com aria-disabled, não
// disabled. Pelo teclado, eles continuam no Tab e a dica diz por quê (com o disabled, o foco caía no <body> no meio da
// gravação, e no diálogo de remover caía fora dele); o clique, o Enter e o espaço não fazem nada (nem o Enter no campo,
// que envia o formulário); a cara continua a do disabled. Pela rota de verdade, com a API falsa de teste-apoio.ts.
import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { dicaDe } from "../../test/dicas";
import {
  chegarPeloTab,
  conferirIndisponivel,
  esperarDisponivel,
  esperarIndisponivel,
  lerCss,
} from "../../test/indisponivel";
import { ADMIN_DE_TESTE, renderizarRota } from "../../test/renderizar";
import { simularApiAdesao } from "./teste-apoio";
import { DICAS } from "./textos";

/** A cara de indisponível vem do Button.css (RIFA-047), e o adesao.css não a desfaz (a cascata, em caraDeIndisponivel). */
const CSS = [
  lerCss("components/ui/Button.css"),
  lerCss("pages/adesao/adesao.css"),
];

let api: ReturnType<typeof simularApiAdesao> | null = null;

afterEach(() => {
  expect(api?.inesperadas ?? []).toEqual([]);
  api = null;
});

/** Abre a Adesão (coordenação, ou o admin) com a reunião de teste e espera o painel. */
async function abrir(usuario?: typeof ADMIN_DE_TESTE) {
  api = simularApiAdesao();
  renderizarRota("/coordenacao/adesao", usuario ? { usuario } : {});
  await screen.findByText(/^Atualizado às/, undefined, { timeout: 5000 });
  return api;
}

/** Quantas gravações (PUT do vínculo ou DELETE do afiliado) chegaram à API falsa. */
function gravacoes(metodo: "PUT" | "DELETE"): number {
  return (api?.fetchMock.mock.calls ?? []).filter(
    ([, init]) => init?.method === metodo,
  ).length;
}

/** Foca e clica, como o toque e o Enter fazem no navegador (o jsdom não foca no clique). */
function acionar(elemento: HTMLElement) {
  act(() => elemento.focus());
  fireEvent.click(elemento);
}

const botao = (nome: string | RegExp) =>
  screen.getByRole("button", { name: nome });

/** O cartão da célula na lista "Todas as células". */
const naLista = (nome: string) =>
  within(
    within(screen.getByRole("region", { name: "Todas as células" }))
      .getByRole("heading", { level: 3, name: nome })
      .closest("article") as HTMLElement,
  );

describe("RIFA-045: os botões em gravação da Adesão, pelo teclado", () => {
  it("Vincular: 'Salvando…' e Cancelar não gravam de novo nem fecham a escolha; o Enter na busca também não", async () => {
    await abrir();
    acionar(botao("Vincular o afiliado 1044"));
    const escolha = await screen.findByRole("group", {
      name: "Célula do afiliado 1044",
    });
    fireEvent.click(
      within(escolha).getByRole("radio", { name: /^Célula Débora/ }),
    );
    const confirmar = botao("Vincular: Célula Débora");
    const cancelar = botao("Cancelar");
    esperarDisponivel(confirmar);
    esperarDisponivel(cancelar);

    const soltar = api!.segurarGravacoes();
    acionar(confirmar);
    expect(confirmar).toHaveTextContent("Salvando…");
    // O foco fica no botão (com o disabled, caía no <body>).
    expect(confirmar).toHaveFocus();
    const semEfeito = () => {
      expect(gravacoes("PUT")).toBe(1);
      expect(
        screen.getByRole("group", { name: "Célula do afiliado 1044" }),
      ).toBe(escolha);
    };
    await conferirIndisponivel(confirmar, {
      dica: DICAS.salvandoEscolha,
      semEfeito,
      css: CSS,
    });
    await conferirIndisponivel(cancelar, {
      dica: DICAS.salvandoEscolha,
      semEfeito,
      css: CSS,
    });
    // O Enter no campo de busca envia o formulário (o botão de enviar não está disabled): o envio é barrado.
    fireEvent.submit(
      screen
        .getByRole("searchbox", { name: "Buscar célula ou líder" })
        .closest("form") as HTMLFormElement,
    );
    semEfeito();

    soltar();
    expect(
      await screen.findAllByText("Afiliado 1044 vinculado: Célula Débora."),
    ).not.toHaveLength(0);
    expect(gravacoes("PUT")).toBe(1);
  });

  it("Desvincular: 'Desvinculando…' e Cancelar não gravam de novo nem fecham a pergunta", async () => {
    await abrir();
    acionar(
      naLista("Célula Betel").getByRole("button", {
        name: "Desvincular o afiliado 1001",
      }),
    );
    const confirmar = await naLista("Célula Betel").findByRole("button", {
      name: "Confirmar desvínculo",
    });
    const cancelar = naLista("Célula Betel").getByRole("button", {
      name: "Cancelar",
    });

    const soltar = api!.segurarGravacoes();
    acionar(confirmar);
    expect(confirmar).toHaveTextContent("Desvinculando…");
    expect(confirmar).toHaveFocus();
    const semEfeito = () => {
      expect(gravacoes("PUT")).toBe(1);
      expect(
        naLista("Célula Betel").getByText(/^Desvincular o afiliado 1001/),
      ).toBeInTheDocument();
    };
    await conferirIndisponivel(confirmar, {
      dica: DICAS.desvinculando,
      semEfeito,
      css: CSS,
    });
    await conferirIndisponivel(cancelar, {
      dica: DICAS.desvinculando,
      semEfeito,
      css: CSS,
    });

    soltar();
    expect(
      await screen.findAllByText(
        "Afiliado 1001 desvinculado. Ele voltou para “Sem célula”.",
      ),
    ).not.toHaveLength(0);
    expect(gravacoes("PUT")).toBe(1);
  });

  it("pré-cadastro: 'Salvando…' não grava de novo; o Enter no campo também não", async () => {
    await abrir();
    const debora = naLista("Célula Débora");
    const campo = debora.getByRole("textbox", {
      name: "Código de afiliado (Célula Débora)",
    });
    fireEvent.change(campo, { target: { value: "2001" } });
    const salvar = debora.getByRole("button", { name: "Salvar código" });

    const soltar = api!.segurarGravacoes();
    acionar(salvar);
    expect(salvar).toHaveTextContent("Salvando…");
    expect(salvar).toHaveFocus();
    const semEfeito = () => expect(gravacoes("PUT")).toBe(1);
    await conferirIndisponivel(salvar, {
      dica: DICAS.salvandoCodigo,
      semEfeito,
      css: CSS,
    });
    fireEvent.submit(campo.closest("form") as HTMLFormElement);
    semEfeito();

    soltar();
    expect(
      await screen.findAllByText(
        "Código 2001 pré-cadastrado: Célula Débora. As vendas dele já vão contar para a célula.",
      ),
    ).not.toHaveLength(0);
    expect(gravacoes("PUT")).toBe(1);
  });

  it("pré-cadastro com troca: 'Salvando…', 'Trocar para esta célula' e Cancelar não gravam de novo; o Enter no campo também não", async () => {
    await abrir();
    const agape = naLista("Célula Ágape");
    const campo = agape.getByRole("textbox", {
      name: "Código de afiliado (Célula Ágape)",
    });
    fireEvent.change(campo, { target: { value: "1002" } });
    const salvar = agape.getByRole("button", { name: "Salvar código" });
    fireEvent.click(salvar);
    const trocarPara = await agape.findByRole("button", {
      name: "Trocar para esta célula",
    });
    const cancelar = agape.getByRole("button", { name: "Cancelar" });

    const soltar = api!.segurarGravacoes();
    acionar(trocarPara);
    expect(salvar).toHaveTextContent("Salvando…");
    expect(trocarPara).toHaveFocus();
    const semEfeito = () => {
      expect(gravacoes("PUT")).toBe(1);
      expect(
        agape.getByText(/^O afiliado 1002 está em Célula Canaã/),
      ).toBeInTheDocument();
    };
    for (const [controle, nome] of [
      [salvar, "Salvando…"],
      [trocarPara, "Trocar para esta célula"],
      [cancelar, "Cancelar"],
    ] as const) {
      expect(controle).toHaveTextContent(nome);
      await conferirIndisponivel(controle, {
        dica: DICAS.salvandoCodigo,
        semEfeito,
        css: CSS,
      });
    }
    fireEvent.submit(campo.closest("form") as HTMLFormElement);
    semEfeito();

    soltar();
    expect(
      await screen.findAllByText("Afiliado 1002 trocado para: Célula Ágape."),
    ).not.toHaveLength(0);
    expect(gravacoes("PUT")).toBe(1);
  });

  it("remover (admin): o foco fica no diálogo; 'Removendo…', Cancelar, o Esc e o × não fazem nada até a resposta", async () => {
    await abrir(ADMIN_DE_TESTE);
    acionar(botao("Remover o afiliado 1044"));
    const dialogo = await screen.findByRole("alertdialog", {
      name: "Remover o afiliado 1044?",
    });
    const remover = within(dialogo).getByRole("button", {
      name: "Remover afiliado",
    });
    const cancelar = within(dialogo).getByRole("button", { name: "Cancelar" });
    const fechar = within(dialogo).getByRole("button", { name: "Fechar" });

    const soltar = api!.segurarGravacoes();
    acionar(remover);
    expect(remover).toHaveTextContent("Removendo…");
    // Com o disabled, o foco caía no <body>, fora do diálogo.
    expect(remover).toHaveFocus();
    esperarIndisponivel(cancelar);
    const semEfeito = () => {
      expect(screen.getByRole("alertdialog")).toBe(dialogo);
      expect(gravacoes("DELETE")).toBe(1);
    };
    await conferirIndisponivel(remover, {
      dica: DICAS.removendo,
      semEfeito,
      css: CSS,
    });
    await conferirIndisponivel(cancelar, {
      dica: DICAS.removendo,
      semEfeito,
      css: CSS,
    });

    // O × diz o mesmo motivo; o Esc (depois do que fecha a dica) e o × são ignorados enquanto remove.
    chegarPeloTab(fechar);
    expect(dicaDe(fechar)).toHaveTextContent(DICAS.removendo);
    fireEvent.keyDown(fechar, { key: "Escape" });
    fireEvent.keyDown(fechar, { key: "Escape" });
    semEfeito();
    acionar(fechar);
    semEfeito();
    expect(dialogo).toContainElement(document.activeElement as HTMLElement);

    soltar();
    expect(
      await screen.findAllByText("Afiliado 1044 removido."),
    ).not.toHaveLength(0);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(gravacoes("DELETE")).toBe(1);
  });
});

describe("RIFA-047: defeitos achados na revisão (gravando, nada fecha a pergunta nem a escolha no meio)", () => {
  /** Os três botões do afiliado 1001 na Célula Betel (o admin tem também o Remover). */
  const BOTOES_DO_AFILIADO = [
    "Trocar a célula do afiliado 1001",
    "Desvincular o afiliado 1001",
    "Remover o afiliado 1001",
  ];

  it("'Desvinculando…': Trocar, Desvincular e Remover do mesmo afiliado ficam indisponíveis (no Tab, com o motivo) e não fecham a pergunta", async () => {
    await abrir(ADMIN_DE_TESTE);
    const betel = () => naLista("Célula Betel");
    acionar(
      betel().getByRole("button", { name: "Desvincular o afiliado 1001" }),
    );
    const confirmar = await betel().findByRole("button", {
      name: "Confirmar desvínculo",
    });
    for (const nome of BOTOES_DO_AFILIADO)
      esperarDisponivel(betel().getByRole("button", { name: nome }));

    const soltar = api!.segurarGravacoes();
    acionar(confirmar);
    expect(confirmar).toHaveTextContent("Desvinculando…");
    const semEfeito = () => {
      expect(gravacoes("PUT")).toBe(1);
      expect(
        betel().getByText(/^Desvincular o afiliado 1001/),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("group", { name: "Nova célula do afiliado 1001" }),
      ).toBeNull();
      expect(screen.queryByRole("alertdialog")).toBeNull();
    };
    for (const nome of BOTOES_DO_AFILIADO)
      await conferirIndisponivel(betel().getByRole("button", { name: nome }), {
        dica: DICAS.desvinculando,
        semEfeito,
        css: CSS,
      });

    soltar();
    expect(
      await screen.findAllByText(
        "Afiliado 1001 desvinculado. Ele voltou para “Sem célula”.",
      ),
    ).not.toHaveLength(0);
    expect(gravacoes("PUT")).toBe(1);
  });

  it("'Salvando…' da troca de célula: Trocar, Desvincular e Remover também ficam indisponíveis e não fecham a escolha", async () => {
    await abrir(ADMIN_DE_TESTE);
    const betel = () => naLista("Célula Betel");
    acionar(
      betel().getByRole("button", { name: "Trocar a célula do afiliado 1001" }),
    );
    const escolha = await screen.findByRole("group", {
      name: "Nova célula do afiliado 1001",
    });
    fireEvent.click(
      within(escolha).getByRole("radio", { name: /^Célula Débora/ }),
    );
    const confirmar = botao("Trocar para: Célula Débora");

    const soltar = api!.segurarGravacoes();
    acionar(confirmar);
    expect(confirmar).toHaveTextContent("Salvando…");
    const semEfeito = () => {
      expect(gravacoes("PUT")).toBe(1);
      expect(
        screen.getByRole("group", { name: "Nova célula do afiliado 1001" }),
      ).toBe(escolha);
      expect(betel().queryByText(/^Desvincular o afiliado 1001/)).toBeNull();
      expect(screen.queryByRole("alertdialog")).toBeNull();
    };
    for (const nome of BOTOES_DO_AFILIADO)
      await conferirIndisponivel(betel().getByRole("button", { name: nome }), {
        dica: DICAS.salvandoEscolha,
        semEfeito,
        css: CSS,
      });

    soltar();
    expect(
      await screen.findAllByText("Afiliado 1001 trocado para: Célula Débora."),
    ).not.toHaveLength(0);
    expect(gravacoes("PUT")).toBe(1);
  });

  it("pré-cadastro com troca: digitar no campo durante a gravação não limpa a pergunta (o campo fica só leitura até a resposta)", async () => {
    await abrir();
    const agape = naLista("Célula Ágape");
    const campo = agape.getByRole("textbox", {
      name: "Código de afiliado (Célula Ágape)",
    });
    fireEvent.change(campo, { target: { value: "1002" } });
    fireEvent.click(agape.getByRole("button", { name: "Salvar código" }));
    const trocarPara = await agape.findByRole("button", {
      name: "Trocar para esta célula",
    });
    expect(campo).not.toHaveAttribute("readonly");

    const soltar = api!.segurarGravacoes();
    acionar(trocarPara);
    expect(campo).toHaveAttribute("readonly");
    act(() => campo.focus());
    fireEvent.change(campo, { target: { value: "10029" } });

    // A pergunta e os botões dela continuam (antes, a pergunta sumia e o foco caía no <body>); o código também.
    expect(
      agape.getByText(/^O afiliado 1002 está em Célula Canaã/),
    ).toBeInTheDocument();
    expect(trocarPara).toBeInTheDocument();
    esperarIndisponivel(trocarPara);
    expect(campo).toHaveValue("1002");
    expect(gravacoes("PUT")).toBe(1);

    soltar();
    expect(
      await screen.findAllByText("Afiliado 1002 trocado para: Célula Ágape."),
    ).not.toHaveLength(0);
    expect(gravacoes("PUT")).toBe(1);
  });
});
