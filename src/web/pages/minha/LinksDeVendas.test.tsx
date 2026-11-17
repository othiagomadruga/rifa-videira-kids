// CA2 (RIFA-046, D24 item 10): o link de vendas na /minha, pela rota de verdade, com a API falsa (respostas pelo
// respostaMeusLinksVendasSchema). Os estados (configurado, sem modelo, sem código, vários códigos, carregando, erro,
// acesso desligado e sem campanha), o escopo por papel (o líder vê a célula dele; o discipulador e a rede, as
// células deles: a tela mostra o que a API manda e não manda id de nada) e Copiar e WhatsApp com o link certo.
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { decodeQR } from "qr/decode.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RespostaMeusLinksVendas } from "../../../shared/contracts";
import { pixelsDoSvg, textoDaDica } from "../../components/qr/teste-apoio";
import { AJUDA, DICAS } from "../../components/qr/textos";
import { contarControles, controlesSemDica } from "../../test/dicas";
import { renderizarRota, respostaJson } from "../../test/renderizar";
import {
  ALVO_CELULA,
  ALVO_DISCIPULADOR,
  ALVO_REDE,
  criarApiFalsa,
  meusLinksDe,
  respostaErro,
  sessaoDaVisao,
  urlDoAfiliado,
  visaoDe,
  type ApiFalsa,
} from "./teste-apoio";
import { INTERVALO_ATUALIZACAO_MS } from "./useVisaoIndividual";

const CAMINHO_LINKS = "/api/minha/links-vendas";
/** O primeiro teste do arquivo carrega os pacotes lazy (a visão e o QR code). */
const ESPERA_DO_PACOTE = { timeout: 5000 };

const escrever = vi.fn();

beforeEach(() => {
  escrever.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: escrever },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "clipboard");
});

type Papel = "lider" | "discipulador" | "rede";

async function abrir(
  papel: Papel = "lider",
  links: RespostaMeusLinksVendas | null = null,
  api: ApiFalsa = criarApiFalsa(visaoDe({ papel }), null, links),
  { esperarOsLinks = true } = {},
) {
  vi.stubGlobal("fetch", api.fetch);
  const visao = visaoDe({ papel });
  const tela = renderizarRota("/minha", { usuario: sessaoDaVisao(visao) });
  const titulo =
    papel === "lider"
      ? "Seu link de vendas"
      : "Links de vendas das suas células";
  const cartao = (
    await screen.findByRole(
      "heading",
      { level: 2, name: titulo },
      ESPERA_DO_PACOTE,
    )
  ).closest("section") as HTMLElement;
  if (esperarOsLinks)
    await waitFor(() =>
      expect(
        within(cartao).queryByText("Carregando o link de vendas…"),
      ).toBeNull(),
    );
  return { api, cartao, ...tela };
}

/** O texto que vai no WhatsApp, como o wa.me recebe. */
function linkDoWhatsApp(celula: string, url: string) {
  return `https://wa.me/?text=${encodeURIComponent(
    `Compre seus bilhetes da rifa do Videira Kids pelo link da ${celula}: ${url}`,
  )}`;
}

