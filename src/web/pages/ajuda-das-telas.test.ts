// RIFA-066 (D31): os textos de ajuda seguem a regra (o que é, para que serve e, quando há escolha, um exemplo, em 2 ou
// 3 frases curtas) e as chaves das telas que carregam com o site não se repetem (elas dividem um pedaço só, sob
// demanda). Aqui se confere o que dá para medir: o tamanho, o número de frases e o ponto final; o sentido de cada
// texto fica com a revisão.
import { describe, expect, it } from "vitest";
import { AJUDA, AJUDA_DAS_TELAS } from "./ajuda-das-telas";
import { AJUDA as AJUDA_CAMPANHA } from "./campanha/textos";

/** Todos os textos de um objeto de ajuda (os de dentro de grupos e os de funções, com um valor de exemplo). */
function textos(objeto: object, prefixo = ""): [string, string][] {
  return Object.entries(objeto).flatMap(
    ([chave, valor]): [string, string][] => {
      const nome = `${prefixo}${chave}`;
      if (typeof valor === "string") return [[nome, valor]];
      if (typeof valor === "function")
        return [[nome, String((valor as (x: string) => string)("link_lider"))]];
      return textos(valor as object, `${nome}.`);
    },
  );
}

/** As frases de um texto ("Ex.:" e "R$ 1,00" não terminam frase). */
function frases(texto: string): string[] {
  return texto
    .replace(/Ex\.:/g, "Ex:")
    .split(/(?<=[.!?…])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ“"])/u)
    .filter(Boolean);
}

const TODOS = [...textos(AJUDA), ...textos(AJUDA_CAMPANHA, "campanha.")];

describe("os textos de ajuda", () => {
  it("as chaves das telas que carregam com o site não se repetem entre elas", () => {
    const chaves = AJUDA_DAS_TELAS.flatMap((tela) => Object.keys(tela));
    expect(chaves.length).toBeGreaterThan(20);
    expect(new Set(chaves).size).toBe(chaves.length);
    expect(Object.keys(AJUDA)).toHaveLength(chaves.length);
  });

  it.each(TODOS)(
    "%s: até 3 frases curtas (até 260 caracteres), com ponto final",
    (_chave, texto) => {
      expect(texto.length).toBeGreaterThan(30);
      expect(texto.length).toBeLessThanOrEqual(260);
      expect(frases(texto).length).toBeLessThanOrEqual(3);
      expect(texto).toMatch(/[.!?…]$/);
    },
  );
});
