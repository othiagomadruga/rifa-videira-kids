import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lerCss } from "../../test/indisponivel";
import { renderizarRota } from "../../test/renderizar";
import {
  criarApiFalsa,
  criarCelula,
  hierarquiaExemplo,
  hierarquiaVazia,
  respostaErro,
  type ApiFalsa,
} from "./teste-apoio";

const CAMINHO = "/coordenacao/hierarquia";

async function abrirTela(api: ApiFalsa = criarApiFalsa()) {
  vi.stubGlobal("fetch", api.fetch);
  const tela = renderizarRota(CAMINHO);
  await screen.findByRole("region", { name: "Resumo" });
  return { api, ...tela };
}

function tabela(nome: string) {
  return screen.getByRole("table", { name: nome });
}

/** Texto de cada célula das linhas de dados (sem o cabeçalho); botões viram "Editar X | Excluir X". */
function linhasDe(nome: string): string[][] {
  return within(tabela(nome))
    .getAllByRole("row")
    .slice(1)
    .map((linha) =>
      within(linha)
        .getAllByRole("cell")
        .map((celula) => {
          const botoes = within(celula).queryAllByRole("button");
          return botoes.length > 0
            ? botoes.map((botao) => botao.textContent).join(" | ")
            : (celula.textContent ?? "");
        }),
    );
}

/** Foca e clica, como o teclado (Enter) e o clique fazem no navegador. */
function acionar(elemento: HTMLElement) {
  act(() => elemento.focus());
  fireEvent.click(elemento);
}

/** Primeira coluna (o nome) de cada linha. */
function nomesDe(nome: string): string[] {
  return linhasDe(nome).map((linha) => linha[0]);
}

/** O valor do indicador (Stat) com este rótulo. Com o ícone (RIFA-051), o rótulo fica ao lado do chip, no topo do Stat. */
function indicador(rotulo: string): string | null | undefined {
  const resumo = screen.getByRole("region", { name: "Resumo" });
  return within(resumo)
    .getByText(rotulo)
    .closest(".ui-stat")
    ?.querySelector(".ui-stat__valor")?.textContent;
}

