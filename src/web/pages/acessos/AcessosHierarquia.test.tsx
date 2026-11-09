// CA4 e CA5 (RIFA-014): a aba "Líderes, discipuladores e redes" de /coordenacao/acessos (só admin), pela rota
// de verdade e com a API falsa (teste-apoio.ts), que segue as regras do contrato: o admin gera os links em
// lote, copia a mensagem e abre o WhatsApp de cada um; o link aparece uma vez só, com aviso; "Novo link" e
// "Trocar acesso" (com confirmação) por linha; desativar, reativar e revogar pelas rotas que a tela já tem.
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ADMIN_DE_TESTE, renderizarRota } from "../../test/renderizar";
import { criarApiFalsa, respostaErro, type ApiFalsa } from "./teste-apoio";
import { mensagemHierarquia } from "./textos";

const ROTA_ALVOS = "/api/admin/acessos-hierarquia";
const ROTA_LINKS = "/api/admin/acessos-hierarquia/links";
const ABA = "Líderes, discipuladores e redes";

/** Abre /coordenacao/acessos como admin, troca para a aba da hierarquia e espera a lista dos líderes. */
async function abrirAba(api: ApiFalsa = criarApiFalsa()) {
  vi.stubGlobal("fetch", api.fetch);
  const tela = renderizarRota("/coordenacao/acessos", {
    usuario: ADMIN_DE_TESTE,
  });
  await screen.findByRole("heading", { level: 2, name: "Admin de Teste" });
  acionar(screen.getByRole("tab", { name: ABA }));
  await screen.findByRole("table", { name: "Acessos: Líderes de célula" });
  return { api, ...tela };
}

/** Foca e clica, como o toque e o Enter fazem no navegador (o jsdom não foca no clique). */
function acionar(elemento: HTMLElement) {
  act(() => elemento.focus());
  fireEvent.click(elemento);
}

const tabela = () => screen.getByRole("table");

/** A linha da tabela de um alvo. */
function linha(alvo: string): HTMLElement {
  const linhaDoAlvo = within(tabela())
    .getAllByRole("row")
    .find((item) =>
      within(item).queryAllByRole("cell")[0]?.textContent?.startsWith(alvo),
    );
  if (!linhaDoAlvo) throw new Error(`sem linha para ${alvo}`);
  return linhaDoAlvo;
}

/** O texto de uma coluna da linha (pela posição do cabeçalho com este título). */
function coluna(alvo: string, titulo: string) {
  const indice = within(tabela())
    .getAllByRole("columnheader")
    .findIndex((cabecalho) => cabecalho.textContent === titulo);
  if (indice < 0) throw new Error(`sem a coluna ${titulo}`);
  return within(linha(alvo)).getAllByRole("cell")[indice]?.textContent;
}

/** Os botões de ação da linha, pelo nome acessível. */
function acoes(alvo: string) {
  return within(linha(alvo))
    .queryAllByRole("button")
    .map((botao) => botao.textContent?.replace(/\s+/g, " ").trim());
}

const anuncio = () =>
  screen
    .getAllByRole("status")
    .filter((elemento) => elemento.classList.contains("visualmente-oculto"))
    .map((elemento) => elemento.textContent)
    .join(" | ");

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

