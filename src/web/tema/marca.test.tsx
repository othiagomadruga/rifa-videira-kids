// CA2 e CA3 (RIFA-020): o logo da Videira no cabeçalho das telas abertas (ranking público, entrar, acesso), no
// shell da coordenação e no telão, com o alt certo e o nome do produto em texto; o favicon é o símbolo. O logo do
// Kids, discreto: no rodapé das telas abertas (fora do cabeçalho) e no máximo um selo no telão.
import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderizarRota, respostaJson } from "../test/renderizar";
import { MARCA } from "./marca";

type ModuloFs = {
  readFileSync(caminho: string): Uint8Array;
  readFileSync(caminho: string, codificacao: "utf8"): string;
};
const { process } = globalThis as unknown as {
  process: { getBuiltinModule(nome: "node:fs"): ModuloFs };
};
const fs = process.getBuiltinModule("node:fs");
// O caminho vai numa variável: com um texto fixo, o Vite trocaria o new URL(..., import.meta.url) pela URL do asset.
const caminho = (relativo: string) =>
  decodeURIComponent(new URL(relativo, import.meta.url).pathname);

const ALT_LOGO = "Videira Igreja em Células";
const TOKEN = "a".repeat(43);

/**
 * O cabeçalho da moldura (PublicShell ou AppShell). Pelo elemento: o Testing Library conta como "banner" também o
 * <header> do PageHeader, que fica dentro do <main>.
 */
function cabecalhoDaMoldura(): HTMLElement {
  const cabecalho = document.querySelector<HTMLElement>(
    "header.ui-public-shell__topo, header.ui-app-shell__topo",
  );
  if (!cabecalho) throw new Error("a tela não tem o cabeçalho da moldura");
  return cabecalho;
}

/** As imagens do Kids na tela (decorativas no rodapé, então pelo arquivo, não pelo nome). */
const imagensDoKids = (raiz: ParentNode = document) =>
  [...raiz.querySelectorAll("img")].filter(
    (imagem) => imagem.getAttribute("src") === MARCA.kids.src,
  );

