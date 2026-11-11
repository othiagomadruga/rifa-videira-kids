// Tela /coordenacao/adesao com a API simulada (fetch trocado): uma "API falsa" guarda as células e a
// fila de órfãos, responde no formato do contrato (conferido com os schemas) e aplica os PUTs, como o
// Worker faria. Os relógios são falsos (avançam sozinhos com o tempo real) para controlar o "há 2 min"
// e a atualização automática.
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  afiliadoResumoSchema,
  corpoSalvarAfiliadoSchema,
  respostaAdesaoSchema,
  respostaListaAfiliadosSchema,
  type AfiliadoResumo,
} from "../../../shared/contracts";
import { renderizarRota, respostaJson } from "../../test/renderizar";
import type { CelulaAdesao } from "./adesao-api";
import { INTERVALO_ATUALIZACAO_MS } from "./usePainelAdesao";

// 11/11/2026, 19:33 em Belém (22:33 UTC): a reunião de cadastro dos líderes.
const AGORA = new Date("2026-11-11T22:33:00.000Z");

function celula(
  id: number,
  nome: string,
  dados: Partial<CelulaAdesao> = {},
): CelulaAdesao {
  return {
    celula_id: id,
    celula_nome: nome,
    qtd_pessoas: 10,
    lider_nome: `Lider ${nome.replace("Célula ", "")}`,
    lider_telefone: null,
    discipulador_id: 1,
    discipulador_nome: "Discipulador Ficticio A",
    rede_id: 1,
    rede_nome: "Rede Jovem Ficticia",
    divisao: "jovens",
    afiliados: [],
    vinculada: false,
    primeira_venda_em: null,
    pedidos_aprovados: 0,
    ...dados,
  };
}

function afiliado(
  affiliateId: number,
  dados: Partial<AfiliadoResumo> = {},
): AfiliadoResumo {
  return {
    affiliate_id: affiliateId,
    celula_id: null,
    celula_nome: null,
    rotulo: null,
    origem: "webhook",
    criado_em: "2026-11-11T22:30:00.000Z",
    vinculado_em: null,
    atualizado_em: "2026-11-11T22:30:00.000Z",
    vendas: { pedidos_aprovados: 0, bilhetes: 0, total_centavos: 0 },
    primeira_venda_em: null,
    ultima_venda_em: null,
    ...dados,
  };
}

type EstadoApi = { celulas: CelulaAdesao[]; orfaos: AfiliadoResumo[] };

function cenarioDaReuniao(): EstadoApi {
  return {
    celulas: [
      celula(1, "Célula Ágape", { lider_telefone: "(91) 90000-0001" }),
      celula(2, "Célula Betel", {
        afiliados: [1001],
        vinculada: true,
        pedidos_aprovados: 3,
        primeira_venda_em: "2026-11-23T13:41:09.877Z",
      }),
      celula(3, "Célula Canaã", { afiliados: [1002], vinculada: true }),
      celula(4, "Célula Débora", { rede_nome: "Rede Adulta Ficticia" }),
    ],
    orfaos: [
      afiliado(1044, {
        criado_em: "2026-11-11T22:31:00.000Z",
        atualizado_em: "2026-11-11T22:31:00.000Z",
      }),
      afiliado(1043, {
        vendas: { pedidos_aprovados: 1, bilhetes: 2, total_centavos: 3600 },
      }),
    ],
  };
}

const SEM_VENDAS = { pedidos_aprovados: 0, bilhetes: 0, total_centavos: 0 };

