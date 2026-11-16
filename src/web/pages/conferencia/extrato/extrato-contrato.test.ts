// RIFA-059: as cópias do contrato na seção do extrato (o caminho da lista de pedidos, o tamanho da página e os status)
// conferidas contra o contrato, e a conversão de um item da lista no pedido do cruzamento.
import { describe, expect, it } from "vitest";
import {
  PAGINA_PEDIDOS_MAXIMA,
  ROTAS,
  STATUS_PEDIDO,
} from "../../../../shared/contracts";
import {
  CAMINHO_PEDIDOS,
  PEDIDOS_POR_PAGINA,
  pedidoDoCruzamento,
} from "./extrato-api";
import { STATUS } from "./textos";
import { belem, itemPedido, paginasDe } from "./teste-apoio";

describe("cópias do contrato", () => {
  it("o caminho, o tamanho da página e os status", () => {
    expect(CAMINHO_PEDIDOS).toBe(ROTAS.listarPedidos.caminho);
    expect(ROTAS.listarPedidos.metodo).toBe("GET");
    expect(PEDIDOS_POR_PAGINA).toBe(PAGINA_PEDIDOS_MAXIMA);
    expect(Object.keys(STATUS).sort()).toEqual([...STATUS_PEDIDO].sort());
  });

  it("a consulta que a seção manda passa pelo schema da rota", () => {
    expect(
      ROTAS.listarPedidos.consulta.safeParse({
        limite: String(PEDIDOS_POR_PAGINA),
        antes_de: "cursor",
      }).success,
    ).toBe(true);
  });

  it("as respostas da API falsa passam pelo schema estrito", () => {
    expect(paginasDe([itemPedido("PEDTESTE0001")])).toHaveLength(1);
  });
});

describe("pedidoDoCruzamento", () => {
  it("a reserva é o criado_em da Rifei; sem ele, quando chegou ao sistema", () => {
    const comCriado = pedidoDoCruzamento(
      itemPedido("A", {
        reserva: belem("2026-11-16", "09:58"),
        registrado_em: belem("2026-11-16", "09:59"),
      }),
    );
    expect(comCriado.reserva).toBe(Date.parse("2026-11-16T09:58:00-03:00"));
    const semCriado = pedidoDoCruzamento(
      itemPedido("B", {
        criado_em: null,
        registrado_em: belem("2026-11-16", "09:59"),
      }),
    );
    expect(semCriado.reserva).toBe(Date.parse("2026-11-16T09:59:00-03:00"));
  });

  it("aprovado, desconsiderado e a célula", () => {
    const pedido = pedidoDoCruzamento(
      itemPedido("C", {
        status: "approved",
        aprovado_em: belem("2026-11-16", "10:30"),
        desconsiderado: {
          motivo: "teste",
          observacao: null,
          em: belem("2026-11-16", "11:00"),
        },
        celula_nome: null,
      }),
    );
    expect(pedido).toMatchObject({
      status: "approved",
      aprovado_em: Date.parse("2026-11-16T10:30:00-03:00"),
      desconsiderado: true,
      celula_nome: null,
    });
  });
});