describe("CA4: a lista dos alvos", () => {
  it("só carrega ao abrir a aba; mostra alvo, pessoa, telefone, situação e aparelhos de cada líder, sem token", async () => {
    const api = criarApiFalsa();
    vi.stubGlobal("fetch", api.fetch);
    renderizarRota("/coordenacao/acessos", { usuario: ADMIN_DE_TESTE });
    await screen.findByRole("heading", { level: 2, name: "Admin de Teste" });
    expect(api.chamadasA("GET", ROTA_ALVOS)).toEqual([]);

    acionar(screen.getByRole("tab", { name: ABA }));
    await screen.findByRole("table", { name: "Acessos: Líderes de célula" });

    expect(api.chamadasA("GET", ROTA_ALVOS)).toEqual([
      {
        metodo: "GET",
        caminho: ROTA_ALVOS,
        corpo: undefined,
        consulta: "papel=lider",
      },
    ]);
    expect(
      within(tabela())
        .getAllByRole("columnheader")
        .map((titulo) => titulo.textContent),
    ).toEqual([
      "Célula",
      "Pessoa",
      "Telefone",
      "Situação",
      "Aparelhos conectados",
      "Ações",
    ]);
    expect(coluna("Célula Ágape", "Pessoa")).toBe("Maria Fictícia");
    expect(coluna("Célula Ágape", "Telefone")).toBe("(91) 98888-7777");
    expect(coluna("Célula Ágape", "Situação")).toBe("Sem link");
    expect(coluna("Célula Ágape", "Aparelhos conectados")).toBe("0");
    expect(acoes("Célula Ágape")).toEqual(["Novo link para Célula Ágape"]);

    expect(coluna("Célula Betel", "Situação")).toBe(
      "Link válidoÚltimo uso em 11/11/2026 09:00.",
    );
    expect(coluna("Célula Betel", "Aparelhos conectados")).toBe("1");
    expect(acoes("Célula Betel")).toEqual([
      "Novo link para Célula Betel",
      "Trocar acesso de Célula Betel",
      "Revogar link de Célula Betel criado em 10/11/2026 19:00",
      "Desativar acesso de Célula Betel",
    ]);

    expect(coluna("Célula Canaã", "Telefone")).toBe("Sem telefone");
    expect(coluna("Célula Canaã", "Situação")).toBe(
      "Só links revogados ou vencidos",
    );
    expect(acoes("Célula Canaã")).toEqual([
      "Novo link para Célula Canaã",
      "Desativar acesso de Célula Canaã",
    ]);

    expect(coluna("Célula Dorcas", "Situação")).toMatch(/^Desativado/);
    expect(acoes("Célula Dorcas")).toEqual([
      "Reativar acesso de Célula Dorcas",
    ]);

    // A hierarquia trocou o líder da Éfeso depois do último link: a tela sugere trocar o acesso.
    expect(coluna("Célula Éfeso", "Pessoa")).toBe(
      "Rute FictíciaO último link foi para Lia Fictícia: se a pessoa mudou, troque o acesso.",
    );

    // Só Ágape (sem link) e Canaã (só revogados ou vencidos): a desativada fica de fora.
    expect(
      screen.getByRole("button", {
        name: "Gerar links para quem ainda não tem (2)",
      }),
    ).not.toHaveAttribute("aria-disabled");
    expect(document.body.innerHTML).not.toContain("/acesso/");
  });

  it("a escolha do papel troca a lista (discipuladores e redes, sem a coluna de telefone)", async () => {
    const { api } = await abrirAba();

    fireEvent.change(screen.getByLabelText("Papel"), {
      target: { value: "discipulador" },
    });
    await screen.findByRole("table", { name: "Acessos: Discipuladores" });
    expect(api.chamadasA("GET", ROTA_ALVOS).at(-1)?.consulta).toBe(
      "papel=discipulador",
    );
    expect(
      within(tabela())
        .getAllByRole("columnheader")
        .map((titulo) => titulo.textContent),
    ).toEqual([
      "Discipulador",
      "Pessoa",
      "Situação",
      "Aparelhos conectados",
      "Ações",
    ]);
    expect(coluna("Davi Fictício", "Situação")).toBe("Sem link");
    expect(
      screen.getByRole("button", {
        name: "Gerar links para quem ainda não tem (1)",
      }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Papel"), {
      target: { value: "rede" },
    });
    await screen.findByRole("table", { name: "Acessos: Redes" });
    expect(coluna("Rede Adulta Fictícia", "Pessoa")).toBe(
      "Sem responsável na hierarquia",
    );
  });
});

