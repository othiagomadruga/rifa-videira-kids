// RIFA-050 (P2.3): quem subiu na última atualização que mudou a ordem. Sem temporizador: o resultado só muda quando
// a ordem (ou as posições) mudam.
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { quemSubiu, useSubiu, type PosicaoNaLista } from "./useSubiu";

const lista = (...nomes: string[]): PosicaoNaLista[] =>
  nomes.map((chave, indice) => ({ chave, posicao: indice + 1 }));

describe("quemSubiu", () => {
  it("sem lista antes (a primeira), ninguém", () => {
    expect([...quemSubiu(new Map(), lista("A", "B"))]).toEqual([]);
  });

  it("quem ficou com a posição menor e quem entrou na lista; quem caiu ou ficou, não", () => {
    const antes = new Map([
      ["A", 1],
      ["B", 2],
      ["C", 3],
    ]);
    expect([...quemSubiu(antes, lista("B", "A", "C"))]).toEqual(["B"]);
    expect([...quemSubiu(antes, lista("A", "D", "B"))]).toEqual(["D"]);
    expect([...quemSubiu(antes, lista("A", "B", "C"))]).toEqual([]);
  });

  it("empatar com quem estava na frente é subir (3º → 2º empatado)", () => {
    const antes = new Map([
      ["A", 1],
      ["B", 2],
      ["C", 3],
    ]);
    const agora = [
      { chave: "A", posicao: 1 },
      { chave: "B", posicao: 2 },
      { chave: "C", posicao: 2 },
    ];
    expect([...quemSubiu(antes, agora)]).toEqual(["C"]);
  });
});

describe("useSubiu", () => {
  it("ao aparecer, ninguém; a mudança marca quem subiu, que fica até a próxima mudança", () => {
    const { result, rerender } = renderHook(
      ({ itens }: { itens: PosicaoNaLista[] }) => useSubiu(itens),
      { initialProps: { itens: lista("A", "B", "C") } },
    );
    expect([...result.current]).toEqual([]);

    // Os mesmos dados (uma lista nova, igual): nada muda, e o conjunto é o mesmo (nada renderiza à toa).
    const antes = result.current;
    rerender({ itens: lista("A", "B", "C") });
    expect(result.current).toBe(antes);

    rerender({ itens: lista("C", "A", "B") });
    expect([...result.current]).toEqual(["C"]);

    // Atualizações sem mudança de ordem: o chip fica.
    rerender({ itens: lista("C", "A", "B") });
    rerender({ itens: lista("C", "A", "B") });
    expect([...result.current]).toEqual(["C"]);

    // A próxima mudança compara com a anterior (C, A, B), não com a primeira.
    rerender({ itens: lista("C", "B", "A") });
    expect([...result.current]).toEqual(["B"]);
  });

  it("da lista vazia para a primeira venda: ninguém subiu", () => {
    const { result, rerender } = renderHook(
      ({ itens }: { itens: PosicaoNaLista[] }) => useSubiu(itens),
      { initialProps: { itens: [] as PosicaoNaLista[] } },
    );
    rerender({ itens: lista("A") });
    expect([...result.current]).toEqual([]);
    rerender({ itens: lista("B", "A") });
    expect([...result.current]).toEqual(["B"]);
  });
});
