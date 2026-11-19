// CA3 (RIFA-011): a regra do dinheiro no telão, além do teste-guarda de rotas.test.tsx. O telão reusa o
// ranking público ("/": os mesmos dados e a mesma atualização), então a varredura cobre o código dele E o
// que ele importa de pages/ranking-publico: nada de formatação de dinheiro, nem bilhetes com número ou
// como campo, e só rotas /api/publico/. De onde importa: nenhuma tela da coordenação; do contrato, só o
// módulo sem zod. A tela renderizada é conferida em TelaoPage.test.tsx (em todos os estados).
import { describe, expect, it } from "vitest";

const PASTA = "/src/web/pages/telao/";
const PUBLICO = "/src/web/pages/ranking-publico/";

/** O código do telão (sem os testes). */
const FONTES = import.meta.glob<string>(
  ["./**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}"],
  { query: "?raw", import: "default", eager: true },
);

/** O código do ranking público (sem os testes), de onde o telão importa. */
const FONTES_DO_PUBLICO = import.meta.glob<string>(
  [
    "../ranking-publico/**/*.{ts,tsx}",
    "!../ranking-publico/**/*.test.{ts,tsx}",
  ],
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

/** Os arquivos do ranking público que o telão importa ("/src/web/pages/ranking-publico/textos"). */
function importadosDoPublico(): string[] {
  return Object.entries(FONTES).flatMap(([arquivo, fonte]) =>
    importacoes(arquivo, fonte)
      .map(({ destino }) => destino)
      .filter((destino) => destino.startsWith(PUBLICO)),
  );
}

/** O código que vai para o telão: o dele e os arquivos do ranking público que ele importa. */
function codigoDoTelao(): [string, string][] {
  const importados = new Set(importadosDoPublico());
  return [
    ...Object.entries(FONTES),
    ...Object.entries(FONTES_DO_PUBLICO).filter(([arquivo]) =>
      importados.has(
        `${PUBLICO}${arquivo.replace("../ranking-publico/", "").replace(/\.tsx?$/, "")}`,
      ),
    ),
  ];
}

describe("CA3: o código do telão não mostra dinheiro nem quantidades", () => {
  it("encontra os arquivos do telão e os do ranking público que ele usa", () => {
    expect(Object.keys(FONTES)).toEqual(
      expect.arrayContaining([
        "./TelaoPage.tsx",
        "./textos.ts",
        "./useTelao.ts",
      ]),
    );
    expect(new Set(importadosDoPublico())).toEqual(
      new Set([
        // A ajuda dos títulos (RIFA-066): só textos, sem dinheiro (entra na conferência abaixo).
        `${PUBLICO}ajuda-sob-demanda`,
        `${PUBLICO}ranking-publico-api`,
        `${PUBLICO}textos`,
        `${PUBLICO}useRankingPublico`,
        `${PUBLICO}useSubiu`,
      ]),
    );
    // Os importados entram na varredura (e o ranking-publico-api traz a chamada da API).
    expect(codigoDoTelao().map(([arquivo]) => arquivo)).toEqual(
      expect.arrayContaining([
        "../ranking-publico/ranking-publico-api.ts",
        "../ranking-publico/textos.ts",
        "../ranking-publico/useRankingPublico.ts",
        "../ranking-publico/useSubiu.ts",
      ]),
    );
  });

  it("sem formatarMoeda, R$, currency, BRL, _centavos nem bilhetes com número ou como campo", () => {
    for (const [arquivo, fonte] of codigoDoTelao()) {
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

  it("as únicas rotas da API no código são as abertas (/api/publico/...)", () => {
    const rotas = codigoDoTelao().flatMap(([arquivo, fonte]) =>
      [...fonte.matchAll(/\/api\/[\w/-]*/g)].map(([rota]) => ({
        arquivo,
        rota,
      })),
    );
    expect(rotas.length).toBeGreaterThan(0);
    for (const { arquivo, rota } of rotas)
      expect(rota, arquivo).toMatch(/^\/api\/publico\//);
  });
});

describe("CA3: de onde o telão importa", () => {
  it("só da própria pasta, do ranking público (tela aberta), dos componentes base, de lib/, do tema e do contrato sem zod", () => {
    const vistas: string[] = [];
    for (const [arquivo, fonte] of Object.entries(FONTES)) {
      for (const { trecho, destino, soTipo } of importacoes(arquivo, fonte)) {
        vistas.push(destino);
        const contexto = `${arquivo}: ${trecho}`;
        // Das telas, só a própria e a do ranking público (nunca as da coordenação, que têm valores).
        if (destino.startsWith("/src/web/pages/"))
          expect(
            destino.startsWith(PASTA) || destino.startsWith(PUBLICO),
            contexto,
          ).toBe(true);
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
        "/src/web/lib/formatadores",
        "/src/web/components/ui",
      ]),
    );
  });
});