describe("CA2: o líder vê o link da célula dele", () => {
  it("configurado: o link em destaque, com o QR code (que a câmera leria), Copiar e Enviar no WhatsApp", async () => {
    const { api, cartao } = await abrir("lider");
    const url = urlDoAfiliado(1042);

    const qr = await within(cartao).findByRole(
      "img",
      { name: "QR code do link de vendas da Célula Ágape" },
      ESPERA_DO_PACOTE,
    );
    expect(decodeQR(pixelsDoSvg(qr))).toBe(url);
    expect(cartao).toHaveTextContent(
      "Cada compra feita na Rifei por este link conta para a Célula Ágape.",
    );
    expect(
      within(cartao).getByRole("textbox", { name: "Link de vendas" }),
    ).toHaveValue(url);
    expect(
      within(cartao).getByRole("textbox", { name: "Link de vendas" }),
    ).toHaveAttribute("readonly");

    const whatsapp = within(cartao).getByRole("link", {
      name: "Enviar no WhatsApp o link da Célula Ágape",
    });
    expect(whatsapp).toHaveAttribute(
      "href",
      linkDoWhatsApp("Célula Ágape", url),
    );
    expect(whatsapp).toHaveAttribute("target", "_blank");
    expect(whatsapp).toHaveAttribute("rel", "noopener noreferrer");

    fireEvent.click(
      within(cartao).getByRole("button", {
        name: "Copiar link da Célula Ágape",
      }),
    );
    await waitFor(() => expect(escrever).toHaveBeenCalledWith(url));
    expect(
      await within(cartao).findByText("Link copiado.", {
        selector: "p:not([role])",
      }),
    ).toBeInTheDocument();

    // Baixar imagem e Imprimir vêm com o QR; nada de "Também contam" com um código só.
    expect(
      within(cartao).getByRole("button", {
        name: "Baixar imagem do QR code da Célula Ágape",
      }),
    ).toBeInTheDocument();
    expect(
      within(cartao).getByRole("button", {
        name: "Imprimir o QR code da Célula Ágape",
      }),
    ).toBeInTheDocument();
    expect(within(cartao).queryByText(/Também contam/)).toBeNull();
    // A rota não leva id de nada: o alvo vem da sessão.
    expect(api.chamadasA("GET", CAMINHO_LINKS)).toEqual([
      { metodo: "GET", caminho: CAMINHO_LINKS },
    ]);
  });

  it("sem a área de transferência, o link fica selecionado no campo", async () => {
    Reflect.deleteProperty(navigator, "clipboard");
    const { cartao } = await abrir("lider");
    const campo = within(cartao).getByRole("textbox", {
      name: "Link de vendas",
    });
    fireEvent.click(
      within(cartao).getByRole("button", { name: /^Copiar link/ }),
    );
    expect(
      await within(cartao).findByText(
        "Não deu para copiar sozinho: o link ficou selecionado no campo. Copie pelo menu do celular.",
        { selector: "p:not([role])" },
      ),
    ).toBeInTheDocument();
    expect(campo).toHaveFocus();
    const selecionado = campo as HTMLTextAreaElement;
    expect(
      selecionado.value.slice(
        selecionado.selectionStart,
        selecionado.selectionEnd,
      ),
    ).toBe(urlDoAfiliado(1042));
  });

  it("sem modelo configurado: a coordenação ainda não liberou o link (sem campo nem QR)", async () => {
    const { cartao } = await abrir(
      "lider",
      meusLinksDe(ALVO_CELULA, { configurado: false }),
    );
    expect(
      await within(cartao).findByText(
        "A coordenação ainda não liberou o link de vendas.",
      ),
    ).toBeInTheDocument();
    expect(cartao).toHaveTextContent(
      "Enquanto isso, use o link da sua Área de afiliados na Rifei.",
    );
    expect(within(cartao).queryByRole("textbox")).toBeNull();
    expect(within(cartao).queryByRole("img")).toBeNull();
  });

  it("sem código vinculado: o aviso de falar com a coordenação", async () => {
    const { cartao } = await abrir(
      "lider",
      meusLinksDe(ALVO_CELULA, { afiliadosDoLider: [] }),
    );
    expect(
      await within(cartao).findByText(
        "Sua célula ainda não tem cadastro de afiliado ligado: fale com a coordenação.",
      ),
    ).toBeInTheDocument();
    expect(within(cartao).queryByRole("textbox")).toBeNull();
  });

  it("vários códigos: todos aparecem, o mais recente em destaque (com o QR) e os outros com Ver QR", async () => {
    const { cartao } = await abrir(
      "lider",
      meusLinksDe(ALVO_CELULA, { afiliadosDoLider: [1077, 1042] }),
    );
    const qr = await within(cartao).findByRole(
      "img",
      { name: "QR code do link de vendas da Célula Ágape" },
      ESPERA_DO_PACOTE,
    );
    expect(decodeQR(pixelsDoSvg(qr))).toBe(urlDoAfiliado(1077));
    expect(
      within(cartao).getByRole("textbox", { name: "Link de vendas" }),
    ).toHaveValue(urlDoAfiliado(1077));

    const outros = within(cartao).getByRole("group", {
      name: "Também contam para a sua célula",
    });
    expect(
      within(outros).getByRole("textbox", {
        name: "Link do afiliado 1042 da Célula Ágape",
      }),
    ).toHaveValue(urlDoAfiliado(1042));
    // Cada botão diz de qual código é (o leitor de tela não ouve dois "Copiar link" iguais).
    fireEvent.click(
      within(outros).getByRole("button", {
        name: "Copiar link da Célula Ágape (afiliado 1042)",
      }),
    );
    await waitFor(() =>
      expect(escrever).toHaveBeenCalledWith(urlDoAfiliado(1042)),
    );
    expect(
      within(outros).getByRole("link", {
        name: "Enviar no WhatsApp o link da Célula Ágape (afiliado 1042)",
      }),
    ).toHaveAttribute(
      "href",
      linkDoWhatsApp("Célula Ágape", urlDoAfiliado(1042)),
    );
    const verQr = within(outros).getByRole("button", {
      name: "Ver QR code da Célula Ágape (afiliado 1042)",
    });
    verQr.focus();
    fireEvent.click(verQr);
    const dialogo = await screen.findByRole("dialog", {
      name: "QR code da Célula Ágape (afiliado 1042)",
    });
    const doDialogo = await within(dialogo).findByRole("img", {
      name: "QR code do link de vendas da Célula Ágape",
    });
    expect(decodeQR(pixelsDoSvg(doDialogo))).toBe(urlDoAfiliado(1042));
    expect(dialogo).toHaveTextContent(urlDoAfiliado(1042));
    fireEvent.click(within(dialogo).getByRole("button", { name: "Pronto" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(verQr).toHaveFocus();
  });
});

describe("CA2: discipulador e rede veem os links das células deles", () => {
  it("discipulador: as três células dele, cada uma com Copiar, WhatsApp e Ver QR; a sem código, o aviso", async () => {
    const { cartao } = await abrir("discipulador");
    const nomes = within(cartao)
      .getAllByRole("heading", { level: 3 })
      .map((titulo) => titulo.textContent);
    expect(nomes).toEqual(["Célula Ágape", "Célula Betel", "Célula Canaã"]);

    const betel = within(cartao)
      .getByRole("heading", { level: 3, name: "Célula Betel" })
      .closest("article") as HTMLElement;
    expect(betel).toHaveTextContent("Líder: João Fictício");
    expect(
      within(betel).getByRole("textbox", {
        name: "Link de vendas da Célula Betel",
      }),
    ).toHaveValue(urlDoAfiliado(1043));
    expect(
      within(betel).getByRole("link", {
        name: "Enviar no WhatsApp o link da Célula Betel",
      }),
    ).toHaveAttribute(
      "href",
      linkDoWhatsApp("Célula Betel", urlDoAfiliado(1043)),
    );
    fireEvent.click(
      within(betel).getByRole("button", {
        name: "Copiar link da Célula Betel",
      }),
    );
    await waitFor(() =>
      expect(escrever).toHaveBeenCalledWith(urlDoAfiliado(1043)),
    );

    // Nenhum QR aparece (nem é carregado) até o Ver QR.
    expect(within(cartao).queryByRole("img")).toBeNull();
    fireEvent.click(
      within(betel).getByRole("button", {
        name: "Ver QR code da Célula Betel",
      }),
    );
    const dialogo = await screen.findByRole("dialog", {
      name: "QR code da Célula Betel",
    });
    const qr = await within(dialogo).findByRole(
      "img",
      { name: "QR code do link de vendas da Célula Betel" },
      ESPERA_DO_PACOTE,
    );
    expect(decodeQR(pixelsDoSvg(qr))).toBe(urlDoAfiliado(1043));

    const canaa = within(cartao)
      .getByRole("heading", { level: 3, name: "Célula Canaã" })
      .closest("article") as HTMLElement;
    expect(canaa).toHaveTextContent(
      "Ainda sem cadastro de afiliado ligado: o líder fala com a coordenação.",
    );
    expect(within(canaa).queryByRole("textbox")).toBeNull();
    // Célula de outro discipulador, nunca.
    expect(cartao).not.toHaveTextContent("Célula Dorcas");
  });

  it("rede: as células de todos os discipuladores dela, com o discipulador de cada uma", async () => {
    const { cartao, api } = await abrir("rede");
    const nomes = within(cartao)
      .getAllByRole("heading", { level: 3 })
      .map((titulo) => titulo.textContent);
    expect(nomes).toEqual([
      "Célula Ágape",
      "Célula Betel",
      "Célula Canaã",
      "Célula Dorcas",
    ]);
    const dorcas = within(cartao)
      .getByRole("heading", { level: 3, name: "Célula Dorcas" })
      .closest("article") as HTMLElement;
    expect(dorcas).toHaveTextContent(
      "Líder: Pedro Fictício · Discipulador: Elias Fictício",
    );
    expect(
      within(dorcas).getByRole("textbox", {
        name: "Link de vendas da Célula Dorcas",
      }),
    ).toHaveValue(urlDoAfiliado(1050));
    expect(api.chamadasA("GET", CAMINHO_LINKS)).toEqual([
      { metodo: "GET", caminho: CAMINHO_LINKS },
    ]);
  });

  it("sem modelo: a coordenação ainda não liberou, e cada líder usa o link da Área de afiliados", async () => {
    const { cartao } = await abrir(
      "discipulador",
      meusLinksDe(ALVO_DISCIPULADOR, { configurado: false }),
    );
    expect(cartao).toHaveTextContent(
      "A coordenação ainda não liberou o link de vendas.",
    );
    expect(cartao).toHaveTextContent(
      "Enquanto isso, cada líder usa o link da Área de afiliados dele na Rifei.",
    );
    expect(within(cartao).queryByRole("heading", { level: 3 })).toBeNull();
  });

  it("rede com um link de outro endereço (fora do schema): a tela não o mostra nem faz QR dele", async () => {
    const links = meusLinksDe(ALVO_REDE);
    // Simula uma resposta adulterada no caminho (o schema da API já recusa): a segunda trava é a da tela.
    const adulterada = structuredClone(links);
    adulterada.itens[0].links[0].url = "https://golpe.example/?afiliado=1042";
    const api = criarApiFalsa(visaoDe({ papel: "rede" }));
    api.proxima("GET", CAMINHO_LINKS, () => respostaJson(adulterada));
    const { cartao } = await abrir("rede", null, api);
    const agape = within(cartao)
      .getByRole("heading", { level: 3, name: "Célula Ágape" })
      .closest("article") as HTMLElement;
    expect(agape).not.toHaveTextContent("golpe.example");
    expect(within(agape).queryByRole("textbox")).toBeNull();
    expect(document.body).not.toHaveTextContent("golpe.example");
  });
});

describe("estados do link de vendas", () => {
  it("enquanto carrega, o carregando no cartão; numa falha, Tentar de novo", async () => {
    const api = criarApiFalsa(visaoDe());
    let liberar: (resposta: Response) => void = () => {};
    api.proxima(
      "GET",
      CAMINHO_LINKS,
      () =>
        new Promise<Response>((resolver) => {
          liberar = resolver;
        }),
    );
    const { cartao } = await abrir("lider", null, api, {
      esperarOsLinks: false,
    });
    expect(
      within(cartao).getByText("Carregando o link de vendas…"),
    ).toBeInTheDocument();
    // O "Carregando…" aparece também enquanto o pacote da seção chega (lazy), antes do GET: sob carga, o `liberar`
    // chegava antes do pedido e a resposta nunca vinha. Espera o pedido sair (RIFA-047).
    await waitFor(() =>
      expect(api.chamadasA("GET", CAMINHO_LINKS)).toHaveLength(1),
    );

    await act(async () =>
      liberar(respostaErro(503, "indisponivel", "Serviço indisponível")),
    );
    const alerta = await within(cartao).findByRole("alert");
    expect(alerta).toHaveTextContent(
      "Não foi possível carregar o link de vendas.",
    );
    // Uma falha da API (503) é falha de verdade: o vermelho (RIFA-051).
    expect(alerta).toHaveClass("ui-estado--erro");
    fireEvent.click(
      within(alerta).getByRole("button", { name: "Tentar de novo" }),
    );
    expect(
      await within(cartao).findByRole("textbox", { name: "Link de vendas" }),
    ).toHaveValue(urlDoAfiliado(1042));
    expect(api.chamadasA("GET", CAMINHO_LINKS)).toHaveLength(2);
  });

  it("sem conexão ao pedir o link: o cartão neutro (sem o vermelho), com Tentar de novo", async () => {
    const api = criarApiFalsa(visaoDe());
    api.proxima("GET", CAMINHO_LINKS, () => {
      throw new TypeError("Failed to fetch");
    });
    const { cartao } = await abrir("lider", null, api, {
      esperarOsLinks: false,
    });
    const alerta = await within(cartao).findByRole("alert");
    expect(alerta).toHaveTextContent(
      "Não foi possível carregar o link de vendas.",
    );
    expect(alerta).toHaveClass("ui-estado--conexao");
    expect(alerta).not.toHaveClass("ui-estado--erro");
    expect(
      within(alerta).getByRole("button", { name: "Tentar de novo" }),
    ).toBeInTheDocument();
  });

  it("403 acesso_desligado: o texto da coordenação, como na visão", async () => {
    const api = criarApiFalsa(visaoDe({ papel: "discipulador" }));
    api.proxima("GET", CAMINHO_LINKS, () =>
      respostaJson(
        {
          erro: {
            codigo: "acesso_desligado",
            mensagem: "Acesso desligado",
            detalhes: { papel: "discipulador" },
          },
        },
        403,
      ),
    );
    const { cartao } = await abrir("discipulador", null, api);
    expect(
      await within(cartao).findByText(
        "A coordenação desligou o acesso de discipuladores por enquanto.",
      ),
    ).toBeInTheDocument();
  });

  it("404 (sem campanha ativa): a campanha ainda não está ativa", async () => {
    const api = criarApiFalsa(visaoDe());
    api.proxima(
      "GET",
      CAMINHO_LINKS,
      respostaErro(404, "nao_encontrado", "Sem campanha ativa"),
    );
    const { cartao } = await abrir("lider", null, api);
    expect(
      await within(cartao).findByText("A campanha ainda não está ativa."),
    ).toBeInTheDocument();
  });

  it("pedido uma vez: a atualização de cada minuto da visão não pede o link de novo", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { api, cartao } = await abrir("lider");
    await within(cartao).findByRole("textbox", { name: "Link de vendas" });
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ATUALIZACAO_MS));
    await waitFor(() =>
      expect(api.chamadasA("GET", "/api/minha/visao")).toHaveLength(2),
    );
    expect(api.chamadasA("GET", CAMINHO_LINKS)).toHaveLength(1);
    expect(
      within(cartao).getByRole("textbox", { name: "Link de vendas" }),
    ).toHaveValue(urlDoAfiliado(1042));
  });

  it("a coordenação vincula o afiliado com a tela aberta (reunião): na atualização da visão, o aviso amarelo sai e o link e o QR entram, sem recarregar", async () => {
    // RIFA-036 (ensaio geral 2): antes, o aviso amarelo sumia e o cartão continuava dizendo que a célula não tinha
    // cadastro de afiliado até o líder recarregar a página.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let vinculados = 0;
    const api = criarApiFalsa(() =>
      visaoDe({ papel: "lider", afiliados: vinculados }),
    );
    const { cartao } = await abrir("lider", null, api);
    expect(
      await within(cartao).findByText(
        "Sua célula ainda não tem cadastro de afiliado ligado: fale com a coordenação.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Seu link de afiliado ainda não está ligado à sua célula: fale com a coordenação.",
      ),
    ).toBeInTheDocument();

    // O pedido novo do link fica preso até a conferência abaixo: enquanto ele não volta, o cartão fica como estava,
    // sem voltar ao "carregando" (não pisca).
    let liberar: () => void = () => undefined;
    const segura = new Promise<void>((resolver) => {
      liberar = resolver;
    });
    api.proxima("GET", CAMINHO_LINKS, async () => {
      await segura;
      return respostaJson(meusLinksDe(ALVO_CELULA));
    });
    vinculados = 1;
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ATUALIZACAO_MS));
    await waitFor(() =>
      expect(api.chamadasA("GET", CAMINHO_LINKS)).toHaveLength(2),
    );
    expect(
      screen.queryByText(
        "Seu link de afiliado ainda não está ligado à sua célula: fale com a coordenação.",
      ),
    ).toBeNull();
    expect(
      within(cartao).queryByText("Carregando o link de vendas…"),
    ).toBeNull();
    expect(
      within(cartao).getByText(/ainda não tem cadastro de afiliado ligado/),
    ).toBeInTheDocument();

    liberar();
    expect(
      await within(cartao).findByRole("textbox", { name: "Link de vendas" }),
    ).toHaveValue(urlDoAfiliado(1042));
    expect(
      within(cartao).queryByText("Carregando o link de vendas…"),
    ).toBeNull();
    expect(
      screen.queryByText(
        "Seu link de afiliado ainda não está ligado à sua célula: fale com a coordenação.",
      ),
    ).toBeNull();
    expect(
      within(cartao).queryByText(/ainda não tem cadastro de afiliado ligado/),
    ).toBeNull();
    expect(
      await within(cartao).findByRole(
        "img",
        { name: "QR code do link de vendas da Célula Ágape" },
        ESPERA_DO_PACOTE,
      ),
    ).toBeInTheDocument();
    // D12: o pedido de novo continua sem id de nada (o alvo vem da sessão).
    expect(api.chamadasA("GET", CAMINHO_LINKS)).toEqual([
      { metodo: "GET", caminho: CAMINHO_LINKS },
      { metodo: "GET", caminho: CAMINHO_LINKS },
    ]);

    // Sem mudança nos vínculos, a atualização seguinte não pede o link de novo.
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ATUALIZACAO_MS));
    await waitFor(() =>
      expect(api.chamadasA("GET", "/api/minha/visao")).toHaveLength(3),
    );
    expect(api.chamadasA("GET", CAMINHO_LINKS)).toHaveLength(2);
  });
});

