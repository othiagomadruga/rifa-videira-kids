// RIFA-031 (D20), CA5: remover afiliado de teste na tela Adesão (só admin), pela rota de verdade e com uma API
// falsa (fetch trocado) que responde como a API: 204 sem pedido que conte e 409 `afiliado_com_pedidos` com
// quantos e quais pedidos ainda contam (detalhes pelo schema do contrato). CA8: confirmação num alertdialog, foco
// e região viva.
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detalhesAfiliadoComPedidosSchema,
  respostaAdesaoSchema,
  respostaListaAfiliadosSchema,
  type AfiliadoResumo,
} from "../../../shared/contracts";
import {
  ADMIN_DE_TESTE,
  USUARIO_DE_TESTE,
  renderizarRota,
  respostaJson,
} from "../../test/renderizar";
import { lerCss } from "../../test/indisponivel";
import type { CelulaAdesao } from "./adesao-api";

const SEM_VENDAS = { pedidos_aprovados: 0, bilhetes: 0, total_centavos: 0 };

function celula(id: number, nome: string, afiliados: number[]): CelulaAdesao {
  return {
    celula_id: id,
    celula_nome: nome,
    qtd_pessoas: 10,
    lider_nome: `Lider ${id}`,
    lider_telefone: null,
    discipulador_id: 1,
    discipulador_nome: "Discipulador Ficticio",
    rede_id: 1,
    rede_nome: "Rede Ficticia",
    divisao: "jovens",
    afiliados,
    vinculada: afiliados.length > 0,
    primeira_venda_em: null,
    pedidos_aprovados: 0,
  };
}

function orfao(affiliateId: number): AfiliadoResumo {
  return {
    affiliate_id: affiliateId,
    celula_id: null,
    celula_nome: null,
    rotulo: null,
    origem: "webhook",
    criado_em: "2026-11-11T22:30:00.000Z",
    vinculado_em: null,
    atualizado_em: "2026-11-11T22:30:00.000Z",
    vendas: SEM_VENDAS,
    primeira_venda_em: null,
    ultima_venda_em: null,
  };
}

/** Pedidos que ainda contam, por afiliado: com algum, o DELETE dá 409. */
type ComPedidos = Record<number, { quantidade: number; ids: string[] }>;

function simularApi(comPedidos: ComPedidos = {}) {
  const estado = {
    celulas: [celula(1, "Célula Ágape", [1001]), celula(2, "Célula Betel", [])],
    orfaos: [orfao(1044), orfao(1043)],
  };
  const deletes: number[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const metodo = init?.method ?? "GET";
      if (metodo === "GET" && url === "/api/admin/adesao")
        return respostaJson(
          respostaAdesaoSchema.parse({
            resumo: {
              celulas: estado.celulas.length,
              vinculadas: estado.celulas.filter((c) => c.vinculada).length,
              com_venda: 0,
              afiliados_nao_vinculados: estado.orfaos.length,
            },
            itens: estado.celulas,
          }),
        );
      if (metodo === "GET" && url === "/api/admin/afiliados?vinculado=false")
        return respostaJson(
          respostaListaAfiliadosSchema.parse({
            itens: estado.orfaos,
            sem_afiliado: SEM_VENDAS,
          }),
        );
      const remover = /^\/api\/admin\/afiliados\/(\d+)$/.exec(url);
      if (metodo === "DELETE" && remover) {
        const id = Number(remover[1]);
        deletes.push(id);
        const pedidos = comPedidos[id];
        if (pedidos)
          return respostaJson(
            {
              erro: {
                codigo: "afiliado_com_pedidos",
                mensagem: "O afiliado tem pedidos que contam",
                detalhes: detalhesAfiliadoComPedidosSchema.parse({
                  pedidos_que_contam: pedidos.quantidade,
                  pedidos: pedidos.ids,
                }),
              },
            },
            409,
          );
        estado.orfaos = estado.orfaos.filter((o) => o.affiliate_id !== id);
        for (const c of estado.celulas) {
          c.afiliados = c.afiliados.filter((a) => a !== id);
          c.vinculada = c.afiliados.length > 0;
        }
        return new Response(null, { status: 204 });
      }
      return respostaJson(
        { erro: { codigo: "nao_encontrado", mensagem: "Rota não encontrada" } },
        404,
      );
    }),
  );
  return { estado, deletes };
}

async function abrir(usuario = ADMIN_DE_TESTE) {
  renderizarRota("/coordenacao/adesao", { usuario });
  await screen.findByText(/^Atualizado às/);
}

function acionar(elemento: HTMLElement) {
  act(() => elemento.focus());
  fireEvent.click(elemento);
}

const regiaoSemCelula = () =>
  screen.getByRole("region", { name: /^Sem célula/ });
const regiaoTodas = () =>
  screen.getByRole("region", { name: /^Todas as células$/ });

/** A região viva fixa da tela (anuncia o último vínculo ou remoção). */
const anuncio = () =>
  [
    ...document.querySelectorAll<HTMLElement>(
      ".visualmente-oculto[role=status]",
    ),
  ]
    .map((elemento) => elemento.textContent)
    .join(" | ");

