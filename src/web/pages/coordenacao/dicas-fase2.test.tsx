// RIFA-045 fase 2a: as telas da coordenação que faltavam (Visão geral, Hierarquia, Conferência, Bumbo, Rankings,
// Mapa e Trilha) têm dica em todos os botões e campos. Mesma varredura da fase 1 (dicas.test.tsx): passa o mouse em
// cada botão, campo, aba, link com cara de botão, <summary> e link do menu visível (com um diálogo aberto, só nele),
// espera o tempo da dica e confere a dica e que ela some ao tirar o mouse. Cada tela entra nos estados que mostram
// os outros botões (diálogos, confirmações, "Carregar mais", filtros sem resultado, carregando, falhas).
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COLUNAS_CSV_HIERARQUIA,
  respostaAuditoriaSchema,
  type RegistroAuditoria,
} from "../../../shared/contracts";
import { ATRASO_DA_DICA_MS, FOLGA_DA_DICA_MS } from "../../components/ui";
import {
  contarControles,
  controlesSemDica,
  dicaDe,
  passarOMouse,
  tirarOMouse,
} from "../../test/dicas";
import { esperarDisponivel } from "../../test/indisponivel";
import {
  ADMIN_DE_TESTE,
  renderizarRota,
  respostaJson,
} from "../../test/renderizar";
import { simularApi as simularBumbo } from "../bumbo/teste-apoio";
import { DICAS as DICAS_BUMBO } from "../bumbo/textos";
import {
  ANALISE_POR_PEDIDO,
  CSV_EXEMPLO,
  RECUPERACOES,
  criarApiFalsa as criarApiConferencia,
} from "../conferencia/teste-apoio";
import { DICAS as DICAS_CONFERENCIA } from "../conferencia/textos";
import {
  criarApiFalsa as criarApiHierarquia,
  hierarquiaVazia,
  relatorio,
  respostaErro as erroHierarquia,
} from "../hierarquia/teste-apoio";
import { DICAS as DICAS_HIERARQUIA } from "../hierarquia/textos";
import { simularApi as simularMapa } from "../mapa/teste-apoio";
import { DICAS as DICAS_MAPA } from "../mapa/textos";
import { DICAS as DICAS_RANKINGS } from "../rankings/textos";
import {
  item,
  respostaDaConsulta,
  simularApiRanking,
} from "../rankings/teste-apoio";
import { DICAS as DICAS_TRILHA } from "../trilha/textos";
import {
  CENARIOS,
  RESPOSTAS_DE_ERRO,
  simularApi as simularVisaoGeral,
} from "../visao-geral/teste-apoio";
import { DICAS as DICAS_VISAO_GERAL } from "../visao-geral/textos";

/** Confere a página inteira (com os diálogos abertos): nenhum controle sem dica, e a varredura achou controles. */
function conferirDicas(minimo: number) {
  expect(contarControles()).toBeGreaterThanOrEqual(minimo);
  expect(controlesSemDica()).toEqual([]);
}

/** O texto da dica que abre com o mouse parado no controle (e some ao tirar o mouse), como na varredura. */
function textoDaDica(controle: Element): string | null {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    passarOMouse(controle);
    act(() => vi.advanceTimersByTime(ATRASO_DA_DICA_MS));
    const texto = dicaDe(controle)?.textContent ?? null;
    tirarOMouse(controle);
    act(() => vi.advanceTimersByTime(FOLGA_DA_DICA_MS));
    return texto;
  } finally {
    vi.useRealTimers();
  }
}

/** Foca e clica, como o toque e o Enter fazem no navegador (o jsdom não foca no clique). */
function acionar(elemento: HTMLElement) {
  act(() => elemento.focus());
  fireEvent.click(elemento);
}

