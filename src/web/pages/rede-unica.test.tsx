// RIFA-065 (D30): com uma rede só na hierarquia, nenhuma tela mostra a palavra "rede" nem o nome da rede, para nenhum
// papel (admin, coordenação, líder e discipulador). Cada tela abre com a hierarquia numa rede só e a varredura confere o
// texto (inclusive o só do leitor de tela), os rótulos em atributos (como o `label` de um <optgroup>), os valores dos
// campos, o título da aba e as dicas de todos os botões e campos, com o menu. A exceção é a aba "Importar planilha" da
// Hierarquia: a planilha continua com a coluna `rede`, e a dica dela explica que a rede pode ser uma só. Com duas
// redes, nada muda: os testes de cada tela (com duas redes) continuam como eram.
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { textosDasDicas } from "../test/dicas";
import {
  ADMIN_DE_TESTE,
  USUARIO_DE_TESTE,
  renderizarRota,
  respostaJson,
} from "../test/renderizar";
import { criarApiFalsa as criarApiAcessos } from "./acessos/teste-apoio";
import { celulaDeTeste, simularApiAdesao } from "./adesao/teste-apoio";
import {
  CONFIGURADA,
  simularApi as simularApiCampanha,
} from "./campanha/teste-apoio";
import { DICAS_REDE_UNICA as DICAS_HIERARQUIA } from "./hierarquia/textos";
import {
  criarApiFalsa as criarApiHierarquia,
  criarCelula,
  criarDiscipulador,
  criarRede,
} from "./hierarquia/teste-apoio";
import {
  criarApiFalsa as criarApiMinha,
  sessaoDaVisao,
  visaoDe,
} from "./minha/teste-apoio";
import { simularApi as simularApiPedidos } from "./pedidos/teste-apoio";
import {
  item,
  respostaDaConsulta,
  simularApiRanking,
} from "./rankings/teste-apoio";
import {
  CENARIOS,
  celulaDaApi,
  simularApi as simularApiVisaoGeral,
} from "./visao-geral/teste-apoio";

/** A palavra, no singular ou no plural, em qualquer caixa. */
const PALAVRA_REDE = /\bredes?\b/i;
/** O nome da rede única dos cenários (sem a palavra "Rede", para a varredura do nome valer por si). */
const NOME_DA_REDE = "Exploradores Ficticia";

/** Atributos que viram texto na tela ou no leitor de tela. */
const ATRIBUTOS = ["label", "aria-label", "title", "placeholder", "alt"];

/**
 * Tudo o que a pessoa vê ou ouve em `raiz` (padrão: o <body>), menos as partes de `excluir` (seletores): o texto, os
 * atributos de ATRIBUTOS, os valores dos campos e o título da aba do navegador.
 */
function textosDaTela(excluir: readonly string[] = []): string[] {
  const fora = (elemento: Element) =>
    excluir.some((seletor) => elemento.closest(seletor) !== null);
  const textos = [document.title];
  const percorrer = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
  );
  for (let no = percorrer.nextNode(); no; no = percorrer.nextNode()) {
    const pai = no.parentElement;
    if (pai && !fora(pai) && no.textContent?.trim()) {
      textos.push(no.textContent.trim());
    }
  }
  for (const elemento of document.body.querySelectorAll("*")) {
    if (fora(elemento)) continue;
    for (const atributo of ATRIBUTOS) {
      const valor = elemento.getAttribute(atributo);
      if (valor) textos.push(valor);
    }
    if (
      elemento instanceof HTMLInputElement ||
      elemento instanceof HTMLTextAreaElement
    ) {
      if (elemento.value) textos.push(elemento.value);
    }
  }
  return textos;
}

/** Os textos da tela e das dicas que citam a rede (a palavra ou o nome). Vazio = a rede não aparece. */
function citamARede(textos: readonly string[]): string[] {
  return textos.filter(
    (texto) => PALAVRA_REDE.test(texto) || texto.includes(NOME_DA_REDE),
  );
}

/** Confere a tela inteira e as dicas: nada cita a rede (menos o que `excluir` tira da tela). */
function conferirSemRede(excluir: readonly string[] = []) {
  expect(citamARede(textosDaTela(excluir))).toEqual([]);
  expect(citamARede(textosDasDicas())).toEqual([]);
}