// RIFA-045 nos controles da RIFA-046: aqui a varredura fica no cartão do link de vendas (e no diálogo do "Ver QR", que
// deixa o resto da página `inert`), com os textos de cada dica; a página inteira (fase 2b) é varrida em
// pages/dicas-fora-da-coordenacao.test.tsx.
describe("ícones e bloco de leitura (RIFA-051, A-16)", () => {
  /** O ícone (só visual) que vem antes do texto do controle. */
  function iconeDe(controle: HTMLElement): string | null {
    const icone = controle.firstElementChild;
    if (icone?.tagName.toLowerCase() !== "svg") return null;
    expect(icone).toHaveAttribute("aria-hidden", "true");
    return icone.getAttribute("data-icone");
  }

  it("líder: cada botão com o seu ícone à esquerda do texto, e os nomes não mudam", async () => {
    const { cartao } = await abrir("lider");
    expect(
      iconeDe(
        within(cartao).getByRole("button", {
          name: "Copiar link da Célula Ágape",
        }),
      ),
    ).toBe("copiar");
    expect(
      iconeDe(
        within(cartao).getByRole("link", {
          name: "Enviar no WhatsApp o link da Célula Ágape",
        }),
      ),
    ).toBe("conversa");
    expect(
      iconeDe(
        await within(cartao).findByRole(
          "button",
          { name: "Baixar imagem do QR code da Célula Ágape" },
          ESPERA_DO_PACOTE,
        ),
      ),
    ).toBe("baixar");
    expect(
      iconeDe(
        within(cartao).getByRole("button", {
          name: "Imprimir o QR code da Célula Ágape",
        }),
      ),
    ).toBe("imprimir");
    // O título do cartão com o ícone do link (o nome do título não muda).
    const titulo = within(cartao).getByRole("heading", {
      level: 2,
      name: "Seu link de vendas",
    });
    expect(titulo.querySelector("svg")).toHaveAttribute("data-icone", "link");
    // O link continua num campo só leitura, selecionável e com a dica (a cara de bloco de leitura é do CSS).
    const campo = within(cartao).getByRole("textbox", {
      name: "Link de vendas",
    });
    expect(campo).toHaveAttribute("readonly");
    expect(campo).toHaveClass("qr-compartilhar__campo");
  });

  it("discipulador: cada célula num bloco, com Copiar, Ver QR e WhatsApp nessa ordem (no celular, Copiar e Ver QR dividem a linha)", async () => {
    const { cartao } = await abrir("discipulador");
    const betel = within(cartao)
      .getByRole("heading", { level: 3, name: "Célula Betel" })
      .closest("article") as HTMLElement;
    const acoes = betel.querySelector<HTMLElement>(".qr-compartilhar__acoes");
    if (!acoes) throw new Error("sem as ações");
    expect(
      [...acoes.querySelectorAll<HTMLElement>("button, a")].map((controle) => [
        controle.textContent?.replace(/\s+/g, " ").trim(),
        iconeDe(controle),
      ]),
    ).toEqual([
      ["Copiar link da Célula Betel", "copiar"],
      ["Ver QR code da Célula Betel", "qr"],
      ["Enviar no WhatsApp o link da Célula Betel", "conversa"],
    ]);
    // O nome e o líder juntos, no começo do bloco.
    expect(betel.firstElementChild).toHaveClass("minha-links__identidade");
    expect(betel.firstElementChild).toHaveTextContent(
      "Célula BetelLíder: João Fictício",
    );
  });
});