const botao = (nome: string | RegExp) =>
  screen.getByRole("button", { name: nome });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Visão geral", () => {
  async function abrir(caminho = "/coordenacao") {
    const api = simularVisaoGeral(CENARIOS.emDia);
    renderizarRota(caminho);
    return api;
  }
  const relatorioDaCampanha = () =>
    within(
      screen
        .getByRole("heading", { level: 2, name: "Relatório da campanha" })
        .closest<HTMLElement>(".ui-card") as HTMLElement,
    );

  it("o painel: o filtro, Atualizar, a tabela da curva, os 7 tipos do relatório e 'Baixar relatório'", async () => {
    await abrir();
    await screen.findByText(/^Atualizado às/, undefined, { timeout: 5000 });
    expect(relatorioDaCampanha().getAllByRole("radio")).toHaveLength(7);
    expect(screen.getByText("Ver os dados em tabela")).toBeInTheDocument();
    conferirDicas(20);

    // O rádio tem a dica no fim da descrição (depois da linha do que a planilha traz).
    const porDia = screen.getByRole("radio", { name: "Por dia" });
    expect(textoDaDica(porDia)).toBe(DICAS_VISAO_GERAL.tipoRelatorio.dias);
  });

  it("baixando: 'Baixando…' diz por que está indisponível", async () => {
    const api = await abrir();
    await screen.findByText(/^Atualizado às/, undefined, { timeout: 5000 });
    // O download fica pendente (sair da tela no fim do teste cancela a consulta).
    api.relatorio = () => new Promise<Response>(() => {});
    fireEvent.click(botao("Baixar relatório"));
    const baixando = await screen.findByRole("button", { name: "Baixando…" });
    expect(textoDaDica(baixando)).toBe(DICAS_VISAO_GERAL.baixando);
    conferirDicas(20);
  });

  it("falha ao baixar: 'Tentar de novo' no aviso do relatório", async () => {
    const api = await abrir();
    await screen.findByText(/^Atualizado às/, undefined, { timeout: 5000 });
    api.relatorio = () => RESPOSTAS_DE_ERRO.interno();
    fireEvent.click(botao("Baixar relatório"));
    await relatorioDaCampanha().findByRole("button", {
      name: "Tentar de novo",
    });
    conferirDicas(20);
  });

  it("recorte que não existe: 'Ver a campanha toda'", async () => {
    await abrir("/coordenacao?escopo=celula&id=99");
    await screen.findByRole(
      "button",
      { name: "Ver a campanha toda" },
      { timeout: 5000 },
    );
    conferirDicas(15);
  });
});

