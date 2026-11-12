// RIFA-043 (ensaio geral): a 1280 px, "R$ 3.300,00" quebrava no meio nos cartões dos totais ("R$ 3.300,0" / "0"): com
// --grade-min 12rem cabiam 4 por linha, e o cartão ficava mais estreito que o valor. Aqui, o que dá para provar lendo
// o CSS (o jsdom não faz layout): as colunas que a grade dá em cada largura e a largura de cada cartão contra a do
// maior valor em R$. A medida na tela de verdade (390, 1280 e 1366 px) está nas capturas do Playwright.
import { describe, expect, it } from "vitest";

// O Vitest esvazia todo import de CSS (até com ?raw): o texto vem do disco, pelo fs do Node.
type ModuloFs = { readFileSync(caminho: string, codificacao: "utf8"): string };
const { process } = globalThis as unknown as {
  process: { getBuiltinModule(nome: "node:fs"): ModuloFs };
};
// O caminho vai numa variável: com um texto fixo, o Vite trocaria o new URL(..., import.meta.url) pela URL do asset.
const lerCss = (relativo: string) =>
  process
    .getBuiltinModule("node:fs")
    .readFileSync(
      decodeURIComponent(new URL(relativo, import.meta.url).pathname),
      "utf8",
    )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ");

/** O corpo da primeira regra com exatamente este seletor. */
function regra(css: string, seletor: string): string {
  const achado = new RegExp(
    `(^|\\})\\s*${seletor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`,
  ).exec(css);
  if (!achado) throw new Error(`regra ${seletor} não encontrada`);
  return achado[2];
}

const REM = 16;
const tokens = lerCss("../../tema/tokens.css");
/** Um token do tema em rem (ex.: --espaco-4 → 1). */
function tokenRem(nome: string): number {
  const achado = new RegExp(`${nome}:\\s*([\\d.]+)rem;`).exec(tokens);
  if (!achado) throw new Error(`token ${nome} não encontrado em rem`);
  return Number(achado[1]);
}

const conferencia = lerCss("./conferencia.css");
const stat = lerCss("../../components/ui/Stat.css");
const base = lerCss("../../tema/base.css");

// --grade-min dos totais: clamp(<mínimo>rem, (<limiar>rem - 100%) * 999, (100% - var(--espaco-4)) / 2).
const GRADE_MIN =
  /--grade-min:\s*clamp\(\s*([\d.]+)rem,\s*\(\s*([\d.]+)rem - 100%\s*\)\s*\*\s*999,\s*\(\s*100% - var\(--espaco-4\)\s*\)\s*\/\s*2\s*\);/;
const lido = GRADE_MIN.exec(regra(conferencia, ".conferencia-totais"));
const MINIMO_PX = Number(lido?.[1]) * REM;
const LIMIAR_PX = Number(lido?.[2]) * REM;
const VAO_PX = tokenRem("--espaco-4") * REM;

/**
 * As colunas da `.grade` (base.css: repeat(auto-fit, minmax(min(100%, var(--grade-min)), 1fr))) numa caixa de
 * `largura` px com `itens` cartões: com auto-fit, as faixas vazias somem e os cartões dividem a linha.
 */
function colunas(largura: number, itens: number): number {
  const clamp = Math.max(
    MINIMO_PX,
    Math.min((LIMIAR_PX - largura) * 999, (largura - VAO_PX) / 2),
  );
  const faixa = Math.min(largura, clamp);
  const cabem = Math.max(1, Math.floor((largura + VAO_PX) / (faixa + VAO_PX)));
  return Math.min(cabem, itens);
}

/** O tamanho do valor do Stat (clamp(--texto-2xl, 1.25rem + 1vw, --texto-3xl)) numa janela de `janela` px. */
function fonteDoValor(janela: number): number {
  return Math.min(
    tokenRem("--texto-3xl") * REM,
    Math.max(tokenRem("--texto-2xl") * REM, 1.25 * REM + janela / 100),
  );
}

// "R$ 99.999,99" (12 caracteres; a campanha toda não passa de R$ 75 mil) no Chromium, com a fonte do site em negrito
// e algarismos tabulares: 196 px a 30 px = 6,53em (medido com o Playwright). 6,6em dá folga.
const MAIOR_VALOR_EM = 6.6;
// O recuo do Stat (2 × --espaco-5) e a borda (2 × 1 px).
const RECUO_PX = 2 * tokenRem("--espaco-5") * REM + 2;