beforeEach(() => {
  // Sem sessão (401) e sem campanha (404): o que importa aqui é a moldura das telas.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL) =>
      String(entrada).startsWith("/api/sessao")
        ? respostaJson(
            { erro: { codigo: "nao_autenticado", mensagem: "Sem sessão" } },
            401,
          )
        : respostaJson(
            { erro: { codigo: "nao_encontrado", mensagem: "Sem campanha" } },
            404,
          ),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function conferirLogo(cabecalho: HTMLElement) {
  const logo = within(cabecalho).getByRole("img", { name: ALT_LOGO });
  // WebP com o PNG de reserva; largura e altura reservam o lugar antes de carregar (nada pula).
  expect(logo).toHaveAttribute("src", MARCA.logo.png);
  expect(logo).toHaveAttribute("width", "272");
  expect(logo).toHaveAttribute("height", "105");
  const fonte = logo.closest("picture")?.querySelector("source");
  expect(fonte).toHaveAttribute("type", "image/webp");
  expect(fonte).toHaveAttribute("srcset", MARCA.logo.webp);
  // O nome do produto continua em texto.
  expect(cabecalho).toHaveTextContent("Projeto Videira Kids");
}

describe("CA2: o logo da Videira", () => {
  it.each([
    ["/", "Ranking da campanha"],
    ["/entrar", "Entrar"],
    [`/acesso/${TOKEN}`, "Entrar no sistema da Projeto Videira Kids"],
  ])("tela aberta %s: no cabeçalho, com o alt certo", async (rota, titulo) => {
    renderizarRota(rota, { usuario: null });
    await screen.findByRole("heading", { level: 1, name: titulo });
    conferirLogo(cabecalhoDaMoldura());
  });

  it("shell da coordenação: no topo da barra, ao lado de 'Projeto Videira Kids · Coordenação'", () => {
    renderizarRota("/coordenacao");
    const topo = cabecalhoDaMoldura();
    conferirLogo(topo);
    expect(topo).toHaveTextContent("Projeto Videira KidsCoordenação");
  });

  it("telão: no canto do topo", () => {
    renderizarRota("/telao");
    const marca = document.querySelector<HTMLElement>(".telao__marca");
    expect(marca).not.toBeNull();
    conferirLogo(marca as HTMLElement);
  });

  it("telão: o selo claro só aparece com o logo carregado (nada de retângulo branco vazio)", () => {
    renderizarRota("/telao");
    const logo = screen.getByRole("img", { name: ALT_LOGO });
    const selo = logo.closest(".ui-marca__selo");
    expect(selo).not.toHaveAttribute("data-carregado");

    fireEvent.load(logo);
    expect(selo).toHaveAttribute("data-carregado");

    // O fundo claro do selo vem só com data-carregado; antes, só o lugar (padding) fica reservado.
    const css = fs
      .readFileSync(caminho("../components/ui/Marca.css"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const regras = [
      ...css.matchAll(
        /(\[data-tema="telao"\] \.ui-marca__selo[^{]*)\{([^}]*)\}/g,
      ),
    ].map(([, seletor, corpo]) => ({ seletor: seletor.trim(), corpo }));
    const comFundo = regras.filter(({ corpo }) => /background/.test(corpo));
    expect(comFundo.map(({ seletor }) => seletor)).toEqual([
      '[data-tema="telao"] .ui-marca__selo[data-carregado]',
    ]);
  });

  it("telas abertas (RIFA-049): a marca na faixa escura, com o logo no selo claro só depois de carregar", async () => {
    renderizarRota("/entrar", { usuario: null });
    await screen.findByRole("heading", { level: 1, name: "Entrar" });
    const cabecalho = cabecalhoDaMoldura();
    conferirLogo(cabecalho);
    const marca = cabecalho.querySelector(".ui-marca");
    expect(marca).toHaveAttribute("data-fundo", "escuro");
    const logo = within(cabecalho).getByRole("img", { name: ALT_LOGO });
    const selo = logo.closest(".ui-marca__selo");
    expect(selo).not.toHaveAttribute("data-carregado");
    fireEvent.load(logo);
    expect(selo).toHaveAttribute("data-carregado");

    // O fundo claro do selo vem só com data-carregado (o logo nunca é recolorido: nenhum filtro na imagem).
    const css = fs
      .readFileSync(caminho("../components/ui/Marca.css"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const regras = [
      ...css.matchAll(
        /(\.ui-marca\[data-fundo="escuro"\] \.ui-marca__selo[^{]*)\{([^}]*)\}/g,
      ),
    ].map(([, seletor, corpo]) => ({ seletor: seletor.trim(), corpo }));
    expect(regras.length).toBeGreaterThanOrEqual(2);
    expect(
      regras
        .filter(({ corpo }) => /background/.test(corpo))
        .map(({ seletor }) => seletor),
    ).toEqual([
      '.ui-marca[data-fundo="escuro"] .ui-marca__selo[data-carregado]',
    ]);
    expect(css).not.toMatch(/filter\s*:/);
  });

  it("coordenação e /minha continuam com a marca no fundo claro (sem o selo)", () => {
    renderizarRota("/coordenacao");
    expect(cabecalhoDaMoldura().querySelector(".ui-marca")).not.toHaveAttribute(
      "data-fundo",
    );
  });

  it("o logo é um só em cada tela (o símbolo provisório 'VK' saiu)", () => {
    renderizarRota("/");
    expect(screen.getAllByRole("img", { name: ALT_LOGO })).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/\bVK\b/);
  });
});

describe("CA2: o favicon e o ícone da tela inicial são o símbolo da Videira", () => {
  const html = fs.readFileSync(caminho("../../../index.html"), "utf8");

  it("o index.html aponta os dois", () => {
    expect(html).toMatch(/<link rel="icon" href="\/favicon\.ico"/);
    expect(html).toMatch(
      /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png"/,
    );
  });

  it("favicon.ico: 4 tamanhos quadrados (16, 32, 48 e 64), só o símbolo (o logo inteiro é largo)", () => {
    const ico = fs.readFileSync(caminho("../../../public/favicon.ico"));
    const visao = new DataView(ico.buffer, ico.byteOffset, ico.byteLength);
    expect(visao.getUint16(2, true)).toBe(1); // tipo: ícone
    const quantos = visao.getUint16(4, true);
    const lados = Array.from({ length: quantos }, (_, i) => {
      const largura = ico[6 + i * 16] || 256;
      const altura = ico[7 + i * 16] || 256;
      return [largura, altura];
    });
    expect(lados.map(([largura]) => largura).sort((a, b) => a - b)).toEqual([
      16, 32, 48, 64,
    ]);
    for (const [largura, altura] of lados) expect(largura).toBe(altura);
  });

  it("apple-touch-icon.png: 180×180", () => {
    const png = fs.readFileSync(
      caminho("../../../public/apple-touch-icon.png"),
    );
    const visao = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect([...png.slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]); // "PNG"
    expect([visao.getUint32(16), visao.getUint32(20)]).toEqual([180, 180]);
  });
});

describe("CA3: o logo do Kids, discreto", () => {
  it.each([
    ["/", "Ranking da campanha"],
    ["/entrar", "Entrar"],
    [`/acesso/${TOKEN}`, "Entrar no sistema da Projeto Videira Kids"],
  ])(
    "tela aberta %s: só no rodapé, com a frase da campanha",
    async (rota, titulo) => {
      renderizarRota(rota, { usuario: null });
      await screen.findByRole("heading", { level: 1, name: titulo });

      const rodape = screen.getByRole("contentinfo");
      expect(rodape).toHaveTextContent(
        "Campanha em prol do espaço Videira Kids",
      );
      // RIFA-067: o crédito de quem desenvolveu, no rodapé de toda tela aberta.
      expect(rodape).toHaveTextContent("Sistema desenvolvido por GODy Tech");
      const [selo, ...outros] = imagensDoKids();
      expect(outros).toHaveLength(0);
      expect(rodape).toContainElement(selo);
      // A frase ao lado já diz o nome: a imagem é decorativa.
      expect(selo).toHaveAttribute("alt", "");
      expect(imagensDoKids(cabecalhoDaMoldura())).toHaveLength(0);
    },
  );

  it("o selo do rodapé é pequeno: 40 px (2,5rem), entre 32 e 48", () => {
    const css = fs
      .readFileSync(caminho("../components/ui/PublicShell.css"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const regra = /\.ui-public-shell__selo-kids\s*\{([^}]*)\}/.exec(css)?.[1];
    expect(regra).toMatch(/width:\s*2\.5rem;/);
    expect(regra).toMatch(/height:\s*2\.5rem;/);
  });

  it("telão: um selo só, com o nome no alt, longe do logo da Videira", () => {
    renderizarRota("/telao");
    expect(imagensDoKids()).toHaveLength(1);
    const selo = screen.getByRole("img", { name: "Videira Kids" });
    expect(document.querySelector(".telao__marca")?.contains(selo)).toBe(false);
  });

  it("a coordenação não tem o selo (ele é das telas abertas)", () => {
    renderizarRota("/coordenacao");
    expect(imagensDoKids()).toHaveLength(0);
  });
});
