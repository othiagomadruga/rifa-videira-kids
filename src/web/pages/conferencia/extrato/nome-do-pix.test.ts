// RIFA-076 (D36): o "REM:" do Pix comparado com o nome do pedido, e o desempate pelo nome no cruzamento. Nomes fictícios.
import { describe, expect, it } from "vitest";
import { cruzar } from "./cruzamento";
import { comparacaoDoNome, nomesConferem, remetenteDoPix } from "./nome-do-pix";
import { pedido, pix } from "./teste-apoio";

const janela = { janelaMs: 24 * 3_600_000 };

describe("o nome do REM", () => {
  it("tira o REM da descrição: sem acento, em maiúsculas, sem números, datas e partículas", () => {
    expect(
      remetenteDoPix("TRANSF PIX REM: Fulana de Tál 16/11 1234567"),
    ).toEqual(["FULANA", "TAL"]);
    expect(remetenteDoPix("PIX RECEBIDO")).toBeNull();
    expect(remetenteDoPix("PIX REM: 1234567")).toBeNull();
  });

  it("confere com o banco cortando ou abreviando; o primeiro nome tem de ser igual", () => {
    const pedidoDe = "Maria José da Silva Ficticia";
    expect(nomesConferem(["MARIA", "JOSE", "SILVA"], pedidoDe)).toBe(true);
    expect(nomesConferem(["MARIA", "J", "S", "FICT"], pedidoDe)).toBe(true);
    expect(nomesConferem(["MARIA"], pedidoDe)).toBe(true);
    expect(nomesConferem(["MARIANA", "SILVA"], pedidoDe)).toBe(false);
    expect(nomesConferem(["MARIA", "SOUZA"], pedidoDe)).toBe(false);
  });

  it("sem REM ou sem nome no pedido (coordenação, pedido antigo): null", () => {
    expect(comparacaoDoNome("PIX REM: FULANA", null)).toBeNull();
    expect(comparacaoDoNome("PIX RECEBIDO", "Fulana")).toBeNull();
    expect(comparacaoDoNome("PIX REM: FULANA", "Fulana Ficticia")).toBe(
      "confere",
    );
    expect(comparacaoDoNome("PIX REM: BELTRANA", "Fulana Ficticia")).toBe(
      "difere",
    );
  });
});

describe("o cruzamento com o nome", () => {
  it("dois pedidos do mesmo valor (seria Ambíguo): o REM que confere com um só fica com ele (Provável)", () => {
    const pedidos = [
      pedido("PEDX0001", "2026-11-16 09:00", 2000, {
        comprador_nome: "Fulana Ficticia",
      }),
      pedido("PEDX0002", "2026-11-16 09:10", 2000, {
        comprador_nome: "Beltrana Ficticia",
      }),
    ];
    const sem = cruzar(
      [pix(1, "2026-11-16 10:00", 2000, "TRANSF PIX REM: OUTRA PESSOA")],
      pedidos,
      janela,
    );
    expect(sem.ambiguos).toHaveLength(1);

    const com = cruzar(
      [pix(1, "2026-11-16 10:00", 2000, "TRANSF PIX REM: BELTRANA F")],
      pedidos,
      janela,
    );
    expect(com.ambiguos).toEqual([]);
    expect(
      com.paraMarcar.map((item) => [item.pedido.id, item.grau, item.nome]),
    ).toEqual([["PEDX0002", "provavel", "confere"]]);
  });

  it("depois do desempate pelo nome, o outro Pix fica com o pedido que sobrou (Provável pelo valor)", () => {
    const resultado = cruzar(
      [
        pix(1, "2026-11-16 10:00", 2000, "TRANSF PIX REM: OUTRA PESSOA"),
        pix(2, "2026-11-16 10:05", 2000, "TRANSF PIX REM: FULANA FICTICIA"),
      ],
      [
        pedido("PEDX0001", "2026-11-16 09:00", 2000, {
          comprador_nome: "Fulana Ficticia",
        }),
        pedido("PEDX0002", "2026-11-16 09:10", 2000, {
          comprador_nome: "Beltrana Ficticia",
        }),
      ],
      janela,
    );
    expect(
      resultado.paraMarcar.map((item) => [
        item.pix.chave,
        item.pedido.id,
        item.nome,
      ]),
    ).toEqual([
      ["L1", "PEDX0002", "difere"],
      ["L2", "PEDX0001", "confere"],
    ]);
  });

  it("sem nome nos pedidos (a coordenação), o resultado é o de antes, com nome null", () => {
    const resultado = cruzar(
      [pix(1, "2026-11-16 10:00", 2000, "TRANSF PIX REM: FULANA")],
      [pedido("PEDX0001", "2026-11-16 09:00", 2000)],
      janela,
    );
    expect(
      resultado.paraMarcar.map((item) => [
        item.pedido.id,
        item.grau,
        item.nome,
      ]),
    ).toEqual([["PEDX0001", "provavel", null]]);
  });
});