/**
 * Como o navegador: um elemento dentro de `inert` (o resto da página com o diálogo aberto) não recebe o foco. O
 * jsdom não implementa o `inert`, e sem isto um foco dado antes de o diálogo sair passava no teste e se perdia na
 * tela de verdade.
 */
function respeitarInert() {
  const focar = HTMLElement.prototype.focus;
  vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
    this: HTMLElement,
    opcoes?: FocusOptions,
  ) {
    if (!this.closest("[inert]")) focar.call(this, opcoes);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CA5: quem vê 'Remover'", () => {
  it("a coordenação não vê a ação (só o admin)", async () => {
    simularApi();
    await abrir(USUARIO_DE_TESTE);
    expect(
      screen.queryByRole("button", { name: /^Remover o afiliado/ }),
    ).not.toBeInTheDocument();
  });

  it("o admin vê 'Remover' em cada órfão e em cada afiliado das células", async () => {
    simularApi();
    await abrir();
    expect(
      within(regiaoSemCelula())
        .getAllByRole("button", { name: /^Remover o afiliado/ })
        .map((botao) => botao.textContent),
    ).toEqual(["Remover o afiliado 1044", "Remover o afiliado 1043"]);
    expect(
      within(regiaoTodas()).getByRole("button", {
        name: "Remover o afiliado 1001",
      }),
    ).toBeInTheDocument();
  });
});

describe("RIFA-051 (P3.8, A-15 e A-16): as ações do afiliado", () => {
  /** O bloco do afiliado na célula (a linha com o código e as ações). */
  const blocoDoAfiliado = (codigo: number) => {
    const bloco = within(regiaoTodas())
      .getByText(`Afiliado ${codigo}`)
      .closest<HTMLElement>(".adesao-afiliado");
    if (!bloco) throw new Error(`sem o bloco do afiliado ${codigo}`);
    return bloco;
  };

  it("admin: o 'Remover' ao lado do código, na cara do perigo discreto; 'Trocar' e 'Desvincular' juntos, em duas colunas iguais (nenhum botão sozinho numa linha)", async () => {
    simularApi();
    await abrir();
    const bloco = blocoDoAfiliado(1001);
    const linha = bloco.querySelector(".adesao-afiliado__linha");
    const acoes = bloco.querySelector(".adesao-afiliado__acoes");
    if (!linha || !acoes) throw new Error("sem a linha e as ações");

    const remover = within(bloco).getByRole("button", {
      name: "Remover o afiliado 1001",
    });
    expect(linha).toContainElement(remover);
    expect(remover).toHaveClass("ui-button--perigo-discreto");
    expect(
      within(acoes as HTMLElement)
        .getAllByRole("button")
        .map((botao) => [
          botao.textContent,
          botao.classList.contains("ui-button--secundario"),
        ]),
    ).toEqual([
      ["Trocar a célula do afiliado 1001", true],
      ["Desvincular o afiliado 1001", true],
    ]);
    // Os três são do tamanho das ações de uma linha (36 px no mouse; 44 px no toque).
    for (const botao of within(bloco).getAllByRole("button"))
      expect(botao).toHaveClass("ui-button--pequeno");
    // A ordem do Tab segue a da tela: o Remover (em cima, à direita), depois Trocar e Desvincular.
    expect(
      within(bloco)
        .getAllByRole("button")
        .map((botao) => botao.textContent),
    ).toEqual([
      "Remover o afiliado 1001",
      "Trocar a célula do afiliado 1001",
      "Desvincular o afiliado 1001",
    ]);
  });

  it("coordenação (sem o 'Remover'): o código sozinho na linha e as duas ações embaixo", async () => {
    simularApi();
    await abrir(USUARIO_DE_TESTE);
    const bloco = blocoDoAfiliado(1001);
    expect(
      within(
        bloco.querySelector(".adesao-afiliado__linha") as HTMLElement,
      ).queryAllByRole("button"),
    ).toEqual([]);
    expect(
      within(
        bloco.querySelector(".adesao-afiliado__acoes") as HTMLElement,
      ).getAllByRole("button"),
    ).toHaveLength(2);
  });

  it("o 'Remover' de cada órfão também é perigo discreto (não o roxo de um link)", async () => {
    simularApi();
    await abrir();
    for (const botao of within(regiaoSemCelula()).getAllByRole("button", {
      name: /^Remover o afiliado/,
    }))
      expect(botao).toHaveClass("ui-button--perigo-discreto");
  });

  it("as duas colunas são iguais e encolhem (nenhuma largura fixa)", () => {
    const css = lerCss("pages/adesao/adesao.css");
    const regra = /\.adesao-afiliado__acoes\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(regra).toMatch(/display:\s*grid;/);
    expect(regra).toMatch(
      /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/,
    );
  });
});

