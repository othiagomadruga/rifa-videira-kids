// Tela do bumbo (/coordenacao/bumbo), renderizada pela rota de verdade com a sessão de teste e a API do
// bumbo simulada (teste-apoio.ts: o texto sai de montarBumbo, como no Worker). CA1: a mensagem do dia,
// o seletor de data, copiar e enviar, e os estados; CA3: nada de R$ na tela.
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MENSAGEM_SEM_CONEXAO } from "../../lib/api";
import { renderizarRota } from "../../test/renderizar";
import {
  CAMPANHA_EM_REAIS,
  INSTANTES,
  respostaDoBumbo,
  simularApi,
  type ApiDoBumbo,
} from "./teste-apoio";
import { somarDias } from "./textos";

const CAMINHO = "/coordenacao/bumbo";
const COPIADA = "Mensagem copiada. Agora é só colar no grupo dos líderes.";
const NAO_COPIOU =
  "Não deu para copiar sozinho: a mensagem ficou selecionada. Copie pelo menu do celular.";

let api: ApiDoBumbo;

function abrir(cenario: Parameters<typeof simularApi>[0] = {}) {
  api = simularApi(cenario);
  return renderizarRota(CAMINHO);
}

/** O texto da mensagem na tela (o <pre> da figura "Texto da mensagem"), depois que ele chega. */
async function textoNaTela(): Promise<HTMLElement> {
  const figura = await screen.findByRole("figure", {
    name: "Texto da mensagem",
  });
  const texto = figura.querySelector("pre");
  if (!texto) throw new Error("A figura da mensagem está sem o <pre>");
  return texto;
}

const seletor = () => screen.getByRole("combobox", { name: "Dia da mensagem" });

const opcoes = () =>
  within(seletor())
    .getAllByRole<HTMLOptionElement>("option")
    .map((opcao) => ({ valor: opcao.value, rotulo: opcao.textContent }));

/** De `de` até `ate`, do mais recente ao mais antigo. */
function diasDescendo(de: string, ate: string): string[] {
  const dias: string[] = [];
  for (let data = de; data >= ate; data = somarDias(data, -1)) dias.push(data);
  return dias;
}

function simularAreaDeTransferencia(
  writeText: (texto: string) => Promise<void>,
) {
  const espiao = vi.fn(writeText);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: espiao },
  });
  return espiao;
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

afterEach(() => {
  // A tela só chama a rota aberta do bumbo (a sessão dos testes já vem conhecida).
  expect(
    api.caminhos.filter((pedido) => !pedido.startsWith("/api/publico/bumbo")),
  ).toEqual([]);
  // CA3: em nenhum estado o bumbo exibe R$.
  expect(document.body.textContent).not.toMatch(/R\$/);
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(document, "visibilityState");
  window.getSelection()?.removeAllRanges();
});

