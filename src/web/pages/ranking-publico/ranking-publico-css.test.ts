// RIFA-050 (P2.4 e P2.5): o CSS do ranking público, lido do disco. Só variáveis do tema que existem (nenhuma cor nem
// medida solta); a faixa da fase num tom claro, com contraste; a faixa do pódio dentro da borda (sem o
// left: -1px de antes); a lista corta as partículas da comemoração nos lados (sem rolagem lateral); a pílula da
// meta batida só fica amarela quando o número termina de contar; o movimento novo só sem prefers-reduced-motion. A
// medida na tela de verdade (390 e 360 px no meio da comemoração, CLS) está nas capturas do Playwright.
import { describe, expect, it } from "vitest";

// O Vitest esvazia todo import de CSS (até com ?raw): o texto vem do disco, pelo fs do Node.
type ModuloFs = { readFileSync(caminho: string, codificacao: "utf8"): string };
const { process } = globalThis as unknown as {
  process: { getBuiltinModule(nome: "node:fs"): ModuloFs };
};
const lerArquivo = (relativo: string) =>
  process
    .getBuiltinModule("node:fs")
    .readFileSync(
      decodeURIComponent(new URL(relativo, import.meta.url).pathname),
      "utf8",
    );

const semComentarios = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const tokensCss = lerArquivo("../../tema/tokens.css");
const css = semComentarios(lerArquivo("./ranking-publico.css"));

/** As cores do tema claro (:root), seguindo var(--x). */
const TEMA = (() => {
  const inicio = tokensCss.indexOf(":root {");
  const bloco = tokensCss.slice(inicio, tokensCss.indexOf("}", inicio));
  return new Map(
    [...bloco.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((par) => [
      par[1],
      par[2].trim(),
    ]),
  );
})();

function cor(nome: string): string {
  const valor = TEMA.get(nome);
  if (!valor) throw new Error(`${nome} não está no tema`);
  const referencia = /^var\((--[\w-]+)\)$/.exec(valor);
  return referencia ? cor(referencia[1]) : valor;
}

function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a: string, b: string): number {
  const [clara, escura] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (clara + 0.05) / (escura + 0.05);
}

