// RIFA-039 (D21): a aba "Webhook da Rifei" de /coordenacao/acessos (só admin), pela rota de verdade e com a API
// falsa do token (teste-apoio-webhook.ts), que segue as regras da API: o GET nunca traz o token, o POST o devolve uma
// vez e responde 409 `em_uso` com uma credencial vigente sem `substituir: true`.
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ADMIN_DE_TESTE, renderizarRota } from "../../test/renderizar";
import { respostaErro } from "./teste-apoio";
import {
  CENARIOS,
  ROTA_TOKEN,
  criarApiWebhook,
  type ApiWebhook,
} from "./teste-apoio-webhook";

const CAMINHO = "/coordenacao/acessos";
const ABA = "Webhook da Rifei";
const URL_WEBHOOK = `${window.location.origin}/api/webhooks/rifei`;

/** Abre /coordenacao/acessos como admin, troca para a aba do webhook e espera a situação. */
async function abrirAba(api: ApiWebhook = criarApiWebhook()) {
  vi.stubGlobal("fetch", api.fetch);
  const tela = renderizarRota(CAMINHO, { usuario: ADMIN_DE_TESTE });
  await screen.findByRole("heading", { level: 2, name: "Admin de Teste" });
  acionar(screen.getByRole("tab", { name: ABA }));
  await screen.findByRole("heading", { level: 2, name: "Situação" });
  return { api, ...tela };
}

/** Foca e clica, como o toque e o Enter fazem no navegador (o jsdom não foca no clique). */
function acionar(elemento: HTMLElement) {
  act(() => elemento.focus());
  fireEvent.click(elemento);
}

const painel = () => screen.getByRole("tabpanel", { name: ABA });
const botaoGerar = () =>
  within(painel()).getByRole("button", {
    name: /^(Gerar token do webhook|Gerando…)$/,
  });

/** O valor de um dado da situação ("Último uso" → "12/11/2026 10:05"). */
function dado(rotulo: string) {
  return within(painel()).getByText(rotulo, { selector: "dt" })
    .nextElementSibling?.textContent;
}

/** A região viva fixa da aba (anuncia o token gerado e o resultado de copiar). */
const anuncio = () =>
  within(painel())
    .getAllByRole("status")
    .find((elemento) => elemento.classList.contains("visualmente-oculto"))
    ?.textContent;

