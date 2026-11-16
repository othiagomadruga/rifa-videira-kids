// RIFA-059: o cruzamento do extrato com os pedidos (D26): Certo, Provável, Ambíguo, sem pedido e já contado, a
// janela, os empates e as garantias (um Pix com no máximo um pedido, um pedido com no máximo um Pix, o mesmo
// resultado em qualquer ordem de entrada).
import { describe, expect, it } from "vitest";
import {
  cruzar,
  numerosParaCopiar,
  serve,
  type ResultadoDoCruzamento,
} from "./cruzamento";
import { pedido, pix } from "./teste-apoio";

const H24 = 24 * 3_600_000;
const janela = { janelaMs: H24 };

/** O resultado em forma curta: Pix → pedido(s), por grupo. */
function curto(resultado: ResultadoDoCruzamento) {
  return {
    paraMarcar: resultado.paraMarcar.map(
      (item) => `${item.pix.chave}→${item.pedido.id}:${item.grau}`,
    ),
    ambiguos: resultado.ambiguos.map(
      (item) =>
        `${item.pix.chave}→${item.candidatos.map((c) => c.id).join("|")}`,
    ),
    semPedido: resultado.semPedido.map(
      (item) =>
        `${item.pix.chave}:${item.motivo}${item.pedidos.length ? `(${item.pedidos.join("|")})` : ""}`,
    ),
    jaContados: resultado.jaContados.map(
      (item) =>
        `${item.pix.chave}→${item.pedidos.map((p) => p.id).join("|")}:${item.grau ?? "um_destes"}`,
    ),
  };
}

describe("Certo: o Pix traz o número do pedido", () => {
  it("na descrição (mesmo grudado em outro texto) ou num identificador (FITID, documento)", () => {
    const resultado = cruzar(
      [
        pix(
          1,
          "2026-11-16 10:05",
          2000,
          "TRANSFERENCIA PIX PEDX0001 REM: FULANA",
        ),
        pix(2, "2026-11-16 10:06", 2000, "PIX RECEBIDO", ["PEDX0002"]),
        pix(3, "2026-11-16 10:07", 2000, "PIX-PEDX0003 RECEBIDO"),
      ],
      [
        pedido("PEDX0001", "2026-11-14 08:00"),
        pedido("PEDX0002", "2026-11-14 08:00"),
        pedido("PEDX0003", "2026-11-14 08:00"),
      ],
      janela,
    );
    // Reservados há mais de 24 h: pelo valor não serviriam; pelo número, sim.
    expect(curto(resultado).paraMarcar).toEqual([
      "L1→PEDX0001:certo",
      "L2→PEDX0002:certo",
      "L3→PEDX0003:certo",
    ]);
  });

  it("o número de um pedido já pago: já contado (Certo)", () => {
    const resultado = cruzar(
      [pix(1, "2026-11-16 10:05", 2000, "PIX PEDX0001")],
      [
        pedido("PEDX0001", "2026-11-16 09:58", 2000, {
          aprovado: "2026-11-16 10:30",
        }),
      ],
      janela,
    );
    expect(curto(resultado).jaContados).toEqual(["L1→PEDX0001:certo"]);
    expect(resultado.paraMarcar).toEqual([]);
  });

  it("com outro valor: continua Certo, com o aviso do valor diferente", () => {
    const resultado = cruzar(
      [pix(1, "2026-11-16 10:05", 1500, "PIX PEDX0001")],
      [pedido("PEDX0001", "2026-11-16 09:58", 2000)],
      janela,
    );
    expect(resultado.paraMarcar[0].grau).toBe("certo");
    expect(resultado.paraMarcar[0].valorDiferente).toBe(true);
  });

  it("o número de um desconsiderado: Pix sem pedido, com o motivo", () => {
    const resultado = cruzar(
      [pix(1, "2026-11-16 10:05", 2000, "PIX PEDX0001")],
      [pedido("PEDX0001", "2026-11-16 09:58", 2000, { desconsiderado: true })],
      janela,
    );
    expect(curto(resultado).semPedido).toEqual(["L1:desconsiderado(PEDX0001)"]);
  });

  it("dois Pix com o mesmo número: o mais antigo fica com o pedido; o outro é Pix em dobro", () => {
    const resultado = cruzar(
      [
        pix(1, "2026-11-16 11:00", 2000, "PIX PEDX0001"),
        pix(2, "2026-11-16 10:05", 2000, "PIX PEDX0001"),
      ],
      [pedido("PEDX0001", "2026-11-16 09:58")],
      janela,
    );
    expect(curto(resultado)).toEqual({
      paraMarcar: ["L2→PEDX0001:certo"],
      ambiguos: [],
      semPedido: ["L1:pedido_repetido(PEDX0001)"],
      jaContados: [],
    });
  });

  it("números curtos demais (menos de 4 caracteres) não contam", () => {
    const resultado = cruzar(
      [pix(1, "2026-11-16 10:05", 2000, "PIX 123")],
      [pedido("123", "2026-11-14 09:58")],
      janela,
    );
    expect(resultado.paraMarcar).toEqual([]);
  });

  it("só de algarismos, o número precisa de 8 ou mais: o documento do banco não vira Certo por acaso", () => {
    const resultado = cruzar(
      [
        // O documento do banco (7 algarismos) igual ao número de um pedido reservado dias antes, com outro valor.
        pix(1, "2026-11-16 10:05", 5000, "TRANSF PIX REM: FULANA 1234567", [
          "2026111600001",
        ]),
        // O número só de algarismos com 8 ou mais: Certo.
        pix(2, "2026-11-16 10:06", 2000, "PIX RECEBIDO 98765432"),
        // Com letra, 4 bastam.
        pix(3, "2026-11-16 10:07", 2000, "PIX RECEBIDO AB12"),
      ],
      [
        pedido("1234567", "2026-11-10 09:00", 2000),
        pedido("98765432", "2026-11-14 08:00"),
        pedido("AB12", "2026-11-14 08:00"),
      ],
      janela,
    );
    expect(curto(resultado)).toEqual({
      paraMarcar: ["L2→98765432:certo", "L3→AB12:certo"],
      ambiguos: [],
      semPedido: ["L1:nenhum"],
      jaContados: [],
    });
  });

  it("os Certos vêm antes: um Pix mais antigo, só pelo valor, perde o pedido para o que traz o número", () => {
    const resultado = cruzar(
      [
        pix(1, "2026-11-16 10:00", 2000, "PIX RECEBIDO FULANA"),
        pix(2, "2026-11-16 10:30", 2000, "PIX PEDX0001"),
      ],
      [pedido("PEDX0001", "2026-11-16 09:58")],
      janela,
    );
    expect(curto(resultado)).toEqual({
      paraMarcar: ["L2→PEDX0001:certo"],
      ambiguos: [],
      semPedido: ["L1:ja_casados(PEDX0001)"],
      jaContados: [],
    });
  });
});

