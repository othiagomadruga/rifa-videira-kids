// A tela usa cópias de valores do contrato (importar os schemas ou o catálogo ROTAS poria o zod no pacote
// do site; veja visao-geral-api.ts). Este teste garante que as cópias continuam iguais ao contrato e que a
// consulta montada pela tela é aceita pelo schema da rota.
import { describe, expect, it } from "vitest";
import {
  ESCOPOS_PAINEL,
  ROTAS,
  ROTAS_ARRECADADO,
  ROTAS_RELATORIO,
  consultaPainelResumoSchema,
  consultaRelatorioSchema,
  respostaPainelResumoSchema,
  respostaRelatorioCsvSchema,
} from "../../../shared/contracts";
import {
  BOM_UTF8,
  FIM_DE_LINHA_CSV_RELATORIO,
  PREFIXO_ARQUIVO_RELATORIO,
  SEPARADOR_CSV_RELATORIO,
  TIPOS_RELATORIO,
  cabecalhoDoRelatorio,
  cabecalhosDoRelatorio,
} from "../../../shared/contracts/relatorio";
import {
  CENARIOS,
  csvDoRelatorio,
  dataDoCenario,
  resolverEscopo,
  respostaRelatorio,
  resumoDoCenario,
} from "./teste-apoio";
import { TEXTOS_TIPO_RELATORIO } from "./textos";
import {
  CAMINHO_CELULAS,
  CAMINHO_GRUPOS,
  CAMINHO_RELATORIO,
  CAMINHO_RESUMO,
  CAMINHO_ARRECADADO,
  ESCOPOS,
  chaveDoEscopo,
  consultaDoRelatorio,
  escopoDosParams,
  nomeReservaDoRelatorio,
  paramsDoEscopo,
  type Escopo,
} from "./visao-geral-api";

const RECORTES: Escopo[] = [
  { tipo: "campanha" },
  { tipo: "divisao", divisao: "jovens" },
  { tipo: "divisao", divisao: "adultos" },
  // RIFA-092: o grupo (Adultos da manhã).
  { tipo: "grupo", id: 1 },
  { tipo: "rede", id: 1 },
  { tipo: "discipulador", id: 2 },
  { tipo: "celula", id: 3 },
];

describe("cópias do contrato na Visão geral", () => {
  it("caminhos e escopos", () => {
    expect(CAMINHO_RESUMO).toBe(ROTAS.painelResumo.caminho);
    expect(ROTAS.painelResumo.metodo).toBe("GET");
    expect(CAMINHO_CELULAS).toBe(ROTAS.listarCelulas.caminho);
    expect(ROTAS.listarCelulas.metodo).toBe("GET");
    // RIFA-092: a ordem dos grupos do filtro.
    expect(CAMINHO_GRUPOS).toBe(ROTAS.listarGrupos.caminho);
    expect(ROTAS.listarGrupos.metodo).toBe("GET");
    expect([...ESCOPOS]).toEqual([...ESCOPOS_PAINEL]);
    // RIFA-087 (adendo da D40): o Arrecadado (só admin), no lugar do saldo da Efí.
    expect(CAMINHO_ARRECADADO).toBe(ROTAS_ARRECADADO.arrecadado.caminho);
    expect(ROTAS_ARRECADADO.arrecadado.metodo).toBe("GET");
  });

  it.each(RECORTES)(
    "a consulta de %o passa no schema da rota e volta ao mesmo recorte",
    (escopo) => {
      const params = paramsDoEscopo(escopo);
      const consulta = consultaPainelResumoSchema.parse(
        Object.fromEntries(params),
      );
      expect(consulta.escopo).toBe(escopo.tipo);
      expect(escopoDosParams(params)).toEqual(escopo);
      expect(
        escopoDosParams(new URLSearchParams(chaveDoEscopo(escopo))),
      ).toEqual(escopo);
    },
  );

  it.each([
    "escopo=celula",
    "escopo=celula&id=abc",
    "escopo=celula&id=0",
    "escopo=rede&id=-1",
    "escopo=rede&id=1.5",
    "escopo=divisao",
    "escopo=divisao&divisao=criancas",
    "escopo=grupo",
    "escopo=grupo&id=abc",
    "escopo=bairro&id=1",
  ])("URL fora do contrato (%s) vira a campanha toda", (consulta) => {
    expect(escopoDosParams(new URLSearchParams(consulta))).toEqual({
      tipo: "campanha",
    });
  });

  it("a API simulada dos testes responde no schema da rota, em todos os cenários e recortes", () => {
    for (const cenario of Object.values(CENARIOS)) {
      for (const escopo of RECORTES) {
        const resolvido = resolverEscopo(
          paramsDoEscopo(escopo),
          cenario.campanha,
        );
        if (!resolvido) throw new Error(`recorte ${chaveDoEscopo(escopo)}`);
        expect(() =>
          respostaPainelResumoSchema.parse(resumoDoCenario(cenario, resolvido)),
        ).not.toThrow();
      }
    }
  });
});

describe("cópias do contrato no relatório da campanha (RIFA-038)", () => {
  it("o caminho da rota, os tipos na ordem do contrato e o nome de reserva do arquivo (D23)", () => {
    expect(CAMINHO_RELATORIO).toBe(ROTAS_RELATORIO.baixarRelatorio.caminho);
    expect(ROTAS_RELATORIO.baixarRelatorio.metodo).toBe("GET");
    expect(Object.keys(TEXTOS_TIPO_RELATORIO)).toEqual([...TIPOS_RELATORIO]);
    for (const tipo of TIPOS_RELATORIO)
      expect(nomeReservaDoRelatorio(tipo)).toBe(
        `${PREFIXO_ARQUIVO_RELATORIO}-${tipo}.csv`,
      );
  });

  it.each(TIPOS_RELATORIO)(
    "a consulta do tipo %s passa no schema da rota",
    (tipo) => {
      expect(
        consultaRelatorioSchema.parse(
          Object.fromEntries(consultaDoRelatorio(tipo)),
        ),
      ).toEqual({ tipo });
    },
  );

  it("a API simulada dos testes responde o CSV e os cabeçalhos do contrato, em todos os cenários e tipos", async () => {
    for (const cenario of Object.values(CENARIOS)) {
      for (const tipo of TIPOS_RELATORIO) {
        const csv = csvDoRelatorio(tipo, cenario);
        expect(() => respostaRelatorioCsvSchema.parse(csv)).not.toThrow();
        const [cabecalho] = csv
          .slice(BOM_UTF8.length)
          .split(FIM_DE_LINHA_CSV_RELATORIO);
        expect(cabecalho).toBe(
          cabecalhoDoRelatorio(tipo, cenario.campanha.meta.unidade).join(
            SEPARADOR_CSV_RELATORIO,
          ),
        );
        const resposta = respostaRelatorio(tipo, cenario);
        expect(Object.fromEntries(resposta.headers)).toEqual(
          Object.fromEntries(
            new Headers(cabecalhosDoRelatorio(tipo, dataDoCenario(cenario))),
          ),
        );
        // O corpo vai em bytes UTF-8 com o BOM (EF BB BF), como o Worker manda.
        const bytes = new Uint8Array(await resposta.arrayBuffer());
        expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      }
    }
  });
});