describe("Hierarquia", () => {
  const IMPORTAR = "/api/admin/hierarquia/importar";

  async function abrir(api = criarApiHierarquia()) {
    vi.stubGlobal("fetch", api.fetch);
    renderizarRota("/coordenacao/hierarquia");
    await screen.findByRole("region", { name: "Resumo" }, { timeout: 5000 });
    return api;
  }

  it("aba Células: as abas, os filtros, Editar e Excluir de cada linha; a busca sem resultado, com 'Limpar filtros'", async () => {
    await abrir();
    expect(
      screen.getAllByRole("button", { name: /^Excluir/ }).length,
    ).toBeGreaterThan(1);
    conferirDicas(20);

    fireEvent.change(screen.getByLabelText(/^Buscar por nome/), {
      target: { value: "nenhuma célula assim" },
    });
    expect(botao("Limpar filtros")).toBeInTheDocument();
    conferirDicas(15);
  });

  it("abas Discipuladores e Redes: Editar e Excluir de cada linha", async () => {
    await abrir();
    acionar(screen.getByRole("tab", { name: "Discipuladores" }));
    expect(botao(/^Editar Ana Discipuladora/)).toBeInTheDocument();
    expect(textoDaDica(botao(/^Excluir Ana Discipuladora/))).toBe(
      DICAS_HIERARQUIA.excluir.discipulador,
    );
    conferirDicas(15);

    acionar(screen.getByRole("tab", { name: "Redes" }));
    expect(botao(/^Editar Rede Jovem Norte/)).toBeInTheDocument();
    conferirDicas(10);
  });

  it("os diálogos: editar célula, discipulador e rede, e a confirmação de excluir", async () => {
    await abrir();
    acionar(botao(/^Editar Célula Esperança/));
    await screen.findByRole("dialog", { name: "Editar célula" });
    conferirDicas(9);
    fireEvent.click(botao("Cancelar"));

    acionar(screen.getByRole("tab", { name: "Discipuladores" }));
    acionar(botao(/^Editar Ana Discipuladora/));
    await screen.findByRole("dialog", { name: "Editar discipulador" });
    conferirDicas(5);
    fireEvent.click(botao("Cancelar"));

    acionar(screen.getByRole("tab", { name: "Redes" }));
    acionar(botao(/^Editar Rede Adulta Sul/));
    await screen.findByRole("dialog", { name: "Editar rede" });
    conferirDicas(6);
    fireEvent.click(botao("Cancelar"));

    acionar(botao(/^Excluir Rede Adulta Sul/));
    await screen.findByRole("alertdialog", {
      name: "Excluir a rede “Rede Adulta Sul”?",
    });
    conferirDicas(3);
  });

  it("depois de salvar, a recarga que falha: o aviso com 'Tentar de novo' e o aviso do salvo com o ×", async () => {
    const api = criarApiHierarquia();
    await abrir(api);
    acionar(botao(/^Editar Célula Fé/));
    const dialogo = await screen.findByRole("dialog", {
      name: "Editar célula",
    });
    api.proxima(
      "GET",
      "/api/admin/redes",
      erroHierarquia(500, "erro_interno", "Erro interno"),
    );
    fireEvent.click(within(dialogo).getByRole("button", { name: "Salvar" }));
    await screen.findByText("Não foi possível atualizar as tabelas");
    expect(botao("Fechar aviso")).toBeInTheDocument();
    conferirDicas(20);
  });

  it("sem células: 'Importar planilha' leva à importação", async () => {
    await abrir(criarApiHierarquia(hierarquiaVazia()));
    expect(botao("Importar planilha")).toBeInTheDocument();
    conferirDicas(8);
  });

  it("aba Importar planilha: o modelo, as colunas, o arquivo, Conferir e Importar; depois de importar, 'Ver células'", async () => {
    const api = await abrir();
    acionar(screen.getByRole("tab", { name: "Importar planilha" }));
    expect(
      screen.getByRole("link", { name: "Baixar modelo" }),
    ).toBeInTheDocument();
    expect(screen.getByText("O que vai em cada coluna")).toBeInTheDocument();
    const campo = screen.getByLabelText("Planilha em CSV");
    // A dica do botão (um <label> do campo escondido) também vale para o campo, que a varredura confere.
    expect(textoDaDica(campo)).toBe(DICAS_HIERARQUIA.escolherPlanilha);
    conferirDicas(10);

    const contagem = {
      total_linhas: 1,
      criados: { redes: 0, discipuladores: 0, celulas: 1 },
      inalterados: { redes: 1, discipuladores: 1, celulas: 0 },
    };
    api.proxima(
      "POST",
      IMPORTAR,
      respostaJson(relatorio({ ...contagem, simulado: true })),
    );
    api.proxima(
      "POST",
      IMPORTAR,
      respostaJson(relatorio({ ...contagem, simulado: false, aplicado: true })),
    );
    const csv = `${COLUNAS_CSV_HIERARQUIA.join(";")}\r\nRede Jovem Norte;jovens;;Ana Discipuladora;Célula Nova;10;Líder Novo;;\r\n`;
    fireEvent.change(campo, {
      target: {
        files: [new File([csv], "hierarquia.csv", { type: "text/csv" })],
      },
    });
    await waitFor(() => esperarDisponivel(botao("Conferir")));
    fireEvent.click(botao("Conferir"));
    await screen.findByText("Nenhum erro encontrado");
    esperarDisponivel(botao("Importar"));
    conferirDicas(10);

    fireEvent.click(botao("Importar"));
    await screen.findByRole("button", { name: "Ver células" });
    conferirDicas(10);
  });
});

