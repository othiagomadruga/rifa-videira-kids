// RIFA-094 (D42): o código dos avisos de venda (que vai para o ranking aberto e para a /minha) só conhece a rota aberta
// dos avisos, não formata dinheiro e, do contrato, só importa tipos (o zod não vai para o pacote do site).
import { describe, expect, it } from "vitest";

const FONTES = import.meta.glob<string>(
  ["./**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}"],
  { query: "?raw", import: "default", eager: true },
);

describe("RIFA-094: a guarda dos avisos de venda", () => {
  it("encontra os arquivos", () => {
    expect(Object.keys(FONTES)).toEqual(
      expect.arrayContaining([
        "./AvisosDeVenda.tsx",
        "./avisos-de-venda-api.ts",
        "./som.ts",
        "./textos.ts",
        "./useAvisosDeVenda.ts",
      ]),
    );
  });

  it("sem dinheiro: nada de formatarMoeda, R$, currency, BRL nem _centavos", () => {
    for (const [arquivo, fonte] of Object.entries(FONTES))
      expect(fonte, arquivo).not.toMatch(
        /formatarMoeda|R\$|currency|BRL|_centavos/,
      );
  });

  it("a única rota da API é a dos avisos (/api/publico/vendas-recentes)", () => {
    const rotas = Object.values(FONTES).flatMap((fonte) =>
      [...fonte.matchAll(/\/api\/[\w/-]*/g)].map(([rota]) => rota),
    );
    expect(new Set(rotas)).toEqual(new Set(["/api/publico/vendas-recentes"]));
  });

  it("do contrato, só tipos; nenhuma tela (pages/)", () => {
    for (const [arquivo, fonte] of Object.entries(FONTES)) {
      for (const [linha] of fonte.matchAll(/^import[^;]*from\s*"[^"]+";/gms)) {
        if (linha.includes("/shared/"))
          expect(linha, arquivo).toMatch(/^import type\b/);
        expect(linha, arquivo).not.toMatch(/\/pages\//);
      }
    }
  });
});
