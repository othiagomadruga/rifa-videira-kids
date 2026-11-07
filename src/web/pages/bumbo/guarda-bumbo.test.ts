// CA3 (RIFA-011): o bumbo nunca exibe R$. A tela renderizada é conferida em BumboPage.test.tsx (em todos
// os estados); aqui, o código: sem formatação de dinheiro, só a rota aberta do bumbo, e de onde a tela
// importa (nada das telas públicas nem das outras telas da coordenação; do contrato, só o módulo sem zod).
import { describe, expect, it } from "vitest";

const PASTA = "/src/web/pages/bumbo/";

/** O código da tela (sem os testes nem o apoio deles). */
const FONTES = import.meta.glob<string>(
  ["./**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}", "!./teste-apoio.ts"],
  { query: "?raw", import: "default", eager: true },
);

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
    encontradas.push({
      trecho: achado[0].trim(),
      destino: resolver(achado[3] ?? achado[4]),
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

describe("CA3: o código do bumbo não formata dinheiro", () => {
  it("encontra os arquivos da tela", () => {
    expect(Object.keys(FONTES)).toEqual(
      expect.arrayContaining([
        "./BumboPage.tsx",
        "./bumbo-api.ts",
        "./textos.ts",
        "./useBumbo.ts",
      ]),
    );
  });

  it("sem formatarMoeda, R$, currency, BRL nem campos _centavos", () => {
    for (const [arquivo, fonte] of Object.entries(FONTES))
      expect(fonte, arquivo).not.toMatch(
        /formatarMoeda|R\$|currency|BRL|_centavos/,
      );
  });

  it("a única rota da API no código é a aberta do bumbo", () => {
    const rotas = Object.entries(FONTES).flatMap(([arquivo, fonte]) =>
      [...fonte.matchAll(/\/api\/[\w/-]*/g)].map(([rota]) => ({
        arquivo,
        rota,
      })),
    );
    expect(rotas.length).toBeGreaterThan(0);
    for (const { arquivo, rota } of rotas)
      expect(rota, arquivo).toBe("/api/publico/bumbo");
  });
});

describe("de onde o bumbo importa", () => {
  it("só da própria pasta, dos componentes base, de lib/ e do contrato sem zod (de api.ts, só tipos)", () => {
    const vistas: string[] = [];
    for (const [arquivo, fonte] of Object.entries(FONTES)) {
      for (const { trecho, destino, soTipo } of importacoes(arquivo, fonte)) {
        vistas.push(destino);
        const contexto = `${arquivo}: ${trecho}`;
        // Outras telas, nunca: nem as públicas (ranking público, telão) nem as da coordenação.
        if (destino.startsWith("/src/web/pages/"))
          expect(destino.startsWith(PASTA), contexto).toBe(true);
        // O apoio dos testes não entra no pacote.
        expect(destino, contexto).not.toMatch(/teste-apoio/);
        if (destino.startsWith("/src/shared/")) {
          const permitido =
            destino === "/src/shared/contracts/calculos" ||
            (soTipo && destino === "/src/shared/contracts/api");
          expect(permitido, contexto).toBe(true);
        }
      }
    }
    expect(vistas).toEqual(
      expect.arrayContaining([
        "/src/shared/contracts/calculos",
        "/src/web/lib/api",
        "/src/web/components/ui",
      ]),
    );
  });
});