describe("CA1: a mensagem do dia", () => {
  it("abre com a mensagem de hoje: o texto exatamente como a API devolve, a data de referência e o dia da campanha", async () => {
    abrir();
    expect(
      screen.getByRole("heading", { level: 1, name: "Bumbo" }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Bumbo · Rifa Videira Kids");
    expect(screen.getByText("Carregando a mensagem…")).toBeInTheDocument();

    const texto = await textoNaTela();
    const esperado = respostaDoBumbo(INSTANTES.durante).texto;
    // Igual, caractere por caractere, com as quebras de linha (e as linhas em branco) da API.
    expect(texto.textContent).toBe(esperado);
    expect(esperado).toContain(
      "*Rifa Videira Kids · Dia 9 de 21*\n\n*Ontem (dia 8):*",
    );
    expect(texto.tagName).toBe("PRE");
    expect(screen.getByText("Terça, 01/12/2026 (hoje)")).toBeInTheDocument();
    expect(screen.getByText("Dia 9 de 21")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Mensagem do dia" }),
    ).toBeInTheDocument();
    // Hoje vai sem `data`: vale em qualquer fase e divide o cache com quem também pede a de hoje.
    expect(api.caminhos).toEqual(["/api/publico/bumbo"]);
    // Com vendas no ranking, nenhum aviso.
    expect(
      screen.queryByText("Ainda sem vendas no ranking."),
    ).not.toBeInTheDocument();
  });

  it("o seletor de data fica na campanha: hoje (o padrão) e os dias do 1º até ontem, do mais recente ao mais antigo", async () => {
    abrir();
    await textoNaTela();

    expect(seletor()).toHaveValue("");
    expect(
      screen.getByText("A mensagem fala sempre do dia anterior, já fechado."),
    ).toBeInTheDocument();
    const lista = opcoes();
    expect(lista.map(({ valor }) => valor)).toEqual([
      "",
      ...diasDescendo("2026-11-30", "2026-11-23"),
    ]);
    expect(lista[0].rotulo).toBe("Terça, 01/12 (hoje) · dia 9");
    expect(lista[1].rotulo).toBe("Segunda, 30/11 (ontem) · dia 8");
    expect(lista[2].rotulo).toBe("Domingo, 29/11 · dia 7");
    expect(lista.at(-1)?.rotulo).toBe("Segunda, 23/11 · dia 1");
  });

  it("trocar o dia pede a mensagem daquele dia, com o foco no seletor; voltar para hoje pede a de hoje", async () => {
    abrir();
    await textoNaTela();
    const campo = seletor();
    act(() => campo.focus());

    fireEvent.change(campo, { target: { value: "2026-11-30" } });

    // A mensagem anterior sai na hora: nunca se copia a mensagem do dia errado.
    expect(screen.getByText("Carregando a mensagem…")).toBeInTheDocument();
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
    expect(await screen.findByText("Segunda, 30/11/2026")).toBeInTheDocument();
    expect((await textoNaTela()).textContent).toBe(
      respostaDoBumbo(INSTANTES.durante, "2026-11-30").texto,
    );
    expect(screen.getByText("Dia 8 de 21")).toBeInTheDocument();
    expect(api.caminhos).toEqual([
      "/api/publico/bumbo",
      "/api/publico/bumbo?data=2026-11-30",
    ]);
    expect(seletor()).toBe(campo);
    expect(campo).toHaveFocus();

    fireEvent.change(campo, { target: { value: "" } });

    expect(
      await screen.findByText("Terça, 01/12/2026 (hoje)"),
    ).toBeInTheDocument();
    expect(api.caminhos.at(-1)).toBe("/api/publico/bumbo");
    expect(campo).toHaveFocus();
  });

  it("campanha encerrada: hoje e a janela inteira, até o dia seguinte ao último (nenhum dia entre ele e hoje)", async () => {
    abrir({ agora: INSTANTES.encerrada });

    expect((await textoNaTela()).textContent).toBe(
      respostaDoBumbo(INSTANTES.encerrada).texto,
    );
    expect(screen.getByText("Campanha encerrada")).toBeInTheDocument();
    const lista = opcoes();
    expect(lista.map(({ valor }) => valor)).toEqual([
      "",
      ...diasDescendo("2026-12-14", "2026-11-23"),
    ]);
    expect(lista.slice(0, 3)).toEqual([
      { valor: "", rotulo: "Domingo, 20/12 (hoje) · campanha encerrada" },
      { valor: "2026-12-14", rotulo: "Segunda, 14/12 · dia seguinte ao fim" },
      { valor: "2026-12-13", rotulo: "Domingo, 13/12 · dia 21" },
    ]);

    fireEvent.change(seletor(), { target: { value: "2026-12-14" } });

    expect(await screen.findByText("Segunda, 14/12/2026")).toBeInTheDocument();
    expect((await textoNaTela()).textContent).toBe(
      respostaDoBumbo(INSTANTES.encerrada, "2026-12-14").texto,
    );
    expect(api.caminhos.at(-1)).toBe("/api/publico/bumbo?data=2026-12-14");
  });

  it("antes do início: a contagem regressiva de hoje, com o aviso e sem seletor (ainda não há outro dia)", async () => {
    abrir({ agora: INSTANTES.antes });

    const texto = await textoNaTela();
    expect(texto.textContent).toBe(respostaDoBumbo(INSTANTES.antes).texto);
    expect(texto.textContent).toContain("Faltam 3 dias para começar");
    expect(screen.getByText("Sexta, 20/11/2026 (hoje)")).toBeInTheDocument();
    expect(screen.getByText("Faltam 3 dias para começar")).toBeInTheDocument();
    expect(
      screen.getByText("A campanha começa em 23/11/2026."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(api.caminhos).toEqual(["/api/publico/bumbo"]);
  });

  it("1º dia de vendas: a mensagem da largada, com o aviso de que o resto vem a partir de amanhã", async () => {
    abrir({ agora: INSTANTES.primeiroDia });

    expect((await textoNaTela()).textContent).toBe(
      respostaDoBumbo(INSTANTES.primeiroDia).texto,
    );
    expect(screen.getByText("Dia 1 de 21")).toBeInTheDocument();
    expect(
      screen.getByText("1º dia de vendas: a mensagem é a da largada."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("sem vendas ainda: a mensagem sai sem posições no ranking, e a tela avisa", async () => {
    abrir({ vendas: [] });

    const texto = await textoNaTela();
    expect(texto.textContent).toContain("_Jovens_: ainda sem vendas.");
    expect(texto.textContent).toContain("_Adultos_: ainda sem vendas.");
    expect(
      screen.getByText("Ainda sem vendas no ranking."),
    ).toBeInTheDocument();
    // A mensagem pode sair assim mesmo.
    expect(
      screen.getByRole("button", { name: "Copiar mensagem" }),
    ).toBeInTheDocument();
  });

  it("404 sem campanha: o aviso com o caminho para configurar, sem seletor nem ações", async () => {
    abrir({
      erro: {
        status: 404,
        codigo: "nao_encontrado",
        mensagem: "A campanha ainda não foi configurada",
      },
    });

    expect(
      await screen.findByText("A campanha ainda não foi configurada."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Configurar a campanha" }),
    ).toHaveAttribute("href", "/coordenacao/campanha");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Copiar mensagem" }),
    ).not.toBeInTheDocument();
  });

  it("falha ao carregar: o erro com 'Tentar de novo', que pede de novo e mostra a mensagem", async () => {
    abrir({ falhas: 1 });

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Não foi possível carregar a mensagem.");
    expect(alerta).toHaveTextContent(MENSAGEM_SEM_CONEXAO);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    fireEvent.click(
      within(alerta).getByRole("button", { name: "Tentar de novo" }),
    );

    expect((await textoNaTela()).textContent).toBe(
      respostaDoBumbo(INSTANTES.durante).texto,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(api.caminhos).toEqual(["/api/publico/bumbo", "/api/publico/bumbo"]);
  });

  it("falha ao trocar de dia: o erro da API fica no lugar da mensagem, o seletor continua e 'Tentar de novo' pede o mesmo dia", async () => {
    abrir();
    await textoNaTela();
    api.erro = {
      status: 500,
      codigo: "erro_interno",
      mensagem: "Erro interno",
    };

    fireEvent.change(seletor(), { target: { value: "2026-11-29" } });

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Não foi possível carregar a mensagem.");
    expect(alerta).toHaveTextContent("Erro interno");
    expect(seletor()).toHaveValue("2026-11-29");
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Enviar no WhatsApp/ }),
    ).not.toBeInTheDocument();

    api.erro = null;
    fireEvent.click(
      within(alerta).getByRole("button", { name: "Tentar de novo" }),
    );

    expect(await screen.findByText("Domingo, 29/11/2026")).toBeInTheDocument();
    expect(api.caminhos.slice(1)).toEqual([
      "/api/publico/bumbo?data=2026-11-29",
      "/api/publico/bumbo?data=2026-11-29",
    ]);
  });

  it("voltar para a aba consulta a de hoje de novo sem tirá-la da tela (no dia seguinte, troca); com outro dia escolhido, não consulta", async () => {
    abrir();
    await textoNaTela();

    definirVisibilidade("hidden");
    definirVisibilidade("visible");
    // A mensagem não sai da tela enquanto consulta.
    expect(
      screen.getByRole("figure", { name: "Texto da mensagem" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(api.caminhos).toHaveLength(2));
    expect(api.caminhos[1]).toBe("/api/publico/bumbo");

    // A página ficou aberta de um dia para o outro: a de hoje passa a ser a do dia novo.
    api.agora = new Date("2026-12-02T15:00:00.000Z");
    definirVisibilidade("hidden");
    definirVisibilidade("visible");
    expect(
      await screen.findByText("Quarta, 02/12/2026 (hoje)"),
    ).toBeInTheDocument();
    expect((await textoNaTela()).textContent).toBe(
      respostaDoBumbo(api.agora).texto,
    );
    expect(opcoes().slice(0, 2)).toEqual([
      { valor: "", rotulo: "Quarta, 02/12 (hoje) · dia 10" },
      { valor: "2026-12-01", rotulo: "Terça, 01/12 (ontem) · dia 9" },
    ]);

    // Uma falha nessa consulta não apaga a mensagem.
    api.falhas = 1;
    definirVisibilidade("hidden");
    definirVisibilidade("visible");
    await waitFor(() => expect(api.falhas).toBe(0));
    expect(
      await screen.findByText("Quarta, 02/12/2026 (hoje)"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // Com um dia passado escolhido, voltar para a aba não consulta (a mensagem dele não muda).
    fireEvent.change(seletor(), { target: { value: "2026-11-30" } });
    await screen.findByText("Segunda, 30/11/2026");
    const pedidos = api.caminhos.length;
    definirVisibilidade("hidden");
    definirVisibilidade("visible");
    expect(api.caminhos).toHaveLength(pedidos);
  });
});

describe("RIFA-051 (P3.9): a prévia como no WhatsApp", () => {
  it("a mensagem num balão, com o *negrito* e o _itálico_ desenhados; o texto (o que se copia e vai para o wa.me) não muda", async () => {
    const escrever = simularAreaDeTransferencia(async () => {});
    abrir();
    const texto = await textoNaTela();
    const esperado = respostaDoBumbo(INSTANTES.durante).texto;
    expect(texto.textContent).toBe(esperado);
    expect(texto).toHaveClass("bumbo__texto");
    expect(
      [...texto.querySelectorAll("strong")].map((negrito) =>
        negrito.textContent?.replace(/^\*|\*$/g, ""),
      ),
    ).toContain("Rifa Videira Kids · Dia 9 de 21");
    expect(texto.querySelectorAll(".bumbo__marca").length).toBeGreaterThan(0);

    expect(
      screen.getByRole("link", { name: /^Enviar no WhatsApp/ }),
    ).toHaveAttribute(
      "href",
      `https://wa.me/?text=${encodeURIComponent(esperado)}`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copiar mensagem" }));
    await waitFor(() =>
      expect(escrever).toHaveBeenCalledExactlyOnceWith(esperado),
    );
    // Copiado, a prévia continua desenhada.
    expect(texto.querySelector("strong")).not.toBeNull();
  });
});

describe("CA1: copiar e enviar", () => {
  it("Copiar mensagem: o texto exato vai para a área de transferência, com a confirmação na tela e o anúncio", async () => {
    const escrever = simularAreaDeTransferencia(async () => {});
    abrir();
    const texto = await textoNaTela();

    fireEvent.click(screen.getByRole("button", { name: "Copiar mensagem" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(COPIADA),
    );
    expect(escrever).toHaveBeenCalledExactlyOnceWith(texto.textContent);
    const confirmacao = document.querySelector(".bumbo__copia");
    expect(confirmacao).toHaveTextContent(`✓ ${COPIADA}`);
    expect(confirmacao).toHaveAttribute("data-resultado", "copiada");
  });

  it("copiar de novo volta a anunciar; trocar de dia apaga a confirmação", async () => {
    const escrever = simularAreaDeTransferencia(async () => {});
    abrir();
    await textoNaTela();
    const botao = screen.getByRole("button", { name: "Copiar mensagem" });
    fireEvent.click(botao);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(COPIADA),
    );

    // A região viva esvazia e se enche de novo: o leitor de tela anuncia outra vez.
    const textos: string[] = [];
    const observador = new MutationObserver(() =>
      textos.push(screen.getByRole("status").textContent ?? ""),
    );
    observador.observe(screen.getByRole("status"), {
      childList: true,
      characterData: true,
      subtree: true,
    });
    fireEvent.click(botao);
    await waitFor(() => expect(escrever).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(textos).toEqual(["", COPIADA]));
    observador.disconnect();

    fireEvent.change(seletor(), { target: { value: "2026-11-30" } });
    await screen.findByText("Segunda, 30/11/2026");
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(document.querySelector(".bumbo__copia")).toBeNull();
  });

  it("sem a área de transferência (navegador antigo ou sem HTTPS): a mensagem fica selecionada e a tela explica como copiar", async () => {
    abrir();
    const texto = await textoNaTela();
    expect(navigator.clipboard).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "Copiar mensagem" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(NAO_COPIOU),
    );
    expect(window.getSelection()?.toString()).toBe(texto.textContent);
    expect(document.querySelector(".bumbo__copia")).toHaveAttribute(
      "data-resultado",
      "falhou",
    );
    // RIFA-051 (P3.9): sem copiar sozinho, a prévia volta ao texto puro (com os * e _), que é o que fica selecionado.
    expect(texto.querySelector("strong, em")).toBeNull();
    expect(texto.textContent).toBe(respostaDoBumbo(INSTANTES.durante).texto);
  });

  it("o navegador recusa a cópia (sem permissão): o mesmo caminho, a mensagem selecionada", async () => {
    simularAreaDeTransferencia(() =>
      Promise.reject(new DOMException("Sem permissão", "NotAllowedError")),
    );
    abrir();
    const texto = await textoNaTela();

    fireEvent.click(screen.getByRole("button", { name: "Copiar mensagem" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(NAO_COPIOU),
    );
    expect(window.getSelection()?.toString()).toBe(texto.textContent);
  });

  it("Enviar no WhatsApp: wa.me com o texto inteiro codificado, em outra aba e sem referrer", async () => {
    // Caracteres que quebrariam a URL sem codificar: &, #, ?, +, %, =, / e as quebras de linha.
    const especial =
      "*Rifa & Cia · Dia 9 de 21*\n\n100% + 5% = vamos? #bora\n_Célula/Ágape_: ação!";
    abrir({ texto: especial });
    expect((await textoNaTela()).textContent).toBe(especial);

    const link = screen.getByRole("link", {
      name: "Enviar no WhatsApp (abre em outra aba)",
    });

    expect(link).toHaveAttribute(
      "href",
      `https://wa.me/?text=${encodeURIComponent(especial)}`,
    );
    const url = new URL(link.getAttribute("href") ?? "");
    expect(`${url.origin}${url.pathname}`).toBe("https://wa.me/");
    expect([...url.searchParams.keys()]).toEqual(["text"]);
    expect(url.searchParams.get("text")).toBe(especial);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("o link do WhatsApp leva a mensagem do dia escolhido", async () => {
    abrir();
    await textoNaTela();

    fireEvent.change(seletor(), { target: { value: "2026-11-25" } });
    await screen.findByText("Quarta, 25/11/2026");

    const link = screen.getByRole("link", { name: /Enviar no WhatsApp/ });
    expect(
      new URL(link.getAttribute("href") ?? "").searchParams.get("text"),
    ).toBe(respostaDoBumbo(INSTANTES.durante, "2026-11-25").texto);
  });
});

describe("CA3: o bumbo nunca exibe R$", () => {
  it("com a meta da campanha em R$, a mensagem e a tela continuam só com percentuais e posições", async () => {
    abrir({ campanha: CAMPANHA_EM_REAIS });

    const texto = await textoNaTela();
    expect(texto.textContent).toBe(
      respostaDoBumbo(
        INSTANTES.durante,
        undefined,
        undefined,
        CAMPANHA_EM_REAIS,
      ).texto,
    );
    expect(texto.textContent).toMatch(/\d+% da meta/);
    expect(document.body.textContent).not.toMatch(/R\$|centavo|bilhete/i);
  });
});