describe("Conferência", () => {
  const ROTULO_ARQUIVO = "Arquivo exportado da Rifei (CSV)";

  async function abrir(api = criarApiConferencia()) {
    vi.stubGlobal("fetch", api.fetch);
    renderizarRota("/coordenacao/conferencia");
    await screen.findByLabelText(ROTULO_ARQUIVO, undefined, { timeout: 5000 });
    return api;
  }

  async function escolher() {
    fireEvent.change(screen.getByLabelText(ROTULO_ARQUIVO), {
      target: {
        files: [
          new File([CSV_EXEMPLO], "pedidos-rifei.csv", { type: "text/csv" }),
        ],
      },
    });
    await screen.findByText("pedidos-rifei.csv");
    await waitFor(() =>
      expect(screen.queryByText(/^(Lendo o arquivo|Conferindo)/)).toBeNull(),
    );
  }

  it("antes do arquivo: o seletor e as recuperações feitas, com 'Carregar mais' e, carregando, 'Carregando…'", async () => {
    let segunda: (resposta: Response) => void = () => {};
    const api = await abrir(
      criarApiConferencia({
        recuperacoes: () => ({ itens: RECUPERACOES, proximo: 7 }),
      }),
    );
    const carregarMais = await screen.findByRole("button", {
      name: "Carregar mais",
    });
    expect(textoDaDica(screen.getByLabelText(ROTULO_ARQUIVO))).toBe(
      DICAS_CONFERENCIA.escolherArquivo,
    );
    conferirDicas(10);

    // A próxima página fica pendente: o botão vira "Carregando…" (indisponível com aria-disabled, com a dica).
    api.fetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolver) => {
          segunda = resolver;
        }),
    );
    fireEvent.click(carregarMais);
    const carregando = await screen.findByRole("button", {
      name: "Carregando…",
    });
    expect(textoDaDica(carregando)).toBe(DICAS_CONFERENCIA.carregando);
    conferirDicas(10);
    segunda(respostaJson({ itens: [], proximo: null }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Carregando…" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("conferida: as colunas (com 'Desfazer as trocas'), as vendas perdidas (marcar, desmarcar, cada venda) e 'Recuperar'", async () => {
    await abrir(
      criarApiConferencia({
        analises: [ANALISE_POR_PEDIDO],
        recuperacoes: () => RECUPERACOES,
      }),
    );
    await escolher();
    expect(botao("Marcar todas")).toBeInTheDocument();
    const perdidas = screen.getByRole("region", { name: "Vendas perdidas" });
    const caixas = within(perdidas).getAllByRole("checkbox");
    expect(caixas.some((caixa) => caixa.hasAttribute("disabled"))).toBe(true);
    conferirDicas(20);

    fireEvent.change(screen.getByLabelText("Afiliado"), {
      target: { value: "" },
    });
    expect(botao("Desfazer as trocas")).toBeInTheDocument();
    expect(textoDaDica(botao("Conferir com estas colunas"))).toBe(
      DICAS_CONFERENCIA.conferirColunas,
    );
    conferirDicas(20);
  });

  it("a confirmação do 'Recuperar' e o aviso da recuperação", async () => {
    await abrir(
      criarApiConferencia({
        analises: [ANALISE_POR_PEDIDO],
        recuperacoes: () => RECUPERACOES,
      }),
    );
    await escolher();
    acionar(botao(/^Recuperar \d+ vendas?$/));
    const dialogo = await screen.findByRole("alertdialog", {
      name: /^Recuperar/,
    });
    await within(dialogo).findByRole("button", { name: /^Gravar/ });
    conferirDicas(3);

    fireEvent.click(within(dialogo).getByRole("button", { name: /^Gravar/ }));
    await screen.findByText(/vendas? recuperadas?$/);
    expect(botao("Fechar aviso")).toBeInTheDocument();
    conferirDicas(20);
  });
});

describe("Bumbo", () => {
  it("a mensagem: o dia, 'Enviar no WhatsApp' e 'Copiar mensagem'", async () => {
    simularBumbo();
    renderizarRota("/coordenacao/bumbo");
    await screen.findByRole("button", { name: "Copiar mensagem" });
    expect(
      screen.getByRole("combobox", { name: "Dia da mensagem" }),
    ).toBeInTheDocument();
    expect(
      textoDaDica(screen.getByRole("link", { name: /^Enviar no WhatsApp/ })),
    ).toBe(DICAS_BUMBO.enviarNoWhatsApp);
    conferirDicas(15);
  });

  it("sem campanha: 'Configurar a campanha'", async () => {
    simularBumbo({
      erro: {
        status: 404,
        codigo: "nao_encontrado",
        mensagem: "A campanha ainda não foi configurada",
      },
    });
    renderizarRota("/coordenacao/bumbo");
    await screen.findByRole("link", { name: "Configurar a campanha" });
    conferirDicas(12);
  });
});

