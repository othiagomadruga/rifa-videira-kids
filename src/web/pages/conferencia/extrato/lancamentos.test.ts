// RIFA-059: o filtro dos créditos que parecem Pix (palavras configuráveis, quantos ficaram de fora e por quê), o
// relógio do fuso, a hora repetida que não vale e os valores com sinal de um campo só.
import { describe, expect, it } from "vitest";
import {
  criarRelogio,
  filtrarPix,
  palavrasDoPix,
  primeiroInstante,
  semHoraRepetida,
  PALAVRAS_PADRAO,
  type ExtratoLido,
  type Lancamento,
} from "./lancamentos";
import { lerOfx } from "./ofx";
import { CONTEXTO, OFX_SGML } from "./teste-apoio";
import { acharData, lerValorComSinal } from "./valores";

const relogio = criarRelogio(CONTEXTO);

function lancamento(
  ordem: number,
  centavos: number,
  descricao: string,
  instante: number | null = null,
): Lancamento {
  return {
    ordem,
    dia: "2026-11-16",
    instante,
    centavos,
    descricao,
    identificadores: [],
  };
}

const extrato = (lancamentos: Lancamento[], ilegiveis = 0): ExtratoLido => ({
  ok: true,
  formato: "texto",
  lancamentos,
  ilegiveis,
  semHora: true,
});

describe("palavrasDoPix", () => {
  it("separa por vírgula ou ponto e vírgula, tira acentos, põe em maiúsculas e não repete", () => {
    expect(palavrasDoPix(PALAVRAS_PADRAO)).toEqual(["PIX", "TRANSF"]);
    expect(palavrasDoPix(" pix ; Transferência,PIX,, ted ")).toEqual([
      "PIX",
      "TRANSFERENCIA",
      "TED",
    ]);
    expect(palavrasDoPix("   ")).toEqual([]);
  });
});

describe("filtrarPix", () => {
  const lancamentos = [
    lancamento(1, 2000, "TRANSFERENCIA PIX REM: FULANA"),
    lancamento(2, 4000, "Pix recebido"),
    lancamento(3, 30000, "TED RECEBIDA"),
    lancamento(4, -1500, "PIX ENVIADO"),
    lancamento(5, 100000, "SALDO ANTERIOR"),
    lancamento(6, 0, "PIX ESTORNADO"),
    lancamento(7, 5000, "Transf recebida"),
  ];

  it("só os créditos com as palavras (sem acento e sem diferença de maiúsculas); conta os de fora por motivo", () => {
    const { pix, ignorados } = filtrarPix(
      extrato(lancamentos, 2),
      palavrasDoPix(PALAVRAS_PADRAO),
      relogio,
    );
    expect(pix.map((item) => item.chave)).toEqual(["L1", "L2", "L7"]);
    expect(ignorados).toEqual({
      debitos: 1,
      semPalavra: 1,
      saldos: 1,
      ilegiveis: 3,
    });
  });

  it("as palavras são configuráveis; sem palavras, entram todos os créditos (menos o saldo)", () => {
    expect(
      filtrarPix(extrato(lancamentos), palavrasDoPix("TED"), relogio).pix.map(
        (item) => item.chave,
      ),
    ).toEqual(["L3"]);
    expect(
      filtrarPix(extrato(lancamentos), [], relogio).pix.map(
        (item) => item.chave,
      ),
    ).toEqual(["L1", "L2", "L3", "L7"]);
  });

  it("o Pix sem hora pode ter caído em qualquer hora do dia (no fuso da campanha)", () => {
    const [semHora] = filtrarPix(
      extrato([lancamento(1, 2000, "PIX")]),
      ["PIX"],
      relogio,
    ).pix;
    expect(semHora.inicio).toBe(Date.parse("2026-11-16T00:00:00-03:00"));
    expect(semHora.fim).toBe(Date.parse("2026-11-17T00:00:00-03:00") - 1);
    const comHora = Date.parse("2026-11-16T10:05:00-03:00");
    const [comInstante] = filtrarPix(
      extrato([lancamento(1, 2000, "PIX", comHora)]),
      ["PIX"],
      relogio,
    ).pix;
    expect([comInstante.inicio, comInstante.fim]).toEqual([comHora, comHora]);
  });

  it("primeiroInstante: o começo do primeiro crédito (para saber até onde buscar os pedidos)", () => {
    const lido = lerOfx(OFX_SGML, CONTEXTO);
    if (!lido.ok) throw new Error("não leu");
    expect(primeiroInstante(lido, relogio)).toBe(
      Date.parse("2026-11-16T10:05:00-03:00"),
    );
    expect(
      primeiroInstante(extrato([lancamento(1, -100, "PIX")]), relogio),
    ).toBeNull();
  });
});

