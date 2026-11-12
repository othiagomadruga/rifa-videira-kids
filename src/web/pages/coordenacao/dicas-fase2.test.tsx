// RIFA-045 fase 2a: as telas da coordenação que faltavam (Visão geral, Hierarquia, Conferência, Bumbo, Rankings,
// Mapa e Trilha) têm dica em todos os botões e campos; na fase 2b, a Adesão inteira (a seção "Links de vendas" veio
// com a RIFA-046). As telas fora da coordenação ficam em pages/dicas-fora-da-coordenacao.test.tsx. Mesma varredura da fase 1 (dicas.test.tsx): passa o mouse em
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
import {
  ADMIN_DE_TESTE,
  renderizarRota,
  respostaJson,
} from "../../test/renderizar";
import { celulaDeTeste, simularApiAdesao } from "../adesao/teste-apoio";
import { DICAS as DICAS_ADESAO } from "../adesao/textos";
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
    await waitFor(() => expect(botao("Conferir")).toBeEnabled());
    fireEvent.click(botao("Conferir"));
    await screen.findByText("Nenhum erro encontrado");
    expect(botao("Importar")).toBeEnabled();
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

    // A próxima página fica pendente: o botão vira "Carregando…" (desabilitado, com a dica de indisponível).
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

describe("Adesão", () => {
  let api: ReturnType<typeof simularApiAdesao> | null = null;

  /**
   * Abre a tela (com a coordenação, se não vier o `usuario`) e espera o painel e a seção "Links de vendas" (que vem
   * num pacote à parte).
   */
  async function abrir(
    opcoes: Parameters<typeof simularApiAdesao>[0] = {},
    usuario?: typeof ADMIN_DE_TESTE,
  ) {
    api = simularApiAdesao(opcoes);
    renderizarRota("/coordenacao/adesao", usuario ? { usuario } : {});
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
    return api;
  }

  /** O cartão da célula na lista "Todas as células" (a célula sem afiliado também aparece em "Quem falta"). */
  const naLista = (nome: string) =>
    within(
      within(screen.getByRole("region", { name: "Todas as células" }))
        .getByRole("heading", { level: 3, name: nome })
        .closest("article") as HTMLElement,
    );

  afterEach(() => {
    expect(api?.inesperadas ?? []).toEqual([]);
    api = null;
  });

  it("o painel: Atualizar agora, Vincular de cada órfão, ligar e Copiar em 'Quem falta', as buscas, Trocar, Desvincular, Adicionar outro código e o código de afiliado", async () => {
    await abrir();
    expect(botao("Vincular o afiliado 1044")).toBeInTheDocument();
    expect(
      naLista("Célula Betel").getByRole("button", {
        name: "Adicionar outro código em Célula Betel",
      }),
    ).toBeInTheDocument();
    conferirDicas(38);

    expect(textoDaDica(botao("Atualizar agora"))).toBe(
      DICAS_ADESAO.atualizarAgora,
    );
    expect(textoDaDica(botao("Vincular o afiliado 1043"))).toBe(
      DICAS_ADESAO.vincular,
    );
    expect(textoDaDica(botao("Copiar o telefone de Lider Ágape"))).toBe(
      DICAS_ADESAO.copiarTelefone,
    );
    expect(
      textoDaDica(
        naLista("Célula Ágape").getByRole("textbox", {
          name: "Código de afiliado (Célula Ágape)",
        }),
      ),
    ).toBe(DICAS_ADESAO.codigoAfiliado);
    // O número do líder é um link comum (tel:), que a varredura não pega: a dica confere à parte.
    const ligar = screen.getByRole("link", { name: "(91) 90000-0001" });
    expect(ligar).toHaveAttribute("href", "tel:91900000001");
    expect(textoDaDica(ligar)).toBe(DICAS_ADESAO.ligar);
  });

  it("admin: 'Remover' em cada órfão e em cada afiliado das células", async () => {
    await abrir({}, ADMIN_DE_TESTE);
    expect(
      screen.getAllByRole("button", { name: /^Remover o afiliado/ }),
    ).toHaveLength(4);
    conferirDicas(45);
    expect(textoDaDica(botao("Remover o afiliado 1001"))).toBe(
      DICAS_ADESAO.removerAfiliado,
    );
  });

  it("Vincular aberto: a busca, as células para marcar, Confirmar e Cancelar; gravando, 'Salvando…' diz por que está indisponível", async () => {
    const api = await abrir();
    acionar(botao("Vincular o afiliado 1044"));
    const escolha = await screen.findByRole("group", {
      name: "Célula do afiliado 1044",
    });
    expect(within(escolha).getAllByRole("radio")).toHaveLength(4);
    conferirDicas(45);
    expect(textoDaDica(botao("Vincular o afiliado 1044"))).toBe(
      DICAS_ADESAO.vincularAberto,
    );
    expect(textoDaDica(botao("Confirmar"))).toBe(
      DICAS_ADESAO.confirmarSemEscolha,
    );
    // O rádio tem a dica no fim da descrição (a dica fica na linha toda).
    const debora = within(escolha).getByRole("radio", {
      name: /^Célula Débora/,
    });
    expect(textoDaDica(debora)).toBe(DICAS_ADESAO.opcaoCelula);

    fireEvent.click(debora);
    expect(textoDaDica(botao("Vincular: Célula Débora"))).toBe(
      DICAS_ADESAO.confirmarEscolha,
    );
    const soltar = api.segurarGravacoes();
    fireEvent.click(botao("Vincular: Célula Débora"));
    const salvando = await screen.findByRole("button", { name: "Salvando…" });
    expect(salvando).toBeDisabled();
    expect(textoDaDica(salvando)).toBe(DICAS_ADESAO.salvandoEscolha);
    conferirDicas(45);
    soltar();
    // O aviso aparece na seção e na região viva da tela.
    expect(
      await screen.findAllByText("Afiliado 1044 vinculado: Célula Débora."),
    ).not.toHaveLength(0);
  });

  it("Trocar aberto e a pergunta do Desvincular; desvinculando, 'Desvinculando…' diz por que está indisponível", async () => {
    const api = await abrir();
    const trocar = naLista("Célula Betel").getByRole("button", {
      name: "Trocar a célula do afiliado 1001",
    });
    acionar(trocar);
    await naLista("Célula Betel").findByRole("group", {
      name: "Nova célula do afiliado 1001",
    });
    expect(textoDaDica(trocar)).toBe(DICAS_ADESAO.trocarAberto);
    conferirDicas(44);
    fireEvent.click(
      naLista("Célula Betel").getByRole("button", { name: "Cancelar" }),
    );

    acionar(
      naLista("Célula Betel").getByRole("button", {
        name: "Desvincular o afiliado 1001",
      }),
    );
    const confirmar = await naLista("Célula Betel").findByRole("button", {
      name: "Confirmar desvínculo",
    });
    expect(textoDaDica(confirmar)).toBe(DICAS_ADESAO.confirmarDesvinculo);
    conferirDicas(40);

    const soltar = api.segurarGravacoes();
    fireEvent.click(confirmar);
    const desvinculando = await naLista("Célula Betel").findByRole("button", {
      name: "Desvinculando…",
    });
    expect(textoDaDica(desvinculando)).toBe(DICAS_ADESAO.desvinculando);
    conferirDicas(40);
    soltar();
    expect(
      await screen.findAllByText(
        "Afiliado 1001 desvinculado. Ele voltou para “Sem célula”.",
      ),
    ).not.toHaveLength(0);
  });

  it("pré-cadastro de um código que está em outra célula: a pergunta da troca; gravando, 'Salvando…'", async () => {
    const api = await abrir();
    const agape = naLista("Célula Ágape");
    fireEvent.change(
      agape.getByRole("textbox", { name: "Código de afiliado (Célula Ágape)" }),
      { target: { value: "1002" } },
    );
    fireEvent.click(agape.getByRole("button", { name: "Salvar código" }));
    const trocarPara = await agape.findByRole("button", {
      name: "Trocar para esta célula",
    });
    expect(textoDaDica(trocarPara)).toBe(DICAS_ADESAO.trocarParaEstaCelula);
    expect(textoDaDica(agape.getByRole("button", { name: "Cancelar" }))).toBe(
      DICAS_ADESAO.cancelarTroca,
    );
    conferirDicas(40);

    const soltar = api.segurarGravacoes();
    fireEvent.click(trocarPara);
    const salvando = await agape.findByRole("button", { name: "Salvando…" });
    expect(textoDaDica(salvando)).toBe(DICAS_ADESAO.salvandoCodigo);
    conferirDicas(40);
    soltar();
    expect(
      await screen.findAllByText("Afiliado 1002 trocado para: Célula Ágape."),
    ).not.toHaveLength(0);
  });

  it("a confirmação de remover (admin): removendo, 'Removendo…'; com pedidos que ainda contam, 'Entendi'", async () => {
    const api = await abrir(
      { comPedidos: { 1044: ["PED-1"] } },
      ADMIN_DE_TESTE,
    );
    acionar(botao("Remover o afiliado 1044"));
    const dialogo = await screen.findByRole("alertdialog", {
      name: "Remover o afiliado 1044?",
    });
    // O ×, Cancelar e Remover afiliado (o resto da página fica inert).
    expect(contarControles(dialogo)).toBe(3);
    conferirDicas(3);
    expect(
      textoDaDica(
        within(dialogo).getByRole("button", { name: "Remover afiliado" }),
      ),
    ).toBe(DICAS_ADESAO.confirmarRemocao);
    // O × diz o que acontece ao fechar (no lugar da dica padrão do Dialogo).
    expect(
      textoDaDica(within(dialogo).getByRole("button", { name: "Fechar" })),
    ).toBe(DICAS_ADESAO.cancelarRemocao);

    const soltar = api.segurarGravacoes();
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Remover afiliado" }),
    );
    const removendo = await within(dialogo).findByRole("button", {
      name: "Removendo…",
    });
    expect(textoDaDica(removendo)).toBe(DICAS_ADESAO.removendo);
    conferirDicas(3);
    soltar();

    const entendi = await within(dialogo).findByRole("button", {
      name: "Entendi",
    });
    expect(textoDaDica(entendi)).toBe(DICAS_ADESAO.entendiRemocao);
    conferirDicas(2);
  });

  it("falha na primeira carga: 'Tentar de novo'", async () => {
    api = simularApiAdesao({ falhas: 1 });
    renderizarRota("/coordenacao/adesao");
    await screen.findByRole(
      "button",
      { name: "Tentar de novo" },
      { timeout: 5000 },
    );
    conferirDicas(13);
  });

  it("sem células: o aviso que leva à Hierarquia e a fila 'Sem célula'", async () => {
    await abrir({ celulas: [] });
    expect(screen.getByText("Nenhuma célula cadastrada.")).toBeInTheDocument();
    conferirDicas(18);
  });

  it("uma célula só, já com afiliado: 'Quem falta' vazio e a busca sem resultado", async () => {
    await abrir({
      celulas: [
        celulaDeTeste(2, "Célula Betel", {
          afiliados: [1001],
          vinculada: true,
        }),
      ],
      orfaos: [],
    });
    expect(
      screen.getByText("Todas as células já têm afiliado."),
    ).toBeInTheDocument();
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Buscar célula, líder ou código" }),
      { target: { value: "nenhuma célula assim" } },
    );
    expect(
      within(
        screen.getByRole("region", { name: "Todas as células" }),
      ).getByText("Nenhuma célula encontrada."),
    ).toBeInTheDocument();
    conferirDicas(21);
  });
});
