// CA5: /coordenacao/acessos (só admin), pela rota de verdade e com a API falsa (teste-apoio.ts), que segue
// as regras da API: o link com o token só sai na criação, a lista nunca o traz e os 409 `em_uso`.
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ADMIN_DE_TESTE, renderizarRota } from "../../test/renderizar";
import { MENSAGENS_EM_USO, mensagemWhatsApp } from "./textos";
import { criarApiFalsa, respostaErro, type ApiFalsa } from "./teste-apoio";

const CAMINHO = "/coordenacao/acessos";

async function abrirTela(api: ApiFalsa = criarApiFalsa()) {
  vi.stubGlobal("fetch", api.fetch);
  const tela = renderizarRota(CAMINHO, { usuario: ADMIN_DE_TESTE });
  await screen.findByRole("heading", { level: 2, name: "Admin de Teste" });
  return { api, ...tela };
}

/** Cartão da pessoa (o Card com o título dela). */
function cartao(nome: string): HTMLElement {
  const elemento = screen
    .getByRole("heading", { level: 2, name: nome })
    .closest<HTMLElement>(".ui-card");
  if (!elemento) throw new Error(`sem cartão para ${nome}`);
  return elemento;
}

/** Valor de um dado do cartão ("Links válidos" → "1"). */
function dado(nome: string, rotulo: string) {
  return within(cartao(nome)).getByText(rotulo, { selector: "dt" })
    .nextElementSibling?.textContent;
}

/** Foca e clica, como o toque e o Enter fazem no navegador (o jsdom não foca no clique). */
function acionar(elemento: HTMLElement) {
  act(() => elemento.focus());
  fireEvent.click(elemento);
}

function digitar(dialogo: HTMLElement, rotulo: string, valor: string) {
  fireEvent.change(within(dialogo).getByLabelText(rotulo), {
    target: { value: valor },
  });
}