describe("CA4: gerar em lote, copiar e abrir o WhatsApp; o link aparece uma vez só", () => {
  it("gera para quem ainda não tem, lista cada link com 'Copiar mensagem' e 'Abrir no WhatsApp', e esquece tudo ao fechar", async () => {
    const { api } = await abrirAba();
    const escrever = simularAreaDeTransferencia(async () => {});
    const lote = screen.getByRole("button", {
      name: "Gerar links para quem ainda não tem (2)",
    });

    acionar(lote);

    const dialogo = await screen.findByRole("dialog", {
      name: "2 links de acesso gerados",
    });
    expect(
      api.chamadasA("POST", ROTA_LINKS).map((chamada) => chamada.corpo),
    ).toEqual([{ papel: "lider", ids: [1, 3], revogar_anteriores: false }]);
    expect(dialogo).toHaveAccessibleDescription(
      "Estes links só aparecem agora: mande cada um antes de fechar.",
    );
    expect(dialogo).toHaveTextContent("Estes links só aparecem agora.");
    const [urlAgape, urlCanaa] = api.urlsEmitidas;
    expect(urlAgape).toMatch(/\/acesso\/[A-Za-z0-9_-]{43}$/);

    const itens = within(dialogo).getAllByRole("listitem");
    expect(
      itens.map((item) => within(item).getByRole("heading").textContent),
    ).toEqual(["Célula Ágape", "Célula Canaã"]);
    // Ágape: o WhatsApp abre na conversa do líder (telefone normalizado), com a mensagem pronta.
    const mensagemAgape = mensagemHierarquia({
      alvo: { tipo: "celula", nome: "Célula Ágape" },
      pessoaNome: "Maria Fictícia",
      url: urlAgape,
    });
    expect(itens[0]).toHaveTextContent("Para Maria Fictícia · (91) 98888-7777");
    const whatsapp = within(itens[0]).getByRole("link", {
      name: "Abrir no WhatsApp de Maria Fictícia",
    });
    expect(whatsapp).toHaveAttribute(
      "href",
      `https://wa.me/5591988887777?text=${encodeURIComponent(mensagemAgape)}`,
    );
    expect(whatsapp).toHaveAttribute("target", "_blank");
    expect(whatsapp).toHaveAttribute("rel", "noopener noreferrer");
    // Canaã: sem telefone na hierarquia, só copiar.
    expect(within(itens[1]).queryByRole("link")).not.toBeInTheDocument();
    expect(itens[1]).toHaveTextContent(
      "Sem telefone na hierarquia: copie a mensagem e mande por fora.",
    );

    // O foco entra no primeiro "Copiar mensagem".
    const copiarAgape = within(itens[0]).getByRole("button", {
      name: "Copiar mensagem para Maria Fictícia",
    });
    await waitFor(() => expect(copiarAgape).toHaveFocus());
    fireEvent.click(copiarAgape);
    expect(
      await within(itens[0]).findByText("Mensagem copiada.", {
        selector: ".acessos-copia",
      }),
    ).toBeVisible();
    expect(escrever).toHaveBeenCalledExactlyOnceWith(mensagemAgape);
    expect(within(dialogo).getByRole("status")).toHaveTextContent(
      "Mensagem para Maria Fictícia copiada.",
    );
    fireEvent.click(
      within(itens[1]).getByRole("button", {
        name: "Copiar mensagem para Ana Fictícia",
      }),
    );
    await waitFor(() => expect(escrever).toHaveBeenCalledTimes(2));
    expect(escrever).toHaveBeenLastCalledWith(
      mensagemHierarquia({
        alvo: { tipo: "celula", nome: "Célula Canaã" },
        pessoaNome: "Ana Fictícia",
        url: urlCanaa,
      }),
    );

    fireEvent.click(within(dialogo).getByRole("button", { name: "Pronto" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    // Os links não ficam em lugar nenhum, e a lista recarregada não os traz.
    for (const url of api.urlsEmitidas) {
      expect(document.body.innerHTML).not.toContain(url);
      expect(document.body.innerHTML).not.toContain(url.split("/acesso/")[1]);
    }
    await waitFor(() =>
      expect(coluna("Célula Ágape", "Situação")).toBe(
        "Link válidoAinda não usado.",
      ),
    );
    expect(coluna("Célula Canaã", "Situação")).toBe(
      "Link válidoAinda não usado.",
    );
    // Nada mais a gerar: o botão continua focável (aria-disabled) e recebe o foco de volta.
    const loteDepois = screen.getByRole("button", {
      name: "Gerar links para quem ainda não tem (0)",
    });
    expect(loteDepois).toHaveAttribute("aria-disabled", "true");
    await waitFor(() => expect(loteDepois).toHaveFocus());
    expect(anuncio()).toContain("2 links gerados.");

    // Sem nada a gerar, o toque não chama a API.
    fireEvent.click(loteDepois);
    expect(api.chamadasA("POST", ROTA_LINKS)).toHaveLength(1);
  });

  it("sem a área de transferência: a mensagem aparece selecionada no campo, para copiar pelo menu", async () => {
    await abrirAba();
    simularAreaDeTransferencia(async () => {
      throw new DOMException("negado", "NotAllowedError");
    });
    acionar(
      screen.getByRole("button", {
        name: "Gerar links para quem ainda não tem (2)",
      }),
    );
    const dialogo = await screen.findByRole("dialog");
    const [primeiro] = within(dialogo).getAllByRole("listitem");

    fireEvent.click(
      within(primeiro).getByRole("button", { name: /^Copiar mensagem/ }),
    );

    expect(
      await within(primeiro).findByText(/Não deu para copiar sozinho/, {
        selector: ".acessos-copia",
      }),
    ).toBeVisible();
    const campo = within(primeiro).getByLabelText(
      "Mensagem para Maria Fictícia",
    );
    expect(primeiro.querySelector("details")).toHaveAttribute("open");
    await waitFor(() => expect(campo).toHaveFocus());
    expect((campo as HTMLTextAreaElement).value).toMatch(
      /^Olá, Maria! Este é o seu link pessoal/,
    );
    expect(within(dialogo).getByRole("status")).toHaveTextContent(
      "Não deu para copiar sozinho a mensagem para Maria Fictícia",
    );
  });

  it("409 no lote (um alvo foi desativado em outra aba): explica em português e recarrega a lista", async () => {
    const { api } = await abrirAba();
    api.proxima(
      "POST",
      ROTA_LINKS,
      respostaErro(409, "em_uso", "Algum alvo tem o acesso desativado", {
        ids: [3],
      }),
    );

    acionar(
      screen.getByRole("button", {
        name: "Gerar links para quem ainda não tem (2)",
      }),
    );

    await waitFor(() =>
      expect(anuncio()).toContain(
        "Não foi possível gerar os links: Algum alvo tem o acesso desativado: reative antes de gerar o link. A lista foi atualizada.",
      ),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(api.chamadasA("GET", ROTA_ALVOS)).toHaveLength(2),
    );
    expect(api.urlsEmitidas).toEqual([]);
  });
});

describe("CA4: por linha, 'Novo link' e 'Trocar acesso'", () => {
  it("Novo link: POST com o id da linha (sem revogar), o link aparece uma vez e o foco volta ao botão", async () => {
    const { api } = await abrirAba();
    const novo = within(linha("Célula Betel")).getByRole("button", {
      name: "Novo link para Célula Betel",
    });

    acionar(novo);

    const dialogo = await screen.findByRole("dialog", {
      name: "Link de acesso: Célula Betel",
    });
    expect(
      api.chamadasA("POST", ROTA_LINKS).map((chamada) => chamada.corpo),
    ).toEqual([{ papel: "lider", ids: [2], revogar_anteriores: false }]);
    expect(dialogo).toHaveTextContent("Este link só aparece agora.");
    expect(
      within(dialogo).getByRole("link", {
        name: "Abrir no WhatsApp de João Fictício",
      }),
    ).toHaveAttribute(
      "href",
      expect.stringMatching(/^https:\/\/wa\.me\/559132221111\?text=/),
    );
    fireEvent.click(within(dialogo).getByRole("button", { name: "Pronto" }));

    await waitFor(() => expect(novo).toHaveFocus());
    // O link anterior continua valendo: agora são dois "Revogar link".
    await waitFor(() =>
      expect(
        acoes("Célula Betel").filter((acao) =>
          acao?.startsWith("Revogar link"),
        ),
      ).toHaveLength(2),
    );
    expect(document.body.innerHTML).not.toContain(api.urlsEmitidas[0]);
    expect(anuncio()).toContain("Link novo de Célula Betel gerado.");
  });

  it("Trocar acesso: pede confirmação (o aparelho antigo sai), revoga os anteriores e mostra o link novo uma vez", async () => {
    const { api } = await abrirAba();
    const trocar = within(linha("Célula Éfeso")).getByRole("button", {
      name: "Trocar acesso de Célula Éfeso",
    });

    // Cancelar não faz nada e devolve o foco.
    acionar(trocar);
    let confirmacao = screen.getByRole("alertdialog", {
      name: "Trocar o acesso de Célula Éfeso?",
    });
    expect(confirmacao).toHaveAccessibleDescription(
      "Um link novo é gerado para Rute Fictícia.",
    );
    expect(confirmacao).toHaveTextContent(
      "Os links anteriores param de funcionar e o aparelho antigo sai do sistema",
    );
    const cancelar = within(confirmacao).getByRole("button", {
      name: "Cancelar",
    });
    expect(cancelar).toHaveFocus();
    fireEvent.click(cancelar);
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(trocar).toHaveFocus();
    expect(api.chamadasA("POST", ROTA_LINKS)).toEqual([]);

    acionar(trocar);
    confirmacao = screen.getByRole("alertdialog");
    fireEvent.click(
      within(confirmacao).getByRole("button", { name: "Trocar acesso" }),
    );

    const dialogo = await screen.findByRole("dialog", {
      name: "Link de acesso: Célula Éfeso",
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(
      api.chamadasA("POST", ROTA_LINKS).map((chamada) => chamada.corpo),
    ).toEqual([{ papel: "lider", ids: [5], revogar_anteriores: true }]);
    // O telefone da Éfeso não tem DDD: só copiar.
    expect(within(dialogo).queryByRole("link")).not.toBeInTheDocument();
    expect(dialogo).toHaveTextContent(
      "O telefone não está num formato que o WhatsApp abre: copie a mensagem e mande por fora.",
    );
    expect(dialogo).toHaveTextContent("Para Rute Fictícia");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Pronto" }));

    await waitFor(() => expect(trocar).toHaveFocus());
    // O link antigo foi revogado (as sessões dele acabaram) e o nome do usuário é o da hierarquia.
    await waitFor(() =>
      expect(coluna("Célula Éfeso", "Aparelhos conectados")).toBe("0"),
    );
    expect(coluna("Célula Éfeso", "Pessoa")).toBe("Rute Fictícia");
    expect(coluna("Célula Éfeso", "Situação")).toBe(
      "Link válidoAinda não usado.",
    );
    expect(
      api.alvos.lider[4].usuario?.links.map((item) => item.situacao),
    ).toEqual(["valido", "revogado"]);
    expect(anuncio()).toContain(
      "Acesso de Célula Éfeso trocado: os links anteriores pararam de funcionar.",
    );
  });
});

describe("CA4: desativar, reativar e revogar com as rotas que a tela já tem", () => {
  it("Desativar (confirmação) e Reativar: PATCH /api/admin/usuarios/:id; o foco fica no botão da linha", async () => {
    const { api } = await abrirAba();
    const botao = within(linha("Célula Betel")).getByRole("button", {
      name: "Desativar acesso de Célula Betel",
    });

    acionar(botao);
    const confirmacao = screen.getByRole("alertdialog", {
      name: "Desativar o acesso de João Fictício?",
    });
    expect(confirmacao).toHaveAccessibleDescription(
      "Líder. Dá para reativar depois.",
    );
    fireEvent.click(
      within(confirmacao).getByRole("button", { name: "Desativar acesso" }),
    );

    await waitFor(() =>
      expect(coluna("Célula Betel", "Situação")).toMatch(/^Desativado/),
    );
    expect(
      api.chamadasA("PATCH", "/api/admin/usuarios/2002")[0]?.corpo,
    ).toEqual({
      ativo: false,
    });
    expect(botao).toHaveAccessibleName("Reativar acesso de Célula Betel");
    expect(acoes("Célula Betel")).toEqual(["Reativar acesso de Célula Betel"]);
    await waitFor(() => expect(botao).toHaveFocus());

    fireEvent.click(botao);

    await waitFor(() =>
      expect(coluna("Célula Betel", "Situação")).toMatch(/^Link válido/),
    );
    expect(
      api.chamadasA("PATCH", "/api/admin/usuarios/2002").map((c) => c.corpo),
    ).toEqual([{ ativo: false }, { ativo: true }]);
    expect(anuncio()).toContain("Acesso de Célula Betel reativado.");
  });

  it("Revogar link: confirmação, DELETE /api/admin/links/:id e o foco vai para 'Novo link' da linha", async () => {
    const { api } = await abrirAba();

    acionar(
      within(linha("Célula Betel")).getByRole("button", {
        name: /^Revogar link de Célula Betel/,
      }),
    );
    const confirmacao = screen.getByRole("alertdialog", {
      name: "Revogar este link?",
    });
    fireEvent.click(
      within(confirmacao).getByRole("button", { name: "Revogar link" }),
    );

    await waitFor(() =>
      expect(coluna("Célula Betel", "Situação")).toBe(
        "Só links revogados ou vencidos",
      ),
    );
    expect(api.chamadasA("DELETE", "/api/admin/links/3001")).toHaveLength(1);
    expect(
      within(linha("Célula Betel")).getByRole("button", {
        name: "Novo link para Célula Betel",
      }),
    ).toHaveFocus();
    expect(anuncio()).toContain("Link de Célula Betel revogado.");
  });
});

describe("CA5: acessibilidade da aba", () => {
  it("abas pelo teclado, papel com rótulo, tabela com legenda e botões com o nome do alvo", async () => {
    const api = criarApiFalsa();
    vi.stubGlobal("fetch", api.fetch);
    renderizarRota("/coordenacao/acessos", { usuario: ADMIN_DE_TESTE });
    await screen.findByRole("heading", { level: 2, name: "Admin de Teste" });
    const coordenacao = screen.getByRole("tab", { name: "Coordenação" });
    expect(coordenacao).toHaveAttribute("aria-selected", "true");

    // Seta para a direita: a aba seguinte é escolhida e recebe o foco.
    act(() => coordenacao.focus());
    fireEvent.keyDown(coordenacao, { key: "ArrowRight" });
    const hierarquia = screen.getByRole("tab", { name: ABA });
    expect(hierarquia).toHaveAttribute("aria-selected", "true");
    expect(hierarquia).toHaveFocus();
    const painel = await screen.findByRole("tabpanel", { name: ABA });
    expect(
      await within(painel).findByRole("table", {
        name: "Acessos: Líderes de célula",
      }),
    ).toBeInTheDocument();
    expect(within(painel).getByLabelText("Papel")).toHaveValue("lider");
    for (const botao of within(painel).getAllByRole("button")) {
      expect(botao).toHaveAccessibleName();
    }
    // A aba da coordenação continua montada (escondida), sem perder o que estava nela.
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Admin de Teste",
        hidden: true,
      }),
    ).not.toBeVisible();
  });
});
