// CA2 (RIFA-014, D12): a regra do dinheiro na visão individual vale também no código, além da tela
// renderizada (MinhaPage.test.tsx varre o DOM em todos os cenários). O código da pasta não formata nem lê
// dinheiro, não lê a distância até os vizinhos, só conhece as rotas /api/minha/... e só importa da própria
// pasta, dos componentes base, de lib/ e do contrato sem zod (calculos.ts e, desde a RIFA-046, link-vendas.ts;
// de api.ts, dominio.ts, acesso.ts e, desde a RIFA-090, todas-as-redes.ts, só tipos).
import { describe, expect, it } from "vitest";

const PASTA = "/src/web/pages/minha/";

/** O código da tela (sem os testes e sem o apoio deles, que nunca vai para o pacote do site). */
const FONTES = import.meta.glob<string>(
  ["./**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}", "!./teste-apoio*.ts"],
  { query: "?raw", import: "default", eager: true },
);

/** O QR code e o "Copiar link" do link de vendas (RIFA-046), que a /minha usa: também sem dinheiro. */
const FONTES_DO_QR = import.meta.glob<string>(
  [
    "../../components/qr/**/*.{ts,tsx}",
    "!../../components/qr/**/*.test.{ts,tsx}",
    "!../../components/qr/teste-apoio.ts",
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

describe("CA2: o código da visão individual não mostra dinheiro", () => {
  it("encontra os arquivos da tela", () => {
    expect(Object.keys(FONTES)).toEqual(
      expect.arrayContaining([
        "./MinhaLayout.tsx",
        "./MinhaPage.tsx",
        "./Cabecalho.tsx",
        "./VisaoIndividual.tsx",
        "./Destaque.tsx",
        "./CurvaIndividual.tsx",
        "./RankingIndividual.tsx",
        "./Equipe.tsx",
        "./minha-api.ts",
        "./textos.ts",
        "./useVisaoIndividual.ts",
        "./LinksDeVendas.tsx",
        "./links-vendas-api.ts",
        "./useMeusLinksVendas.ts",
        "./MaioresCompradores.tsx",
        "./maiores-compradores-api.ts",
        "./TodasAsRedes.tsx",
        "./todas-as-redes-api.ts",
        "./textos-todas-as-redes.ts",
      ]),
    );
  });

  it("sem formatarMoeda, R$, currency, BRL nem campos _centavos", () => {
    expect(Object.keys(FONTES_DO_QR).length).toBeGreaterThanOrEqual(5);
    for (const [arquivo, fonte] of Object.entries({
      ...FONTES,
      ...FONTES_DO_QR,
    })) {
      expect(fonte, arquivo).not.toMatch(
        /formatarMoeda|R\$|currency|BRL|_centavos|total_centavos/,
      );
    }
  });

  it("a distância até os vizinhos (que revelaria o número deles) nunca é lida", () => {
    for (const [arquivo, fonte] of Object.entries(FONTES)) {
      expect(fonte, arquivo).not.toMatch(
        /(acima|abaixo|vizinho)\??\.diferenca/,
      );
    }
  });

  it("as únicas rotas da API no código são as da visão individual (/api/minha/...)", () => {
    const rotas: string[] = [];
    for (const [arquivo, fonte] of Object.entries({
      ...FONTES,
      ...FONTES_DO_QR,
    })) {
      for (const [rota] of fonte.matchAll(/\/api\/[\w/-]*/g)) {
        rotas.push(rota);
        expect(rota, arquivo).toMatch(/^\/api\/minha\//);
      }
    }
    expect(rotas).toContain("/api/minha/visao");
    expect(rotas).toContain("/api/minha/links-vendas");
    expect(rotas).toContain("/api/minha/maiores-compradores");
    expect(rotas).toContain("/api/minha/todas-as-redes");
  });
});

describe("CA2: de onde a visão individual importa", () => {
  it("só da própria pasta, dos componentes base, de lib/ e do contrato sem zod", () => {
    const vistas: string[] = [];
    for (const [arquivo, fonte] of Object.entries(FONTES)) {
      for (const { trecho, destino, soTipo } of importacoes(arquivo, fonte)) {
        vistas.push(destino);
        const contexto = `${arquivo}: ${trecho}`;
        // Outras telas: nunca (a Visão geral e os rankings da coordenação formatam dinheiro).
        if (destino.startsWith("/src/web/pages/")) {
          expect(destino.startsWith(PASTA), contexto).toBe(true);
        }
        // Contrato: valores só de calculos.ts e link-vendas.ts (sem zod; RIFA-046, D24); de api.ts,
        // dominio.ts e acesso.ts, só tipos.
        if (destino.startsWith("/src/shared/")) {
          const permitido =
            destino === "/src/shared/contracts/calculos" ||
            destino === "/src/shared/contracts/link-vendas" ||
            (soTipo &&
              [
                "/src/shared/contracts/api",
                "/src/shared/contracts/dominio",
                "/src/shared/contracts/acesso",
                // RIFA-090: os tipos do ranking geral (o módulo tem zod: só tipos).
                "/src/shared/contracts/todas-as-redes",
              ].includes(destino));
          expect(permitido, contexto).toBe(true);
        }
      }
    }
    expect(vistas).toEqual(
      expect.arrayContaining([
        "/src/shared/contracts/calculos",
        "/src/web/lib/api",
        "/src/web/lib/sessao",
        "/src/web/components/ui",
      ]),
    );
  });
});
