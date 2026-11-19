import { describe, expect, it } from "vitest";
import {
  BILHETES_PADRAO,
  bitLigado,
  contarBits,
  criarMapaDeBits,
  ligarBit,
  mapaDeBase64,
  mapaParaBase64,
  numeroInicialEfetivo,
  situacaoNoIndice,
} from "./bilhetes";
import { campanhaEntradaSchema } from "./dominio";
import { respostaBilhetesSchema } from "./api";

describe("bilhetes (RIFA-075, D35)", () => {
  it("o padrão é a rifa da Rifei: 7005 números, número inicial automático", () => {
    expect(BILHETES_PADRAO).toEqual({ quantidade: 7005, numero_inicial: null });
  });

  it("o número inicial automático é 0 só quando um pedido trouxe o 0", () => {
    expect(numeroInicialEfetivo(null, true)).toBe(0);
    expect(numeroInicialEfetivo(null, false)).toBe(1);
    expect(numeroInicialEfetivo(1, true)).toBe(1);
    expect(numeroInicialEfetivo(0, false)).toBe(0);
  });

  it("o mapa de bits vai e volta em base64 (bit i no byte i>>3, do menos significativo)", () => {
    const mapa = criarMapaDeBits(7005);
    expect(mapa.length).toBe(876);
    for (const i of [0, 7, 8, 7004]) ligarBit(mapa, i);
    expect(mapa[0]).toBe(0b1000_0001);
    expect(mapa[1]).toBe(1);
    const volta = mapaDeBase64(mapaParaBase64(mapa));
    expect(Array.from(volta)).toEqual(Array.from(mapa));
    expect(contarBits(volta)).toBe(4);
    expect(bitLigado(volta, 7004)).toBe(true);
    expect(bitLigado(volta, 7003)).toBe(false);
    expect(bitLigado(volta, 99_999)).toBe(false);
  });

  it("base64 de 1.000.000 de números não estoura a pilha", () => {
    const mapa = criarMapaDeBits(1_000_000);
    ligarBit(mapa, 999_999);
    expect(contarBits(mapaDeBase64(mapaParaBase64(mapa)))).toBe(1);
  });

  it("pago vence reservado", () => {
    const pagos = criarMapaDeBits(8);
    const reservados = criarMapaDeBits(8);
    ligarBit(pagos, 1);
    ligarBit(reservados, 1);
    ligarBit(reservados, 2);
    expect(situacaoNoIndice(pagos, reservados, 1)).toBe("pago");
    expect(situacaoNoIndice(pagos, reservados, 2)).toBe("reservado");
    expect(situacaoNoIndice(pagos, reservados, 3)).toBe("livre");
  });

  it("a campanha aceita o grupo bilhetes opcional, com número inicial 0, 1 ou null", () => {
    const base = {
      nome: "X",
      slug_rifei: "x",
      data_inicio: "2026-11-23",
      preco_bilhete_centavos: 1000,
      meta: { unidade: "bilhetes", regra: "por_pessoa", valor: 10 },
      periodos: [{ nome: "S1", dias: 7, percentual_bp: 10000 }],
      ranking: { criterio: "bilhetes" },
    };
    expect(campanhaEntradaSchema.parse(base).bilhetes).toBeUndefined();
    for (const numero_inicial of [0, 1, null])
      expect(
        campanhaEntradaSchema.safeParse({
          ...base,
          bilhetes: { quantidade: 7005, numero_inicial },
        }).success,
      ).toBe(true);
    for (const bilhetes of [
      { quantidade: 0, numero_inicial: 1 },
      { quantidade: 1_000_001, numero_inicial: 1 },
      { quantidade: 10, numero_inicial: 2 },
      { quantidade: 1.5, numero_inicial: 1 },
    ])
      expect(
        campanhaEntradaSchema.safeParse({ ...base, bilhetes }).success,
      ).toBe(false);
  });

  it("a resposta não aceita campo a mais (nada do comprador)", () => {
    const resposta = {
      quantidade: 8,
      numero_inicial: 1,
      numero_inicial_automatico: true,
      pagos: "AQ==",
      reservados: "Ag==",
      contagem: { pagos: 1, reservados: 1, livres: 6 },
      vendido_bp: 1250,
      sem_numeros: { pedidos: 0, bilhetes: 0 },
      fora_da_faixa: 0,
      atualizado_em: "2026-11-23T12:00:00.000Z",
    };
    expect(respostaBilhetesSchema.safeParse(resposta).success).toBe(true);
    expect(
      respostaBilhetesSchema.safeParse({ ...resposta, comprador: "x" }).success,
    ).toBe(false);
  });
});
