// CA3 (RIFA-046, D24 item 11): a seção "Links de vendas" da Adesão, pela rota de verdade, com a API falsa (as
// respostas pelos schemas do contrato e o PUT pelo corpoSalvarModeloLinkVendasSchema). O admin edita o modelo, com
// os problemas enquanto digita e a prévia do link montado com o slug da campanha; a coordenação vê o modelo só
// leitura; o link e o QR de cada célula (Copiar, WhatsApp para o telefone do líder, Ver QR) e "Imprimir os QR codes".
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { decodeQR } from "qr/decode.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  corpoSalvarModeloLinkVendasSchema,
  respostaAdesaoSchema,
  respostaListaAfiliadosSchema,
  type UsuarioSessao,
} from "../../../shared/contracts";
import { CLASSE_IMPRIMINDO } from "../../components/qr/QrCodeLinkVendas";
import { pixelsDoSvg, textoDaDica } from "../../components/qr/teste-apoio";
import { DICAS as DICAS_DO_QR } from "../../components/qr/textos";
import { contarControles, controlesSemDica } from "../../test/dicas";
import {
  ADMIN_DE_TESTE,
  USUARIO_DE_TESTE,
  renderizarRota,
  respostaJson,
} from "../../test/renderizar";
import type { CelulaAdesao } from "./adesao-api";
import {
  MODELO_DE_TESTE,
  SLUG_DE_TESTE,
  respostaLinksDe,
  urlDeTeste,
} from "./teste-apoio-links";
import { DICAS } from "./textos";
import { INTERVALO_ATUALIZACAO_MS } from "./usePainelAdesao";

const ESPERA_DO_PACOTE = { timeout: 5000 };

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

function celulasDaReuniao(): CelulaAdesao[] {
  return [
    celula(1, "Célula Ágape", {
      lider_telefone: "(91) 90000-0001",
      afiliados: [1001, 1077],
      vinculada: true,
    }),
    celula(2, "Célula Betel", { afiliados: [1002], vinculada: true }),
    celula(3, "Célula Canaã"),
  ];
}

type Erro = {
  status: number;
  codigo: string;
  mensagem: string;
  detalhes?: unknown;
};

/**
 * fetch simulado: o painel da Adesão, a lista dos links, o PUT do modelo e a campanha (o slug). `falhasDoGet`: as
 * próximas respostas de erro do GET dos links, uma por consulta, antes das de sucesso.
 */
