// A tela usa cópias de valores do contrato (importar os schemas ou o catálogo ROTAS poria o zod no pacote
// do site; veja visao-geral-api.ts). Este teste garante que as cópias continuam iguais ao contrato e que a
// consulta montada pela tela é aceita pelo schema da rota.
import { describe, expect, it } from "vitest";
import {
  ESCOPOS_PAINEL,
  ROTAS,
  consultaPainelResumoSchema,
  respostaPainelResumoSchema,
} from "../../../shared/contracts";
import { CENARIOS, resolverEscopo, resumoDoCenario } from "./teste-apoio";
import {
  CAMINHO_CELULAS,
  CAMINHO_RESUMO,
  ESCOPOS,
  chaveDoEscopo,
  escopoDosParams,
  paramsDoEscopo,
  type Escopo,
} from "./visao-geral-api";

const RECORTES: Escopo[] = [
  { tipo: "campanha" },
  { tipo: "divisao", divisao: "jovens" },
  { tipo: "divisao", divisao: "adultos" },
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
    expect([...ESCOPOS]).toEqual([...ESCOPOS_PAINEL]);
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