/** A região viva fixa da tela (anuncia o resultado de cada ação). */
const anuncio = () =>
  screen
    .getAllByRole("status")
    .find((elemento) => elemento.classList.contains("visualmente-oculto"));

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

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("CA5: só admin", () => {
  it("a coordenação que abre /coordenacao/acessos vê 'sem permissão', e nada é pedido à API", () => {
    const api = criarApiFalsa();
    vi.stubGlobal("fetch", api.fetch);
    renderizarRota(CAMINHO);

    expect(
      screen.getByRole("heading", { level: 1, name: "Acessos" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sem permissão para esta tela",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Esta tela é só para quem tem o papel Admin.",
    );
    expect(
      screen.queryByRole("button", { name: "Nova pessoa" }),
    ).not.toBeInTheDocument();
    expect(api.chamadas).toEqual([]);
  });
});

describe("CA5: lista de pessoas", () => {
  it("mostra nome, papel, situação, links válidos e aparelhos de cada pessoa (sem nenhum token)", async () => {
    const { api } = await abrirTela();

    expect(
      screen
        .getAllByRole("heading", { level: 2 })
        .map((titulo) => titulo.textContent),
    ).toEqual(["Admin de Teste", "Felipe Coordenador", "Pastor Fictício"]);
    expect(document.title).toBe("Acessos · Rifa Videira Kids");

    const admin = cartao("Admin de Teste");
    expect(within(admin).getByText("Admin")).toBeInTheDocument();
    expect(within(admin).getByText("Ativo")).toBeInTheDocument();
    expect(within(admin).getByText("Você")).toBeInTheDocument();
    expect(dado("Admin de Teste", "Links válidos")).toBe("1");
    expect(dado("Admin de Teste", "Aparelhos conectados")).toBe("1");
    expect(admin).toHaveTextContent(
      "Criado em 10/11/2026 19:00, vale até 25/12/2026.",
    );
    expect(admin).toHaveTextContent("Último uso em 10/11/2026 19:05.");

    const felipe = cartao("Felipe Coordenador");
    expect(within(felipe).getByText("Coordenação")).toBeInTheDocument();
    expect(within(felipe).queryByText("Você")).not.toBeInTheDocument();
    expect(dado("Felipe Coordenador", "E-mail")).toBe("felipe@example.com");
    expect(dado("Felipe Coordenador", "Links válidos")).toBe("1");
    expect(dado("Felipe Coordenador", "Aparelhos conectados")).toBe("2");
    expect(felipe).toHaveTextContent("1 link revogado ou vencido.");
    expect(felipe).toHaveTextContent("Ainda não usado.");

    const pastor = cartao("Pastor Fictício");
    expect(within(pastor).getByText("Desativado")).toBeInTheDocument();
    expect(pastor).toHaveTextContent(
      "Acesso desativado: os links não abrem sessão.",
    );
    expect(
      within(pastor).getByRole("button", {
        name: "Reativar acesso de Pastor Fictício",
      }),
    ).toBeInTheDocument();
    expect(
      within(pastor).queryByRole("button", { name: /Gerar link novo/ }),
    ).not.toBeInTheDocument();

    expect(document.body.innerHTML).not.toContain("/acesso/");
    // A lista e as regras da campanha (D20: os modelos das mensagens e o acesso de cada papel).
    expect(api.chamadas).toEqual([
      { metodo: "GET", caminho: "/api/admin/usuarios", corpo: undefined },
      { metodo: "GET", caminho: "/api/admin/campanha", corpo: undefined },
    ]);
  });

  it("falha ao carregar: mostra o erro e 'Tentar de novo' carrega", async () => {
    const api = criarApiFalsa();
    api.proxima("GET", "/api/admin/usuarios", () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", api.fetch);
    renderizarRota(CAMINHO, { usuario: ADMIN_DE_TESTE });

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Não foi possível carregar as pessoas.");
    fireEvent.click(
      within(alerta).getByRole("button", { name: "Tentar de novo" }),
    );

    expect(
      await screen.findByRole("heading", { level: 2, name: "Admin de Teste" }),
    ).toBeInTheDocument();
  });
});

describe("CA5: nova pessoa e o link mostrado uma vez", () => {
  function abrirNovaPessoa() {
    acionar(screen.getByRole("button", { name: "Nova pessoa" }));
    return screen.getByRole("dialog", { name: "Nova pessoa" });
  }

  it("confere no navegador: nome obrigatório e e-mail válido, sem chamar a API", async () => {
    const { api } = await abrirTela();
    const dialogo = abrirNovaPessoa();
    const criar = within(dialogo).getByRole("button", {
      name: "Criar e gerar link",
    });

    fireEvent.click(criar);
    expect(within(dialogo).getByText("Informe o nome.")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(dialogo).getByLabelText("Nome")).toHaveFocus(),
    );
    expect(within(dialogo).getByLabelText("Nome")).toHaveAttribute(
      "aria-invalid",
      "true",
    );

    digitar(dialogo, "Nome", "Felipe Novo");
    digitar(dialogo, "E-mail (opcional)", "felipe@");
    fireEvent.click(criar);
    expect(
      within(dialogo).getByText("E-mail inválido. Confira ou deixe em branco."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(within(dialogo).getByLabelText("E-mail (opcional)")).toHaveFocus(),
    );

    expect(api.chamadasA("POST", "/api/admin/usuarios")).toEqual([]);
  });

  it("cria a pessoa e mostra o link UMA vez (alerta, Copiar link, Enviar pelo WhatsApp); ao fechar, o link some", async () => {
    const { api } = await abrirTela();
    const escrever = simularAreaDeTransferencia(async () => {});
    const dialogo = abrirNovaPessoa();
    expect(within(dialogo).getByLabelText("Papel")).toHaveValue("coordenacao");

    digitar(dialogo, "Nome", "  Fábio Fictício ");
    fireEvent.change(within(dialogo).getByLabelText("Papel"), {
      target: { value: "admin" },
    });
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Criar e gerar link" }),
    );

    const comLink = await screen.findByRole("dialog", {
      name: "Link de acesso de Fábio Fictício",
    });
    expect(api.chamadasA("POST", "/api/admin/usuarios")).toEqual([
      {
        metodo: "POST",
        caminho: "/api/admin/usuarios",
        corpo: { nome: "Fábio Fictício", email: null, papel: "admin" },
      },
    ]);
    const [url] = api.urlsEmitidas;
    expect(url).toMatch(/\/acesso\/[A-Za-z0-9_-]{43}$/);
    expect(comLink).toHaveAccessibleDescription(
      "Este link só aparece agora: copie ou envie antes de fechar.",
    );
    expect(comLink).toHaveTextContent("Este link só aparece agora.");
    expect(within(comLink).getByLabelText("Link de acesso")).toHaveValue(url);
    // O foco chega pelo efeito do diálogo, que pode rodar depois de ele entrar no DOM.
    await waitFor(() =>
      expect(
        within(comLink).getByRole("button", { name: "Copiar link" }),
      ).toHaveFocus(),
    );

    const whatsapp = within(comLink).getByRole("link", {
      name: "Enviar pelo WhatsApp",
    });
    expect(whatsapp).toHaveAttribute(
      "href",
      `https://wa.me/?text=${encodeURIComponent(mensagemWhatsApp("Fábio Fictício", url))}`,
    );
    expect(mensagemWhatsApp("Fábio Fictício", url)).toBe(
      `Olá, Fábio! Este é o seu link pessoal para entrar no sistema da Rifa Videira Kids. Ele é só seu, não repasse:\n${url}`,
    );
    expect(whatsapp).toHaveAttribute("target", "_blank");
    expect(whatsapp).toHaveAttribute("rel", "noopener noreferrer");

    fireEvent.click(
      within(comLink).getByRole("button", { name: "Copiar link" }),
    );
    expect(
      await within(comLink).findByText("Link copiado.", {
        selector: ".acessos-copia",
      }),
    ).toBeVisible();
    expect(within(comLink).getByRole("status")).toHaveTextContent(
      "Link copiado.",
    );
    expect(escrever).toHaveBeenCalledExactlyOnceWith(url);

    fireEvent.click(within(comLink).getByRole("button", { name: "Pronto" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByRole("heading", { level: 2, name: "Fábio Fictício" }),
    ).toBeInTheDocument();
    expect(dado("Fábio Fictício", "Links válidos")).toBe("1");
    // O link não fica em lugar nenhum da tela, e a lista recarregada não o traz.
    expect(document.body.innerHTML).not.toContain(url);
    expect(document.body.innerHTML).not.toContain(url.split("/acesso/")[1]);
    expect(api.chamadasA("GET", "/api/admin/usuarios")).toHaveLength(2);
    expect(anuncio()).toHaveTextContent("Cadastro de Fábio Fictício criado.");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Nova pessoa" })).toHaveFocus(),
    );
  });

  it("sem a área de transferência, o link fica selecionado no campo e a tela explica", async () => {
    await abrirTela();
    simularAreaDeTransferencia(async () => {
      throw new DOMException("negado", "NotAllowedError");
    });
    const dialogo = abrirNovaPessoa();
    digitar(dialogo, "Nome", "Gestor do Bumbo");
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Criar e gerar link" }),
    );
    const comLink = await screen.findByRole("dialog", {
      name: "Link de acesso de Gestor do Bumbo",
    });
    // O diálogo termina de abrir (o foco inicial vai para "Copiar link") antes do toque, como no navegador.
    // Sem esta espera, o efeito do foco inicial pode rodar depois da cópia falhar e tirar o foco do campo.
    const copiar = within(comLink).getByRole("button", { name: "Copiar link" });
    await waitFor(() => expect(copiar).toHaveFocus());

    fireEvent.click(copiar);

    expect(
      await within(comLink).findByText(/Não deu para copiar sozinho/, {
        selector: ".acessos-copia",
      }),
    ).toBeVisible();
    expect(within(comLink).getByRole("status")).toHaveTextContent(
      "o link ficou selecionado no campo acima",
    );
    await waitFor(() =>
      expect(within(comLink).getByLabelText("Link de acesso")).toHaveFocus(),
    );
  });

  it("e-mail recusado pela API (400 com detalhes): marca o campo e explica", async () => {
    const { api } = await abrirTela();
    api.proxima(
      "POST",
      "/api/admin/usuarios",
      respostaErro(400, "requisicao_invalida", "Requisição inválida", [
        { caminho: ["email"], codigo: "invalid_format", mensagem: "x" },
      ]),
    );
    const dialogo = abrirNovaPessoa();
    digitar(dialogo, "Nome", "Pessoa Nova");
    digitar(dialogo, "E-mail (opcional)", "pessoa@exemplo.com");
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Criar e gerar link" }),
    );

    expect(await within(dialogo).findByRole("alert")).toHaveTextContent(
      "A API recusou algum campo. Confira e tente de novo.",
    );
    expect(
      within(dialogo).getByText("Confira o e-mail (ou deixe em branco)."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(within(dialogo).getByLabelText("E-mail (opcional)")).toHaveFocus(),
    );
    expect(api.urlsEmitidas).toEqual([]);
  });
});

describe("CA5: gerar link novo e revogar link", () => {
  it("Gerar link novo: POST /api/admin/usuarios/:id/links e mostra o link novo uma vez", async () => {
    const { api } = await abrirTela();
    const gerar = within(cartao("Felipe Coordenador")).getByRole("button", {
      name: "Gerar link novo para Felipe Coordenador",
    });

    acionar(gerar);

    const comLink = await screen.findByRole("dialog", {
      name: "Link de acesso de Felipe Coordenador",
    });
    expect(api.chamadasA("POST", "/api/admin/usuarios/902/links")).toHaveLength(
      1,
    );
    expect(within(comLink).getByLabelText("Link de acesso")).toHaveValue(
      api.urlsEmitidas[0],
    );
    fireEvent.click(within(comLink).getByRole("button", { name: "Pronto" }));

    await waitFor(() =>
      expect(dado("Felipe Coordenador", "Links válidos")).toBe("2"),
    );
    await waitFor(() => expect(gerar).toHaveFocus());
    expect(document.body.innerHTML).not.toContain(api.urlsEmitidas[0]);
    expect(anuncio()).toHaveTextContent(
      "Link novo de Felipe Coordenador criado.",
    );
  });

  it("Revogar: confirma (alertdialog, foco em Cancelar), DELETE /api/admin/links/:id e a lista atualiza", async () => {
    const { api } = await abrirTela();

    acionar(
      within(cartao("Felipe Coordenador")).getByRole("button", {
        name: "Revogar link de Felipe Coordenador criado em 10/11/2026 20:00",
      }),
    );
    const confirmacao = screen.getByRole("alertdialog", {
      name: "Revogar este link?",
    });
    expect(
      within(confirmacao).getByRole("button", { name: "Cancelar" }),
    ).toHaveFocus();
    fireEvent.click(
      within(confirmacao).getByRole("button", { name: "Revogar link" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(api.chamadasA("DELETE", "/api/admin/links/3")).toHaveLength(1);
    await waitFor(() =>
      expect(dado("Felipe Coordenador", "Links válidos")).toBe("0"),
    );
    expect(cartao("Felipe Coordenador")).toHaveTextContent(
      "2 links revogados ou vencidos.",
    );
    // O botão do link revogado sumiu: o foco vai para "Gerar link novo" da mesma pessoa.
    expect(
      within(cartao("Felipe Coordenador")).getByRole("button", {
        name: "Gerar link novo para Felipe Coordenador",
      }),
    ).toHaveFocus();
    expect(anuncio()).toHaveTextContent("Link de Felipe Coordenador revogado.");
  });

  it("o último link válido de admin não é revogado: 409 em português e nada muda", async () => {
    const { api } = await abrirTela();

    acionar(
      within(cartao("Admin de Teste")).getByRole("button", {
        name: /^Revogar link de Admin de Teste/,
      }),
    );
    const confirmacao = screen.getByRole("alertdialog", {
      name: "Revogar este link?",
    });
    fireEvent.click(
      within(confirmacao).getByRole("button", { name: "Revogar link" }),
    );

    expect(await within(confirmacao).findByRole("alert")).toHaveTextContent(
      MENSAGENS_EM_USO.ultimoLinkAdmin,
    );
    expect(MENSAGENS_EM_USO.ultimoLinkAdmin).toBe(
      "Este é o último link válido de um admin ativo: gere um link novo para um admin antes de revogar este.",
    );
    expect(api.chamadasA("DELETE", "/api/admin/links/1")).toHaveLength(1);
    expect(api.pessoas[0].links[0].situacao).toBe("valido");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});

describe("CA5: desativar e reativar", () => {
  it("com o link novo da pessoa sendo gerado, 'Desativar acesso' fica indisponível e não abre a confirmação (RIFA-014)", async () => {
    const { api } = await abrirTela();
    let responder: ((resposta: Response) => void) | null = null;
    api.proxima(
      "POST",
      "/api/admin/usuarios/902/links",
      () => new Promise<Response>((resolver) => (responder = resolver)),
    );

    acionar(
      within(cartao("Felipe Coordenador")).getByRole("button", {
        name: "Gerar link novo para Felipe Coordenador",
      }),
    );
    await waitFor(() => expect(responder).not.toBeNull());
    const desativar = within(cartao("Felipe Coordenador")).getByRole("button", {
      name: "Desativar acesso de Felipe Coordenador",
    });
    expect(desativar).toHaveAttribute("aria-disabled", "true");

    acionar(desativar);

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(api.chamadasA("PATCH", "/api/admin/usuarios/902")).toEqual([]);

    // Terminada a geração, o botão volta a abrir a confirmação.
    await act(async () =>
      responder?.(respostaErro(500, "erro_interno", "Falha simulada")),
    );
    await waitFor(() => expect(desativar).not.toHaveAttribute("aria-disabled"));
    acionar(desativar);
    expect(
      screen.getByRole("alertdialog", {
        name: "Desativar o acesso de Felipe Coordenador?",
      }),
    ).toBeInTheDocument();
  });

  it("Desativar: confirma e PATCH { ativo: false }; vira 'Desativado'; Reativar faz PATCH { ativo: true }", async () => {
    const { api } = await abrirTela();
    const botao = within(cartao("Felipe Coordenador")).getByRole("button", {
      name: "Desativar acesso de Felipe Coordenador",
    });

    acionar(botao);
    const confirmacao = screen.getByRole("alertdialog", {
      name: "Desativar o acesso de Felipe Coordenador?",
    });
    fireEvent.click(
      within(confirmacao).getByRole("button", { name: "Desativar acesso" }),
    );

    await waitFor(() =>
      expect(
        within(cartao("Felipe Coordenador")).getByText("Desativado"),
      ).toBeInTheDocument(),
    );
    expect(api.chamadasA("PATCH", "/api/admin/usuarios/902")).toEqual([
      {
        metodo: "PATCH",
        caminho: "/api/admin/usuarios/902",
        corpo: { ativo: false },
      },
    ]);
    // O mesmo botão, agora "Reativar", com o foco de volta.
    expect(botao).toHaveAccessibleName("Reativar acesso de Felipe Coordenador");
    await waitFor(() => expect(botao).toHaveFocus());
    expect(anuncio()).toHaveTextContent(
      "Acesso de Felipe Coordenador desativado.",
    );

    fireEvent.click(botao);

    await waitFor(() =>
      expect(
        within(cartao("Felipe Coordenador")).getByText("Ativo"),
      ).toBeInTheDocument(),
    );
    expect(
      api.chamadasA("PATCH", "/api/admin/usuarios/902").map((c) => c.corpo),
    ).toEqual([{ ativo: false }, { ativo: true }]);
    expect(anuncio()).toHaveTextContent(
      "Acesso de Felipe Coordenador reativado.",
    );
  });

  it("no próprio cartão não há 'Desativar acesso' (a API recusaria com 409); nos dos outros, há", async () => {
    const { api } = await abrirTela();

    const meu = cartao("Admin de Teste");
    expect(within(meu).getByText("Você")).toBeInTheDocument();
    expect(
      within(meu).queryByRole("button", { name: /Desativar acesso/ }),
    ).not.toBeInTheDocument();
    expect(
      within(meu).getByRole("button", {
        name: "Gerar link novo para Admin de Teste",
      }),
    ).toBeInTheDocument();
    expect(
      within(cartao("Felipe Coordenador")).getByRole("button", {
        name: "Desativar acesso de Felipe Coordenador",
      }),
    ).toBeInTheDocument();
    expect(api.chamadasA("PATCH", "/api/admin/usuarios/901")).toEqual([]);
  });

  it("desativar outra pessoa e receber 409 (último admin ativo): explica em português", async () => {
    const { api } = await abrirTela();
    api.proxima(
      "PATCH",
      "/api/admin/usuarios/902",
      respostaErro(409, "em_uso", "Este é o último admin ativo"),
    );

    acionar(
      within(cartao("Felipe Coordenador")).getByRole("button", {
        name: "Desativar acesso de Felipe Coordenador",
      }),
    );
    const confirmacao = screen.getByRole("alertdialog", {
      name: "Desativar o acesso de Felipe Coordenador?",
    });
    fireEvent.click(
      within(confirmacao).getByRole("button", { name: "Desativar acesso" }),
    );

    expect(await within(confirmacao).findByRole("alert")).toHaveTextContent(
      "Esta pessoa é o último admin ativo: crie ou reative outro admin antes de desativá-la.",
    );
    expect(api.pessoas[1].ativo).toBe(true);
  });
});