function simularApi({
  modelo = null as string | null,
  celulas = celulasDaReuniao(),
  slug = SLUG_DE_TESTE as string | null,
  falhasDoGet = [] as Erro[],
} = {}) {
  const estado = { modelo, celulas, slug };
  const corpos: unknown[] = [];
  const chamadas: string[] = [];
  const proximaFalhaDoPut: Erro[] = [];
  const proximaFalhaDoGet: Erro[] = [...falhasDoGet];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? "GET";
    chamadas.push(`${metodo} ${url}`);
    if (metodo === "GET" && url === "/api/admin/adesao")
      return respostaJson(
        respostaAdesaoSchema.parse({
          resumo: {
            celulas: estado.celulas.length,
            vinculadas: estado.celulas.filter((c) => c.vinculada).length,
            com_venda: 0,
            afiliados_nao_vinculados: 0,
          },
          itens: estado.celulas,
        }),
      );
    if (metodo === "GET" && url === "/api/admin/afiliados?vinculado=false")
      return respostaJson(
        respostaListaAfiliadosSchema.parse({
          itens: [],
          sem_afiliado: {
            pedidos_aprovados: 0,
            bilhetes: 0,
            total_centavos: 0,
          },
        }),
      );
    if (metodo === "GET" && url === "/api/admin/links-vendas") {
      const falha = proximaFalhaDoGet.shift();
      return falha
        ? respostaJson(
            { erro: { codigo: falha.codigo, mensagem: falha.mensagem } },
            falha.status,
          )
        : respostaJson(respostaLinksDe(estado.celulas, estado.modelo));
    }
    if (metodo === "GET" && url === "/api/admin/campanha")
      return estado.slug === null
        ? respostaJson(
            { erro: { codigo: "nao_encontrado", mensagem: "Sem campanha" } },
            404,
          )
        : respostaJson({ slug_rifei: estado.slug });
    if (metodo === "PUT" && url === "/api/admin/links-vendas/modelo") {
      const corpo: unknown = JSON.parse(String(init?.body));
      corpos.push(corpo);
      const falha = proximaFalhaDoPut.shift();
      if (falha)
        return respostaJson(
          {
            erro: {
              codigo: falha.codigo,
              mensagem: falha.mensagem,
              detalhes: falha.detalhes,
            },
          },
          falha.status,
        );
      estado.modelo = corpoSalvarModeloLinkVendasSchema.parse(corpo).modelo;
      return respostaJson(respostaLinksDe(estado.celulas, estado.modelo));
    }
    return respostaJson(
      { erro: { codigo: "nao_encontrado", mensagem: "Rota não encontrada" } },
      404,
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return { estado, corpos, chamadas, proximaFalhaDoPut };
}

async function abrir(usuario: UsuarioSessao, opcoes = {}) {
  const api = simularApi(opcoes);
  renderizarRota("/coordenacao/adesao", { usuario });
  const secao = await screen.findByRole(
    "region",
    { name: "Links de vendas" },
    ESPERA_DO_PACOTE,
  );
  await waitFor(() =>
    expect(
      within(secao).queryByText("Carregando os links de vendas…"),
    ).toBeNull(),
  );
  return { api, secao };
}

const imprimir = vi.fn();
const escrever = vi.fn();

beforeEach(() => {
  imprimir.mockClear();
  vi.stubGlobal("print", imprimir);
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
  document.documentElement.classList.remove(CLASSE_IMPRIMINDO);
});

/** O cartão de uma célula na lista dos links. */
function cartaoDaCelula(secao: HTMLElement, nome: string): HTMLElement {
  return within(secao)
    .getByRole("heading", { level: 4, name: nome })
    .closest("article") as HTMLElement;
}

describe("CA3: o admin edita o modelo do link", () => {
  it("sem modelo: avisa que os links não foram liberados; os problemas aparecem enquanto digita; a prévia mostra o link montado", async () => {
    const { api, secao } = await abrir(ADMIN_DE_TESTE);
    expect(
      within(secao).getByText("Os links de vendas ainda não foram liberados."),
    ).toBeInTheDocument();
    expect(within(secao).queryByRole("heading", { level: 4 })).toBeNull();

    const campo = within(secao).getByRole("textbox", {
      name: "Modelo do link de vendas",
    });
    expect(campo).not.toHaveAttribute("readonly");
    expect(campo).toHaveValue("");
    expect(secao).toHaveTextContent(
      "Sem modelo, nenhuma célula tem link: os líderes veem que o link de vendas ainda não foi liberado.",
    );

    // Outro endereço: o problema aparece na hora, como erro do campo.
    fireEvent.change(campo, {
      target: { value: "https://rifei.com.br.golpe.example/{afiliado}" },
    });
    expect(campo).toHaveAttribute("aria-invalid", "true");
    expect(campo).toHaveAccessibleDescription(
      expect.stringContaining(
        "O link de vendas começa com https://rifei.com.br/, o endereço da Rifei.",
      ),
    );
    expect(secao).toHaveTextContent(
      "A prévia aparece quando o modelo não tiver problemas.",
    );

    // Sem {afiliado} e com um marcador que não existe.
    fireEvent.change(campo, {
      target: { value: "https://rifei.com.br/{slug}?celula={celula}" },
    });
    expect(campo).toHaveAccessibleDescription(
      expect.stringContaining(
        "Marcador {celula} não existe no link de vendas. Use: {slug} e {afiliado}.",
      ),
    );
    expect(campo).toHaveAccessibleDescription(
      expect.stringContaining("O modelo precisa ter {afiliado}"),
    );

    // Salvar com problema: não manda nada e o foco volta ao campo.
    const salvar = within(secao).getByRole("button", { name: "Salvar modelo" });
    salvar.focus();
    fireEvent.click(salvar);
    expect(campo).toHaveFocus();
    expect(api.corpos).toEqual([]);

    // O modelo certo: a prévia com o afiliado da primeira célula vinculada e o slug da campanha.
    fireEvent.change(campo, { target: { value: ` ${MODELO_DE_TESTE} ` } });
    expect(campo).not.toHaveAttribute("aria-invalid");
    const previa = within(secao).getByRole("figure", {
      name: "Prévia do link",
    });
    expect(previa).toHaveTextContent("Com o afiliado 1001 (Célula Ágape):");
    const link = within(previa).getByRole("link", { name: urlDeTeste(1001) });
    expect(link).toHaveAttribute("href", urlDeTeste(1001));
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(api.chamadas).toContain("GET /api/admin/campanha");
    expect(secao).toHaveTextContent(
      `${MODELO_DE_TESTE.length} de 300 caracteres`,
    );
  });

  it("Salvar manda o modelo (sem os espaços das pontas) e a lista passa a ter o link de cada célula", async () => {
    const { api, secao } = await abrir(ADMIN_DE_TESTE);
    const campo = within(secao).getByRole("textbox", {
      name: "Modelo do link de vendas",
    });
    fireEvent.change(campo, { target: { value: ` ${MODELO_DE_TESTE}\n` } });
    fireEvent.click(
      within(secao).getByRole("button", { name: "Salvar modelo" }),
    );

    expect(
      await within(secao).findByText(
        "Modelo salvo. Os links das células já usam o modelo novo.",
        { selector: ".ui-aviso__titulo" },
      ),
    ).toBeInTheDocument();
    expect(api.corpos).toEqual([{ modelo: MODELO_DE_TESTE }]);
    expect(campo).toHaveValue(MODELO_DE_TESTE);
    expect(
      within(secao).queryByText(
        "Os links de vendas ainda não foram liberados.",
      ),
    ).toBeNull();
    // A lista veio da resposta do PUT (sem outro GET): a Ágape com os dois códigos, o mais recente primeiro.
    const agape = cartaoDaCelula(secao, "Célula Ágape");
    expect(
      within(agape).getByRole("textbox", {
        name: "Link de vendas (afiliado 1077) da Célula Ágape",
      }),
    ).toHaveValue(urlDeTeste(1077));
    expect(
      within(agape).getByRole("textbox", {
        name: "Também conta para a célula (afiliado 1001) da Célula Ágape",
      }),
    ).toHaveValue(urlDeTeste(1001));
    expect(
      api.chamadas.filter(
        (chamada) => chamada === "GET /api/admin/links-vendas",
      ),
    ).toHaveLength(1);
  });

  it("apagar o modelo manda null; o 400 da API mostra os problemas no campo", async () => {
    const { api, secao } = await abrir(ADMIN_DE_TESTE, {
      modelo: MODELO_DE_TESTE,
    });
    const campo = within(secao).getByRole("textbox", {
      name: "Modelo do link de vendas",
    });
    expect(campo).toHaveValue(MODELO_DE_TESTE);

    api.proximaFalhaDoPut.push({
      status: 400,
      codigo: "requisicao_invalida",
      mensagem: "Dados inválidos",
      detalhes: [
        {
          caminho: ["modelo"],
          codigo: "custom",
          mensagem: "Problema que só a API viu.",
        },
      ],
    });
    fireEvent.change(campo, {
      target: { value: "https://rifei.com.br/{slug}/{afiliado}" },
    });
    fireEvent.click(
      within(secao).getByRole("button", { name: "Salvar modelo" }),
    );
    await waitFor(() =>
      expect(campo).toHaveAccessibleDescription(
        expect.stringContaining("Problema que só a API viu."),
      ),
    );
    expect(campo).toHaveFocus();
    expect(secao).toHaveTextContent("Não foi possível salvar o modelo.");

    fireEvent.change(campo, { target: { value: "  " } });
    fireEvent.click(
      within(secao).getByRole("button", { name: "Salvar modelo" }),
    );
    expect(
      await within(secao).findByText(
        "Modelo apagado. Os líderes veem que o link de vendas ainda não foi liberado.",
        { selector: ".ui-aviso__titulo" },
      ),
    ).toBeInTheDocument();
    expect(api.corpos).toEqual([
      { modelo: "https://rifei.com.br/{slug}/{afiliado}" },
      { modelo: null },
    ]);
    expect(
      within(secao).getByText("Os links de vendas ainda não foram liberados."),
    ).toBeInTheDocument();
  });

  it("igual ao gravado, Salvar fica indisponível e não manda nada", async () => {
    const { api, secao } = await abrir(ADMIN_DE_TESTE, {
      modelo: MODELO_DE_TESTE,
    });
    const salvar = within(secao).getByRole("button", { name: "Salvar modelo" });
    expect(salvar).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(salvar);
    expect(api.corpos).toEqual([]);
  });
});

describe("CA3: a coordenação vê o modelo só leitura", () => {
  it("o campo é só leitura, com 'Só o admin muda o modelo.', sem Salvar e sem pedir a campanha", async () => {
    const { api, secao } = await abrir(USUARIO_DE_TESTE, {
      modelo: MODELO_DE_TESTE,
    });
    const campo = within(secao).getByRole("textbox", {
      name: "Modelo do link de vendas",
    });
    expect(campo).toHaveAttribute("readonly");
    expect(campo).toHaveValue(MODELO_DE_TESTE);
    expect(campo).toHaveAccessibleDescription("Só o admin muda o modelo.");
    expect(
      within(secao).queryByRole("button", { name: "Salvar modelo" }),
    ).toBeNull();
    expect(api.chamadas).not.toContain("GET /api/admin/campanha");
    expect(api.chamadas.some((chamada) => chamada.startsWith("PUT"))).toBe(
      false,
    );
    // Os links das células aparecem para a coordenação também.
    expect(
      within(cartaoDaCelula(secao, "Célula Betel")).getByRole("textbox", {
        name: "Link de vendas (afiliado 1002) da Célula Betel",
      }),
    ).toHaveValue(urlDeTeste(1002));
  });

  it("sem modelo: a coordenação lê que só o admin preenche", async () => {
    const { secao } = await abrir(USUARIO_DE_TESTE);
    expect(secao).toHaveTextContent(
      "Falta o modelo do link, que só o admin preenche, depois de confirmar com a Rifei o formato do link de afiliado.",
    );
    expect(
      within(secao).getByRole("textbox", { name: "Modelo do link de vendas" }),
    ).toHaveValue("");
  });
});

describe("CA3: o link e o QR code de cada célula", () => {
  it("cada célula com link: Copiar, WhatsApp para o telefone do líder e Ver QR (que a câmera leria); sem afiliado, o aviso", async () => {
    const { secao } = await abrir(USUARIO_DE_TESTE, {
      modelo: MODELO_DE_TESTE,
    });
    const agape = cartaoDaCelula(secao, "Célula Ágape");
    expect(agape).toHaveTextContent("Líder: Lider Ágape · Rede Jovem Ficticia");
    const whatsapp = within(agape).getByRole("link", {
      name: "Enviar no WhatsApp o link da Célula Ágape (afiliado 1077)",
    });
    expect(whatsapp).toHaveAttribute(
      "href",
      `https://wa.me/5591900000001?text=${encodeURIComponent(
        `Compre seus bilhetes da rifa do Videira Kids pelo link da Célula Ágape: ${urlDeTeste(1077)}`,
      )}`,
    );
    // Sem telefone: o WhatsApp abre para a pessoa escolher o contato.
    expect(
      within(cartaoDaCelula(secao, "Célula Betel")).getByRole("link", {
        name: "Enviar no WhatsApp o link da Célula Betel",
      }),
    ).toHaveAttribute(
      "href",
      expect.stringMatching(/^https:\/\/wa\.me\/\?text=/),
    );

    fireEvent.click(
      within(agape).getByRole("button", {
        name: "Copiar link da Célula Ágape (afiliado 1077)",
      }),
    );
    await waitFor(() =>
      expect(escrever).toHaveBeenCalledWith(urlDeTeste(1077)),
    );

    const verQr = within(agape).getByRole("button", {
      name: "Ver QR code da Célula Ágape (afiliado 1001)",
    });
    fireEvent.click(verQr);
    const dialogo = await screen.findByRole("dialog", {
      name: "QR code da Célula Ágape (afiliado 1001)",
    });
    const qr = await within(dialogo).findByRole(
      "img",
      { name: "QR code do link de vendas da Célula Ágape" },
      ESPERA_DO_PACOTE,
    );
    expect(decodeQR(pixelsDoSvg(qr))).toBe(urlDeTeste(1001));
    fireEvent.click(within(dialogo).getByRole("button", { name: "Pronto" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect(cartaoDaCelula(secao, "Célula Canaã")).toHaveTextContent(
      "Sem link: a célula ainda não tem afiliado ligado.",
    );
  });

  it("Ver QR de cada célula com link volta exatamente ao link dela", async () => {
    const { secao } = await abrir(USUARIO_DE_TESTE, {
      modelo: MODELO_DE_TESTE,
    });
    for (const [nome, afiliado] of [
      ["Célula Ágape", 1077],
      ["Célula Betel", 1002],
    ] as const) {
      const botao = within(cartaoDaCelula(secao, nome)).getAllByRole("button", {
        name: new RegExp(`^Ver QR code da ${nome}`),
      })[0];
      fireEvent.click(botao);
      const dialogo = await screen.findByRole("dialog");
      const qr = await within(dialogo).findByRole(
        "img",
        { name: `QR code do link de vendas da ${nome}` },
        ESPERA_DO_PACOTE,
      );
      expect(decodeQR(pixelsDoSvg(qr))).toBe(urlDeTeste(afiliado));
      fireEvent.click(within(dialogo).getByRole("button", { name: "Pronto" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    }
  });

  it("Imprimir os QR codes: uma folha por célula com link (o mais recente), com o nome e o link em texto", async () => {
    const { secao } = await abrir(USUARIO_DE_TESTE, {
      modelo: MODELO_DE_TESTE,
    });
    fireEvent.click(
      within(secao).getByRole("button", { name: "Imprimir os QR codes (2)" }),
    );
    await waitFor(() => expect(imprimir).toHaveBeenCalledTimes(1));
    expect(document.documentElement).toHaveClass(CLASSE_IMPRIMINDO);
    const folhas = [
      ...document.querySelectorAll("body > .qr-folhas .qr-folha"),
    ];
    expect(
      folhas.map((folha) => [
        folha.querySelector("h2")?.textContent,
        folha.querySelector(".qr-folha__link")?.textContent,
      ]),
    ).toEqual([
      ["Célula Ágape", urlDeTeste(1077)],
      ["Célula Betel", urlDeTeste(1002)],
    ]);
    for (const folha of folhas) {
      const svg = folha.querySelector("svg") as SVGElement;
      expect(decodeQR(pixelsDoSvg(svg))).toBe(
        folha.querySelector(".qr-folha__link")?.textContent,
      );
    }
    act(() => {
      window.dispatchEvent(new Event("afterprint"));
    });
    expect(document.querySelector(".qr-folhas")).toBeNull();
  });

  it("a busca filtra as células pelo nome, pelo líder ou pelo código", async () => {
    const { secao } = await abrir(USUARIO_DE_TESTE, {
      modelo: MODELO_DE_TESTE,
    });
    const busca = within(secao).getByRole("searchbox", {
      name: "Buscar nos links: célula, líder ou código",
    });
    fireEvent.change(busca, { target: { value: "betel" } });
    expect(
      within(secao)
        .getAllByRole("heading", { level: 4 })
        .map((titulo) => titulo.textContent),
    ).toEqual(["Célula Betel"]);
    fireEvent.change(busca, { target: { value: "1077" } });
    expect(
      within(secao)
        .getAllByRole("heading", { level: 4 })
        .map((titulo) => titulo.textContent),
    ).toEqual(["Célula Ágape"]);
    expect(secao).toHaveTextContent("1 célula encontrada de 3");
  });

  it("um vínculo novo no painel (a cada 15 s) pede os links de novo; sem mudança, não pede", async () => {
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ["setTimeout", "clearTimeout", "Date"],
    });
    const { api, secao } = await abrir(USUARIO_DE_TESTE, {
      modelo: MODELO_DE_TESTE,
    });
    const pedidos = () =>
      api.chamadas.filter(
        (chamada) => chamada === "GET /api/admin/links-vendas",
      ).length;
    expect(pedidos()).toBe(1);

    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ATUALIZACAO_MS));
    await waitFor(() =>
      expect(
        api.chamadas.filter((chamada) => chamada === "GET /api/admin/adesao"),
      ).toHaveLength(2),
    );
    expect(pedidos()).toBe(1);

    api.estado.celulas[2] = {
      ...api.estado.celulas[2],
      afiliados: [1003],
      vinculada: true,
    };
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ATUALIZACAO_MS));
    await waitFor(() => expect(pedidos()).toBe(2));
    expect(
      await within(secao).findByRole("textbox", {
        name: "Link de vendas (afiliado 1003) da Célula Canaã",
      }),
    ).toHaveValue(urlDeTeste(1003));
  });
});

describe("estados da seção Links de vendas", () => {
  it("404 (sem campanha ativa): a campanha ainda não foi configurada, sem modelo nem lista", async () => {
    const { secao } = await abrir(ADMIN_DE_TESTE, {
      falhasDoGet: [
        { status: 404, codigo: "nao_encontrado", mensagem: "Sem campanha" },
      ],
    });
    expect(
      within(secao).getByText("A campanha ainda não foi configurada."),
    ).toBeInTheDocument();
    expect(within(secao).queryByRole("textbox")).toBeNull();
    expect(within(secao).queryByRole("button")).toBeNull();
  });

  it("falha ao carregar: o erro com Tentar de novo, que pede a lista outra vez", async () => {
    const { api, secao } = await abrir(USUARIO_DE_TESTE, {
      modelo: MODELO_DE_TESTE,
      falhasDoGet: [
        { status: 503, codigo: "indisponivel", mensagem: "Fora do ar" },
      ],
    });
    const alerta = within(secao).getByRole("alert");
    expect(alerta).toHaveTextContent(
      "Não foi possível carregar os links de vendas.",
    );
    fireEvent.click(
      within(alerta).getByRole("button", { name: "Tentar de novo" }),
    );
    expect(
      await within(secao).findByRole("textbox", {
        name: "Link de vendas (afiliado 1002) da Célula Betel",
      }),
    ).toHaveValue(urlDeTeste(1002));
    expect(
      api.chamadas.filter(
        (chamada) => chamada === "GET /api/admin/links-vendas",
      ),
    ).toHaveLength(2);
  });

  it("403 no PUT (a sessão deixou de ser admin): só o admin muda o modelo, e nada muda na tela", async () => {
    const { api, secao } = await abrir(ADMIN_DE_TESTE);
    api.proximaFalhaDoPut.push({
      status: 403,
      codigo: "proibido",
      mensagem: "Sem permissão",
    });
    fireEvent.change(
      within(secao).getByRole("textbox", { name: "Modelo do link de vendas" }),
      { target: { value: MODELO_DE_TESTE } },
    );
    fireEvent.click(
      within(secao).getByRole("button", { name: "Salvar modelo" }),
    );
    expect(
      await within(secao).findByText("Só o admin muda o modelo.", {
        selector: ".ui-aviso__titulo",
      }),
    ).toBeInTheDocument();
    expect(api.estado.modelo).toBeNull();
    expect(
      within(secao).getByText("Os links de vendas ainda não foram liberados."),
    ).toBeInTheDocument();
  });
});

// RIFA-045 nos controles da RIFA-046: o resto da Adesão é da fase 2 das dicas, então a varredura fica na seção
// "Links de vendas" (e no diálogo do "Ver QR", que deixa o resto da página `inert`).
describe("dicas nos botões e campos dos links de vendas", () => {
  it("admin com o modelo gravado: o campo, Salvar (indisponível), Imprimir os QR codes, a busca e os links de cada célula; no Ver QR, o diálogo", async () => {
    const { secao } = await abrir(ADMIN_DE_TESTE, { modelo: MODELO_DE_TESTE });
    await within(secao).findByRole("link", { name: urlDeTeste(1001) });
    // Modelo, Salvar, Imprimir os QR codes, busca; Ágape (2 links × 4) e Betel (4).
    expect(contarControles(secao)).toBe(16);
    expect(controlesSemDica(secao)).toEqual([]);

    const texto = (papel: "button" | "link" | "textbox", nome: string) =>
      textoDaDica(within(secao).getByRole(papel, { name: nome }));
    expect(texto("textbox", "Modelo do link de vendas")).toBe(
      "O endereço do link de afiliado da Rifei, com {slug} e {afiliado}.",
    );
    expect(texto("button", "Salvar modelo")).toBe(
      "Nada mudou desde o modelo gravado.",
    );
    // A prévia é um link comum (a varredura não o pega): a dica confere à parte.
    expect(texto("link", urlDeTeste(1001))).toBe(
      "Abre o link de exemplo na Rifei para conferir.",
    );
    expect(texto("button", "Imprimir os QR codes (2)")).toBe(
      "Imprime uma página por célula com link.",
    );
    expect(
      textoDaDica(
        within(secao).getByRole("searchbox", {
          name: "Buscar nos links: célula, líder ou código",
        }),
      ),
    ).toBe("Filtra pelo nome da célula, do líder ou pelo código.");
    // WhatsApp: com o telefone do líder (Ágape) e sem ele (Betel, a pessoa escolhe o contato).
    expect(
      texto(
        "link",
        "Enviar no WhatsApp o link da Célula Ágape (afiliado 1077)",
      ),
    ).toBe(
      "Abre o WhatsApp com a mensagem e o link prontos para o telefone do líder.",
    );
    expect(texto("link", "Enviar no WhatsApp o link da Célula Betel")).toBe(
      DICAS_DO_QR.enviarWhatsApp,
    );
    expect(texto("button", "Copiar link da Célula Betel")).toBe(
      "Copia o link de vendas para colar onde quiser.",
    );
    expect(
      texto("textbox", "Link de vendas (afiliado 1002) da Célula Betel"),
    ).toBe("Toque para selecionar o link inteiro.");

    // Com o campo mudado, Salvar diz o que acontece.
    fireEvent.change(
      within(secao).getByRole("textbox", { name: "Modelo do link de vendas" }),
      { target: { value: "https://rifei.com.br/{slug}/{afiliado}" } },
    );
    expect(texto("button", "Salvar modelo")).toBe(
      "Grava o modelo; os links de todas as células mudam na hora.",
    );

    const verQr = within(cartaoDaCelula(secao, "Célula Betel")).getByRole(
      "button",
      { name: "Ver QR code da Célula Betel" },
    );
    fireEvent.pointerDown(verQr);
    fireEvent.click(verQr);
    const dialogo = await screen.findByRole("dialog", {
      name: "QR code da Célula Betel",
    });
    await within(dialogo).findByRole("img", undefined, ESPERA_DO_PACOTE);
    // O ×, Baixar imagem, Imprimir e Pronto.
    expect(contarControles(dialogo)).toBe(4);
    expect(controlesSemDica(dialogo)).toEqual([]);
  });

  it("coordenação: o modelo só leitura tem a dica de que só o admin muda", async () => {
    const { secao } = await abrir(USUARIO_DE_TESTE, {
      modelo: MODELO_DE_TESTE,
    });
    // Modelo (só leitura), Imprimir os QR codes, busca e os links das células.
    expect(contarControles(secao)).toBe(15);
    expect(controlesSemDica(secao)).toEqual([]);
    expect(
      textoDaDica(
        within(secao).getByRole("textbox", {
          name: "Modelo do link de vendas",
        }),
      ),
    ).toBe(DICAS.modeloSoLeitura);
  });

  it("nenhuma célula com link: Imprimir os QR codes indisponível diz por quê", async () => {
    const { secao } = await abrir(USUARIO_DE_TESTE, {
      modelo: MODELO_DE_TESTE,
      celulas: [celula(3, "Célula Canaã")],
    });
    const imprimirTodos = within(secao).getByRole("button", {
      name: "Imprimir os QR codes (0)",
    });
    expect(imprimirTodos).toHaveAttribute("aria-disabled", "true");
    expect(controlesSemDica(secao)).toEqual([]);
    expect(textoDaDica(imprimirTodos)).toBe(DICAS.imprimirOsQrCodesSemLink);
  });

  it("busca sem resultado e admin sem modelo: os controles que sobram também têm dica", async () => {
    const { secao } = await abrir(ADMIN_DE_TESTE, { modelo: MODELO_DE_TESTE });
    fireEvent.change(
      within(secao).getByRole("searchbox", {
        name: "Buscar nos links: célula, líder ou código",
      }),
      { target: { value: "nada-com-isto" } },
    );
    expect(
      within(secao).getByText("Nenhuma célula encontrada."),
    ).toBeInTheDocument();
    expect(controlesSemDica(secao)).toEqual([]);
  });
});