describe("Rankings", () => {
  it("as abas dos níveis e os filtros de divisão e de janela", async () => {
    simularApiRanking((consulta) =>
      respostaDaConsulta(consulta, [
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
    renderizarRota("/coordenacao/rankings");
    await screen.findByRole("table", undefined, { timeout: 5000 });
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(textoDaDica(screen.getByRole("tab", { name: "Redes" }))).toBe(
      DICAS_RANKINGS.aba.rede,
    );
    conferirDicas(17);
  });
});

describe("Mapa", () => {
  it("os filtros, Atualizar, os quadrados das UFs e 'Ver os estados em tabela'", async () => {
    simularMapa();
    renderizarRota("/coordenacao/mapa");
    await screen.findByRole(
      "group",
      { name: "Mapa das vendas por estado" },
      { timeout: 5000 },
    );
    const ufs = screen.getAllByRole("button", { name: /^(Pará|São Paulo)/ });
    expect(ufs.length).toBeGreaterThan(0);
    expect(screen.getByText("Ver os estados em tabela")).toBeInTheDocument();
    conferirDicas(27 + 15);
  });

  it("atualizando: 'Atualizando…' diz por que está indisponível", async () => {
    let segunda: () => void = () => {};
    const { fetchMock } = simularMapa();
    renderizarRota("/coordenacao/mapa");
    const atualizar = await screen.findByRole(
      "button",
      { name: "Atualizar" },
      { timeout: 5000 },
    );
    const padrao = fetchMock.getMockImplementation();
    fetchMock.mockImplementationOnce(
      (caminho: string) =>
        new Promise<Response>((resolver) => {
          segunda = () => void padrao?.(caminho).then(resolver);
        }),
    );
    fireEvent.click(atualizar);
    const atualizando = await screen.findByRole("button", {
      name: "Atualizando…",
    });
    expect(textoDaDica(atualizando)).toBe(DICAS_MAPA.atualizando);
    conferirDicas(27 + 15);
    segunda();
    await screen.findByRole("button", { name: "Atualizar" });
  });
});

describe("Trilha", () => {
  /** Registro fictício: o id define a ordem (o maior é o mais novo). */
  const registro = (id: number): RegistroAuditoria => ({
    id,
    em: new Date(Date.UTC(2026, 10, 25, 15, 0) + id * 60_000).toISOString(),
    usuario_id: 3,
    usuario_nome: "Coordenadora Ficticia",
    acao: "campanha.salvar",
    alvo: "campanha:1",
    resumo: `Alteração fictícia número ${id}`,
  });

  it("'Carregar mais' e, enquanto a página chega, 'Carregando…'", async () => {
    let segunda: (resposta: Response) => void = () => {};
    let chamadas = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        chamadas++;
        if (chamadas === 1)
          return respostaJson(
            respostaAuditoriaSchema.parse({
              itens: [registro(3), registro(2)],
              proximo: 2,
            }),
          );
        return new Promise<Response>((resolver) => {
          segunda = resolver;
        });
      }),
    );
    renderizarRota("/coordenacao/trilha", { usuario: ADMIN_DE_TESTE });
    const carregarMais = await screen.findByRole(
      "button",
      { name: "Carregar mais" },
      { timeout: 5000 },
    );
    expect(textoDaDica(carregarMais)).toBe(DICAS_TRILHA.carregarMais);
    conferirDicas(14);

    fireEvent.click(carregarMais);
    const carregando = await screen.findByRole("button", {
      name: "Carregando…",
    });
    expect(textoDaDica(carregando)).toBe(DICAS_TRILHA.carregando);
    conferirDicas(14);
    segunda(
      respostaJson(
        respostaAuditoriaSchema.parse({ itens: [registro(1)], proximo: null }),
      ),
    );
    await screen.findByText(/não há registros mais antigos/);
  });
});
