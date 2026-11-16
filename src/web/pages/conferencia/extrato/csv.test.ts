// RIFA-059: o extrato em CSV, com o mapeamento simples de colunas (no padrão da conferência): o cabeçalho depois das
// linhas de título, a detecção pelo nome, crédito e débito em colunas separadas e a troca de coluna.
import { describe, expect, it } from "vitest";
import {
  detectarColunasDoExtrato,
  lancamentosDoCsv,
  lerCsvDoExtrato,
  pareceCsv,
  type CsvDoExtrato,
} from "./csv";
import { CONTEXTO, CSV_EXTRATO, PAGADORA_UM } from "./teste-apoio";

const belem = (texto: string) => Date.parse(`${texto}-03:00`);

function csvDe(texto: string): CsvDoExtrato {
  const lido = lerCsvDoExtrato(texto);
  if (lido === null || "ok" in lido) throw new Error("não leu o CSV");
  return lido;
}

describe("detectarColunasDoExtrato", () => {
  it("acha data, hora, descrição, valor, débito e documento pelo nome; o saldo nunca", () => {
    expect(
      detectarColunasDoExtrato([
        "Data",
        "Hora",
        "Histórico",
        "Documento",
        "Crédito (R$)",
        "Débito (R$)",
        "Saldo (R$)",
      ]),
    ).toEqual({
      data: 0,
      hora: 1,
      descricao: 2,
      identificador: 3,
      valor: 4,
      debito: 5,
    });
  });

  it("prefere a coluna de mais peso (Crédito vence Valor; Histórico vence Nome)", () => {
    const mapeamento = detectarColunasDoExtrato([
      "Nome",
      "Data do lançamento",
      "Valor",
      "Crédito",
      "Lançamento",
    ]);
    expect(mapeamento.valor).toBe(3);
    expect(mapeamento.descricao).toBe(4);
    expect(mapeamento.data).toBe(1);
  });
});

describe("lerCsvDoExtrato", () => {
  it("acha o cabeçalho depois das linhas de título, com o separador dele", () => {
    const csv = csvDe(CSV_EXTRATO);
    expect(csv.colunas).toEqual([
      "Data",
      "Histórico",
      "Documento",
      "Valor (R$)",
      "Saldo (R$)",
    ]);
    expect(csv.registros).toHaveLength(3);
    expect(csv.mapeamentoDetectado).toEqual({
      data: 0,
      hora: null,
      descricao: 1,
      valor: 3,
      debito: null,
      identificador: 2,
    });
  });

  it("sem cabeçalho reconhecível, devolve null (a tela lê como texto colado)", () => {
    expect(
      lerCsvDoExtrato("16/11/2026;PIX;20,00\n17/11/2026;PIX;30,00"),
    ).toBeNull();
  });

  it("pareceCsv: linhas com o mesmo separador", () => {
    expect(pareceCsv(CSV_EXTRATO)).toBe(true);
    expect(
      pareceCsv("16/11/2026 PIX RECEBIDO R$ 20,00\n16/11/2026 PIX 3,00"),
    ).toBe(false);
  });
});

describe("lancamentosDoCsv", () => {
  it("lê a data com a hora, o valor com sinal, a descrição e o documento", () => {
    const csv = csvDe(CSV_EXTRATO);
    const lido = lancamentosDoCsv(csv, csv.mapeamentoDetectado, CONTEXTO);
    if (!lido.ok) throw new Error(lido.mensagem);
    expect(lido.formato).toBe("csv");
    expect(lido.lancamentos[0]).toEqual({
      ordem: 1,
      dia: "2026-11-16",
      instante: belem("2026-11-16T10:05:00"),
      centavos: 2000,
      descricao: `PIX RECEBIDO ${PAGADORA_UM}`,
      identificadores: ["PEDTESTE0101"],
    });
    expect(lido.lancamentos.map((item) => item.centavos)).toEqual([
      2000, -1500, 4000,
    ]);
  });

  it("crédito e débito em colunas separadas; a hora numa coluna à parte", () => {
    const csv = csvDe(
      [
        "Data,Hora,Histórico,Crédito,Débito,Saldo",
        "16/11/2026,10:05,PIX RECEBIDO,20.00,,1020.00",
        "16/11/2026,11:30,PIX ENVIADO,,15.00,1005.00",
      ].join("\n"),
    );
    const lido = lancamentosDoCsv(csv, csv.mapeamentoDetectado, CONTEXTO);
    if (!lido.ok) throw new Error(lido.mensagem);
    expect(
      lido.lancamentos.map((item) => [item.centavos, item.instante]),
    ).toEqual([
      [2000, belem("2026-11-16T10:05:00")],
      [-1500, belem("2026-11-16T11:30:00")],
    ]);
  });

  it("trocar a coluna muda o resultado; sem a data, a falha diz o que falta", () => {
    const csv = csvDe(CSV_EXTRATO);
    const semDescricao = lancamentosDoCsv(
      csv,
      { ...csv.mapeamentoDetectado, descricao: null },
      CONTEXTO,
    );
    expect(semDescricao.ok && semDescricao.lancamentos[0].descricao).toBe(
      "(sem descrição)",
    );
    const semData = lancamentosDoCsv(
      csv,
      { ...csv.mapeamentoDetectado, data: null },
      CONTEXTO,
    );
    expect(semData.ok).toBe(false);
  });

  it("a linha com valor e data ilegíveis conta como ilegível; a vazia, não", () => {
    const csv = csvDe(
      [
        "Data;Histórico;Valor",
        "16/11/2026;PIX;20,00",
        "sem data;PIX;abc",
        ";;",
      ].join("\n"),
    );
    const lido = lancamentosDoCsv(csv, csv.mapeamentoDetectado, CONTEXTO);
    expect(lido.ok && lido.ilegiveis).toBe(1);
  });
});
