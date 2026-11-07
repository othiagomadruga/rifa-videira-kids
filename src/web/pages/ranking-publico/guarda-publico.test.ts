// CA3 (RIFA-010): a regra do dinheiro na tela pública, além do teste-guarda de rotas.test.tsx (que lê
// estes mesmos arquivos procurando formatação de dinheiro). Aqui também: quantidade de bilhetes, de onde a
// tela importa (nada da tela de rankings da coordenação, que mostra valores; do contrato, só o módulo sem
// zod) e quais rotas da API o código conhece. A tela renderizada é conferida em RankingPublicoPage.test.tsx.
import { describe, expect, it } from "vitest";

const PASTA = "/src/web/pages/ranking-publico/";

/** O código da tela (sem os testes). */
const FONTES = import.meta.glob<string>(
  ["./**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}"],
  { query: "?raw", import: "default", eager: true },
);

/** Todos os arquivos da pasta, testes inclusive. */
const TODOS = import.meta.glob<string>("./**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
});

type Importacao = { trecho: string; destino: string; soTipo: boolean };

/** As importações de um arquivo (estáticas, reexportações e dinâmicas), com o destino resolvido. */
function importacoes(arquivo: string, fonte: string): Importacao[] {
  const base = new URL(arquivo, `file://${PASTA}`);
  const resolver = (especificador: string) =>
    especificador.startsWith(".")
      ? new URL(especificador, base).pathname
      : especificador;
  const encontradas: Importacao[] = [];
  const estaticas =
    /^\s*(import|export)\b([^;]*?)\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']/gm;
  for (const achado of fonte.matchAll(estaticas)) {
    const especificador = achado[3] ?? achado[4];
    encontradas.push({
      trecho: achado[0].trim(),
      destino: resolver(especificador),
      soTipo: /^\s*(import|export)\s+type\b/.test(achado[0]),
    });
  }
  for (const achado of fonte.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
    encontradas.push({
      trecho: achado[0],
      destino: resolver(achado[1]),
      soTipo: false,
    });
  }
  return encontradas;
}

describe("CA3: o código da tela pública não mostra dinheiro nem quantidades", () => {
  it("encontra os arquivos da tela", () => {
    expect(Object.keys(FONTES)).toEqual(
      expect.arrayContaining([
        "./RankingPublicoPage.tsx",
        "./ranking-publico-api.ts",
        "./textos.ts",
        "./useRankingPublico.ts",
      ]),
    );
  });

  it("sem formatarMoeda, R$, currency, BRL, _centavos nem bilhetes com número ou como campo", () => {
    for (const [arquivo, fonte] of Object.entries(FONTES)) {
      expect(fonte, arquivo).not.toMatch(
        /formatarMoeda|R\$|currency|BRL|_centavos/,
      );
      // "12 bilhetes", `${n} bilhetes`, {n} bilhetes, n + " bilhetes"...
      expect(fonte, arquivo).not.toMatch(/(\d|[})]|\+\s*["'`])\s*bilhetes?\b/i);
      // Leitura de um campo de bilhetes (item.bilhetes, qtd_bilhetes, { bilhetes: ... }).
      expect(fonte, arquivo).not.toMatch(
        /\.(qtd_)?bilhetes\b|\bqtd_bilhetes\b|\bbilhetes\s*[:=]/,
      );
    }
  });
});

describe("CA3: de onde a tela pública importa", () => {
  it("nenhum arquivo da pasta (testes inclusive) importa da tela de rankings da coordenação", () => {
    for (const [arquivo, fonte] of Object.entries(TODOS)) {
      for (const { trecho, destino } of importacoes(arquivo, fonte)) {
        expect(destino, `${arquivo}: ${trecho}`).not.toMatch(
          /\/pages\/rankings\//,
        );
      }
    }
  });

  it("o código da tela só importa da própria pasta, dos componentes base, de lib/ e do contrato sem zod", () => {
    const vistas: string[] = [];
    for (const [arquivo, fonte] of Object.entries(FONTES)) {
      for (const { trecho, destino, soTipo } of importacoes(arquivo, fonte)) {
        vistas.push(destino);
        const contexto = `${arquivo}: ${trecho}`;
        // Outras telas: nunca (nem a de rankings, que mostra valores).
        if (destino.startsWith("/src/web/pages/")) {
          expect(destino.startsWith(PASTA), contexto).toBe(true);
        }
        // Contrato: valores só de calculos.ts (sem zod); de api.ts, só tipos; o index, nunca.
        if (destino.startsWith("/src/shared/")) {
          const permitido =
            destino === "/src/shared/contracts/calculos" ||
            (soTipo && destino === "/src/shared/contracts/api");
          expect(permitido, contexto).toBe(true);
        }
      }
    }
    // A conferência acima viu as importações de verdade.
    expect(vistas).toEqual(
      expect.arrayContaining([
        "/src/shared/contracts/calculos",
        "/src/web/lib/api",
        "/src/web/components/ui",
      ]),
    );
  });

  it("as únicas rotas da API no código são as abertas (/api/publico/...)", () => {
    for (const [arquivo, fonte] of Object.entries(FONTES)) {
      for (const [rota] of fonte.matchAll(/\/api\/[\w/-]*/g)) {
        expect(rota, arquivo).toMatch(/^\/api\/publico\//);
      }
    }
  });
});