describe("Provável, Ambíguo e sem pedido: pelo valor e pela hora", () => {
  it("Provável: o mesmo valor, reservado antes do Pix, na janela, e só um pedido serve", () => {
    const resultado = cruzar(
      [pix(1, "2026-11-16 10:05", 4000)],
      [
        pedido("PEDX0001", "2026-11-16 09:58", 4000),
        pedido("PEDX0002", "2026-11-16 09:59", 2000),
      ],
      janela,
    );
    expect(curto(resultado).paraMarcar).toEqual(["L1→PEDX0001:provavel"]);
  });

  it("a janela: reservado há 25 h não serve com 24 h; serve com 48 h", () => {
    const pedidos = [pedido("PEDX0001", "2026-11-15 09:00")];
    const pixes = [pix(1, "2026-11-16 10:00", 2000)];
    expect(curto(cruzar(pixes, pedidos, janela)).semPedido).toEqual([
      "L1:nenhum",
    ]);
    expect(
      curto(cruzar(pixes, pedidos, { janelaMs: 2 * H24 })).paraMarcar,
    ).toEqual(["L1→PEDX0001:provavel"]);
  });

  it("o Pix antes da reserva não serve (com 5 min de folga para o relógio)", () => {
    expect(
      serve(
        pix(1, "2026-11-16 10:00", 2000),
        pedido("A", "2026-11-16 10:30"),
        H24,
      ),
    ).toBe(false);
    expect(
      serve(
        pix(1, "2026-11-16 10:00", 2000),
        pedido("A", "2026-11-16 10:04"),
        H24,
      ),
    ).toBe(true);
  });

  it("o Pix sem hora serve aos pedidos reservados até o fim daquele dia", () => {
    expect(
      serve(pix(1, "2026-11-16", 2000), pedido("A", "2026-11-16 22:00"), H24),
    ).toBe(true);
    expect(
      serve(pix(1, "2026-11-16", 2000), pedido("A", "2026-11-17 08:00"), H24),
    ).toBe(false);
    expect(
      serve(pix(1, "2026-11-16", 2000), pedido("A", "2026-11-15 08:00"), H24),
    ).toBe(true);
    expect(
      serve(pix(1, "2026-11-16", 2000), pedido("A", "2026-11-14 23:00"), H24),
    ).toBe(false);
  });

  it("o pedido já pago só serve ao Pix que chegou antes da aprovação", () => {
    const pago = pedido("A", "2026-11-16 09:00", 2000, {
      aprovado: "2026-11-16 09:30",
    });
    expect(serve(pix(1, "2026-11-16 09:10", 2000), pago, H24)).toBe(true);
    expect(serve(pix(1, "2026-11-16 10:00", 2000), pago, H24)).toBe(false);
  });

  it("Ambíguo: mais de um pedido serve; os candidatos vêm do reservado mais cedo ao mais tarde", () => {
    const resultado = cruzar(
      [pix(1, "2026-11-16 17:00", 2000, "PIX RECEBIDO FULANA")],
      [
        pedido("PEDX0005", "2026-11-16 16:40"),
        pedido("PEDX0004", "2026-11-16 16:20", 2000, { status: "expired" }),
      ],
      janela,
    );
    expect(curto(resultado).ambiguos).toEqual(["L1→PEDX0004|PEDX0005"]);
  });

  it("Ambíguo com todos os candidatos já pagos: já contado (um destes)", () => {
    const resultado = cruzar(
      [pix(1, "2026-11-16 10:05", 2000)],
      [
        pedido("A", "2026-11-16 09:58", 2000, { aprovado: "2026-11-16 10:20" }),
        pedido("B", "2026-11-16 10:01", 2000, { aprovado: "2026-11-16 10:40" }),
      ],
      janela,
    );
    expect(curto(resultado)).toEqual({
      paraMarcar: [],
      ambiguos: [],
      semPedido: [],
      jaContados: ["L1→A|B:um_destes"],
    });
  });

  it("Provável de um pedido já pago: já contado (Provável)", () => {
    const resultado = cruzar(
      [pix(1, "2026-11-16 10:05", 2000)],
      [pedido("A", "2026-11-16 09:58", 2000, { aprovado: "2026-11-16 10:20" })],
      janela,
    );
    expect(curto(resultado).jaContados).toEqual(["L1→A:provavel"]);
  });

  it("o desconsiderado nunca serve pelo valor", () => {
    const resultado = cruzar(
      [pix(1, "2026-11-16 10:05", 2000)],
      [pedido("A", "2026-11-16 09:58", 2000, { desconsiderado: true })],
      janela,
    );
    expect(curto(resultado).semPedido).toEqual(["L1:nenhum"]);
  });
});

