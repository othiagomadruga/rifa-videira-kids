// RIFA-013b, item 5 (unidade): quando um pedido aprovado é implausível. O teto e a tolerância vêm do
// contrato (TETO_BILHETES_POR_PEDIDO = 200 e TOLERANCIA_DESCONTO_BP = 5000).
import { describe, expect, it } from "vitest";
import {
  TETO_BILHETES_POR_PEDIDO,
  TOLERANCIA_DESCONTO_BP,
  motivoPedidoSuspeitoSchema,
} from "../../shared/contracts";
import { avaliarPlausibilidade } from "./plausibilidade";

const PRECO = 2000;
const avaliar = (qtdBilhetes: number, totalCentavos: number) =>
  avaliarPlausibilidade({
    qtdBilhetes,
    totalCentavos,
    precoBilheteCentavos: PRECO,
  });
const codigos = (qtd: number, total: number) =>
  avaliar(qtd, total)?.motivos.map((motivo) => motivo.codigo) ?? [];

describe("avaliarPlausibilidade", () => {
  it("as constantes são as combinadas: teto de 200 bilhetes e até 50% de desconto", () => {
    expect(TETO_BILHETES_POR_PEDIDO).toBe(200);
    expect(TOLERANCIA_DESCONTO_BP).toBe(5000);
  });

  it("pedido comum (bilhetes × preço) é plausível", () => {
    expect(avaliar(3, 6000)).toBeNull();
    expect(avaliar(1, 2000)).toBeNull();
  });

  it("borda do teto: 200 bilhetes passam; 201 marcam quantidade_acima_do_teto", () => {
    expect(avaliar(200, 200 * PRECO)).toBeNull();
    expect(avaliar(201, 201 * PRECO)).toEqual({
      motivos: [
        {
          caminho: ["numbers_count"],
          codigo: "quantidade_acima_do_teto",
          mensagem:
            "Mais de 200 bilhetes num pedido só: confira na Rifei (o pedido continua contando)",
          ocorrencias: 1,
        },
      ],
      esperadoCentavos: 201 * PRECO,
    });
  });

  it("borda de cima: um centavo acima de bilhetes × preço marca total_acima_do_esperado", () => {
    expect(codigos(5, 5 * PRECO)).toEqual([]);
    expect(codigos(5, 5 * PRECO + 1)).toEqual(["total_acima_do_esperado"]);
  });

  it("borda de baixo: 50% de desconto passa (como no exemplo oficial da Rifei); um centavo a menos marca", () => {
    expect(codigos(5, (5 * PRECO) / 2)).toEqual([]);
    expect(codigos(5, (5 * PRECO) / 2 - 1)).toEqual([
      "total_abaixo_do_esperado",
    ]);
    // Cupom de 100% (venda de R$ 0,00) também vai para a revisão.
    expect(codigos(2, 0)).toEqual(["total_abaixo_do_esperado"]);
  });

  it("o caso da auditoria (1.000.000 de bilhetes por R$ 10 milhões) é marcado pela quantidade; com total baixo, pelos dois", () => {
    // R$ 10 milhões é a metade de 1.000.000 × R$ 20,00: dentro da tolerância de desconto.
    expect(codigos(1_000_000, 1_000_000_000)).toEqual([
      "quantidade_acima_do_teto",
    ]);
    expect(codigos(1_000_000, 100)).toEqual([
      "quantidade_acima_do_teto",
      "total_abaixo_do_esperado",
    ]);
  });

  it("pedido sem bilhetes e sem valor não marca; sem bilhetes e com valor, marca o total", () => {
    expect(avaliar(0, 0)).toBeNull();
    expect(codigos(0, 100)).toEqual(["total_acima_do_esperado"]);
  });

  it("conta exata com valores enormes (BigInt): o esperado fica no maior inteiro seguro", () => {
    const suspeita = avaliarPlausibilidade({
      qtdBilhetes: 1_000_000,
      totalCentavos: 0,
      precoBilheteCentavos: Number.MAX_SAFE_INTEGER,
    });
    expect(suspeita?.esperadoCentavos).toBe(Number.MAX_SAFE_INTEGER);
    expect(suspeita?.motivos.map((motivo) => motivo.codigo)).toEqual([
      "quantidade_acima_do_teto",
      "total_abaixo_do_esperado",
    ]);
  });

  it("os motivos seguem o schema do contrato e as mensagens nunca trazem o valor recebido", () => {
    const suspeita = avaliar(4321, 98_765);
    expect(suspeita?.motivos).toHaveLength(2);
    for (const motivo of suspeita?.motivos ?? []) {
      expect(motivoPedidoSuspeitoSchema.parse(motivo)).toEqual(motivo);
      expect(motivo.mensagem).not.toMatch(/4321|98765|987,65|4\.321/);
    }
  });
});
