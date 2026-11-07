// A tela usa cópias de valores do contrato (importar os valores poria o zod no pacote do site; veja
// conferencia-api.ts). Este teste garante que as cópias continuam iguais ao contrato e que o código da
// tela só importa TIPOS do contrato.
import { describe, expect, it } from "vitest";
import {
  CAMPOS_RECONCILIACAO,
  LIMITE_CARACTERES_CSV_RECONCILIACAO,
  LIMITE_LINHAS_CSV_RECONCILIACAO,
  LIMITE_PEDIDOS_RECUPERAR as LIMITE_PEDIDOS_DO_CONTRATO,
  MOTIVOS_NAO_RECUPERADO,
  OBSERVACOES_DIVERGENCIA,
  ORIGENS_DATA_RECUPERADA,
  ROTAS,
  STATUS_ARQUIVO_RECONCILIACAO,
  STATUS_PEDIDO,
  TIPOS_DIVERGENCIA,
} from "../../../shared/contracts";
import {
  CAMINHOS,
  LIMITE_CARACTERES_CSV,
  LIMITE_LINHAS_CSV,
  LIMITE_PEDIDOS_RECUPERAR,
} from "./conferencia-api";
import {
  CAMPOS,
  DIVERGENCIAS,
  MOTIVOS,
  OBSERVACOES,
  ORIGEM_DA_DATA,
  STATUS_DO_ARQUIVO,
  STATUS_DO_SISTEMA,
} from "./textos";

/** O código da tela (sem os testes e sem o apoio deles). */
const FONTES = import.meta.glob<string>(
  ["./**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}", "!./teste-apoio.ts"],
  { query: "?raw", import: "default", eager: true },
);

describe("cópias do contrato na tela da conferência", () => {
  it("caminhos da API", () => {
    expect(CAMINHOS).toEqual({
      analisar: ROTAS.analisarReconciliacao.caminho,
      recuperar: ROTAS.recuperarReconciliacao.caminho,
      recuperacoes: ROTAS.listarRecuperacoes.caminho,
    });
  });

  it("limites do arquivo e do Recuperar", () => {
    expect(LIMITE_CARACTERES_CSV).toBe(LIMITE_CARACTERES_CSV_RECONCILIACAO);
    expect(LIMITE_LINHAS_CSV).toBe(LIMITE_LINHAS_CSV_RECONCILIACAO);
    expect(LIMITE_PEDIDOS_RECUPERAR).toBe(LIMITE_PEDIDOS_DO_CONTRATO);
  });

  it("textos de cada campo, tipo, status, observação, motivo e origem da data, na ordem do contrato", () => {
    expect(Object.keys(CAMPOS)).toEqual([...CAMPOS_RECONCILIACAO]);
    expect(Object.keys(DIVERGENCIAS)).toEqual([...TIPOS_DIVERGENCIA]);
    expect(Object.keys(STATUS_DO_ARQUIVO)).toEqual([
      ...STATUS_ARQUIVO_RECONCILIACAO,
    ]);
    expect(Object.keys(STATUS_DO_SISTEMA).sort()).toEqual(
      [...STATUS_PEDIDO].sort(),
    );
    expect(Object.keys(OBSERVACOES)).toEqual([...OBSERVACOES_DIVERGENCIA]);
    expect(Object.keys(MOTIVOS)).toEqual([...MOTIVOS_NAO_RECUPERADO]);
    expect(Object.keys(ORIGEM_DA_DATA)).toEqual([...ORIGENS_DATA_RECUPERADA]);
  });

  it("o código da tela só importa TIPOS do contrato (os valores trariam o zod para o pacote do site)", () => {
    expect(Object.keys(FONTES)).toEqual(
      expect.arrayContaining([
        "./ConferenciaPage.tsx",
        "./conferencia-api.ts",
        "./textos.ts",
      ]),
    );
    for (const [arquivo, fonte] of Object.entries(FONTES)) {
      for (const achado of fonte.matchAll(
        /^\s*(import|export)\b([^;]*?)\bfrom\s*["']([^"']*shared\/contracts[^"']*)["']/gm,
      )) {
        expect(
          /^\s*(import|export)\s+type\b/.test(achado[0]),
          `${arquivo}: ${achado[0].trim()}`,
        ).toBe(true);
      }
      expect(fonte, arquivo).not.toMatch(/\bfrom\s*["']zod["']/);
      // O arquivo do usuário nunca vai para o armazenamento do navegador (comentários à parte).
      const semComentarios = fonte
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(semComentarios, arquivo).not.toMatch(
        /localStorage|sessionStorage|indexedDB/,
      );
    }
  });
});