describe("dicas nos botões e campos do link de vendas", () => {
  it("líder com dois códigos: o campo, Copiar, WhatsApp, Baixar imagem, Imprimir e Ver QR; no diálogo, Pronto e o ×", async () => {
    const { cartao } = await abrir(
      "lider",
      meusLinksDe(ALVO_CELULA, { afiliadosDoLider: [1077, 1042] }),
    );
    await within(cartao).findByRole(
      "img",
      { name: "QR code do link de vendas da Célula Ágape" },
      ESPERA_DO_PACOTE,
    );
    // O link em destaque (campo, Copiar, WhatsApp, Baixar imagem, Imprimir) e o outro (campo, Copiar, WhatsApp, Ver QR),
    // e o "?" da ajuda de cada campo (RIFA-066).
    expect(contarControles(cartao)).toBe(11);
    expect(controlesSemDica(cartao)).toEqual([]);

    const texto = (papel: "button" | "link" | "textbox", nome: string) =>
      textoDaDica(within(cartao).getByRole(papel, { name: nome }));
    expect(texto("textbox", "Link de vendas")).toBe(AJUDA.campoLink);
    expect(texto("button", "Copiar link da Célula Ágape")).toBe(
      DICAS.copiarLink,
    );
    // Na /minha, sem telefone: a pessoa escolhe o contato.
    expect(texto("link", "Enviar no WhatsApp o link da Célula Ágape")).toBe(
      "Abre o WhatsApp com a mensagem e o link prontos.",
    );
    expect(texto("button", "Baixar imagem do QR code da Célula Ágape")).toBe(
      "Baixa o QR code como imagem (PNG) para mandar ou imprimir.",
    );
    expect(texto("button", "Imprimir o QR code da Célula Ágape")).toBe(
      "Imprime só o QR code, o nome da célula e o link.",
    );
    const verQr = within(cartao).getByRole("button", {
      name: "Ver QR code da Célula Ágape (afiliado 1042)",
    });
    expect(textoDaDica(verQr)).toBe(
      "Mostra o QR code deste link para a pessoa apontar a câmera.",
    );

    // Como o toque: o ponteiro apaga a marca do teclado que o textoDaDica deixou (o foco que o diálogo põe não abre
    // dica).
    fireEvent.pointerDown(verQr);
    fireEvent.click(verQr);
    const dialogo = await screen.findByRole("dialog", {
      name: "QR code da Célula Ágape (afiliado 1042)",
    });
    await within(dialogo).findByRole("img", {
      name: "QR code do link de vendas da Célula Ágape",
    });
    // O ×, Baixar imagem, Imprimir e Pronto.
    expect(contarControles(dialogo)).toBe(4);
    expect(controlesSemDica(dialogo)).toEqual([]);
    expect(
      textoDaDica(within(dialogo).getByRole("button", { name: "Pronto" })),
    ).toBe("Fecha o QR code.");
    expect(
      textoDaDica(within(dialogo).getByRole("button", { name: /^Fechar/ })),
    ).toBe("Fecha o QR code.");
  });

  it("discipulador: cada célula com link (campo, Copiar, WhatsApp e Ver QR)", async () => {
    const { cartao } = await abrir("discipulador");
    await within(cartao).findByRole("textbox", {
      name: "Link de vendas da Célula Betel",
    });
    expect(contarControles(cartao)).toBeGreaterThanOrEqual(8);
    expect(controlesSemDica(cartao)).toEqual([]);
  });

  it("erro com Tentar de novo: o botão do ErrorState já vem com a dica", async () => {
    const api = criarApiFalsa(visaoDe());
    api.proxima(
      "GET",
      CAMINHO_LINKS,
      respostaErro(503, "indisponivel", "Serviço indisponível"),
    );
    const { cartao } = await abrir("lider", null, api);
    await within(cartao).findByRole("button", { name: "Tentar de novo" });
    expect(contarControles(cartao)).toBe(1);
    expect(controlesSemDica(cartao)).toEqual([]);
  });
});
