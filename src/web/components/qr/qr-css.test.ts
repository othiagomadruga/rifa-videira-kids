// O CSS do link de vendas (RIFA-046): o do QR code e do "Copiar link" (components/qr) e o da seção da Adesão. Lido
// do disco (o Vitest esvazia os imports de CSS): só variáveis do tema que existem (o QR é preto no branco pelas
// cores fixas do <svg>, nunca pelo CSS), nenhuma medida em px fora das bordas, nenhuma largura fixa (390 px sem
// rolagem lateral; a medida na tela de verdade é das capturas) e a impressão só com as folhas, com o QR de 4 cm ou
// mais.
import { describe, expect, it } from "vitest";

type ModuloFs = { readFileSync(caminho: string, codificacao: "utf8"): string };
const { process } = globalThis as unknown as {
  process: { getBuiltinModule(nome: "node:fs"): ModuloFs };
};
const ler = (relativo: string) =>
  process
    .getBuiltinModule("node:fs")
    .readFileSync(
      decodeURIComponent(new URL(relativo, import.meta.url).pathname),
      "utf8",
    )
    .replace(/\/\*[\s\S]*?\*\//g, "");

const TOKENS = ler("../../tema/tokens.css");
const ARQUIVOS = {
  "qr-codigo.css": ler("./qr-codigo.css"),
  "compartilhar.css": ler("./compartilhar.css"),
  "adesao/links-vendas.css": ler("../../pages/adesao/links-vendas.css"),
};
const QR = ARQUIVOS["qr-codigo.css"];

/** O CSS sem o bloco @media print (a folha impressa usa cm e pt). */
function semImpressao(css: string): string {
  const inicio = css.indexOf("@media print");
  if (inicio < 0) return css;
  let profundidade = 0;
  for (let i = css.indexOf("{", inicio); i < css.length; i += 1) {
    if (css[i] === "{") profundidade += 1;
    if (css[i] === "}") profundidade -= 1;
    if (profundidade === 0) return css.slice(0, inicio) + css.slice(i + 1);
  }
  return css;
}

describe("o CSS do link de vendas", () => {
  it.each(Object.entries(ARQUIVOS))(
    "%s: só variáveis do tema que existem, sem cor solta",
    (_arquivo, css) => {
      const usadas = [...css.matchAll(/var\((--[\w-]+)\)/g)].map(
        ([, nome]) => nome,
      );
      expect(usadas.length).toBeGreaterThan(5);
      for (const nome of usadas)
        expect(TOKENS, nome).toMatch(new RegExp(`${nome}\\s*:`));
      expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    },
  );

  it.each(Object.entries(ARQUIVOS))(
    "%s: nenhuma largura fixa nem px fora das bordas (na tela)",
    (_arquivo, css) => {
      for (const [, propriedade, valor] of semImpressao(css).matchAll(
        /([\w-]+)\s*:\s*([^;{}]+);/g,
      )) {
        if (/^(min-|max-)?width$/.test(propriedade))
          expect(valor.trim(), `${propriedade}: ${valor}`).toMatch(
            /^(0|100%|min\(100%, \d+rem\)|var\(--[\w-]+\))$/,
          );
        if (propriedade === "grid-template-columns")
          expect(valor, `${propriedade}: ${valor}`).toMatch(
            /minmax\(min\(100%,|minmax\(0,/,
          );
        if (!/^border/.test(propriedade))
          expect(valor, `${propriedade}: ${valor}`).not.toMatch(/\d+px/);
      }
    },
  );

  it("nomes e links quebram a linha em vez de alargar a página", () => {
    const todos = Object.values(ARQUIVOS).join("\n");
    for (const seletor of [
      ".qr-compartilhar .qr-compartilhar__campo",
      ".qr-dialogo__link",
      ".adesao-links__nome",
      ".adesao-links__previa",
    ]) {
      const inicio = todos.indexOf(`${seletor} {`);
      expect(inicio, seletor).toBeGreaterThanOrEqual(0);
      expect(todos.slice(inicio, todos.indexOf("}", inicio))).toMatch(
        /overflow-wrap:\s*anywhere/,
      );
    }
  });

  it("na impressão, só as folhas aparecem, uma por página, com o QR de 4 cm ou mais", () => {
    expect(QR).toMatch(/\.qr-folhas\s*\{\s*display:\s*none;/);
    const impressao = QR.slice(QR.indexOf("@media print"));
    expect(impressao).toMatch(
      /html\.qr-imprimindo body > :not\(\.qr-folhas\)\s*\{\s*display:\s*none !important;/,
    );
    expect(impressao).toMatch(/break-after:\s*page/);
    const imagem =
      /\.qr-folha__imagem\s*\{([^}]*)\}/.exec(impressao)?.[1] ?? "";
    const largura = /width:\s*([\d.]+)cm/.exec(imagem)?.[1];
    expect(Number(largura)).toBeGreaterThanOrEqual(4);
    expect(imagem).toMatch(/height:\s*[\d.]+cm/);
  });

  it("o link num bloco de leitura (RIFA-051): fundo suave e, fora do foco, sem a borda de campo de digitar", () => {
    const compartilhar = ARQUIVOS["compartilhar.css"];
    const campo =
      /\.qr-compartilhar \.qr-compartilhar__campo\s*\{([^}]*)\}/.exec(
        compartilhar,
      )?.[1] ?? "";
    expect(campo).toMatch(/background:\s*var\(--cor-superficie-2\);/);
    expect(campo).toMatch(/resize:\s*none;/);
    // Com a altura do próprio link (field-sizing), o campo continua um alvo de toque de 44 px.
    expect(campo).toMatch(/min-height:\s*var\(--alvo-toque\);/);
    // A borda some só fora do foco (no foco, volta a borda roxa do Campos.css, além do anel), num seletor mais
    // específico que o :hover e o :focus do Campos.css (três classes ou pseudo-classes).
    const semBorda =
      /\.qr-compartilhar \.qr-compartilhar__campo\.ui-campo__controle:not\(:focus\)\s*\{([^}]*)\}/.exec(
        compartilhar,
      )?.[1] ?? "";
    expect(semBorda).toMatch(/border-color:\s*var\(--cor-superficie-2\);/);
    expect(compartilhar).not.toMatch(/outline:\s*(none|0)/);
  });

  it("os botões com ícone ganham o mesmo respiro dos lados (o Copiar e o Ver QR dividem a linha a 360 px)", () => {
    for (const [arquivo, seletor] of [
      ["compartilhar.css", ".qr-compartilhar__acoes > .ui-button"],
      ["qr-codigo.css", ".qr-codigo__acoes > .ui-button"],
    ] as const) {
      const css = ARQUIVOS[arquivo];
      const inicio = css.indexOf(`${seletor} {`);
      expect(inicio, seletor).toBeGreaterThanOrEqual(0);
      expect(css.slice(inicio, css.indexOf("}", inicio))).toMatch(
        /padding-inline:\s*var\(--espaco-3\);/,
      );
    }
  });

  it("'Baixar imagem' e 'Imprimir' ocupam a linha toda quando descem (360 px), como os botões do link", () => {
    for (const [arquivo, seletor] of [
      ["compartilhar.css", ".qr-compartilhar__acoes > *"],
      ["qr-codigo.css", ".qr-codigo__acoes > .ui-button"],
    ] as const) {
      const css = ARQUIVOS[arquivo];
      const inicio = css.indexOf(`${seletor} {`);
      expect(inicio, seletor).toBeGreaterThanOrEqual(0);
      expect(css.slice(inicio, css.indexOf("}", inicio))).toMatch(
        /flex:\s*1 1 auto;/,
      );
    }
  });

  it("o movimento só no no-preference", () => {
    for (const [arquivo, css] of Object.entries(ARQUIVOS)) {
      const fora = css.replace(
        /@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?\}\s*\}/g,
        "",
      );
      expect(fora, arquivo).not.toMatch(/animation|transition/);
    }
  });
});