describe("CA5: remover", () => {
  it("pede confirmação; 'Cancelar' não chama a API e devolve o foco", async () => {
    const { deletes } = simularApi();
    await abrir();
    const botao = within(regiaoSemCelula()).getByRole("button", {
      name: "Remover o afiliado 1044",
    });

    acionar(botao);

    const dialogo = screen.getByRole("alertdialog", {
      name: "Remover o afiliado 1044?",
    });
    expect(dialogo).toHaveAccessibleDescription(
      "Use só para um afiliado de teste: ele sai do sistema, e os pedidos desconsiderados dele ficam sem afiliado.",
    );
    const cancelar = within(dialogo).getByRole("button", { name: "Cancelar" });
    await waitFor(() => expect(cancelar).toHaveFocus());
    fireEvent.click(cancelar);

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(deletes).toEqual([]);
    await waitFor(() => expect(botao).toHaveFocus());
  });

  it("204: o órfão sai da fila, o aviso é anunciado e o foco vai para o próximo da fila", async () => {
    const { deletes } = simularApi();
    respeitarInert();
    await abrir();
    acionar(
      within(regiaoSemCelula()).getByRole("button", {
        name: "Remover o afiliado 1044",
      }),
    );
    const dialogo = screen.getByRole("alertdialog");

    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Remover afiliado" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(deletes).toEqual([1044]);
    expect(
      within(regiaoSemCelula()).queryByRole("heading", {
        name: "Afiliado 1044",
      }),
    ).not.toBeInTheDocument();
    expect(anuncio()).toContain("Afiliado 1044 removido.");
    await waitFor(() =>
      expect(
        within(regiaoSemCelula()).getByRole("button", {
          name: "Vincular o afiliado 1043",
        }),
      ).toHaveFocus(),
    );
  });

  it("409 afiliado_com_pedidos: mostra quantos e quais pedidos contam (com o link para a busca) e diz para desconsiderar antes", async () => {
    const { deletes } = simularApi({
      1001: { quantidade: 3, ids: ["PED-3", "PED 2"] },
    });
    await abrir();
    acionar(
      within(regiaoTodas()).getByRole("button", {
        name: "Remover o afiliado 1001",
      }),
    );
    const dialogo = screen.getByRole("alertdialog", {
      name: "Remover o afiliado 1001?",
    });
    expect(dialogo).toHaveTextContent("Ele está na Célula Ágape.");

    acionar(within(dialogo).getByRole("button", { name: "Remover afiliado" }));

    const alerta = await within(dialogo).findByRole("alert");
    expect(alerta).toHaveTextContent(
      "O afiliado 1001 tem 3 pedidos que ainda contam",
    );
    expect(alerta).toHaveTextContent(
      "Desconsidere esses pedidos na tela Pedidos antes de remover",
    );
    expect(
      within(alerta)
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["Pedido PED-3", "/coordenacao/pedidos?id=PED-3"],
      ["Pedido PED 2", "/coordenacao/pedidos?id=PED+2"],
    ]);
    expect(alerta).toHaveTextContent("E mais 1 pedido.");
    // Tentar de novo daria o mesmo 409: só "Entendi", com o foco (o botão que o tinha saiu do diálogo).
    expect(
      within(dialogo).queryByRole("button", { name: "Remover afiliado" }),
    ).not.toBeInTheDocument();
    expect(deletes).toEqual([1001]);
    const entendi = within(dialogo).getByRole("button", { name: "Entendi" });
    await waitFor(() => expect(entendi).toHaveFocus());
    fireEvent.click(entendi);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(
      within(regiaoTodas()).getByRole("button", {
        name: "Remover o afiliado 1001",
      }),
    ).toBeInTheDocument();
  });

  it("outra falha: explica no diálogo e o foco vai para 'Remover afiliado', para tentar de novo", async () => {
    simularApi();
    const fetchDaApi = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) =>
        init?.method === "DELETE"
          ? Promise.reject(new TypeError("Failed to fetch"))
          : fetchDaApi(url, init),
      ),
    );
    await abrir();
    acionar(
      within(regiaoSemCelula()).getByRole("button", {
        name: "Remover o afiliado 1044",
      }),
    );
    const dialogo = screen.getByRole("alertdialog");
    const remover = within(dialogo).getByRole("button", {
      name: "Remover afiliado",
    });

    acionar(remover);
    // Como o navegador, que tira o foco do botão quando ele fica desabilitado (enquanto remove).
    act(() => remover.blur());

    expect(
      await within(dialogo).findByText("Não foi possível remover"),
    ).toBeInTheDocument();
    await waitFor(() => expect(remover).toHaveFocus());
  });

  it("afiliado da célula, sem pedido que conte: 204, o aviso no cartão e o foco no título da célula", async () => {
    simularApi();
    respeitarInert();
    await abrir();
    acionar(
      within(regiaoTodas()).getByRole("button", {
        name: "Remover o afiliado 1001",
      }),
    );
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Remover afiliado",
      }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(anuncio()).toContain("Afiliado 1001 removido de Célula Ágape.");
    await waitFor(() =>
      expect(
        within(regiaoTodas()).getByRole("heading", {
          level: 3,
          name: "Célula Ágape",
        }),
      ).toHaveFocus(),
    );
    await waitFor(() =>
      expect(
        within(regiaoTodas()).queryByRole("button", {
          name: "Remover o afiliado 1001",
        }),
      ).not.toBeInTheDocument(),
    );
  });
});