/** Tudo o que um armazenamento do navegador guarda (chaves e valores), num texto só. */
function conteudoDe(armazenamento: Storage): string {
  const partes: string[] = [];
  for (let indice = 0; indice < armazenamento.length; indice += 1) {
    const chave = armazenamento.key(indice);
    if (chave !== null) partes.push(chave, armazenamento.getItem(chave) ?? "");
  }
  return partes.join("\n");
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

/**
 * Gera direto (sem credencial vigente) e devolve o token que apareceu, depois de o efeito da tela dar o foco a
 * "Copiar token". O `findBy...` volta assim que o campo aparece, e o efeito pode rodar um instante depois: sem esta
 * espera (docs/frontend.md, "Testes"), o foco do efeito chegou uma vez, sob carga, depois do que o teste fez em
 * seguida (o foco que a cópia sem área de transferência põe no campo ficou em "Copiar token").
 */
async function gerarDireto(api: ApiWebhook) {
  acionar(botaoGerar());
  const campo = await within(painel()).findByLabelText("Token do webhook");
  expect(api.tokens).toHaveLength(1);
  const copiar = within(painel()).getByRole("button", { name: "Copiar token" });
  await waitFor(() => expect(copiar).toHaveFocus());
  return { campo, token: api.tokens[0] };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("CA1: só o admin", () => {
  it("a coordenação não tem o link Acessos no menu; em /coordenacao/acessos, 'sem permissão', sem a aba e sem chamar a API", () => {
    const api = criarApiWebhook(CENARIOS.tela);
    vi.stubGlobal("fetch", api.fetch);
    renderizarRota(CAMINHO);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sem permissão para esta tela",
    );
    expect(
      screen.queryByRole("link", { name: "Acessos" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: ABA })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Gerar token do webhook" }),
    ).not.toBeInTheDocument();
    expect(api.chamadas).toEqual([]);
  });

  it("a coordenação nas outras telas também não pede o token", async () => {
    const api = criarApiWebhook(CENARIOS.tela);
    vi.stubGlobal("fetch", api.fetch);
    renderizarRota("/coordenacao");
    await waitFor(() => expect(api.chamadas.length).toBeGreaterThan(0));

    expect(api.chamadasAoToken()).toEqual([]);
  });

  it("o admin tem o link Acessos e a aba; o token só é pedido quando a aba abre", async () => {
    const api = criarApiWebhook(CENARIOS.tela);
    vi.stubGlobal("fetch", api.fetch);
    renderizarRota(CAMINHO, { usuario: ADMIN_DE_TESTE });
    await screen.findByRole("heading", { level: 2, name: "Admin de Teste" });

    expect(
      screen
        .getAllByRole("link", { name: "Acessos" })
        .every((link) => link.getAttribute("href") === CAMINHO),
    ).toBe(true);
    expect(api.chamadasAoToken()).toEqual([]);

    acionar(screen.getByRole("tab", { name: ABA }));
    await screen.findByRole("heading", { level: 2, name: "Situação" });
    expect(api.chamadasAoToken()).toEqual([
      { metodo: "GET", caminho: ROTA_TOKEN, corpo: undefined },
    ]);
  });
});

describe("CA2: a situação", () => {
  it("token gerado no site: desde quando e o último uso", async () => {
    await abrirAba(criarApiWebhook(CENARIOS.tela));

    expect(dado("Credencial que vale")).toBe("Token gerado no site");
    expect(dado("Gerado em")).toBe("12/11/2026 10:00");
    expect(dado("Último uso")).toBe("12/11/2026 10:05");
    expect(painel()).toHaveTextContent("Vale o token gerado neste site.");
    expect(within(painel()).getByLabelText("URL do webhook")).toHaveValue(
      URL_WEBHOOK,
    );
  });

  it("token gerado no site ainda sem uso, com o segredo do Worker também gravado", async () => {
    await abrirAba(
      criarApiWebhook({
        ...CENARIOS.tela,
        segredo: true,
        ultimaEntregaEm: null,
      }),
    );

    expect(dado("Último uso")).toBe("ainda não usado");
    expect(painel()).toHaveTextContent(
      "A Rifei ainda não mandou nenhuma venda com ele",
    );
    expect(painel()).toHaveTextContent(
      "O segredo do Worker também existe, mas não vale enquanto houver um token gerado aqui.",
    );
  });

  it("segredo do Worker: sem data de geração, com o último uso", async () => {
    await abrirAba(criarApiWebhook(CENARIOS.segredo));

    expect(dado("Credencial que vale")).toBe("Segredo do Worker");
    expect(dado("Desde")).toBe("sem registro (gravado pelo terminal)");
    expect(dado("Último uso")).toBe("11/11/2026 19:30");
    expect(painel()).toHaveTextContent(
      "Gerar um token aqui faz o segredo parar de valer.",
    );
    expect(
      within(painel()).queryByText("Gerado em", { selector: "dt" }),
    ).not.toBeInTheDocument();
  });

  it("nenhuma credencial: o aviso de que as vendas não chegam", async () => {
    await abrirAba(criarApiWebhook(CENARIOS.nenhum));

    expect(dado("Credencial que vale")).toBe("Nenhuma");
    expect(
      within(painel()).queryByText("Último uso", { selector: "dt" }),
    ).not.toBeInTheDocument();
    expect(painel()).toHaveTextContent(
      "A Rifei não consegue entregar as vendas",
    );
    expect(within(painel()).getByLabelText("URL do webhook")).toHaveValue(
      URL_WEBHOOK,
    );
  });

  it("falha ao carregar: o erro com 'Tentar de novo', que carrega", async () => {
    const api = criarApiWebhook(CENARIOS.tela);
    api.proxima("GET", new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", api.fetch);
    renderizarRota(CAMINHO, { usuario: ADMIN_DE_TESTE });
    await screen.findByRole("heading", { level: 2, name: "Admin de Teste" });
    acionar(screen.getByRole("tab", { name: ABA }));

    const alerta = await within(painel()).findByRole("alert");
    expect(alerta).toHaveTextContent(
      "Não foi possível carregar o token do webhook.",
    );
    fireEvent.click(
      within(alerta).getByRole("button", { name: "Tentar de novo" }),
    );
    expect(
      await within(painel()).findByRole("heading", { name: "Situação" }),
    ).toBeInTheDocument();
    expect(dado("Credencial que vale")).toBe("Token gerado no site");
  });
});

describe("CA3: a geração direta mostra o token uma vez", () => {
  it("sem credencial vigente, gera direto: o token com 'Copiar', o passo a passo da Rifei e a situação nova", async () => {
    const { api } = await abrirAba(criarApiWebhook(CENARIOS.nenhum));
    const copiar = simularAreaDeTransferencia(async () => {});

    const { campo, token } = await gerarDireto(api);

    expect(api.chamadasAoToken("POST")).toEqual([
      { metodo: "POST", caminho: ROTA_TOKEN, corpo: {} },
    ]);
    expect(campo).toHaveValue(token);
    expect(campo).toHaveAttribute("readonly");
    expect(painel()).toHaveTextContent("Este token só aparece agora.");
    const passos = within(painel()).getByRole("heading", {
      level: 3,
      name: "Como colar na Rifei",
    }).parentElement;
    expect(passos).toHaveTextContent("Integrações");
    expect(passos).toHaveTextContent("Outro");
    expect(passos).toHaveTextContent("Adicionar");
    expect(passos).toHaveTextContent(
      "Novo pedido, Pedido pago e Pedido expirado",
    );
    expect(dado("Credencial que vale")).toBe("Token gerado no site");
    expect(dado("Gerado em")).toBe("12/11/2026 10:00");
    expect(dado("Último uso")).toBe("ainda não usado");

    fireEvent.click(
      within(painel()).getByRole("button", { name: "Copiar token" }),
    );
    await waitFor(() => expect(copiar).toHaveBeenCalledWith(token));
    // O anúncio vem de um estado mudado depois da área de transferência responder: espera (docs/frontend.md).
    await waitFor(() =>
      expect(anuncio()).toBe(
        "Token copiado. Cole no campo Token do webhook na Rifei.",
      ),
    );

    fireEvent.click(
      within(painel()).getByRole("button", { name: "Copiar URL" }),
    );
    await waitFor(() => expect(copiar).toHaveBeenLastCalledWith(URL_WEBHOOK));
    await waitFor(() =>
      expect(anuncio()).toBe(
        "URL copiada. Cole no campo URL do webhook na Rifei.",
      ),
    );
  });

  it("sem a área de transferência, o token fica selecionado no campo, com o aviso", async () => {
    const { api } = await abrirAba(criarApiWebhook(CENARIOS.nenhum));
    simularAreaDeTransferencia(async () => {
      throw new Error("sem permissão");
    });
    const { campo, token } = await gerarDireto(api);
    // O foco está em "Copiar token" (gerarDireto esperou o efeito): o do campo só pode vir da cópia que falhou.
    expect(campo).not.toHaveFocus();

    fireEvent.click(
      within(painel()).getByRole("button", { name: "Copiar token" }),
    );

    await waitFor(() => expect(campo).toHaveFocus());
    const selecionado = campo as HTMLTextAreaElement;
    expect(
      selecionado.value.slice(
        selecionado.selectionStart,
        selecionado.selectionEnd,
      ),
    ).toBe(token);
    await waitFor(() =>
      expect(anuncio()).toMatch(/o token ficou selecionado no campo/),
    );
  });

  it("nada vai para o storage, a URL, o histórico, o título ou o log; ao sair e voltar, o token não está mais lá", async () => {
    const gravacoes = [
      vi.spyOn(Storage.prototype, "setItem"),
      vi.spyOn(window.history, "pushState"),
      vi.spyOn(window.history, "replaceState"),
    ];
    const logs = (["log", "info", "warn", "error", "debug"] as const).map(
      (nivel) => vi.spyOn(console, nivel),
    );
    const { api, roteador } = await abrirAba(criarApiWebhook(CENARIOS.nenhum));
    const { token } = await gerarDireto(api);
    expect(document.body).toHaveTextContent(token);

    for (const espiao of [...gravacoes, ...logs])
      for (const argumentos of espiao.mock.calls)
        expect(JSON.stringify(argumentos)).not.toContain(token);
    expect(conteudoDe(localStorage)).not.toContain(token);
    expect(conteudoDe(sessionStorage)).not.toContain(token);
    expect(JSON.stringify(roteador.state.location)).not.toContain(token);
    expect(window.location.href).not.toContain(token);
    expect(document.title).not.toContain(token);
    expect(document.cookie).not.toContain(token);

    // Sai da tela (vai para a Trilha) e volta: o token não volta; a situação, sim.
    await act(() => roteador.navigate("/coordenacao/trilha"));
    expect(document.body).not.toHaveTextContent(token);
    await act(() => roteador.navigate(CAMINHO));
    await screen.findByRole("heading", { level: 2, name: "Admin de Teste" });
    acionar(screen.getByRole("tab", { name: ABA }));
    await screen.findByRole("heading", { level: 2, name: "Situação" });

    expect(dado("Credencial que vale")).toBe("Token gerado no site");
    expect(dado("Último uso")).toBe("ainda não usado");
    expect(
      within(painel()).queryByLabelText("Token do webhook"),
    ).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(token);
    expect(conteudoDe(localStorage)).not.toContain(token);
    expect(conteudoDe(sessionStorage)).not.toContain(token);
  });

  it("ao recarregar a página, o token não volta (o GET nunca o traz)", async () => {
    const { api, unmount } = await abrirAba(criarApiWebhook(CENARIOS.nenhum));
    const { token } = await gerarDireto(api);
    unmount();

    renderizarRota(CAMINHO, { usuario: ADMIN_DE_TESTE });
    await screen.findByRole("heading", { level: 2, name: "Admin de Teste" });
    acionar(screen.getByRole("tab", { name: ABA }));
    await screen.findByRole("heading", { level: 2, name: "Situação" });

    expect(dado("Credencial que vale")).toBe("Token gerado no site");
    expect(document.body.innerHTML).not.toContain(token);
    expect(
      within(painel()).getByRole("button", { name: "Gerar token do webhook" }),
    ).toBeInTheDocument();
  });

  it("falha ao gerar: o aviso com a mensagem da API, sem token e com o botão de volta", async () => {
    const { api } = await abrirAba(criarApiWebhook(CENARIOS.nenhum));
    api.proxima("POST", respostaErro(500, "erro_interno", "Erro interno."));

    acionar(botaoGerar());

    const alerta = await within(painel()).findByRole("alert");
    expect(alerta).toHaveTextContent("Não foi possível gerar o token");
    expect(alerta).toHaveTextContent("Erro interno.");
    expect(
      within(painel()).queryByLabelText("Token do webhook"),
    ).not.toBeInTheDocument();
    expect(botaoGerar()).toHaveTextContent("Gerar token do webhook");
    expect(botaoGerar()).not.toHaveAttribute("aria-disabled");
    expect(api.tokens).toEqual([]);
  });
});

describe("CA4: com credencial vigente, a confirmação e depois substituir: true", () => {
  it.each([
    [
      "tela",
      CENARIOS.tela,
      "Gerar um token novo?",
      "O token atual para de valer na hora.",
    ],
    [
      "segredo",
      CENARIOS.segredo,
      "Trocar o segredo do Worker por um token do site?",
      "O segredo do Worker para de valer na hora.",
    ],
  ])(
    "vigente %s: pede a confirmação antes de qualquer POST; confirmar manda substituir: true",
    async (_, cenario, titulo, descricao) => {
      const { api } = await abrirAba(criarApiWebhook(cenario));

      acionar(botaoGerar());

      const confirmacao = screen.getByRole("alertdialog", { name: titulo });
      expect(confirmacao).toHaveAccessibleDescription(descricao);
      expect(confirmacao).toHaveTextContent(
        "As vendas param de chegar ao sistema até você colar o token novo na Rifei",
      );
      expect(api.chamadasAoToken("POST")).toEqual([]);

      fireEvent.click(
        within(confirmacao).getByRole("button", { name: "Gerar token novo" }),
      );

      const campo = await within(painel()).findByLabelText("Token do webhook");
      expect(api.chamadasAoToken("POST")).toEqual([
        { metodo: "POST", caminho: ROTA_TOKEN, corpo: { substituir: true } },
      ]);
      expect(campo).toHaveValue(api.tokens[0]);
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(dado("Credencial que vale")).toBe("Token gerado no site");
    },
  );

  it("o 409 em_uso (outra aba gerou no meio): recarrega a situação, pede a confirmação e repete com substituir: true", async () => {
    const { api } = await abrirAba(criarApiWebhook(CENARIOS.nenhum));
    expect(dado("Credencial que vale")).toBe("Nenhuma");
    // Outra aba gera um token depois que esta carregou.
    api.credenciais.geradoEm = "2026-11-12T13:30:00.000Z";

    acionar(botaoGerar());

    const confirmacao = await screen.findByRole("alertdialog", {
      name: "Gerar um token novo?",
    });
    expect(confirmacao).toHaveTextContent(
      "As vendas param de chegar ao sistema até você colar o token novo na Rifei",
    );
    await waitFor(() => expect(dado("Gerado em")).toBe("12/11/2026 10:30"));
    expect(api.tokens).toEqual([]);

    fireEvent.click(
      within(confirmacao).getByRole("button", { name: "Gerar token novo" }),
    );

    const campo = await within(painel()).findByLabelText("Token do webhook");
    expect(campo).toHaveValue(api.tokens[0]);
    expect(api.chamadasAoToken()).toEqual([
      { metodo: "GET", caminho: ROTA_TOKEN, corpo: undefined },
      { metodo: "POST", caminho: ROTA_TOKEN, corpo: {} },
      { metodo: "GET", caminho: ROTA_TOKEN, corpo: undefined },
      { metodo: "POST", caminho: ROTA_TOKEN, corpo: { substituir: true } },
    ]);
  });

  it("a situação de um GET que saiu antes da geração não troca a situação nova pela velha", async () => {
    const { api } = await abrirAba(criarApiWebhook(CENARIOS.nenhum));
    api.credenciais.geradoEm = "2026-11-12T13:30:00.000Z";
    const liberarGet = api.segurar("GET");

    acionar(botaoGerar());
    const confirmacao = await screen.findByRole("alertdialog");
    await waitFor(() => expect(api.chamadasAoToken("GET")).toHaveLength(2));
    fireEvent.click(
      within(confirmacao).getByRole("button", { name: "Gerar token novo" }),
    );
    await within(painel()).findByLabelText("Token do webhook");
    expect(dado("Gerado em")).toBe("12/11/2026 10:31");

    liberarGet();
    await act(async () => {});

    expect(dado("Gerado em")).toBe("12/11/2026 10:31");
    expect(dado("Último uso")).toBe("ainda não usado");
  });

  it("cancelar não gera: nenhum POST, o diálogo fecha e o foco volta ao botão", async () => {
    const { api } = await abrirAba(criarApiWebhook(CENARIOS.tela));
    const botao = botaoGerar();

    acionar(botao);
    const confirmacao = screen.getByRole("alertdialog");
    await waitFor(() =>
      expect(
        within(confirmacao).getByRole("button", { name: "Cancelar" }),
      ).toHaveFocus(),
    );
    fireEvent.click(
      within(confirmacao).getByRole("button", { name: "Cancelar" }),
    );

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() => expect(botao).toHaveFocus());

    // Esc também cancela.
    acionar(botao);
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    expect(api.chamadasAoToken("POST")).toEqual([]);
    expect(api.tokens).toEqual([]);
    expect(
      within(painel()).queryByLabelText("Token do webhook"),
    ).not.toBeInTheDocument();
  });

  it("depois de cancelar a troca, o token mostrado antes continua (ele continua valendo)", async () => {
    const { api } = await abrirAba(criarApiWebhook(CENARIOS.nenhum));
    const { token } = await gerarDireto(api);

    acionar(botaoGerar());
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Cancelar",
      }),
    );

    expect(within(painel()).getByLabelText("Token do webhook")).toHaveValue(
      token,
    );
    expect(api.tokens).toEqual([token]);
  });

  it("gerar de novo troca o token mostrado pelo novo", async () => {
    const { api } = await abrirAba(criarApiWebhook(CENARIOS.nenhum));
    const { token: primeiro } = await gerarDireto(api);

    acionar(botaoGerar());
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Gerar token novo",
      }),
    );

    await waitFor(() => expect(api.tokens).toHaveLength(2));
    const campo = within(painel()).getByLabelText("Token do webhook");
    await waitFor(() => expect(campo).toHaveValue(api.tokens[1]));
    expect(document.body.innerHTML).not.toContain(primeiro);
    expect(dado("Gerado em")).toBe("12/11/2026 10:01");
  });
});

