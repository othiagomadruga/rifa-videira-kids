// A tela Pedidos suspeitos usa cópias de valores do contrato (os valores de src/shared/contracts poriam o zod no
// pacote do site; veja pedidos-suspeitos-api.ts). Este teste garante que as cópias continuam iguais ao contrato e
// que todo motivo do contrato tem um texto em português.
import { describe, expect, it } from "vitest";
import {
  MOTIVOS_PEDIDO_SUSPEITO,
  ROTAS,
  TETO_BILHETES_POR_PEDIDO as TETO_DO_CONTRATO,
  TOLERANCIA_DESCONTO_BP as TOLERANCIA_DO_CONTRATO,
} from "../../../shared/contracts";
import { TELAS_COORDENACAO } from "../coordenacao/telas";
import {
  CAMINHO_PEDIDOS_SUSPEITOS,
  TETO_BILHETES_POR_PEDIDO,
  TOLERANCIA_DESCONTO_BP,
} from "./pedidos-suspeitos-api";
import { ROTULO_MOTIVO } from "./textos";

describe("cópias do contrato dos pedidos suspeitos no site", () => {
  it("caminho e método da rota; rota e tela abertas a toda a coordenação", () => {
    expect(ROTAS.pedidosSuspeitos).toMatchObject({
      metodo: "GET",
      caminho: CAMINHO_PEDIDOS_SUSPEITOS,
      grupo: "coordenacao",
    });
    expect("papeis" in ROTAS.pedidosSuspeitos).toBe(false);
    const tela = TELAS_COORDENACAO.find(
      ({ segmento }) => segmento === "pedidos-suspeitos",
    );
    expect(tela).toBeDefined();
    expect(tela?.papeis).toBeUndefined();
  });

  it("teto de bilhetes e tolerância de desconto (usados no detalhe dos motivos)", () => {
    expect(TETO_BILHETES_POR_PEDIDO).toBe(TETO_DO_CONTRATO);
    expect(TOLERANCIA_DESCONTO_BP).toBe(TOLERANCIA_DO_CONTRATO);
  });

  it("todo motivo do contrato tem um texto em português, sem repetir", () => {
    expect(Object.keys(ROTULO_MOTIVO).sort()).toEqual(
      [...MOTIVOS_PEDIDO_SUSPEITO].sort(),
    );
    const textos = Object.values(ROTULO_MOTIVO);
    expect(new Set(textos).size).toBe(textos.length);
    for (const texto of textos) expect(texto).toMatch(/^[A-Z][^_]+$/);
  });
});
