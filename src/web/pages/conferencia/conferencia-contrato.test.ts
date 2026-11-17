// A tela da conferência e o leitor do CSV dela (src/shared/conferencia) rodam no navegador: do contrato
// da API (com zod) vêm só TIPOS; valores, só dos módulos sem zod (contracts/conferencia, o leitor de CSV e
// o calendário). Este teste confere os caminhos com ROTAS, os textos com as listas do contrato e as
// importações do código da tela e do leitor.
import { describe, expect, it } from "vitest";
import {
  MOTIVOS_DESCONSIDERACAO,
  CAMPOS_RECONCILIACAO,
  MOTIVOS_NAO_RECUPERADO,
  OBSERVACOES_DIVERGENCIA,
  ORIGENS_DATA_RECUPERADA,
  ROTAS,
  STATUS_ARQUIVO_RECONCILIACAO,
  STATUS_PEDIDO,
  TIPOS_DIVERGENCIA,
} from "../../../shared/contracts";
import { CAMINHOS } from "./conferencia-api";
import {
  CAMPOS,
  DIVERGENCIAS,
  MOTIVO_DESCONSIDERACAO,
  MOTIVOS,
  OBSERVACOES,
  ORIGEM_DA_DATA,
  STATUS_DO_ARQUIVO,
  STATUS_DO_SISTEMA,
} from "./textos";

/** O código da tela (com a seção do extrato, RIFA-059) e o do leitor (sem os testes e sem o apoio deles). */
const FONTES = {
  ...import.meta.glob<string>(
    ["./**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}", "!./**/teste-apoio.ts"],
    { query: "?raw", import: "default", eager: true },
  ),
  ...import.meta.glob<string>(
    [
      "../../../shared/conferencia/*.ts",
      "!../../../shared/conferencia/*.test.ts",
      "!../../../shared/conferencia/teste-csv.ts",
    ],
    { query: "?raw", import: "default", eager: true },
  ),
};

/**
 * Módulos do contrato sem zod (o site pode importar valores deles). O "./csv" é o leitor do extrato em CSV
 * (extrato/csv.ts, RIFA-059), que só importa o shared/csv. O rifei-api (RIFA-070, D29) tem só os limites e os textos
 * da API da Rifei (o "Marcar como pago na Rifei" do extrato).
 */
const SEM_ZOD =
  /shared\/contracts\/(conferencia|calendario|rifei-api)$|\.\.\/contracts\/(conferencia|calendario)$|\.\.\/csv$|shared\/csv$|^\.\/csv$/;

describe("a tela da conferência e o contrato", () => {
  it("caminhos da API", () => {
    expect(CAMINHOS).toEqual({
      campanha: ROTAS.obterCampanha.caminho,
      analisar: ROTAS.analisarReconciliacao.caminho,
      recuperar: ROTAS.recuperarReconciliacao.caminho,
      recuperacoes: ROTAS.listarRecuperacoes.caminho,
    });
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
    expect(Object.keys(MOTIVO_DESCONSIDERACAO)).toEqual([
      ...MOTIVOS_DESCONSIDERACAO,
    ]);
  });

  it("a tela vem num pacote à parte: a página (no pacote principal) só tem o cabeçalho e o import() do resto", () => {
    const pagina = FONTES["./ConferenciaPage.tsx"];
    expect(pagina).toMatch(
      /lazy\(\(\) =>\s*import\("\.\/ConferenciaPeloCsv"\)/,
    );
    // Importações estáticas da página: só o React e os componentes base. Uma importação da conferência
    // aqui poria o leitor do CSV e o resultado de volta no pacote principal (aviso de 500 kB no build).
    expect(
      [...pagina.matchAll(/^import\s+(?:[^"';]*?\bfrom\s*)?"([^"]+)"/gm)].map(
        (achado) => achado[1],
      ),
    ).toEqual(["react", "../../components/ui"]);
    // Nada mais importa o módulo pesado de forma estática.
    for (const [arquivo, fonte] of Object.entries(FONTES))
      expect(fonte, arquivo).not.toMatch(/from\s*"\.\/ConferenciaPeloCsv"/);
  });

  it("do contrato com zod, só TIPOS; valores, só dos módulos sem zod; nada no armazenamento do navegador", () => {
    expect(Object.keys(FONTES)).toEqual(
      expect.arrayContaining([
        "./ConferenciaPage.tsx",
        "./ConferenciaPeloCsv.tsx",
        "./conferencia-api.ts",
        "./textos.ts",
        "../../../shared/conferencia/leitura.ts",
        "../../../shared/conferencia/colunas.ts",
      ]),
    );
    for (const [arquivo, fonte] of Object.entries(FONTES)) {
      for (const achado of fonte.matchAll(
        /^\s*(import|export)\b([^;]*?)\bfrom\s*["']([^"']*(?:contracts|csv)[^"']*)["']/gm,
      )) {
        const tipoSo = /^\s*(import|export)\s+type\b/.test(achado[0]);
        expect(
          tipoSo || SEM_ZOD.test(achado[3]),
          `${arquivo}: ${achado[0].trim()}`,
        ).toBe(true);
      }
      expect(fonte, arquivo).not.toMatch(/\bfrom\s*["']zod["']/);
      // O arquivo do usuário nunca vai para o armazenamento do navegador nem para o log (comentários à parte; o
      // extrato do banco tem o nome de quem pagou, D26).
      const semComentarios = fonte
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(semComentarios, arquivo).not.toMatch(
        /localStorage|sessionStorage|indexedDB|\bconsole\s*\./,
      );
    }
  });
});