describe("CA5: um POST por vez", () => {
  it("duplo clique no botão: um POST só; o botão fica indisponível (e focado) enquanto gera", async () => {
    const { api } = await abrirAba(criarApiWebhook(CENARIOS.nenhum));
    const liberar = api.segurar("POST");
    const botao = botaoGerar();

    acionar(botao);
    fireEvent.click(botao);
    fireEvent.click(botao);

    await waitFor(() => expect(botao).toHaveAttribute("aria-disabled", "true"));
    expect(botao).toHaveTextContent("Gerando…");
    expect(botao).toHaveFocus();
    expect(api.chamadasAoToken("POST")).toHaveLength(1);

    fireEvent.click(botao);
    liberar();

    await within(painel()).findByLabelText("Token do webhook");
    expect(api.chamadasAoToken("POST")).toHaveLength(1);
    expect(api.tokens).toHaveLength(1);
    expect(botaoGerar()).not.toHaveAttribute("aria-disabled");
  });

  it("duplo clique na confirmação: um POST com substituir só; a confirmação fica indisponível enquanto gera", async () => {
    const { api } = await abrirAba(criarApiWebhook(CENARIOS.tela));
    const liberar = api.segurar("POST");

    acionar(botaoGerar());
    const confirmacao = screen.getByRole("alertdialog");
    const confirmar = within(confirmacao).getByRole("button", {
      name: "Gerar token novo",
    });
    acionar(confirmar);
    fireEvent.click(confirmar);

    await waitFor(() =>
      expect(confirmar).toHaveAttribute("aria-disabled", "true"),
    );
    expect(confirmar).toHaveTextContent("Gerando…");
    const cancelar = within(confirmacao).getByRole("button", {
      name: "Cancelar",
    });
    expect(cancelar).toHaveAttribute("aria-disabled", "true");
    // Nem o Cancelar, nem o Esc, nem outro toque mexem no que está em andamento.
    fireEvent.click(cancelar);
    fireEvent.keyDown(confirmacao, { key: "Escape" });
    fireEvent.click(confirmar);
    expect(screen.getByRole("alertdialog")).toBe(confirmacao);
    expect(api.chamadasAoToken("POST")).toHaveLength(1);

    liberar();

    await within(painel()).findByLabelText("Token do webhook");
    expect(api.chamadasAoToken("POST")).toEqual([
      { metodo: "POST", caminho: ROTA_TOKEN, corpo: { substituir: true } },
    ]);
    expect(api.tokens).toHaveLength(1);
  });

  it("sair da tela com o POST em andamento: a resposta que chega depois não aparece", async () => {
    const { api, roteador } = await abrirAba(criarApiWebhook(CENARIOS.nenhum));
    const liberar = api.segurar("POST");
    acionar(botaoGerar());
    await waitFor(() => expect(api.chamadasAoToken("POST")).toHaveLength(1));

    await act(() => roteador.navigate("/coordenacao/trilha"));
    liberar();
    // A API gera o token e a resposta chega com a tela já fechada.
    await act(() => new Promise((resolver) => setTimeout(resolver, 30)));
    expect(api.tokens).toHaveLength(1);

    expect(document.body.innerHTML).not.toContain(api.tokens[0]);
    expect(screen.queryByLabelText("Token do webhook")).not.toBeInTheDocument();
  });
});