/** Cada regra: os seletores (um por item da lista, sem quebras) e as declarações. */
const REGRAS = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
  ([, seletor, corpo]) => ({
    seletores: seletor
      .replace(/^[\s\S]*@media[^{]*$/, "")
      .split(/,(?![^(]*\))/)
      .map((parte) => parte.trim().replace(/\s+/g, " ")),
    declaracoes: new Map(
      [...corpo.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map(
        ([, propriedade, valor]) => [propriedade, valor.trim()],
      ),
    ),
  }),
);

function valorDe(seletor: string, propriedade: string): string | undefined {
  return REGRAS.filter(
    ({ seletores, declaracoes }) =>
      seletores.includes(seletor) && declaracoes.has(propriedade),
  )
    .at(-1)
    ?.declaracoes.get(propriedade);
}

/** O CSS dentro de @media (prefers-reduced-motion: no-preference) { ... } (o bloco inteiro, com as chaves). */
function blocosSemReduce(texto: string): string {
  const blocos: string[] = [];
  for (const inicio of texto.matchAll(
    /@media \(prefers-reduced-motion: no-preference\)\s*\{/g,
  )) {
    let profundidade = 1;
    let i = (inicio.index ?? 0) + inicio[0].length;
    const comeco = i;
    while (profundidade > 0 && i < texto.length) {
      if (texto[i] === "{") profundidade += 1;
      if (texto[i] === "}") profundidade -= 1;
      i += 1;
    }
    blocos.push(texto.slice(comeco, i - 1));
  }
  return blocos.join("\n");
}

describe("RIFA-050: o CSS do ranking público", () => {
  it("usa só variáveis do tema que existem (nenhuma cor solta, nenhum rgba)", () => {
    const usadas = [...css.matchAll(/var\((--[\w-]+)\)/g)].map(
      ([, nome]) => nome,
    );
    expect(usadas.length).toBeGreaterThan(30);
    for (const nome of new Set(usadas))
      expect(tokensCss.includes(`${nome}:`), nome).toBe(true);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  it("P2.5: a faixa do pódio é uma camada do fundo, dentro da borda e de cima a baixo (segue o raio do cartão), sem o left: -1px de antes", () => {
    const fundo = valorDe(
      ".ranking-publico__item[data-destaque]",
      "background",
    );
    expect(fundo).toMatch(
      /^linear-gradient\(\s*var\(--marca-verde-agua-forte\),\s*var\(--marca-azul-forte\),\s*var\(--marca-roxo\)\s*\)\s*left \/ 4px 100% no-repeat,\s*var\(--cor-superficie\)$/,
    );
    expect(css).not.toMatch(/data-destaque\]::before/);
    expect(css).not.toMatch(/left:\s*-/);
  });

  it("P2.4: a lista (não o item) corta as partículas nos lados, sem cortar a sombra dos itens", () => {
    // No item que o FLIP desliza, o overflow: clip faz o Chrome contar a troca de lugar como layout shift.
    expect(valorDe(".ranking-publico__item", "overflow")).toBeUndefined();
    expect(valorDe(".ranking-publico__lista", "overflow-x")).toBe("clip");
    expect(valorDe(".ranking-publico__lista", "padding")).toBe(
      "0 var(--espaco-2)",
    );
    expect(valorDe(".ranking-publico__lista", "margin")).toBe(
      "0 calc(-1 * var(--espaco-2))",
    );
  });

  it("P2.5: a faixa da fase num tom claro (sem repetir o degradê forte do topo), com os pares de contraste do tema", () => {
    expect(valorDe(".ranking-publico__fase", "background")).toBe(
      "var(--cor-primaria-suave)",
    );
    expect(valorDe(".ranking-publico__fase", "color")).toBe("var(--cor-texto)");
    expect(valorDe(".ranking-publico__fase-destaque", "color")).toBe(
      "var(--cor-primaria-forte)",
    );
    expect(valorDe(".ranking-publico__linha-do-tempo", "color")).toBe(
      "var(--cor-texto-suave)",
    );
    for (const texto of [
      "--cor-texto",
      "--cor-primaria-forte",
      "--cor-texto-suave",
    ])
      expect(
        contraste(cor(texto), cor("--cor-primaria-suave")),
        texto,
      ).toBeGreaterThanOrEqual(4.5);
    expect(css).not.toMatch(/gradiente-marca-forte/);
  });

  it("P2.5: a linha do tempo: o trilho branco e os dias passados no degradê da marca (decorativo), enchendo uma vez, só sem reduce", () => {
    expect(valorDe(".ranking-publico__trilho", "background")).toBe(
      "var(--cor-superficie)",
    );
    expect(valorDe(".ranking-publico__percorrido", "background")).toBe(
      "var(--gradiente-marca)",
    );
    const semReduce = blocosSemReduce(css);
    expect(semReduce).toMatch(
      /\.ranking-publico__percorrido\s*\{\s*animation:\s*ui-encher [^;]+;/,
    );
    // Fora do @media, nenhuma animação nova.
    const fora = css.replace(semReduce, "");
    expect(fora).not.toMatch(/animation\s*:/);
  });

  it("P2.4: a pílula da meta batida só fica amarela quando o número termina de contar; a regra antiga saiu", () => {
    expect(
      valorDe(
        ".ranking-publico__item[data-meta-batida] .ranking-publico__percentual:not(:has(.mov-contagem))",
        "background",
      ),
    ).toBe("var(--cor-comemoracao)");
    expect(
      valorDe(
        ".ranking-publico__item[data-meta-batida] .ranking-publico__percentual",
        "background",
      ),
    ).toBeUndefined();
  });

  it("o carregando e a falha da primeira carga seguram a altura da tela (o rodapé não sobe: CLS)", () => {
    expect(css).toMatch(
      /\.ui-public-shell__conteudo:has\(\s*\.ranking-publico__carregando,\s*\.ranking-publico__fase,\s*\.ranking-publico__falhou\s*\)\s*\{\s*min-height: 100vh;\s*min-height: 100dvh;/,
    );
  });

  it("o esqueleto aparece nas cores forçadas (a borda, já que o fundo some)", () => {
    expect(css).toMatch(
      /@media \(forced-colors: active\)\s*\{\s*\.ranking-publico__esqueleto \.mov-esqueleto\s*\{\s*border: 1px solid GrayText;/,
    );
  });

  it("a fase e o % na fonte dos títulos", () => {
    expect(valorDe(".ranking-publico__fase-destaque", "font-family")).toBe(
      "var(--fonte-titulo)",
    );
    expect(valorDe(".ranking-publico__percentual", "font-family")).toBe(
      "var(--fonte-titulo)",
    );
  });
});
