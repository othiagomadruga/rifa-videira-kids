// A tela do bumbo usa cópias de valores do contrato (importar os valores de api.ts poria o zod no pacote
// do site; veja bumbo-api.ts). Este teste garante que as cópias continuam iguais ao contrato.
import { describe, expect, it } from "vitest";
import {
  DIAS_DO_BUMBO_DEPOIS_DO_FIM,
  ROTAS,
} from "../../../shared/contracts/api";
import { CAMINHO_BUMBO, DIAS_DEPOIS_DO_FIM, caminhoDoBumbo } from "./bumbo-api";

describe("cópias do contrato do bumbo no site", () => {
  it("o caminho da rota aberta do bumbo", () => {
    expect(CAMINHO_BUMBO).toBe(ROTAS.bumbo.caminho);
    expect(ROTAS.bumbo.grupo).toBe("aberto");
    expect(caminhoDoBumbo(null)).toBe("/api/publico/bumbo");
    expect(caminhoDoBumbo("2026-11-30")).toBe(
      "/api/publico/bumbo?data=2026-11-30",
    );
  });

  it("a janela do `data`: até o dia seguinte ao último dia da campanha", () => {
    expect(DIAS_DEPOIS_DO_FIM).toBe(DIAS_DO_BUMBO_DEPOIS_DO_FIM);
  });

  it("o `data` que a tela manda passa pelo schema da consulta", () => {
    expect(ROTAS.bumbo.consulta.parse({ data: "2026-11-30" })).toEqual({
      data: "2026-11-30",
    });
    expect(ROTAS.bumbo.consulta.parse({})).toEqual({});
  });
});