/** fetch simulado com estado: GET /api/admin/adesao, GET ?vinculado=false e PUT do afiliado. */
function simularApi(inicial: EstadoApi) {
  const estado = structuredClone(inicial);
  const puts: { affiliateId: number; corpo: unknown }[] = [];
  const inesperadas: string[] = [];
  const contagem = { adesao: 0, orfaos: 0 };
  const falhas = { gets: 0, putCelulaInexistente: false };
  // Portão fechado: as consultas (GET) esperam. Dá para ver a tela entre o PUT e a atualização.
  let portao: Promise<void> | null = null;
  function segurarConsultas() {
    let abrir = () => {};
    portao = new Promise<void>((resolver) => {
      abrir = resolver;
    });
    return () => {
      portao = null;
      abrir();
    };
  }

  const fetchMock = vi.fn(
    async (url: string, init?: RequestInit): Promise<Response> => {
      const metodo = init?.method ?? "GET";
      if (metodo === "GET" && url === "/api/admin/adesao") {
        contagem.adesao += 1;
        if (portao) await portao;
        if (falhas.gets > 0) {
          falhas.gets -= 1;
          throw new TypeError("Failed to fetch");
        }
        return respostaJson(
          respostaAdesaoSchema.parse({
            resumo: {
              celulas: estado.celulas.length,
              vinculadas: estado.celulas.filter((c) => c.vinculada).length,
              com_venda: estado.celulas.filter((c) => c.pedidos_aprovados > 0)
                .length,
              afiliados_nao_vinculados: estado.orfaos.length,
            },
            itens: estado.celulas,
          }),
        );
      }
      if (metodo === "GET" && url === "/api/admin/afiliados?vinculado=false") {
        contagem.orfaos += 1;
        if (portao) await portao;
        return respostaJson(
          respostaListaAfiliadosSchema.parse({
            itens: estado.orfaos,
            sem_afiliado: SEM_VENDAS,
          }),
        );
      }
      const put = /^\/api\/admin\/afiliados\/(\d+)$/.exec(url);
      if (metodo === "PUT" && put) {
        const affiliateId = Number(put[1]);
        const corpo: unknown = JSON.parse(String(init?.body));
        puts.push({ affiliateId, corpo });
        return salvar(affiliateId, corpoSalvarAfiliadoSchema.parse(corpo));
      }
      inesperadas.push(`${metodo} ${url}`);
      return respostaJson(
        { erro: { codigo: "nao_encontrado", mensagem: "Rota não encontrada" } },
        404,
      );
    },
  );

  function salvar(
    affiliateId: number,
    { celula_id }: { celula_id: number | null },
  ): Response {
    const destino = estado.celulas.find((c) => c.celula_id === celula_id);
    if (celula_id !== null && (!destino || falhas.putCelulaInexistente)) {
      const mensagem = `A célula ${celula_id} não existe`;
      return respostaJson(
        {
          erro: {
            codigo: "referencia_invalida",
            mensagem,
            detalhes: [
              {
                caminho: ["celula_id"],
                codigo: "referencia_invalida",
                mensagem,
              },
            ],
          },
        },
        400,
      );
    }
    const agora = new Date().toISOString();
    const anterior =
      estado.orfaos.find((o) => o.affiliate_id === affiliateId) ??
      afiliado(affiliateId, {
        origem: "manual",
        criado_em: agora,
        atualizado_em: agora,
      });
    estado.orfaos = estado.orfaos.filter((o) => o.affiliate_id !== affiliateId);
    for (const c of estado.celulas) {
      c.afiliados = c.afiliados.filter((id) => id !== affiliateId);
      c.vinculada = c.afiliados.length > 0;
    }
    const salvo: AfiliadoResumo = {
      ...anterior,
      celula_id,
      celula_nome: destino?.celula_nome ?? null,
      vinculado_em: destino ? agora : null,
      atualizado_em: agora,
    };
    if (destino) {
      destino.afiliados = [...destino.afiliados, affiliateId].sort(
        (a, b) => a - b,
      );
      destino.vinculada = true;
    } else {
      estado.orfaos.unshift(salvo);
    }
    return respostaJson(afiliadoResumoSchema.parse(salvo));
  }

  vi.stubGlobal("fetch", fetchMock);
  return {
    estado,
    puts,
    contagem,
    falhas,
    inesperadas,
    fetchMock,
    segurarConsultas,
  };
}

let api: ReturnType<typeof simularApi>;

async function abrirTela(inicial: EstadoApi = cenarioDaReuniao()) {
  api = simularApi(inicial);
  renderizarRota("/coordenacao/adesao");
  await screen.findByText(/^Atualizado às/);
}

const regiao = (nome: RegExp) => screen.getByRole("region", { name: nome });
/** Cartão (article) com o título (h3) `titulo`, dentro de `dentro` (padrão: a página toda). */
const cartao = (titulo: string, dentro: HTMLElement = document.body) => {
  const artigo = within(dentro)
    .getByRole("heading", { level: 3, name: titulo })
    .closest("article");
  if (!artigo) throw new Error(`sem cartão para ${titulo}`);
  return artigo;
};
/** Cartão da célula na lista "Todas as células" (a célula também pode estar em "Quem falta"). */
const celulaNaLista = (nome: string) =>
  cartao(nome, regiao(/^Todas as células$/));
const tituloDaCelula = (nome: string) =>
  within(regiao(/^Todas as células$/)).getByRole("heading", {
    level: 3,
    name: nome,
  });
const titulosNivel3 = (elemento: HTMLElement) =>
  within(elemento)
    .queryAllByRole("heading", { level: 3 })
    .map((titulo) => titulo.textContent);

/** Espera a consulta em andamento terminar (o texto volta de "Atualizando…" para "Atualizado às"). */
async function esperarAtualizacao() {
  await waitFor(() =>
    expect(screen.getByText(/^Atualizado às/)).toBeInTheDocument(),
  );
}

function definirVisibilidade(estado: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => estado,
  });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

type Tela = "celular" | "computador";
const matchMediaOriginal = Object.getOwnPropertyDescriptor(
  window,
  "matchMedia",
);
let mudarTela: (tela: Tela) => void = () => {};