/** Foca e clica, como o toque e o Enter fazem no navegador (o jsdom não foca no clique). */
function acionar(elemento: HTMLElement) {
  act(() => elemento.focus());
  fireEvent.click(elemento);
}

const abas = () =>
  screen.getAllByRole("tab").map((aba) => aba.textContent?.trim());

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------------------------------
// Hierarquia: uma rede, três discipuladores e quatro células
// ---------------------------------------------------------------------------------------------------

function hierarquiaDeUmaRede() {
  const rede = criarRede(7, NOME_DA_REDE, "jovens", "Pastor Ficticio");
  const ana = criarDiscipulador(11, "Ana Discipuladora", rede);
  const bruno = criarDiscipulador(12, "Bruno Discipulador", rede);
  const carla = criarDiscipulador(13, "Carla Discipuladora", rede);
  return {
    redes: [rede],
    discipuladores: [ana, bruno, carla],
    celulas: [
      criarCelula(101, "Célula Esperança", ana),
      criarCelula(102, "Célula Fé", bruno),
      criarCelula(103, "Célula Ágape", carla),
      criarCelula(104, "Célula Vida", carla),
    ],
  };
}

describe("Hierarquia (admin)", () => {
  async function abrir() {
    const api = criarApiHierarquia(hierarquiaDeUmaRede());
    vi.stubGlobal("fetch", api.fetch);
    renderizarRota("/coordenacao/hierarquia", { usuario: ADMIN_DE_TESTE });
    await screen.findByRole("region", { name: "Resumo" });
    return api;
  }

  it("sem o número, a aba, as colunas e o filtro das redes; a importação é a exceção, com a dica da rede única", async () => {
    await abrir();
    const resumo = screen.getByRole("region", { name: "Resumo" });
    expect(
      [...resumo.querySelectorAll(".ui-stat__rotulo")].map((rotulo) =>
        rotulo.textContent?.trim(),
      ),
    ).toEqual(["Discipuladores", "Células", "Total de pessoas"]);
    expect(abas()).toEqual(["Células", "Discipuladores", "Importar planilha"]);
    expect(
      within(screen.getByRole("table", { name: "Células" }))
        .getAllByRole("columnheader")
        .map((titulo) => titulo.textContent),
    ).not.toContain("Rede");
    expect(screen.queryByLabelText("Rede")).toBeNull();

    // A importação continua com a coluna `rede` (a planilha não muda): é a única parte que cita a rede.
    const importar = screen.getByRole("tab", { name: "Importar planilha" });
    expect(citamARede(textosDaTela(["[role='tabpanel']"]))).toEqual([]);
    expect(
      citamARede(textosDasDicas()).filter(
        (texto) => texto !== DICAS_HIERARQUIA.abaImportar,
      ),
    ).toEqual([]);
    expect(DICAS_HIERARQUIA.abaImportar).toMatch(/a rede pode ser uma só/);
    const painelImportar = document.getElementById(
      importar.getAttribute("aria-controls") ?? "",
    );
    expect(painelImportar).toHaveTextContent(
      "Cadastra de uma vez os discipuladores e as células.",
    );
    expect(painelImportar).toHaveTextContent(
      "rede (obrigatória)nome da rede (pode ser uma só: o mesmo nome em todas as linhas)",
    );

    // As tabelas, uma aba de cada vez (o painel visível), com as dicas de cada uma.
    for (const nome of ["Células", "Discipuladores"]) {
      acionar(screen.getByRole("tab", { name: nome }));
      const painel = screen.getByRole("tabpanel");
      expect(citamARede(textosDaTela(["[role='tabpanel'][hidden]"]))).toEqual(
        [],
      );
      expect(painel).toHaveTextContent(
        nome === "Células" ? "Célula Fé" : "Ana",
      );
      expect(
        citamARede(textosDasDicas()).filter(
          (texto) => texto !== DICAS_HIERARQUIA.abaImportar,
        ),
      ).toEqual([]);
    }
    expect(
      within(screen.getByRole("table", { name: "Discipuladores" }))
        .getAllByRole("columnheader")
        .map((titulo) => titulo.textContent),
    ).toEqual(["Discipulador", "Divisão", "Células", "Pessoas", "Ações"]);
  });

  it("os diálogos: a célula escolhe o discipulador numa lista só; o discipulador fica sem o campo da rede e salva na mesma", async () => {
    const api = await abrir();
    acionar(screen.getByRole("button", { name: "Editar Célula Fé" }));
    const dialogoCelula = await screen.findByRole("dialog", {
      name: "Editar célula",
    });
    const discipulador = within(dialogoCelula).getByLabelText("Discipulador");
    expect(within(discipulador).queryAllByRole("group")).toEqual([]);
    expect(
      within(discipulador)
        .getAllByRole("option")
        .map((opcao) => opcao.textContent),
    ).toEqual([
      "Ana Discipuladora",
      "Bruno Discipulador",
      "Carla Discipuladora",
    ]);
    conferirSemRede(["[role='tabpanel']"]);
    fireEvent.click(
      within(dialogoCelula).getByRole("button", { name: "Cancelar" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    acionar(screen.getByRole("tab", { name: "Discipuladores" }));
    acionar(screen.getByRole("button", { name: "Editar Bruno Discipulador" }));
    const dialogo = await screen.findByRole("dialog", {
      name: "Editar discipulador",
    });
    expect(within(dialogo).queryByLabelText("Rede")).toBeNull();
    conferirSemRede(["[role='tabpanel']"]);
    fireEvent.change(within(dialogo).getByLabelText("Nome do discipulador"), {
      target: { value: "Bruno Discipulador Novo" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      api.chamadasA("PUT", "/api/admin/discipuladores/12")[0]?.corpo,
    ).toEqual({ rede_id: 7, nome: "Bruno Discipulador Novo" });
  });
});

// ---------------------------------------------------------------------------------------------------
// Visão geral, Pedidos e Adesão: as células trazem a hierarquia toda
// ---------------------------------------------------------------------------------------------------

describe("Visão geral (coordenação)", () => {
  it("o filtro sem o grupo das redes, o aviso das vendas sem célula, o relatório sem o tipo das redes e o menu", async () => {
    const api = simularApiVisaoGeral(CENARIOS.emDia);
    // As mesmas três células do cenário, numa rede só.
    api.celulas = () =>
      respostaJson({
        itens: [1, 2, 3].map((id) =>
          celulaDaApi({
            id,
            nome: `Célula Ficticia 0${id}`,
            qtd_pessoas: [12, 9, 15][id - 1] ?? 10,
            discipulador_id: id,
            discipulador_nome: `Discipulador Ficticio ${id}`,
            rede_id: 7,
            rede_nome: NOME_DA_REDE,
            divisao: "jovens",
          }),
        ),
      });
    renderizarRota("/coordenacao");
    await screen.findByText(/^Atualizado às/);
    const filtro = screen.getByLabelText("Filtrar por");
    await waitFor(() =>
      expect(within(filtro).getAllByRole("group")).toHaveLength(3),
    );
    expect(
      within(filtro)
        .getAllByRole("group")
        .map((grupo) => grupo.getAttribute("label")),
    ).toEqual(["Divisão", "Discipulador", "Célula"]);
    expect(
      within(
        screen.getByRole("region", { name: "Para conferir" }),
      ).getAllByRole("listitem")[0],
    ).toHaveTextContent(
      "contam na campanha, mas em nenhuma divisão nem célula.",
    );
    expect(
      screen.queryByRole("radio", { name: "Por rede" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Por célula" }),
    ).toBeInTheDocument();
    conferirSemRede();
  });
});

describe("Pedidos (coordenação)", () => {
  it("o filtro de célula sem o grupo com o nome da rede", async () => {
    simularApiPedidos({
      celulas: [
        {
          id: 1,
          nome: "Célula Ficticia 02",
          rede_id: 7,
          rede_nome: NOME_DA_REDE,
        },
        {
          id: 2,
          nome: "Célula Ficticia 10",
          rede_id: 7,
          rede_nome: NOME_DA_REDE,
        },
      ],
    });
    renderizarRota("/coordenacao/pedidos");
    const celula = await screen.findByRole("combobox", { name: "Célula" });
    await waitFor(() =>
      expect(within(celula).getAllByRole("option")).toHaveLength(4),
    );
    expect(within(celula).queryAllByRole("group")).toEqual([]);
    expect(
      within(celula)
        .getAllByRole("option")
        .map((opcao) => opcao.textContent),
    ).toEqual([
      "Todas as células",
      "Só os sem célula",
      "Célula Ficticia 02",
      "Célula Ficticia 10",
    ]);
    conferirSemRede();
  });
});

describe("Adesão (admin)", () => {
  it("as listas, a escolha da célula e os links de vendas sem o nome da rede; as buscas sem citar a rede", async () => {
    const naRede = { rede_id: 7, rede_nome: NOME_DA_REDE };
    const api = simularApiAdesao({
      celulas: [
        celulaDeTeste(1, "Célula Ágape", {
          ...naRede,
          lider_telefone: "(91) 90000-0001",
        }),
        celulaDeTeste(2, "Célula Betel", {
          ...naRede,
          afiliados: [1001],
          vinculada: true,
        }),
        celulaDeTeste(3, "Célula Canaã", {
          ...naRede,
          afiliados: [1002],
          vinculada: true,
        }),
      ],
    });
    renderizarRota("/coordenacao/adesao", { usuario: ADMIN_DE_TESTE });
    await screen.findByText(/^Atualizado às/, undefined, { timeout: 5000 });
    const links = await screen.findByRole(
      "region",
      { name: "Links de vendas" },
      { timeout: 5000 },
    );
    await within(links).findByRole(
      "button",
      { name: /^Imprimir os QR codes/ },
      { timeout: 5000 },
    );
    const todas = screen.getByRole("region", { name: "Todas as células" });
    expect(
      within(todas)
        .getByRole("heading", { level: 3, name: "Célula Betel" })
        .closest("article"),
    ).toHaveTextContent("Líder: Lider Betel");
    // A escolha da célula (ao vincular um afiliado da fila).
    acionar(screen.getByRole("button", { name: "Vincular o afiliado 1044" }));
    await screen.findByLabelText("Buscar célula ou líder");
    conferirSemRede();
    expect(api.inesperadas).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
// Rankings, Campanha e Acessos: perguntam à API quantas redes há
// ---------------------------------------------------------------------------------------------------

describe("Rankings (coordenação)", () => {
  const itens = [
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
      realizado: 3,
      meta: 29,
      esperado: 5,
    }),
  ];

  it("sem a aba das redes e sem a rede no vínculo; o cabeçalho e o menu não citam a rede", async () => {
    const api = simularApiRanking(
      (consulta) => respostaDaConsulta(consulta, itens),
      { redes: 1 },
    );
    renderizarRota("/coordenacao/rankings");
    await screen.findByRole("table");
    await waitFor(() => expect(abas()).toEqual(["Células", "Discipuladores"]));
    const [primeira] = within(screen.getByRole("table"))
      .getAllByRole("row")
      .slice(1);
    expect(
      primeira?.querySelector(".rankings-linha__vinculo")?.textContent,
    ).toBe("Jovens · Discipulador Ficticio A");
    expect(
      screen.getByText(
        "A disputa entre células e discipuladores: posição, % da meta e quem está em dia.",
      ),
    ).toBeInTheDocument();
    conferirSemRede();
    expect(api.pedidosDasRedes).toEqual(["/api/admin/redes"]);
    expect(api.inesperadas).toEqual([]);
  });

  it("uma URL de antes com ?nivel=rede mostra as células", async () => {
    const api = simularApiRanking(
      (consulta) => respostaDaConsulta(consulta, itens),
      { redes: 1 },
    );
    renderizarRota("/coordenacao/rankings?nivel=rede");
    await waitFor(() => expect(abas()).toEqual(["Células", "Discipuladores"]));
    await screen.findByRole("columnheader", { name: "Célula" });
    expect(screen.getByRole("tab", { name: "Células" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(api.caminhos.at(-1)).toBe(
      "/api/painel/ranking?nivel=celula&periodo=atual",
    );
    conferirSemRede();
  });
});

describe("Campanha", () => {
  async function abrir(usuario = ADMIN_DE_TESTE) {
    const api = simularApiCampanha({ campanha: CONFIGURADA, redes: 1 });
    renderizarRota("/coordenacao/campanha", { usuario });
    await screen.findByRole("heading", { level: 2, name: "Identificação" });
    // O resumo conta só as mensagens que a tela mostra.
    await screen.findByText("As 3 com o texto padrão.");
    return api;
  }

  it.each([
    ["admin", ADMIN_DE_TESTE],
    ["coordenação", USUARIO_DE_TESTE],
  ])(
    "%s: sem o acesso das redes (na chave e no resumo) e sem a mensagem do link da rede",
    async (_papel, usuario) => {
      const api = await abrir(usuario);
      expect(screen.queryByLabelText("Acesso das redes")).toBeNull();
      expect(
        screen.getByLabelText("Acesso dos discipuladores"),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText("Mensagem do link da rede")).toBeNull();
      expect(
        screen.queryByRole("link", { name: "Acesso de redes" }),
      ).toBeNull();
      expect(
        screen.getByLabelText("Mensagem do link do discipulador"),
      ).toHaveAccessibleDescription(
        /\{alvo\} = o nome da célula ou do discipulador/,
      );
      conferirSemRede();
      expect(api.pedidosDasRedes).toEqual(["/api/admin/redes"]);
    },
  );

  it("o admin salva com o acesso e a mensagem das redes como estavam (escondidos, não mudam)", async () => {
    const api = await abrir();
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(api.puts()).toHaveLength(1));
    const corpo = api.puts()[0]?.corpo as {
      acesso: { redes: boolean };
      mensagens: { link_rede: string };
    };
    expect(corpo.acesso.redes).toBe(CONFIGURADA.acesso.redes);
    expect(corpo.mensagens.link_rede).toBe(CONFIGURADA.mensagens.link_rede);
  });
});

describe("Acessos (admin)", () => {
  it("a aba dos líderes e discipuladores, sem o papel Rede (não se oferece criar acesso de rede)", async () => {
    const api = criarApiAcessos();
    api.redes.quantidade = 1;
    vi.stubGlobal("fetch", api.fetch);
    renderizarRota("/coordenacao/acessos", { usuario: ADMIN_DE_TESTE });
    await screen.findByRole("heading", { level: 2, name: "Admin de Teste" });
    const aba = await screen.findByRole("tab", {
      name: "Líderes e discipuladores",
    });
    acionar(aba);
    await screen.findByRole("table", { name: "Acessos: Líderes de célula" });
    const papel = screen.getByLabelText("Papel");
    expect(
      within(papel)
        .getAllByRole("option")
        .map((opcao) => opcao.textContent),
    ).toEqual(["Líderes de célula", "Discipuladores"]);
    conferirSemRede();
    expect(api.redes.pedidos).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------
// /minha: o líder e o discipulador nunca veem o nome da rede (com uma rede só ou com várias)
// ---------------------------------------------------------------------------------------------------

describe("/minha", () => {
  it.each(["lider", "discipulador"] as const)(
    "%s: o cabeçalho, os números, a equipe e os links sem a rede",
    async (papel) => {
      const visao = visaoDe({ papel });
      const api = criarApiMinha(visao);
      vi.stubGlobal("fetch", api.fetch);
      renderizarRota("/minha", { usuario: sessaoDaVisao(visao) });
      await screen.findByRole("heading", { level: 2, name: "Ranking" });
      await screen.findByRole(
        "heading",
        {
          level: 2,
          name:
            papel === "lider"
              ? "Seu link de vendas"
              : "Links de vendas das suas células",
        },
        { timeout: 5000 },
      );
      conferirSemRede();
    },
  );
});

// ---------------------------------------------------------------------------------------------------
// Entrar: a tela aberta (sem saber da hierarquia) não cita a rede
// ---------------------------------------------------------------------------------------------------

describe("Entrar", () => {
  it("o texto da tela não cita a rede", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respostaJson(
          { erro: { codigo: "nao_autenticado", mensagem: "Sem sessão" } },
          401,
        ),
      ),
    );
    renderizarRota("/entrar", { usuario: null });
    await screen.findByRole("heading", { level: 1, name: "Entrar" });
    await screen.findByText(/link pessoal/);
    expect(citamARede(textosDaTela())).toEqual([]);
  });
});