function escolherOpcao(rotulo: string, valor: string) {
  fireEvent.change(screen.getByLabelText(rotulo), { target: { value: valor } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CA1: visão da hierarquia", () => {
  it("mostra o título, o resumo e a tabela de células com todas as colunas", async () => {
    const { api } = await abrirTela();

    expect(
      screen.getByRole("heading", { level: 1, name: "Hierarquia" }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Hierarquia · Projeto Videira Kids");
    expect(api.chamadasA("GET", "/api/admin/redes")).toHaveLength(1);
    expect(api.chamadasA("GET", "/api/admin/discipuladores")).toHaveLength(1);
    expect(api.chamadasA("GET", "/api/admin/celulas")).toHaveLength(1);

    expect(indicador("Redes")).toBe("2");
    expect(indicador("Discipuladores")).toBe("3");
    expect(indicador("Células")).toBe("4");
    expect(indicador("Total de pessoas")).toBe("54");
    // RIFA-051 (P3.5): a cara única dos números, com o chip do ícone no roxo da marca (só visual).
    const chips = [
      ...screen
        .getByRole("region", { name: "Resumo" })
        .querySelectorAll(".ui-stat"),
    ].map((stat) => {
      const chip = stat.querySelector(".ui-stat__icone");
      expect(chip).toHaveAttribute("aria-hidden", "true");
      expect(chip).toHaveClass("ui-stat__icone--marca");
      return chip?.querySelector("svg")?.getAttribute("data-icone");
    });
    // RIFA-053: cada número com o próprio ícone (antes, "pessoas" duas vezes).
    expect(chips).toEqual(["hierarquia", "adesao", "celula", "pessoas"]);
    expect(new Set(chips).size).toBe(chips.length);

    expect(
      within(tabela("Células"))
        .getAllByRole("columnheader")
        .map((cabecalho) => cabecalho.textContent),
    ).toEqual([
      "Célula",
      "Discipulador",
      "Rede",
      "Divisão",
      "Grupo",
      "Pessoas",
      "Líder",
      "Contato",
      "Ações",
    ]);
    // Ordem da hierarquia: rede, discipulador e célula.
    expect(linhasDe("Células")).toEqual([
      [
        "Célula Ágape",
        "Carla Discipuladora",
        "Rede Adulta Sul",
        "Adultos",
        "Sem grupo",
        "15",
        "Nina Líder",
        "nina@example.com",
        "Editar Célula Ágape | Excluir Célula Ágape",
      ],
      [
        "Célula Vida",
        "Carla Discipuladora",
        "Rede Adulta Sul",
        "Adultos",
        "Sem grupo",
        "18",
        "Otávio Líder",
        "(91) 90000-0004",
        "Editar Célula Vida | Excluir Célula Vida",
      ],
      [
        "Célula Esperança",
        "Ana Discipuladora",
        "Rede Jovem Norte",
        "Jovens",
        "Sem grupo",
        "12",
        "Lucas Líder",
        "lucas@example.com(91) 90000-0001",
        "Editar Célula Esperança | Excluir Célula Esperança",
      ],
      [
        "Célula Fé",
        "Bruno Discipulador",
        "Rede Jovem Norte",
        "Jovens",
        "Sem grupo",
        "9",
        "Marta Líder",
        "Não informado",
        "Editar Célula Fé | Excluir Célula Fé",
      ],
    ]);
    expect(
      screen.getByRole("link", { name: "lucas@example.com" }),
    ).toHaveAttribute("href", "mailto:lucas@example.com");
    expect(
      screen.getByRole("link", { name: "(91) 90000-0001" }),
    ).toHaveAttribute("href", "tel:91900000001");
    expect(screen.getByText("4 células (54 pessoas)")).toHaveAttribute(
      "role",
      "status",
    );
    // RIFA-051 (P3.8, A-15): "Excluir" é ação destrutiva: o vermelho do perigo discreto, não o roxo de um link;
    // "Editar" continua secundário. Os nomes não mudam.
    for (const botao of screen.getAllByRole("button", { name: /^Excluir / }))
      expect(botao).toHaveClass("ui-button--perigo-discreto");
    for (const botao of screen.getAllByRole("button", { name: /^Editar / }))
      expect(botao).toHaveClass("ui-button--secundario");
  });

  it("e-mail e telefone do líder são links (tel: só com dígitos e o + inicial); telefone que não é um número só fica como texto", async () => {
    const api = criarApiFalsa();
    const [, fe, agape, vida] = api.dados.celulas;
    fe.lider_telefone = "+55 (91) 98888-7777";
    agape.lider_telefone = "(91) 98888-7777 / (91) 3222-1111";
    vida.lider_telefone = "(91) 3222-1111 ramal 2";
    await abrirTela(api);

    expect(
      screen.getByRole("link", { name: "nina@example.com" }),
    ).toHaveAttribute("href", "mailto:nina@example.com");
    expect(
      screen.getByRole("link", { name: "+55 (91) 98888-7777" }),
    ).toHaveAttribute("href", "tel:+5591988887777");
    // Dois números no mesmo campo ou um ramal discariam outro número: ficam como texto.
    for (const telefone of [
      "(91) 98888-7777 / (91) 3222-1111",
      "(91) 3222-1111 ramal 2",
    ]) {
      expect(screen.getByText(telefone).closest("a")).toBeNull();
    }
    const discagens = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"))
      .filter((href) => href?.startsWith("tel:"));
    expect(discagens).toEqual(["tel:91900000001", "tel:+5591988887777"]);
  });

  it("filtra por divisão e por rede (a lista de redes acompanha a divisão)", async () => {
    await abrirTela();

    escolherOpcao("Divisão", "adultos");
    expect(nomesDe("Células")).toEqual(["Célula Ágape", "Célula Vida"]);
    expect(
      screen.getByText("Mostrando 2 de 4 células (33 pessoas)"),
    ).toBeInTheDocument();
    const redes = screen.getByLabelText("Rede");
    expect(
      within(redes)
        .getAllByRole("option")
        .map((opcao) => opcao.textContent),
    ).toEqual(["Todas as redes", "Rede Adulta Sul"]);

    escolherOpcao("Divisão", "");
    escolherOpcao("Rede", "1");
    expect(nomesDe("Células")).toEqual(["Célula Esperança", "Célula Fé"]);
    expect(
      screen.getByText("Mostrando 2 de 4 células (21 pessoas)"),
    ).toBeInTheDocument();

    // Rede de outra divisão sai do filtro.
    escolherOpcao("Divisão", "adultos");
    expect(screen.getByLabelText("Rede")).toHaveValue("");
    expect(nomesDe("Células")).toEqual(["Célula Ágape", "Célula Vida"]);
  });

  it("busca por nome sem acento nem maiúsculas (célula, líder ou discipulador)", async () => {
    await abrirTela();
    const busca = screen.getByRole("searchbox", { name: "Buscar por nome" });

    fireEvent.change(busca, { target: { value: "  AGAPE " } });
    expect(nomesDe("Células")).toEqual(["Célula Ágape"]);

    fireEvent.change(busca, { target: { value: "marta" } });
    expect(nomesDe("Células")).toEqual(["Célula Fé"]);

    fireEvent.change(busca, { target: { value: "carla" } });
    expect(nomesDe("Células")).toEqual(["Célula Ágape", "Célula Vida"]);
    expect(
      screen.getByText("Mostrando 2 de 4 células (33 pessoas)"),
    ).toBeInTheDocument();

    fireEvent.change(busca, { target: { value: "nenhuma assim" } });
    expect(screen.queryByRole("table", { name: "Células" })).toBeNull();
    expect(
      screen.getByText("Nenhuma célula encontrada com esses filtros."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(busca).toHaveValue("");
    expect(nomesDe("Células")).toHaveLength(4);
  });

  it("sem células, mostra o estado vazio que leva à importação", async () => {
    await abrirTela(criarApiFalsa(hierarquiaVazia()));

    expect(
      screen.getByText("Nenhuma célula ainda: importe a planilha"),
    ).toBeInTheDocument();
    expect(indicador("Células")).toBe("0");
    expect(indicador("Total de pessoas")).toBe("0");

    fireEvent.click(screen.getByRole("button", { name: "Importar planilha" }));

    const aba = screen.getByRole("tab", { name: "Importar planilha" });
    expect(aba).toHaveAttribute("aria-selected", "true");
    expect(aba).toHaveFocus();
    expect(
      within(screen.getByRole("tabpanel")).getByRole("heading", {
        name: "Importar a planilha das células",
      }),
    ).toBeInTheDocument();
  });

  it("tem abas de discipuladores e de redes, com as contagens", async () => {
    await abrirTela();
    expect(
      screen.getByRole("tablist", { name: "Partes da hierarquia" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Discipuladores" }));
    expect(screen.getByRole("tab", { name: "Discipuladores" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(linhasDe("Discipuladores")).toEqual([
      [
        "Carla Discipuladora",
        "Rede Adulta Sul",
        "Adultos",
        "Sem grupo",
        "2",
        "33",
        "Editar Carla Discipuladora | Excluir Carla Discipuladora",
      ],
      [
        "Ana Discipuladora",
        "Rede Jovem Norte",
        "Jovens",
        "Sem grupo",
        "1",
        "12",
        "Editar Ana Discipuladora | Excluir Ana Discipuladora",
      ],
      [
        "Bruno Discipulador",
        "Rede Jovem Norte",
        "Jovens",
        "Sem grupo",
        "1",
        "9",
        "Editar Bruno Discipulador | Excluir Bruno Discipulador",
      ],
    ]);

    fireEvent.click(screen.getByRole("tab", { name: "Redes" }));
    expect(
      within(tabela("Redes"))
        .getAllByRole("columnheader")
        .map((cabecalho) => cabecalho.textContent),
    ).toEqual([
      "Rede",
      "Divisão",
      "Responsável",
      "Discipuladores",
      "Células",
      "Pessoas",
      "Ações",
    ]);
    expect(linhasDe("Redes")).toEqual([
      [
        "Rede Adulta Sul",
        "Adultos",
        "Não informado",
        "1",
        "2",
        "33",
        "Editar Rede Adulta Sul | Excluir Rede Adulta Sul",
      ],
      [
        "Rede Jovem Norte",
        "Jovens",
        "Pastor Fictício",
        "2",
        "2",
        "21",
        "Editar Rede Jovem Norte | Excluir Rede Jovem Norte",
      ],
    ]);
  });

  it("mostra o erro da API ao carregar e tenta de novo", async () => {
    const api = criarApiFalsa();
    api.proxima(
      "GET",
      "/api/admin/celulas",
      respostaErro(503, "banco_indisponivel", "O banco não respondeu."),
    );
    vi.stubGlobal("fetch", api.fetch);
    renderizarRota(CAMINHO);

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Não foi possível carregar a hierarquia.");
    expect(alerta).toHaveTextContent("O banco não respondeu.");

    fireEvent.click(
      within(alerta).getByRole("button", { name: "Tentar de novo" }),
    );

    expect(
      await screen.findByRole("table", { name: "Células" }),
    ).toBeInTheDocument();
    expect(api.chamadasA("GET", "/api/admin/celulas")).toHaveLength(2);
  });
});

describe("CA2: editar e excluir", () => {
  async function abrirEdicaoDaCelula(nome: string) {
    const botao = screen.getByRole("button", { name: `Editar ${nome}` });
    acionar(botao);
    const dialogo = screen.getByRole("dialog", { name: "Editar célula" });
    return { botao, dialogo };
  }

  it("edita a célula num diálogo acessível e salva o registro inteiro (PUT)", async () => {
    const { api } = await abrirTela();
    const { botao, dialogo } = await abrirEdicaoDaCelula("Célula Esperança");

    expect(dialogo).toHaveAttribute("aria-modal", "true");
    expect(dialogo).toHaveAccessibleDescription("Célula Esperança");
    const campos = within(dialogo);
    expect(campos.getByLabelText("Nome da célula")).toHaveFocus();
    expect(campos.getByLabelText("Nome da célula")).toHaveValue(
      "Célula Esperança",
    );
    expect(campos.getByLabelText("Discipulador")).toHaveValue("11");
    expect(campos.getByLabelText("Nº de pessoas")).toHaveValue("12");
    expect(campos.getByLabelText("Nome do líder")).toHaveValue("Lucas Líder");
    expect(campos.getByLabelText("E-mail (opcional)")).toHaveValue(
      "lucas@example.com",
    );
    expect(campos.getByLabelText("Telefone (opcional)")).toHaveValue(
      "(91) 90000-0001",
    );
    // O resto da página fica fora de alcance enquanto o diálogo está aberto.
    expect(screen.getByRole("main").closest("[inert]")).not.toBeNull();

    fireEvent.change(campos.getByLabelText("Nº de pessoas"), {
      target: { value: "14" },
    });
    fireEvent.change(campos.getByLabelText("Discipulador"), {
      target: { value: "12" },
    });
    fireEvent.change(campos.getByLabelText("E-mail (opcional)"), {
      target: { value: "  " },
    });
    fireEvent.click(campos.getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(api.chamadasA("PUT", "/api/admin/celulas/101")).toEqual([
      {
        metodo: "PUT",
        caminho: "/api/admin/celulas/101",
        corpo: {
          discipulador_id: 12,
          nome: "Célula Esperança",
          qtd_pessoas: 14,
          lider_nome: "Lucas Líder",
          lider_email: null,
          lider_telefone: "(91) 90000-0001",
          // RIFA-085: o seletor "Grupo" ficou em "Igual ao do discipulador".
          grupo_id: null,
        },
      },
    ]);
    // Foco e `inert` voltam na limpeza do efeito do diálogo (primeiro o `inert`, depois o foco), que
    // pode rodar numa tarefa depois de o diálogo sair do DOM: esperar o foco evita teste instável.
    await waitFor(() => expect(botao).toHaveFocus());
    expect(screen.getByRole("main").closest("[inert]")).toBeNull();
    expect(
      screen.getByText("Célula “Célula Esperança” salva.", {
        selector: "[role=status]",
      }),
    ).toBeInTheDocument();
    // As tabelas são lidas de novo.
    await waitFor(() => expect(indicador("Total de pessoas")).toBe("56"));
    const linha = linhasDe("Células").find((l) => l[0] === "Célula Esperança");
    expect(linha?.slice(1, 6)).toEqual([
      "Bruno Discipulador",
      "Rede Jovem Norte",
      "Jovens",
      "Sem grupo",
      "14",
    ]);
  });

  it("o diálogo prende o foco (Tab e Shift+Tab dão a volta) e Esc fecha devolvendo o foco", async () => {
    const { api } = await abrirTela();
    const { botao, dialogo } = await abrirEdicaoDaCelula("Célula Fé");
    const fechar = within(dialogo).getByRole("button", { name: "Fechar" });
    const salvar = within(dialogo).getByRole("button", { name: "Salvar" });

    act(() => fechar.focus());
    fireEvent.keyDown(fechar, { key: "Tab", shiftKey: true });
    expect(salvar).toHaveFocus();

    fireEvent.keyDown(salvar, { key: "Tab" });
    expect(fechar).toHaveFocus();

    // RIFA-045: o Tab abriu a dica do ×; o 1º Esc só fecha a dica (a camada de cima) e o 2º fecha o diálogo.
    fireEvent.keyDown(fechar, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(fechar).toHaveFocus();
    fireEvent.keyDown(fechar, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(botao).toHaveFocus();
    expect(api.chamadasA("PUT", "/api/admin/celulas/102")).toHaveLength(0);
  });

  it("confere os campos antes de enviar e leva o foco ao primeiro erro", async () => {
    const { api } = await abrirTela();
    const { dialogo } = await abrirEdicaoDaCelula("Célula Fé");
    const campos = within(dialogo);

    fireEvent.change(campos.getByLabelText("Nome da célula"), {
      target: { value: "   " },
    });
    fireEvent.change(campos.getByLabelText("Nº de pessoas"), {
      target: { value: "12,5" },
    });
    fireEvent.change(campos.getByLabelText("E-mail (opcional)"), {
      target: { value: "marta@" },
    });
    fireEvent.click(campos.getByRole("button", { name: "Salvar" }));

    const nome = campos.getByLabelText("Nome da célula");
    expect(nome).toHaveFocus();
    expect(nome).toHaveAttribute("aria-invalid", "true");
    expect(nome).toHaveAccessibleDescription("Informe o nome da célula.");
    expect(campos.getByLabelText("Nº de pessoas")).toHaveAccessibleDescription(
      /Use um número inteiro de 1 a 1000\./,
    );
    expect(
      campos.getByLabelText("E-mail (opcional)"),
    ).toHaveAccessibleDescription(
      "E-mail inválido. Confira ou deixe em branco.",
    );
    expect(api.chamadasA("PUT", "/api/admin/celulas/102")).toHaveLength(0);
  });

  it("409 nome_duplicado explica o nome repetido e marca o campo", async () => {
    const api = criarApiFalsa();
    api.proxima(
      "PUT",
      "/api/admin/celulas/101",
      respostaErro(409, "nome_duplicado", "Já existe uma célula com esse nome"),
    );
    await abrirTela(api);
    const { dialogo } = await abrirEdicaoDaCelula("Célula Esperança");
    const campos = within(dialogo);

    fireEvent.change(campos.getByLabelText("Nome da célula"), {
      target: { value: "célula fé " },
    });
    // Como no navegador, o toque leva o foco ao Salvar: o campo só volta a ter o foco se a tela o levar.
    const salvar = campos.getByRole("button", { name: "Salvar" });
    act(() => salvar.focus());
    fireEvent.click(salvar);

    const alerta = await campos.findByRole("alert");
    expect(alerta).toHaveTextContent("Não foi possível salvar");
    expect(alerta).toHaveTextContent(
      "Já existe uma célula com o nome “célula fé”. Os nomes não podem se repetir",
    );
    const nome = campos.getByLabelText("Nome da célula");
    expect(nome).toHaveAttribute("aria-invalid", "true");
    expect(nome).toHaveAccessibleDescription(
      "Já existe uma célula com esse nome.",
    );
    await waitFor(() => expect(nome).toHaveFocus());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("409 em_uso ao salvar (outra gravação ao mesmo tempo) mostra a mensagem da API e recarrega as listas sozinha", async () => {
    const mensagem =
      "A célula mudou enquanto isso (outra alteração ao mesmo tempo) e nada foi gravado: a lista foi atualizada; confira e tente de novo.";
    const api = criarApiFalsa();
    // Outra pessoa renomeou a célula Fé enquanto esta edição estava aberta.
    api.proxima("PUT", "/api/admin/celulas/101", () => {
      const fe = api.dados.celulas.find((celula) => celula.id === 102);
      if (fe) fe.nome = "Célula Fé e Graça";
      return respostaErro(409, "em_uso", mensagem);
    });
    await abrirTela(api);
    const { dialogo } = await abrirEdicaoDaCelula("Célula Esperança");
    const campos = within(dialogo);

    fireEvent.click(campos.getByRole("button", { name: "Salvar" }));

    const alerta = await campos.findByRole("alert");
    expect(alerta).toHaveTextContent("Não foi possível salvar");
    expect(alerta).toHaveTextContent(mensagem);
    expect(api.chamadasA("PUT", "/api/admin/celulas/101")).toHaveLength(1);
    expect(campos.getByLabelText("Nome da célula")).not.toHaveAttribute(
      "aria-invalid",
    );
    await waitFor(() =>
      expect(nomesDe("Células")).toContain("Célula Fé e Graça"),
    );
    expect(api.chamadasA("GET", "/api/admin/celulas")).toHaveLength(2);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("400 da API mostra o campo recusado", async () => {
    const api = criarApiFalsa();
    api.proxima(
      "PUT",
      "/api/admin/celulas/101",
      respostaErro(400, "requisicao_invalida", "Dados inválidos", [
        {
          caminho: ["lider_email"],
          codigo: "invalid_format",
          mensagem: "Invalid email address",
        },
      ]),
    );
    await abrirTela(api);
    const { dialogo } = await abrirEdicaoDaCelula("Célula Esperança");
    const campos = within(dialogo);

    fireEvent.click(campos.getByRole("button", { name: "Salvar" }));

    expect(await campos.findByRole("alert")).toHaveTextContent(
      "A API recusou o campo: E-mail do líder. Confira e salve de novo.",
    );
    const email = campos.getByLabelText("E-mail (opcional)");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription(
      "Confira o e-mail (ou deixe em branco).",
    );
    await waitFor(() => expect(email).toHaveFocus());
  });

  it("exclui a célula depois de confirmar", async () => {
    const { api } = await abrirTela();

    acionar(screen.getByRole("button", { name: "Excluir Célula Fé" }));
    const confirmacao = screen.getByRole("alertdialog", {
      name: "Excluir a célula “Célula Fé”?",
    });
    expect(confirmacao).toHaveAccessibleDescription(
      "Isso não pode ser desfeito.",
    );
    expect(
      within(confirmacao).getByRole("button", { name: "Cancelar" }),
    ).toHaveFocus();

    fireEvent.click(
      within(confirmacao).getByRole("button", { name: "Excluir" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(api.chamadasA("DELETE", "/api/admin/celulas/102")).toHaveLength(1);
    // Como na edição: o foco chega na limpeza do efeito do diálogo.
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Células" })).toHaveFocus(),
    );
    expect(
      screen.getByText("Célula “Célula Fé” excluída.", {
        selector: "[role=status]",
      }),
    ).toBeInTheDocument();
    await waitFor(() => expect(nomesDe("Células")).not.toContain("Célula Fé"));
    expect(indicador("Células")).toBe("3");
  });

  it("cancelar a exclusão não chama a API e devolve o foco ao botão", async () => {
    const { api } = await abrirTela();
    const botao = screen.getByRole("button", { name: "Excluir Célula Fé" });

    acionar(botao);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(botao).toHaveFocus();
    expect(api.chamadasA("DELETE", "/api/admin/celulas/102")).toHaveLength(0);
  });

  /** Abre a aba, pede para excluir `nome` e confirma, com a API respondendo 409 `em_uso` com `mensagem`. */
  async function excluirComEmUso(
    aba: "Células" | "Discipuladores" | "Redes",
    nome: string,
    caminho: string,
    mensagem: string,
  ) {
    const api = criarApiFalsa();
    api.proxima("DELETE", caminho, respostaErro(409, "em_uso", mensagem));
    await abrirTela(api);
    if (aba !== "Células") {
      fireEvent.click(screen.getByRole("tab", { name: aba }));
    }
    fireEvent.click(screen.getByRole("button", { name: `Excluir ${nome}` }));
    const confirmacao = screen.getByRole("alertdialog");
    fireEvent.click(
      within(confirmacao).getByRole("button", { name: "Excluir" }),
    );
    const alerta = await within(confirmacao).findByRole("alert");
    return { api, alerta };
  }

  it("409 em_uso ao excluir a célula mostra o motivo que veio da API e mantém a célula", async () => {
    const mensagem =
      "A célula tem afiliados vinculados (1). Passe os afiliados para outra célula (Adesão → Todas as células → Trocar), que leva as vendas junto, antes de excluir esta.";
    const { api, alerta } = await excluirComEmUso(
      "Células",
      "Célula Ágape",
      "/api/admin/celulas/103",
      mensagem,
    );

    expect(alerta).toHaveTextContent("Não foi possível excluir");
    expect(alerta).toHaveTextContent(mensagem);
    expect(alerta).not.toHaveTextContent("Não dá para excluir");
    expect(api.chamadasA("DELETE", "/api/admin/celulas/103")).toHaveLength(1);
    expect(
      screen.getByRole("alertdialog", {
        name: "Excluir a célula “Célula Ágape”?",
      }),
    ).toBeInTheDocument();
    expect(nomesDe("Células")).toContain("Célula Ágape");
  });

  // Desde a RIFA-018 o 409 `em_uso` do DELETE também vem da trilha de auditoria e de corrida (outra gravação ao
  // mesmo tempo): o texto fixo diria "tem afiliado vinculado" ou "tem discipuladores", o que não é verdade.
  it.each([
    {
      caso: "a rede ainda tem discipuladores",
      aba: "Redes",
      nome: "Rede Adulta Sul",
      caminho: "/api/admin/redes/2",
      mensagem:
        "A rede tem discipuladores (1). Exclua os discipuladores ou mova-os para outra rede antes de excluir a rede.",
      recarrega: false,
    },
    {
      caso: "a trilha de auditoria segura o acesso do discipulador",
      aba: "Discipuladores",
      nome: "Carla Discipuladora",
      caminho: "/api/admin/discipuladores/13",
      mensagem:
        "O discipulador não pode ser excluído: o acesso dele aparece como autor na trilha de auditoria, que guarda quem fez cada ação.",
      recarrega: false,
    },
    {
      caso: "a célula mudou enquanto isso",
      aba: "Células",
      nome: "Célula Fé",
      caminho: "/api/admin/celulas/102",
      mensagem:
        "A célula mudou enquanto isso (outra alteração ao mesmo tempo) e nada foi gravado: a lista foi atualizada; confira e tente de novo.",
      recarrega: true,
    },
    {
      caso: "uma referência mudou enquanto isso",
      aba: "Redes",
      nome: "Rede Jovem Norte",
      caminho: "/api/admin/redes/1",
      mensagem:
        "A exclusão foi recusada por uma referência que mudou enquanto isso: a lista foi atualizada; confira e tente de novo.",
      recarrega: true,
    },
  ] as const)(
    "409 em_uso ao excluir mostra a mensagem da API, e não o texto fixo; só o de outra gravação ao mesmo tempo recarrega as listas: $caso",
    async ({ aba, nome, caminho, mensagem, recarrega }) => {
      const { api, alerta } = await excluirComEmUso(
        aba,
        nome,
        caminho,
        mensagem,
      );

      expect(alerta).toHaveTextContent(mensagem);
      expect(alerta).not.toHaveTextContent("Não dá para excluir");
      // Deixa rodar os efeitos da resposta (a recarga sai de um efeito) antes de contar as leituras.
      await act(async () => {});
      await waitFor(() =>
        expect(api.chamadasA("GET", "/api/admin/redes")).toHaveLength(
          recarrega ? 2 : 1,
        ),
      );
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    },
  );

  it.each([
    {
      aba: "Células",
      nome: "Célula Ágape",
      caminho: "/api/admin/celulas/103",
      mensagem: "",
      reserva:
        "Não dá para excluir: a célula tem afiliado da Rifei vinculado. Passe o afiliado para outra célula (Adesão → Todas as células → Trocar), que leva as vendas junto, antes de excluir esta.",
    },
    {
      aba: "Discipuladores",
      nome: "Carla Discipuladora",
      caminho: "/api/admin/discipuladores/13",
      mensagem: "   ",
      reserva:
        "Não dá para excluir: o discipulador ainda tem células. Mova as células para outro discipulador (botão Editar, na aba Células) ou exclua-as antes.",
    },
    {
      aba: "Redes",
      nome: "Rede Adulta Sul",
      caminho: "/api/admin/redes/2",
      mensagem: "",
      reserva:
        "Não dá para excluir: a rede ainda tem discipuladores. Mova os discipuladores para outra rede (botão Editar, na aba Discipuladores) ou exclua-os antes.",
    },
  ] as const)(
    "409 em_uso sem mensagem da API usa o texto fixo ($aba)",
    async ({ aba, nome, caminho, mensagem, reserva }) => {
      const { alerta } = await excluirComEmUso(aba, nome, caminho, mensagem);

      expect(alerta).toHaveTextContent(reserva);
    },
  );

  it("edita a rede (divisão e responsável) e o discipulador (rede)", async () => {
    const { api } = await abrirTela();

    fireEvent.click(screen.getByRole("tab", { name: "Redes" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Editar Rede Jovem Norte" }),
    );
    const dialogoRede = within(
      screen.getByRole("dialog", { name: "Editar rede" }),
    );
    expect(dialogoRede.getByLabelText("Divisão")).toHaveValue("jovens");
    fireEvent.change(dialogoRede.getByLabelText("Divisão"), {
      target: { value: "adultos" },
    });
    fireEvent.change(dialogoRede.getByLabelText("Responsável (opcional)"), {
      target: { value: "" },
    });
    fireEvent.click(dialogoRede.getByRole("button", { name: "Salvar" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(api.chamadasA("PUT", "/api/admin/redes/1")[0]?.corpo).toEqual({
      nome: "Rede Jovem Norte",
      divisao: "adultos",
      responsavel_nome: null,
    });

    fireEvent.click(screen.getByRole("tab", { name: "Discipuladores" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Editar Bruno Discipulador" }),
    );
    const dialogoDiscipulador = within(
      screen.getByRole("dialog", { name: "Editar discipulador" }),
    );
    fireEvent.change(dialogoDiscipulador.getByLabelText("Rede"), {
      target: { value: "2" },
    });
    fireEvent.click(
      dialogoDiscipulador.getByRole("button", { name: "Salvar" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      api.chamadasA("PUT", "/api/admin/discipuladores/12")[0]?.corpo,
    ).toEqual({ rede_id: 2, nome: "Bruno Discipulador", grupo_id: null });
    await waitFor(() =>
      expect(
        linhasDe("Discipuladores").find(
          (l) => l[0] === "Bruno Discipulador",
        )?.[1],
      ).toBe("Rede Adulta Sul"),
    );
  });
});

describe("RIFA-084 (D39): o grupo do discipulador", () => {
  it("a lista dos grupos vem com a hierarquia; a coluna Grupo mostra o grupo ou “Sem grupo”", async () => {
    const dados = hierarquiaExemplo();
    dados.discipuladores[2] = {
      ...dados.discipuladores[2],
      grupo_id: 1,
      grupo_nome: "Adultos da manhã",
    };
    const { api } = await abrirTela(criarApiFalsa(dados));
    expect(api.chamadasA("GET", "/api/admin/grupos")).toHaveLength(1);

    fireEvent.click(screen.getByRole("tab", { name: "Discipuladores" }));
    expect(
      within(tabela("Discipuladores"))
        .getAllByRole("columnheader")
        .map((cabecalho) => cabecalho.textContent),
    ).toContain("Grupo");
    expect(
      linhasDe("Discipuladores").map((linha) => [linha[0], linha[3]]),
    ).toEqual([
      ["Carla Discipuladora", "Adultos da manhã"],
      ["Ana Discipuladora", "Sem grupo"],
      ["Bruno Discipulador", "Sem grupo"],
    ]);
  });

  it("Editar: o seletor Grupo, com “Sem grupo” e os 4 grupos na ordem; salvar manda o grupo escolhido ou null", async () => {
    const { api } = await abrirTela();
    fireEvent.click(screen.getByRole("tab", { name: "Discipuladores" }));

    fireEvent.click(
      screen.getByRole("button", { name: "Editar Ana Discipuladora" }),
    );
    let dialogo = within(
      screen.getByRole("dialog", { name: "Editar discipulador" }),
    );
    const grupo = dialogo.getByLabelText("Grupo");
    expect(grupo).toHaveValue("");
    expect(
      within(grupo)
        .getAllByRole("option")
        .map((opcao) => opcao.textContent),
    ).toEqual([
      "Sem grupo",
      "Adultos da manhã",
      "Adultos da noite",
      "Jovens",
      "Adolescentes",
    ]);
    fireEvent.change(grupo, { target: { value: "2" } });
    fireEvent.click(dialogo.getByRole("button", { name: "Salvar" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(api.chamadasA("PUT", "/api/admin/discipuladores/11")).toEqual([
      expect.objectContaining({
        corpo: { rede_id: 1, nome: "Ana Discipuladora", grupo_id: 2 },
      }),
    ]);
    await waitFor(() =>
      expect(
        linhasDe("Discipuladores").find(
          (linha) => linha[0] === "Ana Discipuladora",
        )?.[3],
      ).toBe("Adultos da noite"),
    );

    // Abrir de novo: o seletor vem no grupo gravado; "Sem grupo" manda null.
    fireEvent.click(
      screen.getByRole("button", { name: "Editar Ana Discipuladora" }),
    );
    dialogo = within(
      screen.getByRole("dialog", { name: "Editar discipulador" }),
    );
    expect(dialogo.getByLabelText("Grupo")).toHaveValue("2");
    fireEvent.change(dialogo.getByLabelText("Grupo"), {
      target: { value: "" },
    });
    fireEvent.click(dialogo.getByRole("button", { name: "Salvar" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      api.chamadasA("PUT", "/api/admin/discipuladores/11")[1]?.corpo,
    ).toEqual({ rede_id: 1, nome: "Ana Discipuladora", grupo_id: null });
  });
});

describe("RIFA-085 (D39, adendo): o grupo próprio da célula", () => {
  /** A Carla (das células Ágape e Vida) no grupo "Adultos da noite"; a Vida com o grupo próprio "Adolescentes". */
  function hierarquiaComGrupos() {
    const dados = hierarquiaExemplo();
    const carla = {
      ...dados.discipuladores[2],
      grupo_id: 2,
      grupo_nome: "Adultos da noite",
    };
    dados.discipuladores[2] = carla;
    dados.celulas[2] = criarCelula(103, "Célula Ágape", carla, {
      qtd_pessoas: 15,
      lider_nome: "Nina Líder",
      lider_email: "nina@example.com",
    });
    dados.celulas[3] = criarCelula(104, "Célula Vida", carla, {
      qtd_pessoas: 18,
      lider_nome: "Otávio Líder",
      lider_telefone: "(91) 90000-0004",
      grupo_id: 4,
      grupo_nome: "Adolescentes",
    });
    return dados;
  }

  /** O nome da célula e a coluna Grupo (a 5ª). */
  const grupos = () => linhasDe("Células").map((linha) => [linha[0], linha[4]]);

  it("a coluna Grupo mostra o grupo que vale: o do discipulador, o próprio com a marca “(da célula)” ou “Sem grupo”", async () => {
    await abrirTela(criarApiFalsa(hierarquiaComGrupos()));
    expect(grupos()).toEqual([
      ["Célula Ágape", "Adultos da noite"],
      ["Célula Vida", "Adolescentes (da célula)"],
      ["Célula Esperança", "Sem grupo"],
      ["Célula Fé", "Sem grupo"],
    ]);
    // A marca é discreta (o texto suave e menor), só na célula de grupo próprio.
    const marcas = within(tabela("Células")).getAllByText("(da célula)");
    expect(marcas).toHaveLength(1);
    expect(marcas[0]).toHaveClass("hierarquia-suave");
    expect(marcas[0].closest(".hierarquia-grupo-proprio")).toHaveTextContent(
      "Adolescentes (da célula)",
    );
  });

  it("Editar: o seletor Grupo com “Igual ao do discipulador (<grupo>)” e os 4 grupos; o rótulo segue o discipulador escolhido", async () => {
    await abrirTela(criarApiFalsa(hierarquiaComGrupos()));
    acionar(screen.getByRole("button", { name: "Editar Célula Ágape" }));
    const dialogo = within(
      screen.getByRole("dialog", { name: "Editar célula" }),
    );
    const grupo = dialogo.getByLabelText("Grupo");
    expect(grupo).toHaveValue("");
    const opcoes = () =>
      within(grupo)
        .getAllByRole("option")
        .map((opcao) => opcao.textContent);
    expect(opcoes()).toEqual([
      "Igual ao do discipulador (Adultos da noite)",
      "Adultos da manhã",
      "Adultos da noite",
      "Jovens",
      "Adolescentes",
    ]);
    // Trocar o discipulador (a Ana, sem grupo) muda o que a célula herdaria.
    fireEvent.change(dialogo.getByLabelText("Discipulador"), {
      target: { value: "11" },
    });
    expect(opcoes()[0]).toBe("Igual ao do discipulador (sem grupo)");
    expect(grupo).toHaveValue("");
  });

  it("salvar manda o grupo escolhido; “Igual ao do discipulador” manda null; a coluna muda junto", async () => {
    const { api } = await abrirTela(criarApiFalsa(hierarquiaComGrupos()));
    acionar(screen.getByRole("button", { name: "Editar Célula Ágape" }));
    let dialogo = within(screen.getByRole("dialog", { name: "Editar célula" }));
    fireEvent.change(dialogo.getByLabelText("Grupo"), {
      target: { value: "4" },
    });
    fireEvent.click(dialogo.getByRole("button", { name: "Salvar" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(api.chamadasA("PUT", "/api/admin/celulas/103")).toEqual([
      expect.objectContaining({
        corpo: {
          discipulador_id: 13,
          nome: "Célula Ágape",
          qtd_pessoas: 15,
          lider_nome: "Nina Líder",
          lider_email: "nina@example.com",
          lider_telefone: null,
          grupo_id: 4,
        },
      }),
    ]);
    await waitFor(() =>
      expect(grupos()[0]).toEqual(["Célula Ágape", "Adolescentes (da célula)"]),
    );

    // A Vida (com grupo próprio) abre no grupo gravado; “Igual ao do discipulador” manda null e ela volta a herdar.
    acionar(screen.getByRole("button", { name: "Editar Célula Vida" }));
    dialogo = within(screen.getByRole("dialog", { name: "Editar célula" }));
    expect(dialogo.getByLabelText("Grupo")).toHaveValue("4");
    fireEvent.change(dialogo.getByLabelText("Grupo"), {
      target: { value: "" },
    });
    fireEvent.click(dialogo.getByRole("button", { name: "Salvar" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      api.chamadasA("PUT", "/api/admin/celulas/104")[0]?.corpo,
    ).toMatchObject({ grupo_id: null });
    await waitFor(() =>
      expect(grupos()[1]).toEqual(["Célula Vida", "Adultos da noite"]),
    );
  });
});

describe("RIFA-051 (revisão): os números com o chip no cartão estreito", () => {
  // O jsdom não faz layout: o CSS é a prova. Medido no Chromium (revisão da RIFA-051): de 360 a 768 px e a 1024 px,
  // o cartão tem 156 a 182 px e, com o chip ao lado, "Discipuladores" (99 px) quebrava no meio ("Discipulado/res").
  const css = lerCss("pages/hierarquia/hierarquia.css").replace(/\s+/g, " ");

  it("o cartão é um contêiner; abaixo de 9,5rem por dentro, o chip vai para cima do rótulo (nada de quebrar a palavra)", () => {
    const cartao = /\.hierarquia-resumo > \.ui-stat \{([^}]*)\}/.exec(css)?.[1];
    expect(cartao).toMatch(/container-type: inline-size;/);
    // 9,5rem = 152 px: o chip (32), o vão (8) e "Discipuladores" (99) cabem com folga para a fonte do aparelho.
    expect(css).toMatch(
      /@container \(max-width: 9\.5rem\) \{ \.hierarquia-resumo \.ui-stat__topo \{ flex-direction: column; align-items: flex-start; \} \}/,
    );
  });

  it("o valor fica no pé do cartão, alinhado com o dos vizinhos quando um rótulo ocupa duas linhas", () => {
    expect(
      /\.hierarquia-resumo > \.ui-stat \{([^}]*)\}/.exec(css)?.[1],
    ).toMatch(/align-content: space-between;/);
  });
});
