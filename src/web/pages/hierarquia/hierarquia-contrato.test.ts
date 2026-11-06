// A tela usa cópias de valores do contrato (importar os valores poria o zod no pacote do site; veja
// hierarquia-api.ts). Este teste garante que as cópias continuam iguais ao contrato.
import { describe, expect, it } from "vitest";
import {
  COLUNAS_CSV_HIERARQUIA,
  COLUNAS_CSV_HIERARQUIA_OBRIGATORIAS,
  DIVISOES as DIVISOES_DO_CONTRATO,
  LIMITE_LINHAS_CSV_HIERARQUIA,
  ROTAS,
  celulaEntradaSchema,
  celulaSchema,
  corpoImportarHierarquiaSchema,
  redeEntradaSchema,
} from "../../../shared/contracts";
import { LIMITES } from "./formulario";
import {
  CAMINHOS,
  LIMITE_CARACTERES_CSV,
  LIMITE_LINHAS_CSV,
} from "./hierarquia-api";
import { COLUNAS_DA_PLANILHA } from "./planilha";
import { DIVISOES } from "./textos";

describe("cópias do contrato na tela da hierarquia", () => {
  it("caminhos da API", () => {
    expect(CAMINHOS).toEqual({
      redes: ROTAS.listarRedes.caminho,
      discipuladores: ROTAS.listarDiscipuladores.caminho,
      celulas: ROTAS.listarCelulas.caminho,
      importar: ROTAS.importarHierarquia.caminho,
    });
    expect(ROTAS.atualizarCelula.caminho).toBe(`${CAMINHOS.celulas}/:id`);
    expect(ROTAS.removerRede.caminho).toBe(`${CAMINHOS.redes}/:id`);
    expect(ROTAS.removerDiscipulador.caminho).toBe(
      `${CAMINHOS.discipuladores}/:id`,
    );
  });

  it("colunas da planilha (ordem e obrigatórias) e divisões", () => {
    expect(Object.keys(COLUNAS_DA_PLANILHA)).toEqual([
      ...COLUNAS_CSV_HIERARQUIA,
    ]);
    expect(
      Object.entries(COLUNAS_DA_PLANILHA)
        .filter(([, info]) => info.obrigatoria)
        .map(([coluna]) => coluna),
    ).toEqual([...COLUNAS_CSV_HIERARQUIA_OBRIGATORIAS]);
    expect(DIVISOES).toEqual(DIVISOES_DO_CONTRATO);
  });

  it("limites do arquivo e dos campos", () => {
    expect(LIMITE_CARACTERES_CSV).toBe(
      corpoImportarHierarquiaSchema.shape.csv.maxLength,
    );
    expect(LIMITE_LINHAS_CSV).toBe(LIMITE_LINHAS_CSV_HIERARQUIA);
    const celula = celulaEntradaSchema.shape;
    expect(LIMITES).toEqual({
      nome: celula.nome.maxLength,
      telefone: celulaSchema.shape.lider_telefone.unwrap().maxLength,
      email: celulaSchema.shape.lider_email.unwrap().maxLength,
      pessoasMin: celula.qtd_pessoas.minValue,
      pessoasMax: celula.qtd_pessoas.maxValue,
    });
    expect(celula.lider_nome.maxLength).toBe(LIMITES.nome);
    expect(
      redeEntradaSchema.shape.responsavel_nome.unwrap().unwrap().maxLength,
    ).toBe(LIMITES.nome);
  });
});