describe("empates e o algoritmo guloso estável", () => {
  it("dois Pix disputam o mesmo e único pedido: o mais antigo fica com ele; o outro diz com quem ficou", () => {
    const resultado = cruzar(
      [pix(2, "2026-11-16 10:30", 2000), pix(1, "2026-11-16 10:05", 2000)],
      [pedido("A", "2026-11-16 09:58")],
      janela,
    );
    expect(curto(resultado)).toEqual({
      paraMarcar: ["L1→A:provavel"],
      ambiguos: [],
      semPedido: ["L2:ja_casados(A)"],
      jaContados: [],
    });
  });

  it("no mesmo instante, desempata a ordem no extrato", () => {
    const resultado = cruzar(
      [pix(7, "2026-11-16 10:05", 2000), pix(3, "2026-11-16 10:05", 2000)],
      [pedido("A", "2026-11-16 09:58")],
      janela,
    );
    expect(curto(resultado).paraMarcar).toEqual(["L3→A:provavel"]);
    expect(curto(resultado).semPedido).toEqual(["L7:ja_casados(A)"]);
  });

  it("em voltas: um Pix com dois candidatos vira Provável quando o outro candidato fica com um Pix que só tinha ele", () => {
    // L1 (10:00) serve a A e B; L2 (às 08:30 do dia seguinte) só a B (A passou da janela).
    const resultado = cruzar(
      [pix(1, "2026-11-16 10:00", 2000), pix(2, "2026-11-17 08:30", 2000)],
      [pedido("A", "2026-11-16 08:00"), pedido("B", "2026-11-16 09:00")],
      janela,
    );
    expect(curto(resultado).paraMarcar).toEqual([
      "L1→A:provavel",
      "L2→B:provavel",
    ]);
  });

  it("dois Pix iguais e dois pedidos iguais que servem aos dois: os dois Pix ficam Ambíguos (sem chutar o par)", () => {
    const resultado = cruzar(
      [pix(1, "2026-11-16 10:05", 2000), pix(2, "2026-11-16 10:06", 2000)],
      [pedido("A", "2026-11-16 09:58"), pedido("B", "2026-11-16 10:00")],
      janela,
    );
    expect(curto(resultado).ambiguos).toEqual(["L1→A|B", "L2→A|B"]);
  });

  it("pedidos reservados no mesmo instante: os candidatos em ordem pelo número", () => {
    const resultado = cruzar(
      [pix(1, "2026-11-16 10:05", 2000)],
      [
        pedido("PEDX0009", "2026-11-16 09:58"),
        pedido("PEDX0002", "2026-11-16 09:58"),
      ],
      janela,
    );
    expect(curto(resultado).ambiguos).toEqual(["L1→PEDX0002|PEDX0009"]);
  });

  it("o mesmo resultado em qualquer ordem de entrada; um Pix com no máximo um pedido e vice-versa", () => {
    const pixes = [
      pix(1, "2026-11-16 10:00", 2000),
      pix(2, "2026-11-16 10:05", 2000, "PIX PEDX0003"),
      pix(3, "2026-11-16 11:00", 4000),
      pix(4, "2026-11-16 11:00", 4000),
      pix(5, "2026-11-16 12:00", 2000),
      pix(6, "2026-11-16", 6000),
    ];
    const pedidos = [
      pedido("PEDX0001", "2026-11-16 09:50"),
      pedido("PEDX0002", "2026-11-16 09:55"),
      pedido("PEDX0003", "2026-11-16 09:59"),
      pedido("PEDX0004", "2026-11-16 10:50", 4000),
      pedido("PEDX0005", "2026-11-16 11:40", 2000, {
        aprovado: "2026-11-16 12:10",
      }),
      pedido("PEDX0006", "2026-11-16 08:00", 6000),
    ];
    const referencia = curto(cruzar(pixes, pedidos, janela));
    // Fisher-Yates com semente fixa: permutações de verdade, sempre as mesmas.
    let semente = 7;
    const sorteio = () =>
      (semente = (semente * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
    const embaralhar = <T>(lista: T[]) => {
      const copia = [...lista];
      for (let i = copia.length - 1; i > 0; i--) {
        const j = Math.floor(sorteio() * (i + 1));
        [copia[i], copia[j]] = [copia[j], copia[i]];
      }
      return copia;
    };
    expect(
      curto(cruzar([...pixes].reverse(), [...pedidos].reverse(), janela)),
    ).toEqual(referencia);
    for (let volta = 0; volta < 50; volta++)
      expect(
        curto(cruzar(embaralhar(pixes), embaralhar(pedidos), janela)),
      ).toEqual(referencia);
    const resultado = cruzar(pixes, pedidos, janela);
    const casados = [
      ...resultado.paraMarcar.map((item) => [item.pix.chave, item.pedido.id]),
      ...resultado.jaContados
        .filter((item) => item.grau !== null)
        .map((item) => [item.pix.chave, item.pedidos[0].id]),
    ];
    expect(new Set(casados.map(([chave]) => chave)).size).toBe(casados.length);
    expect(new Set(casados.map(([, id]) => id)).size).toBe(casados.length);
    // Todo Pix aparece numa lista só.
    const todos = [
      ...resultado.paraMarcar,
      ...resultado.ambiguos,
      ...resultado.semPedido,
      ...resultado.jaContados,
    ].map((item) => item.pix.chave);
    expect(todos.sort()).toEqual(["L1", "L2", "L3", "L4", "L5", "L6"]);
  });
});

describe("numerosParaCopiar", () => {
  it("os números dos pedidos para marcar, um por linha, na ordem dos Pix", () => {
    const resultado = cruzar(
      [
        pix(2, "2026-11-16 11:00", 4000),
        pix(1, "2026-11-16 10:05", 2000, "PIX PEDX0001"),
      ],
      [
        pedido("PEDX0001", "2026-11-16 09:58"),
        pedido("PEDX0002", "2026-11-16 10:58", 4000),
      ],
      janela,
    );
    expect(numerosParaCopiar(resultado)).toBe("PEDX0001\nPEDX0002");
  });
});