// A caixa da grade em cada janela (largura da tela − barra lateral e margens, até a largura máxima do conteúdo;
// medida com o Playwright no build).
const CAIXAS: [janela: number, caixa: number][] = [
  [390, 324],
  [1280, 910],
  [1366, 996],
  [1920, 1102],
];

describe("Conferência: os totais em R$ não quebram no meio (RIFA-043)", () => {
  it("o --grade-min dos totais está no formato esperado e a .grade usa o vão --espaco-4", () => {
    expect(lido).not.toBeNull();
    expect(regra(base, ".grade")).toMatch(/gap:\s*var\(--espaco-4\);/);
    expect(regra(base, ".grade")).toMatch(
      /repeat\(\s*auto-fit,\s*minmax\(min\(100%, var\(--grade-min, 14rem\)\), 1fr\)\s*\)/,
    );
  });

  it("o limiar é o das 4 colunas com o mínimo: 4 cabem exatamente nele, e nunca fica 3 + 1", () => {
    expect(LIMIAR_PX).toBe(4 * MINIMO_PX + 3 * VAO_PX);
    expect(colunas(LIMIAR_PX, 4)).toBe(4);
    expect(colunas(LIMIAR_PX - 1, 4)).toBe(2);
    for (let largura = 200; largura <= 2400; largura += 2)
      expect([1, 2, 4]).toContain(colunas(largura, 4));
  });

  it("390 px: 1 coluna; 1280 e 1366 px: 2 (o arquivo ao lado do sistema); 1920 px: 4. Com 2 cartões (sem o código), até 2", () => {
    expect(CAIXAS.map(([, caixa]) => colunas(caixa, 4))).toEqual([1, 2, 2, 4]);
    expect(CAIXAS.map(([, caixa]) => colunas(caixa, 2))).toEqual([1, 2, 2, 2]);
    // Antes (--grade-min 12rem, sem o clamp), a 1280 px cabiam 4 colunas de 215 px: menos que o recuo e "R$ 3.300,00".
    expect(Math.floor((910 + VAO_PX) / (12 * REM + VAO_PX))).toBe(4);
  });

  it.each(CAIXAS)(
    'janela de %i px: cada cartão tem a largura do recuo e de "R$ 99.999,99" no tamanho do valor',
    (janela, caixa) => {
      for (const itens of [4, 2]) {
        const n = colunas(caixa, itens);
        const cartao = (caixa - (n - 1) * VAO_PX) / n;
        expect(cartao).toBeGreaterThanOrEqual(
          RECUO_PX + MAIOR_VALOR_EM * fonteDoValor(janela),
        );
      }
    },
  );

  it("em qualquer caixa de 16rem para cima, o cartão cabe o valor no maior tamanho (1,875rem)", () => {
    for (let caixa = MINIMO_PX; caixa <= 2400; caixa += 4) {
      const n = colunas(caixa, 4);
      const cartao = (caixa - (n - 1) * VAO_PX) / n;
      expect(cartao).toBeGreaterThanOrEqual(
        RECUO_PX + MAIOR_VALOR_EM * tokenRem("--texto-3xl") * REM,
      );
    }
  });

  it("o Stat continua igual para as outras telas: anywhere no cartão (nunca alarga a página, RIFA-020) e o valor até 1,875rem", () => {
    // Quem garante o número inteiro é a largura do cartão (a grade acima); o anywhere só parte a palavra que não cabe
    // nem sozinha na linha, e o break-word não entra nos componentes (quebra-de-nomes.test.ts).
    expect(regra(stat, ".ui-stat")).toMatch(/overflow-wrap:\s*anywhere;/);
    expect(regra(stat, ".ui-stat__valor")).not.toMatch(/overflow-wrap/);
    expect(regra(stat, ".ui-stat__valor")).toMatch(
      /font-size:\s*clamp\(var\(--texto-2xl\), 1\.25rem \+ 1vw, var\(--texto-3xl\)\);/,
    );
    expect(regra(stat, ".ui-stat")).toMatch(
      /padding:\s*var\(--espaco-4\) var\(--espaco-5\);/,
    );
  });
});