describe("semHoraRepetida", () => {
  const as = (hora: string) => Date.parse(`2026-11-16T${hora}:00-03:00`);

  it("a mesma hora em todos (pelo menos 2): só o dia", () => {
    const mesma = semHoraRepetida(
      [lancamento(1, 1, "a", as("12:00")), lancamento(2, 1, "b", as("12:00"))],
      relogio,
    );
    expect(mesma.semHora).toBe(true);
    expect(mesma.lancamentos.map((item) => item.instante)).toEqual([
      null,
      null,
    ]);
  });

  it("horas diferentes (ou uma só) ficam", () => {
    expect(
      semHoraRepetida(
        [
          lancamento(1, 1, "a", as("10:00")),
          lancamento(2, 1, "b", as("11:00")),
        ],
        relogio,
      ).semHora,
    ).toBe(false);
    expect(
      semHoraRepetida([lancamento(1, 1, "a", as("10:00"))], relogio).semHora,
    ).toBe(false);
  });
});

describe("valores de um campo só e datas num texto", () => {
  it("lerValorComSinal", () => {
    expect(lerValorComSinal("-50.00")).toBe(-5000);
    expect(lerValorComSinal("+20,00")).toBe(2000);
    expect(lerValorComSinal("R$ 1.234,56")).toBe(123456);
    expect(lerValorComSinal("20,00 D")).toBe(-2000);
    expect(lerValorComSinal("20,00 C")).toBe(2000);
    expect(lerValorComSinal("20,00-")).toBe(-2000);
    expect(lerValorComSinal("(20,00)")).toBe(-2000);
    expect(lerValorComSinal("− R$ 9,90")).toBe(-990);
    expect(lerValorComSinal("R$ -9,90")).toBe(-990);
    expect(lerValorComSinal("25.5")).toBe(2550);
    expect(lerValorComSinal("")).toBeNull();
    expect(lerValorComSinal("abc")).toBeNull();
  });

  it("acharData: a primeira data do texto, nos vários jeitos", () => {
    const hoje = "2026-11-18";
    const dia = (texto: string) => {
      const achada = acharData(texto, hoje);
      return achada && [achada.ano, achada.mes, achada.dia];
    };
    expect(dia("16/11/2026 PIX")).toEqual([2026, 11, 16]);
    expect(dia("PIX 16/11/26")).toEqual([2026, 11, 16]);
    expect(dia("16/11")).toEqual([2026, 11, 16]);
    expect(dia("16-11-2026")).toEqual([2026, 11, 16]);
    expect(dia("2026-11-16")).toEqual([2026, 11, 16]);
    expect(dia("Seg, 16 de novembro de 2026")).toEqual([2026, 11, 16]);
    expect(dia("16 NOV")).toEqual([2026, 11, 16]);
    expect(dia("3 de março")).toEqual([2026, 3, 3]);
    expect(dia("ontem")).toEqual([2026, 11, 17]);
    expect(dia("PIX 2 MARCOS")).toBeNull();
    expect(dia("16-11 PIX")).toBeNull();
    expect(dia("R$ 1.234,56")).toBeNull();
    expect(dia("32/13/2026")).toBeNull();
  });
});
