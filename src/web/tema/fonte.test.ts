// RIFA-049 (P1.13, D25): a fonte dos títulos. Um arquivo só (Outfit 800, subconjunto latino, woff2), do próprio site
// (nenhuma URL externa), até 16 KiB, com a licença OFL ao lado; o @font-face com font-display: swap e a reserva
// ajustada; o preload do index.html aponta para o MESMO arquivo que o @font-face (o Vite troca os dois pelo arquivo com
// hash: conferido no build, docs/frontend.md); o texto corrido continua na fonte do sistema.
import { describe, expect, it } from "vitest";

type ModuloFs = {
  readFileSync(caminho: string): Uint8Array;
  readFileSync(caminho: string, codificacao: "utf8"): string;
  readdirSync(caminho: string): string[];
  existsSync(caminho: string): boolean;
};
const { process } = globalThis as unknown as {
  process: { getBuiltinModule(nome: "node:fs"): ModuloFs };
};
const fs = process.getBuiltinModule("node:fs");
// O caminho vai numa variável: com um texto fixo, o Vite trocaria o new URL(..., import.meta.url) pela URL do asset.
const caminho = (relativo: string, base: string = import.meta.url) =>
  decodeURIComponent(new URL(relativo, base).pathname);
const lerTexto = (relativo: string) =>
  fs.readFileSync(caminho(relativo), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const BASE_CSS = lerTexto("./base.css");
const TOKENS_CSS = lerTexto("./tokens.css");
const INDEX_HTML = fs.readFileSync(caminho("../../../index.html"), "utf8");
const RAIZ = caminho("../../../");

/** Os blocos @font-face do base.css, como propriedade → valor. */
const FACES = [...BASE_CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(
  ([, corpo]) =>
    Object.fromEntries(
      [...corpo.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map(([, p, v]) => [
        p,
        v.replace(/\s+/g, " ").trim(),
      ]),
    ),
);
const OUTFIT = FACES.find((face) => face["font-family"] === '"Outfit"');
const RESERVA = FACES.find(
  (face) => face["font-family"] === '"Outfit reserva"',
);

describe("fonte dos títulos: o arquivo", () => {
  it("um woff2 só, do próprio site (tema/fontes), com a licença OFL", () => {
    const pasta = fs.readdirSync(caminho("./fontes/")).sort();
    expect(pasta).toEqual(["OFL.txt", "outfit-latin-800-normal.woff2"]);
    const arquivo = fs.readFileSync(
      caminho("./fontes/outfit-latin-800-normal.woff2"),
    );
    // Assinatura do woff2 ("wOF2") e o teto do plano.
    expect(String.fromCharCode(...arquivo.slice(0, 4))).toBe("wOF2");
    expect(arquivo.byteLength).toBeLessThanOrEqual(16 * 1024);
    expect(fs.readFileSync(caminho("./fontes/OFL.txt"), "utf8")).toMatch(
      /SIL Open Font License, Version 1\.1/,
    );
  });

  it("nenhuma fonte de fora (CDN, Google Fonts) e nenhum outro arquivo de fonte no site", () => {
    expect(BASE_CSS).not.toMatch(/https?:|\/\/fonts\./);
    expect(INDEX_HTML).not.toMatch(
      /fonts\.googleapis|fonts\.gstatic|https?:\/\/[^"]*\.woff/,
    );
    const publico = fs.readdirSync(`${RAIZ}public`);
    expect(publico.filter((nome) => /\.(woff2?|ttf|otf)$/.test(nome))).toEqual(
      [],
    );
  });
});

describe("fonte dos títulos: o @font-face e o preload", () => {
  it("a Outfit: 800, normal, font-display: swap, src relativo em ./fontes/ (o Vite põe o hash e a base)", () => {
    expect(OUTFIT).toMatchObject({
      "font-weight": "800",
      "font-style": "normal",
      "font-display": "swap",
      src: 'url("./fontes/outfit-latin-800-normal.woff2") format("woff2")',
    });
    // Só o subconjunto latino (com o á, o ç e o º/ª).
    expect(OUTFIT?.["unicode-range"]).toMatch(/^U\+0000-00FF,/);
  });

  it("o preload do index.html aponta para o mesmo arquivo do @font-face, como fonte e com crossorigin", () => {
    const preloads = [
      ...INDEX_HTML.matchAll(/<link\s+([^>]*rel="preload"[^>]*)\/?>/g),
    ].map(([, atributos]) => atributos.replace(/\s+/g, " "));
    expect(preloads).toHaveLength(1);
    const [preload] = preloads;
    expect(preload).toMatch(/as="font"/);
    expect(preload).toMatch(/type="font\/woff2"/);
    expect(preload).toMatch(/\bcrossorigin\b/);
    const href = /href="([^"]+)"/.exec(preload)?.[1] ?? "";
    // Caminho do arquivo-fonte (o Vite o troca pelo arquivo com hash); nunca o caminho absoluto /fontes/...
    expect(href).toMatch(/^\/src\/web\//);
    const doPreload = `${RAIZ}${href.slice(1)}`;
    const doFontFace = caminho("./fontes/outfit-latin-800-normal.woff2");
    expect(doPreload).toBe(doFontFace);
    expect(fs.existsSync(doPreload)).toBe(true);
  });

  it("a reserva enquanto a Outfit chega: fontes locais com a largura e a altura ajustadas", () => {
    expect(RESERVA).toBeDefined();
    expect(RESERVA?.src).toMatch(/^local\(/);
    expect(RESERVA?.src).not.toMatch(/url\(/);
    expect(RESERVA?.["size-adjust"]).toMatch(/^\d+(\.\d+)?%$/);
    expect(RESERVA?.["ascent-override"]).toMatch(/^\d+(\.\d+)?%$/);
    expect(RESERVA?.["descent-override"]).toMatch(/^\d+(\.\d+)?%$/);
  });
});

describe("fonte dos títulos: onde ela vale", () => {
  it("--fonte-titulo é a Outfit, depois a reserva, depois a fonte do sistema", () => {
    expect(TOKENS_CSS).toMatch(
      /--fonte-titulo:\s*"Outfit",\s*"Outfit reserva",\s*var\(--fonte-base\);/,
    );
  });

  it("o texto corrido continua na fonte do sistema (o body); a do título só nos títulos e nos números de destaque", () => {
    expect(BASE_CSS).toMatch(
      /body\s*\{[^}]*font-family:\s*var\(--fonte-base\);/,
    );
    const usos = import.meta.glob<string>(["../**/*.css"], {
      query: "?raw",
      import: "default",
      eager: true,
    });
    // O Vitest esvazia os imports de CSS: lê do disco os arquivos que o glob achou.
    const comTitulo = Object.keys(usos)
      .filter((arquivo) =>
        /var\(--fonte-titulo\)/.test(fs.readFileSync(caminho(arquivo), "utf8")),
      )
      .sort();
    expect(comTitulo).toEqual(
      expect.arrayContaining([
        "../components/ui/Marca.css",
        "../components/ui/PageHeader.css",
        "../components/ui/Stat.css",
        "./base.css",
      ]),
    );
    expect(BASE_CSS).toMatch(
      /h1\s*\{[^}]*font-family:\s*var\(--fonte-titulo\);/,
    );
  });
});
