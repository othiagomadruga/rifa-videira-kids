// RIFA-066 (D31): os textos de ajuda seguem a regra (o que é, para que serve e, quando há escolha, um exemplo, em 2 ou
// 3 frases curtas) e as chaves das telas que carregam com o site não se repetem (elas dividem um pedaço só, sob
// demanda). Aqui se confere o que dá para medir: o tamanho, o número de frases e o ponto final; o sentido de cada
// texto fica com a revisão.
import { describe, expect, it } from "vitest";
import { AJUDA, AJUDA_DAS_TELAS } from "./ajuda-das-telas";
import { AJUDA as AJUDA_DO_QR } from "../components/qr/textos";
import { AJUDA as AJUDA_CAMPANHA } from "./campanha/textos";
import { AJUDA_NOTIFICACOES } from "./campanha/textos-notificacoes";
import { AJUDA as AJUDA_EXTRATO } from "./conferencia/extrato/textos";
import { AJUDA as AJUDA_CONFERENCIA } from "./conferencia/textos";
import { AJUDA as AJUDA_MAPA } from "./mapa/textos";
import { AJUDA as AJUDA_MINHA } from "./minha/textos";
import { AJUDA_TODAS_AS_REDES } from "./minha/textos-todas-as-redes";
import { AJUDA as AJUDA_PEDIDOS } from "./pedidos/textos";
import { AJUDA as AJUDA_ABERTA } from "./ranking-publico/ajuda";

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

const TODOS = [
  ...textos(AJUDA),
  ...textos(AJUDA_CAMPANHA, "campanha."),
  // RIFA-095 (D43): a opção das notificações de venda.
  ...textos(AJUDA_NOTIFICACOES, "campanha.notificacoes."),
  ...textos(AJUDA_PEDIDOS, "pedidos."),
  ...textos(AJUDA_MAPA, "mapa."),
  ...textos(AJUDA_CONFERENCIA, "conferencia."),
  ...textos(AJUDA_EXTRATO, "extrato."),
  ...textos(AJUDA_MINHA, "minha."),
  ...textos(AJUDA_TODAS_AS_REDES, "minha.todasAsRedes."),
  ...textos(AJUDA_DO_QR, "qr."),
  ...textos(AJUDA_ABERTA, "aberta."),
];

describe("os textos de ajuda", () => {
  it("as chaves das telas que carregam com o site não se repetem entre elas", () => {
    const chaves = AJUDA_DAS_TELAS.flatMap((tela) => Object.keys(tela));
    expect(chaves.length).toBeGreaterThan(20);
    expect(new Set(chaves).size).toBe(chaves.length);
    expect(Object.keys(AJUDA)).toHaveLength(chaves.length);
  });

  it("os textos das telas da coordenação que carregam com o site, os da /minha e os das telas abertas não falam em R$ (o bumbo, a /minha e o público nunca recebem valores)", () => {
    for (const [chave, texto] of [
      ...textos(AJUDA),
      ...textos(AJUDA_MINHA, "minha."),
      ...textos(AJUDA_TODAS_AS_REDES, "minha.todasAsRedes."),
      ...textos(AJUDA_ABERTA, "aberta."),
    ])
      expect(texto, chave).not.toMatch(/R\$|reais/);
  });

  it("os módulos que o bumbo, o telão e as telas abertas carregam sob demanda só têm textos (nenhum import)", () => {
    // O bumbo e o telão podem importar o carregador da ajuda (guarda-bumbo e guarda-telao) porque estes módulos são
    // só textos: um import aqui levaria código (dados, dinheiro, API) para dentro do pacote deles sem a guarda ver.
    const fontes = import.meta.glob<string>(
      ["./ajuda-das-telas.ts", "./*/ajuda.ts"],
      { query: "?raw", import: "default", eager: true },
    );
    const ajudas = Object.keys(fontes).filter(
      (arquivo) => arquivo !== "./ajuda-das-telas.ts",
    );
    expect(ajudas).toContain("./ranking-publico/ajuda.ts");
    expect(ajudas.length).toBeGreaterThanOrEqual(7);
    for (const arquivo of ajudas)
      expect(fontes[arquivo], arquivo).not.toMatch(/^\s*import\b|import\(/m);
    // O agregador só importa os ajuda.ts das telas.
    const destinos = [
      ...(fontes["./ajuda-das-telas.ts"] ?? "").matchAll(/from\s*"([^"]+)"/g),
    ].map((achado) => achado[1]);
    expect(destinos.length).toBeGreaterThanOrEqual(6);
    for (const destino of destinos)
      expect(destino).toMatch(/^\.\/[\w-]+\/ajuda$/);
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