/** Simula a largura da tela para o matchMedia da página (o jsdom não tem matchMedia). */
function simularTela(inicial: Tela) {
  let larga = inicial === "computador";
  const ouvintes = new Set<() => void>();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (consulta: string) => ({
      get matches() {
        return larga;
      },
      media: consulta,
      onchange: null,
      addEventListener: (_tipo: string, ouvinte: () => void) => {
        ouvintes.add(ouvinte);
      },
      removeEventListener: (_tipo: string, ouvinte: () => void) => {
        ouvintes.delete(ouvinte);
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  mudarTela = (tela) => {
    larga = tela === "computador";
    act(() => ouvintes.forEach((ouvinte) => ouvinte()));
  };
}

/** Nomes das seções (regiões) na ordem da página. */
const ordemDasSecoes = () =>
  screen
    .getAllByRole("region")
    .map(
      (secao) =>
        document.getElementById(secao.getAttribute("aria-labelledby") ?? "")
          ?.textContent,
    );

// O jsdom não tem scrollIntoView: o simulado guarda quem pediu para aparecer na tela.
const rolarAte = vi.fn();
/** Textos dos elementos levados à vista (scrollIntoView), na ordem. */
const levadosAVista = () =>
  rolarAte.mock.contexts.map((elemento) => (elemento as Element).textContent);

beforeEach(() => {
  // A reunião é no celular: é a tela padrão dos testes.
  simularTela("celular");
  rolarAte.mockClear();
  Element.prototype.scrollIntoView = rolarAte;
  // Só os temporizadores e o Date: as promessas e o agendador do React continuam reais.
  vi.useFakeTimers({
    now: AGORA,
    shouldAdvanceTime: true,
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  });
});

afterEach(() => {
  expect(api.inesperadas).toEqual([]);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "visibilityState");
  Reflect.deleteProperty(navigator, "clipboard");
  if (matchMediaOriginal)
    Object.defineProperty(window, "matchMedia", matchMediaOriginal);
  else Reflect.deleteProperty(window, "matchMedia");
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

describe("CA3: painel de adesão (/coordenacao/adesao)", () => {
  it("no computador: mostra o resumo em destaque, os órfãos (o mais recente no topo), quem falta e a situação de cada célula", async () => {
    simularTela("computador");
    await abrirTela();

    expect(
      screen.getByRole("heading", { level: 1, name: "Adesão" }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Adesão · Rifa Videira Kids");
    expect(api.fetchMock).toHaveBeenCalledWith(
      "/api/admin/adesao",
      expect.objectContaining({ method: "GET" }),
    );
    expect(api.fetchMock).toHaveBeenCalledWith(
      "/api/admin/afiliados?vinculado=false",
      expect.objectContaining({ method: "GET" }),
    );

    const resumo = regiao(/^Resumo$/);
    expect(resumo).toHaveTextContent("Células vinculadas2 de 4");
    expect(resumo).toHaveTextContent("Células que já venderam1");
    expect(resumo).toHaveTextContent("Afiliados sem célula2");
    expect(
      within(resumo).getByRole("progressbar", { name: "Adesão das células" }),
    ).toHaveAttribute("aria-valuetext", "50%");

    const semCelula = regiao(/^Sem célula \(2\)$/);
    expect(titulosNivel3(semCelula)).toEqual([
      "Afiliado 1044",
      "Afiliado 1043",
    ]);
    expect(cartao("Afiliado 1044")).toHaveTextContent("apareceu há 2 min");
    expect(cartao("Afiliado 1044")).toHaveTextContent(
      "Nenhuma venda aprovada ainda",
    );
    expect(cartao("Afiliado 1043")).toHaveTextContent("apareceu há 3 min");
    expect(cartao("Afiliado 1043")).toHaveTextContent(
      "1 pedido aprovado · R$ 36,00",
    );
    expect(
      within(cartao("Afiliado 1043")).getByText("há 3 min"),
    ).toHaveAttribute("datetime", "2026-11-11T22:30:00.000Z");

    const quemFalta = regiao(/^Quem falta \(2\)$/);
    expect(titulosNivel3(quemFalta)).toEqual(["Célula Ágape", "Célula Débora"]);
    expect(
      within(quemFalta).getByRole("link", { name: "(91) 90000-0001" }),
    ).toHaveAttribute("href", "tel:91900000001");
    expect(within(quemFalta).getByText("Líder: Lider Ágape")).toBeVisible();
    expect(
      within(cartao("Célula Débora", quemFalta)).getByText(
        "Sem telefone na planilha.",
      ),
    ).toBeInTheDocument();

    const todas = regiao(/^Todas as células$/);
    expect(titulosNivel3(todas)).toEqual([
      "Célula Ágape",
      "Célula Betel",
      "Célula Canaã",
      "Célula Débora",
    ]);
    const situacao = (nome: string) =>
      within(todas)
        .getByRole("heading", { level: 3, name: nome })
        .closest("article");
    expect(situacao("Célula Ágape")).toHaveTextContent("Sem afiliado");
    expect(situacao("Célula Betel")).toHaveTextContent("Já vendeu");
    expect(situacao("Célula Betel")).toHaveTextContent(
      "3 pedidos aprovados · primeira venda em 23/11/2026 10:41",
    );
    expect(situacao("Célula Betel")).toHaveTextContent("Afiliado 1001");
    expect(situacao("Célula Canaã")).toHaveTextContent("Vinculada");
    expect(
      within(todas).getByRole("textbox", {
        name: "Código de afiliado (Célula Ágape)",
      }),
    ).toBeInTheDocument();
  });

  it("órfão novo aparece sozinho na atualização seguinte, no topo da fila", async () => {
    await abrirTela();
    api.estado.orfaos.unshift(
      afiliado(1050, {
        criado_em: new Date().toISOString(),
        atualizado_em: new Date().toISOString(),
      }),
    );

    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ATUALIZACAO_MS));

    const semCelula = await screen.findByRole("region", {
      name: /^Sem célula \(3\)$/,
    });
    expect(titulosNivel3(semCelula)).toEqual([
      "Afiliado 1050",
      "Afiliado 1044",
      "Afiliado 1043",
    ]);
    expect(cartao("Afiliado 1050")).toHaveTextContent("apareceu agora mesmo");
    expect(regiao(/^Resumo$/)).toHaveTextContent("3 sem célula");
  });

  it("sem células cadastradas: avisa e leva para a Hierarquia", async () => {
    await abrirTela({ celulas: [], orfaos: [afiliado(1043)] });

    expect(screen.getByText("Nenhuma célula cadastrada.")).toBeInTheDocument();
    expect(
      within(screen.getByRole("main")).getByRole("link", {
        name: "Hierarquia",
      }),
    ).toHaveAttribute("href", "/coordenacao/hierarquia");
    expect(regiao(/^Sem célula \(1\)$/)).toBeInTheDocument();
  });

  it("falha na primeira carga: mostra o erro e 'Tentar de novo' carrega", async () => {
    api = simularApi(cenarioDaReuniao());
    api.falhas.gets = 1;
    renderizarRota("/coordenacao/adesao");

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Não foi possível conectar à API.");
    fireEvent.click(
      within(alerta).getByRole("button", { name: "Tentar de novo" }),
    );

    expect(
      await screen.findByRole("region", { name: /^Sem célula/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("copiar o telefone do líder que falta", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await abrirTela();

    fireEvent.click(
      screen.getByRole("button", { name: "Copiar o telefone de Lider Ágape" }),
    );

    await waitFor(() =>
      expect(
        within(cartao("Célula Ágape", regiao(/^Quem falta/))).getByRole(
          "status",
        ),
      ).toHaveTextContent("Telefone copiado."),
    );
    expect(writeText).toHaveBeenCalledWith("(91) 90000-0001");
  });

  it("sem área de transferência, avisa que não deu para copiar", async () => {
    await abrirTela();

    fireEvent.click(
      screen.getByRole("button", { name: "Copiar o telefone de Lider Ágape" }),
    );

    expect(
      await within(cartao("Célula Ágape", regiao(/^Quem falta/))).findByText(
        "Não deu para copiar: anote o número.",
      ),
    ).toBeInTheDocument();
  });
});

describe("CA4: vincular, trocar, desvincular e pré-cadastrar", () => {
  it("Vincular: escolhe a célula com busca; o afiliado sai de 'Sem célula' e as vendas vão para a célula", async () => {
    await abrirTela();
    const botao = within(cartao("Afiliado 1043")).getByRole("button", {
      name: "Vincular o afiliado 1043",
    });

    fireEvent.click(botao);

    expect(botao).toHaveAttribute("aria-expanded", "true");
    const busca = within(cartao("Afiliado 1043")).getByRole("searchbox", {
      name: "Buscar célula ou líder",
    });
    expect(busca).toHaveFocus();
    const grupo = within(cartao("Afiliado 1043")).getByRole("group", {
      name: "Célula do afiliado 1043",
    });
    // As células sem afiliado vêm primeiro.
    expect(
      within(grupo)
        .getAllByRole("radio")
        .map((opcao) => opcao.getAttribute("value")),
    ).toEqual(["1", "4", "2", "3"]);

    fireEvent.change(busca, { target: { value: "agape" } });
    const opcoes = within(grupo).getAllByRole("radio");
    expect(opcoes).toHaveLength(1);
    fireEvent.click(opcoes[0]);
    fireEvent.click(
      within(cartao("Afiliado 1043")).getByRole("button", {
        name: "Vincular: Célula Ágape",
      }),
    );

    expect(
      await within(regiao(/^Sem célula/)).findByText(
        "Afiliado 1043 vinculado: Célula Ágape.",
      ),
    ).toBeVisible();
    expect(api.puts).toEqual([{ affiliateId: 1043, corpo: { celula_id: 1 } }]);
    await waitFor(() =>
      expect(titulosNivel3(regiao(/^Sem célula/))).toEqual(["Afiliado 1044"]),
    );
    // A fila muda na hora; as células, quando chega a atualização feita depois do vínculo.
    await waitFor(() =>
      expect(titulosNivel3(regiao(/^Quem falta/))).toEqual(["Célula Débora"]),
    );
    expect(regiao(/^Resumo$/)).toHaveTextContent("3 de 4 vinculadas");
    const agape = within(regiao(/^Todas as células$/))
      .getByRole("heading", { level: 3, name: "Célula Ágape" })
      .closest("article");
    expect(agape).toHaveTextContent("Vinculada");
    expect(agape).toHaveTextContent("Afiliado 1043");
  });

  it("Vincular: sem escolher a célula, pede a escolha; Cancelar fecha sem salvar", async () => {
    await abrirTela();
    const item = cartao("Afiliado 1044");
    const botao = within(item).getByRole("button", {
      name: "Vincular o afiliado 1044",
    });
    fireEvent.click(botao);

    fireEvent.click(within(item).getByRole("button", { name: "Confirmar" }));
    expect(within(item).getByRole("alert")).toHaveTextContent(
      "Escolha a célula na lista.",
    );

    fireEvent.click(within(item).getByRole("button", { name: "Cancelar" }));
    expect(within(item).queryByRole("searchbox")).not.toBeInTheDocument();
    expect(botao).toHaveAttribute("aria-expanded", "false");
    expect(botao).toHaveFocus();
    expect(api.puts).toEqual([]);
  });

  it("erro ao salvar (célula inexistente, 400 referencia_invalida): mostra a mensagem e nada muda", async () => {
    await abrirTela();
    api.falhas.putCelulaInexistente = true;
    const item = cartao("Afiliado 1043");
    fireEvent.click(
      within(item).getByRole("button", { name: "Vincular o afiliado 1043" }),
    );
    fireEvent.click(within(item).getByRole("radio", { name: /^Célula Ágape/ }));

    fireEvent.click(
      within(item).getByRole("button", { name: "Vincular: Célula Ágape" }),
    );

    expect(await within(item).findByRole("alert")).toHaveTextContent(
      "A célula 1 não existe",
    );
    expect(levadosAVista()).toEqual([]);
    expect(api.puts).toHaveLength(1);
    expect(within(item).getByRole("searchbox")).toBeInTheDocument();
    expect(screen.queryByText(/vinculado:/)).not.toBeInTheDocument();
    expect(titulosNivel3(regiao(/^Sem célula/))).toEqual([
      "Afiliado 1044",
      "Afiliado 1043",
    ]);
  });

  it("Trocar: move o afiliado para outra célula (a atual fica fora da lista)", async () => {
    await abrirTela();
    const betel = celulaNaLista("Célula Betel");

    fireEvent.click(
      within(betel).getByRole("button", {
        name: "Trocar a célula do afiliado 1001",
      }),
    );
    const grupo = within(betel).getByRole("group", {
      name: "Nova célula do afiliado 1001",
    });
    expect(
      within(grupo).queryByRole("radio", { name: /^Célula Betel/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(grupo).getByRole("radio", { name: /^Célula Canaã/ }),
    );
    fireEvent.click(
      within(betel).getByRole("button", { name: "Trocar para: Célula Canaã" }),
    );

    expect(
      await within(celulaNaLista("Célula Betel")).findByText(
        "Afiliado 1001 trocado para: Célula Canaã.",
      ),
    ).toBeVisible();
    await waitFor(() => expect(tituloDaCelula("Célula Betel")).toHaveFocus());
    expect(api.puts).toEqual([{ affiliateId: 1001, corpo: { celula_id: 3 } }]);
    // O afiliado (com os botões dele) mudou de cartão; na Betel fica só o aviso da troca.
    const botaoTrocar = { name: "Trocar a célula do afiliado 1001" };
    await waitFor(() =>
      expect(
        within(celulaNaLista("Célula Canaã")).getByRole("button", botaoTrocar),
      ).toBeInTheDocument(),
    );
    expect(
      within(celulaNaLista("Célula Betel")).queryByRole("button", botaoTrocar),
    ).not.toBeInTheDocument();
    expect(tituloDaCelula("Célula Betel")).toHaveFocus();
  });

  it("Desvincular: pede confirmação e devolve o afiliado para 'Sem célula'", async () => {
    await abrirTela();
    const canaa = celulaNaLista("Célula Canaã");
    const desvincular = within(canaa).getByRole("button", {
      name: "Desvincular o afiliado 1002",
    });

    // Cancelar não salva.
    fireEvent.click(desvincular);
    fireEvent.click(within(canaa).getByRole("button", { name: "Cancelar" }));
    expect(desvincular).toHaveFocus();
    expect(api.puts).toEqual([]);

    fireEvent.click(desvincular);
    const confirmar = within(canaa).getByRole("button", {
      name: "Confirmar desvínculo",
    });
    expect(confirmar).toHaveFocus();
    expect(confirmar).toHaveAccessibleDescription(
      "Desvincular o afiliado 1002 desta célula? As vendas dele deixam de contar para ela até ele ser vinculado de novo.",
    );
    fireEvent.click(confirmar);

    expect(
      await within(celulaNaLista("Célula Canaã")).findByText(
        "Afiliado 1002 desvinculado. Ele voltou para “Sem célula”.",
      ),
    ).toBeVisible();
    await waitFor(() => expect(tituloDaCelula("Célula Canaã")).toHaveFocus());
    expect(api.puts).toEqual([
      { affiliateId: 1002, corpo: { celula_id: null } },
    ]);
    await waitFor(() =>
      expect(titulosNivel3(regiao(/^Sem célula/))).toEqual([
        "Afiliado 1002",
        "Afiliado 1044",
        "Afiliado 1043",
      ]),
    );
    expect(celulaNaLista("Célula Canaã")).toHaveTextContent("Sem afiliado");
  });

  it("pré-cadastro: o código digitado na linha da célula é salvo nela", async () => {
    await abrirTela();
    const campo = screen.getByRole("textbox", {
      name: "Código de afiliado (Célula Débora)",
    });

    fireEvent.change(campo, { target: { value: " 5005 " } });
    fireEvent.click(
      within(celulaNaLista("Célula Débora")).getByRole("button", {
        name: "Salvar código",
      }),
    );

    expect(
      await within(celulaNaLista("Célula Débora")).findByText(
        "Código 5005 pré-cadastrado: Célula Débora. As vendas dele já vão contar para a célula.",
      ),
    ).toBeVisible();
    await waitFor(() => expect(tituloDaCelula("Célula Débora")).toHaveFocus());
    expect(api.puts).toEqual([{ affiliateId: 5005, corpo: { celula_id: 4 } }]);
    await waitFor(() =>
      expect(celulaNaLista("Célula Débora")).toHaveTextContent("Afiliado 5005"),
    );
    expect(celulaNaLista("Célula Débora")).toHaveTextContent("Vinculada");
  });

  it("pré-cadastro: recusa código que não é número e avisa quando o código já está na célula", async () => {
    await abrirTela();
    const campo = screen.getByRole("textbox", {
      name: "Código de afiliado (Célula Ágape)",
    });
    const salvar = within(celulaNaLista("Célula Ágape")).getByRole("button", {
      name: "Salvar código",
    });

    for (const invalido of ["", "12a", "0", "10.5", "-7"]) {
      fireEvent.change(campo, { target: { value: invalido } });
      fireEvent.click(salvar);
      expect(campo).toHaveAttribute("aria-invalid", "true");
      expect(campo).toHaveAccessibleDescription(
        "Digite só os números do código de afiliado (ex.: 1043).",
      );
    }

    // Célula Betel já tem o 1001: "Adicionar outro código" abre o campo.
    fireEvent.click(
      within(celulaNaLista("Célula Betel")).getByRole("button", {
        name: "Adicionar outro código em Célula Betel",
      }),
    );
    const campoBetel = screen.getByRole("textbox", {
      name: "Código de afiliado (Célula Betel)",
    });
    fireEvent.change(campoBetel, { target: { value: "1001" } });
    fireEvent.click(
      within(celulaNaLista("Célula Betel")).getByRole("button", {
        name: "Salvar código",
      }),
    );
    expect(campoBetel).toHaveAccessibleDescription(
      "O afiliado 1001 já está nesta célula.",
    );
    expect(api.puts).toEqual([]);
  });

  it("pré-cadastro de um código que está em outra célula pede confirmação e troca", async () => {
    await abrirTela();
    const agape = celulaNaLista("Célula Ágape");
    fireEvent.change(
      within(agape).getByRole("textbox", {
        name: "Código de afiliado (Célula Ágape)",
      }),
      { target: { value: "1001" } },
    );
    fireEvent.click(
      within(agape).getByRole("button", { name: "Salvar código" }),
    );

    const trocar = within(agape).getByRole("button", {
      name: "Trocar para esta célula",
    });
    expect(trocar).toHaveAccessibleDescription(
      "O afiliado 1001 está em Célula Betel. Trocar para esta célula?",
    );
    expect(api.puts).toEqual([]);
    fireEvent.click(trocar);

    expect(
      await within(celulaNaLista("Célula Ágape")).findByText(
        "Afiliado 1001 trocado para: Célula Ágape.",
      ),
    ).toBeVisible();
    await waitFor(() => expect(tituloDaCelula("Célula Ágape")).toHaveFocus());
    expect(api.puts).toEqual([{ affiliateId: 1001, corpo: { celula_id: 1 } }]);
  });

  it("pré-cadastro de um código que está na fila de órfãos vincula esse afiliado", async () => {
    await abrirTela();
    const debora = celulaNaLista("Célula Débora");
    fireEvent.change(
      within(debora).getByRole("textbox", {
        name: "Código de afiliado (Célula Débora)",
      }),
      { target: { value: "1044" } },
    );
    fireEvent.click(
      within(debora).getByRole("button", { name: "Salvar código" }),
    );

    expect(
      await within(celulaNaLista("Célula Débora")).findByText(
        "Afiliado 1044 vinculado: Célula Débora.",
      ),
    ).toBeVisible();
    expect(api.puts).toEqual([{ affiliateId: 1044, corpo: { celula_id: 4 } }]);
    await waitFor(() =>
      expect(titulosNivel3(regiao(/^Sem célula/))).toEqual(["Afiliado 1043"]),
    );
  });
});

describe("CA3/CA4: atualização automática", () => {
  it("consulta a cada 15 s com a aba visível, para com a aba oculta e volta na hora; 'Atualizar agora' consulta já", async () => {
    await abrirTela();
    expect(api.contagem).toEqual({ adesao: 1, orfaos: 1 });

    // O relógio falso também anda com o tempo real: a margem de 2 s cobre a duração do teste.
    await act(() =>
      vi.advanceTimersByTimeAsync(INTERVALO_ATUALIZACAO_MS - 2000),
    );
    expect(api.contagem.adesao).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(api.contagem).toEqual({ adesao: 2, orfaos: 2 });
    await esperarAtualizacao();

    // Aba oculta: nenhuma consulta, por mais tempo que passe.
    definirVisibilidade("hidden");
    await act(() => vi.advanceTimersByTimeAsync(4 * INTERVALO_ATUALIZACAO_MS));
    expect(api.contagem.adesao).toBe(2);

    // Voltou: atualiza na hora e retoma o ritmo.
    definirVisibilidade("visible");
    expect(api.contagem.adesao).toBe(3);
    await esperarAtualizacao();
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ATUALIZACAO_MS));
    expect(api.contagem.adesao).toBe(4);
    await esperarAtualizacao();

    fireEvent.click(screen.getByRole("button", { name: "Atualizar agora" }));
    expect(api.contagem).toEqual({ adesao: 5, orfaos: 5 });
    await esperarAtualizacao();
    // O ritmo recomeça a contar do "Atualizar agora".
    await act(() =>
      vi.advanceTimersByTimeAsync(INTERVALO_ATUALIZACAO_MS - 2000),
    );
    expect(api.contagem.adesao).toBe(5);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(api.contagem.adesao).toBe(6);
  });

  it("falha numa atualização: os dados continuam na tela, com um aviso, e a próxima volta ao normal", async () => {
    await abrirTela();
    api.falhas.gets = 1;

    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ATUALIZACAO_MS));

    expect(
      await screen.findByText(
        /^A última atualização falhou: Não foi possível conectar à API\./,
      ),
    ).toHaveAttribute("role", "status");
    expect(regiao(/^Sem célula \(2\)$/)).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ATUALIZACAO_MS));
    await waitFor(() =>
      expect(
        screen.queryByText(/^A última atualização falhou/),
      ).not.toBeInTheDocument(),
    );
    expect(api.contagem.adesao).toBe(3);
  });

  it("ao sair da tela, a atualização automática para", async () => {
    await abrirTela();
    // Uma tela que não consulta a API (a de Pedidos, desde a RIFA-025, consulta).
    fireEvent.click(screen.getByRole("link", { name: "Conferência" }));
    await screen.findByRole("heading", { level: 1, name: "Conferência" });

    await act(() => vi.advanceTimersByTimeAsync(3 * INTERVALO_ATUALIZACAO_MS));

    expect(api.contagem).toEqual({ adesao: 1, orfaos: 1 });
  });
});

describe("RIFA-006b: no celular, a fila logo no topo; depois de vincular, aviso perto e foco estável", () => {
  it("celular: resumo compacto em etiquetas e a fila 'Sem célula' logo abaixo dele, antes de 'Quem falta'", async () => {
    await abrirTela();

    const resumo = regiao(/^Resumo$/);
    expect(
      within(resumo)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["2 de 4 vinculadas", "1 já venderam", "2 sem célula"]);
    // Sem os três indicadores grandes nem a barra, que empurravam a fila para baixo da dobra.
    expect(
      within(resumo).queryByText("Células que já venderam"),
    ).not.toBeInTheDocument();
    expect(within(resumo).queryByRole("progressbar")).not.toBeInTheDocument();
    expect(ordemDasSecoes()).toEqual([
      "Resumo",
      "Sem célula (2)",
      "Quem falta (2)",
      "Todas as células",
    ]);
    // Nada entre o resumo e a fila; o "Atualizar agora" fica na linha da hora, acima do resumo.
    expect(resumo.nextElementSibling?.firstElementChild).toBe(
      regiao(/^Sem célula/),
    );
    expect(
      screen
        .getByRole("button", { name: "Atualizar agora" })
        .compareDocumentPosition(resumo) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("computador: os três indicadores e a barra de adesão, com as seções na mesma ordem", async () => {
    simularTela("computador");
    await abrirTela();

    const resumo = regiao(/^Resumo$/);
    expect(within(resumo).queryByRole("list")).not.toBeInTheDocument();
    expect(resumo).toHaveTextContent("Células vinculadas2 de 4");
    expect(
      within(resumo).getByRole("progressbar", { name: "Adesão das células" }),
    ).toBeInTheDocument();
    expect(ordemDasSecoes()).toEqual([
      "Resumo",
      "Sem célula (2)",
      "Quem falta (2)",
      "Todas as células",
    ]);
  });

  it("sem matchMedia (navegador antigo): vale o celular, com o resumo compacto", async () => {
    Reflect.deleteProperty(window, "matchMedia");
    await abrirTela();

    expect(within(regiao(/^Resumo$/)).getByRole("list")).toBeInTheDocument();
    expect(
      within(regiao(/^Resumo$/)).queryByRole("progressbar"),
    ).not.toBeInTheDocument();
  });

  it("girar o aparelho (mudar a largura da tela) troca o resumo na hora", async () => {
    await abrirTela();
    expect(within(regiao(/^Resumo$/)).getByRole("list")).toBeInTheDocument();

    mudarTela("computador");

    expect(
      within(regiao(/^Resumo$/)).queryByRole("list"),
    ).not.toBeInTheDocument();
    expect(
      within(regiao(/^Resumo$/)).getByRole("progressbar"),
    ).toBeInTheDocument();
  });

  it("sem órfãos: a seção fica curta e explica de onde vêm os códigos", async () => {
    await abrirTela({ ...cenarioDaReuniao(), orfaos: [] });

    const semCelula = regiao(/^Sem célula \(0\)$/);
    expect(semCelula).toHaveTextContent(
      "Nenhum afiliado sem célula agora. Quando o líder iniciar uma compra pelo próprio link de afiliado (sem pagar), o código dele aparece aqui em segundos.",
    );
    expect(within(semCelula).queryByRole("list")).not.toBeInTheDocument();
    expect(regiao(/^Resumo$/)).toHaveTextContent("0 sem célula");
  });

  it("vincular o primeiro da fila: ele sai na hora, o aviso aparece na seção (e é anunciado) e o foco vai para o próximo órfão, onde fica depois da atualização", async () => {
    await abrirTela();
    // Regiões vivas que já estavam na tela: o anúncio tem de sair numa delas.
    const regioesVivas = screen.getAllByRole("status");
    const proximo = screen.getByRole("button", {
      name: "Vincular o afiliado 1043",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Vincular o afiliado 1044" }),
    );
    fireEvent.click(
      within(cartao("Afiliado 1044")).getByRole("radio", {
        name: /^Célula Ágape/,
      }),
    );
    const liberarConsultas = api.segurarConsultas();

    fireEvent.click(
      screen.getByRole("button", { name: "Vincular: Célula Ágape" }),
    );

    // Antes da atualização chegar: o vinculado já saiu da fila e o foco está no próximo.
    await waitFor(() => expect(proximo).toHaveFocus());
    expect(screen.getByText(/^Atualizando…/)).toBeInTheDocument();
    const semCelula = regiao(/^Sem célula \(1\)$/);
    expect(titulosNivel3(semCelula)).toEqual(["Afiliado 1043"]);
    expect(
      within(semCelula).getByText("Afiliado 1044 vinculado: Célula Ágape."),
    ).toBeVisible();
    expect(regioesVivas.map((regiaoViva) => regiaoViva.textContent)).toContain(
      "Afiliado 1044 vinculado: Célula Ágape.",
    );
    expect(regiao(/^Resumo$/)).toHaveTextContent("1 sem célula");
    // O aviso ocupa o lugar do cartão que saiu, logo acima do próximo, e os dois vão para a vista.
    expect(
      cartao("Afiliado 1043").closest("li")?.previousElementSibling,
    ).toHaveTextContent("Afiliado 1044 vinculado: Célula Ágape.");
    expect(levadosAVista()).toEqual([
      proximo.textContent,
      expect.stringContaining("Afiliado 1044 vinculado: Célula Ágape."),
    ]);

    liberarConsultas();
    await esperarAtualizacao();

    expect(proximo).toBeInTheDocument();
    expect(proximo).toHaveFocus();
    expect(titulosNivel3(regiao(/^Sem célula/))).toEqual(["Afiliado 1043"]);
  });

  it("vincular o último da fila: o foco vai para o órfão de cima", async () => {
    await abrirTela();
    fireEvent.click(
      screen.getByRole("button", { name: "Vincular o afiliado 1043" }),
    );
    fireEvent.click(
      within(cartao("Afiliado 1043")).getByRole("radio", {
        name: /^Célula Débora/,
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Vincular: Célula Débora" }),
    );

    const acima = screen.getByRole("button", {
      name: "Vincular o afiliado 1044",
    });
    await waitFor(() => expect(acima).toHaveFocus());
    expect(
      cartao("Afiliado 1044").closest("li")?.nextElementSibling,
    ).toHaveTextContent("Afiliado 1043 vinculado: Célula Débora.");
    expect(levadosAVista()).toEqual([
      acima.textContent,
      expect.stringContaining("Afiliado 1043 vinculado: Célula Débora."),
    ]);
    await esperarAtualizacao();
    expect(acima).toHaveFocus();
    expect(titulosNivel3(regiao(/^Sem célula/))).toEqual(["Afiliado 1044"]);
  });

  it("a fila esvaziou: o foco vai para o título 'Sem célula', que continua na tela", async () => {
    await abrirTela({ ...cenarioDaReuniao(), orfaos: [afiliado(1043)] });
    fireEvent.click(
      screen.getByRole("button", { name: "Vincular o afiliado 1043" }),
    );
    fireEvent.click(
      within(cartao("Afiliado 1043")).getByRole("radio", {
        name: /^Célula Ágape/,
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Vincular: Célula Ágape" }),
    );

    const titulo = await screen.findByText("Sem célula (0)");
    await waitFor(() => expect(titulo).toHaveFocus());
    expect(levadosAVista()).toEqual([
      "Sem célula (0)",
      expect.stringContaining("Afiliado 1043 vinculado: Célula Ágape."),
    ]);
    expect(
      within(regiao(/^Sem célula/)).getByText(
        "Afiliado 1043 vinculado: Célula Ágape.",
      ),
    ).toBeVisible();
    await esperarAtualizacao();
    expect(screen.getByText("Sem célula (0)")).toHaveFocus();
    expect(api.puts).toEqual([{ affiliateId: 1043, corpo: { celula_id: 1 } }]);
  });
});