describe("CA6: acessibilidade", () => {
  it("o foco vai para 'Copiar token', com o aviso como descrição (o token não é lido sozinho), e a região viva anuncia que ele só aparece agora, sem o token", async () => {
    const { api } = await abrirAba(criarApiWebhook(CENARIOS.nenhum));
    const regiao = within(painel())
      .getAllByRole("status")
      .find((elemento) => elemento.classList.contains("visualmente-oculto"));
    expect(regiao).toBeDefined();
    expect(regiao).toBeEmptyDOMElement();

    const { campo, token } = await gerarDireto(api);

    const copiar = within(painel()).getByRole("button", {
      name: "Copiar token",
    });
    await waitFor(() => expect(copiar).toHaveFocus());
    expect(campo).not.toHaveFocus();
    expect(copiar).toHaveAccessibleDescription(
      /^Este token só aparece agora\..*Copie e cole na Rifei antes de sair desta tela/,
    );
    expect(copiar.getAttribute("aria-describedby")).toBeTruthy();
    expect(regiao).toHaveTextContent(
      "Token do webhook gerado. Ele só aparece agora: copie e cole na Rifei.",
    );
    expect(regiao?.textContent).not.toContain(token);
  });

  it("o foco vai para 'Copiar token' também depois da confirmação (a descrição dá o aviso: a região viva muda ainda sob o inert do diálogo)", async () => {
    const { api } = await abrirAba(criarApiWebhook(CENARIOS.segredo));
    acionar(botaoGerar());
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Gerar token novo",
      }),
    );

    const campo = await within(painel()).findByLabelText("Token do webhook");
    const copiar = within(painel()).getByRole("button", {
      name: "Copiar token",
    });
    await waitFor(() => expect(copiar).toHaveFocus());
    expect(copiar).toHaveAccessibleDescription(
      /^Este token só aparece agora\./,
    );
    expect(campo).toHaveValue(api.tokens[0]);
  });

  it("rótulos: campos com rótulo e dica, botões com nome, a aba no padrão das abas e a confirmação como alertdialog", async () => {
    const { api } = await abrirAba(criarApiWebhook(CENARIOS.nenhum));

    expect(screen.getByRole("tab", { name: ABA })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const url = within(painel()).getByLabelText("URL do webhook");
    expect(url).toHaveAccessibleDescription(
      "Vai no campo URL do webhook na Rifei.",
    );
    expect(url).toHaveAttribute("readonly");
    expect(
      within(painel()).getByRole("button", { name: "Copiar URL" }),
    ).toBeInTheDocument();

    const { campo } = await gerarDireto(api);
    expect(campo).toHaveAccessibleDescription(
      "Vai no campo Token do webhook na Rifei.",
    );
    expect(campo).toHaveAttribute("spellcheck", "false");
    // Sem autocomplete, o navegador não guarda o valor no estado da página que restaura a aba (sessão em disco);
    // sem tradução, o token não vai para o serviço de tradução do navegador.
    expect(campo).toHaveAttribute("autocomplete", "off");
    expect(campo).toHaveAttribute("translate", "no");
    expect(
      within(painel()).getByRole("button", { name: "Copiar token" }),
    ).toBeInTheDocument();

    acionar(botaoGerar());
    const confirmacao = screen.getByRole("alertdialog", {
      name: "Gerar um token novo?",
    });
    expect(confirmacao).toHaveAttribute("aria-modal", "true");
  });
});
