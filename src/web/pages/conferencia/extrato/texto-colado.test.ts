// RIFA-059: o leitor do texto colado, com 3 formatos sintéticos (a tabela do Bradesco copiada da tela, uma linha por
// lançamento e o jeito dos apps, com a data numa linha só), valores com e sem "R$", datas com e sem hora e com e sem
// o ano, o sinal escrito (-, +, C, D, −) e o sinal pelas palavras.
import { describe, expect, it } from "vitest";
import { lerTextoColado } from "./texto-colado";
import {
  CONTEXTO,
  PAGADOR_DOIS,
  PAGADORA_UM,
  TEXTO_APP,
  TEXTO_LINHAS,
  TEXTO_TABELA,
} from "./teste-apoio";

const belem = (texto: string) => Date.parse(`${texto}-03:00`);

function lido(texto: string) {
  const resultado = lerTextoColado(texto, CONTEXTO);
  if (!resultado.ok) throw new Error(resultado.mensagem);
  return resultado;
}

const resumo = (texto: string) =>
  lido(texto).lancamentos.map(({ dia, instante, centavos, descricao }) => ({
    dia,
    instante,
    centavos,
    descricao,
  }));

describe("formato 1: a tabela copiada da tela (tabulações, cabeçalho com Crédito e Débito)", () => {
  it("usa as colunas do cabeçalho, junta o REM: da linha de baixo e ignora o saldo", () => {
    expect(resumo(TEXTO_TABELA)).toEqual([
      {
        dia: "2026-11-16",
        instante: null,
        centavos: 2000,
        descricao: `TRANSFERENCIA PIX 1400200 · REM: ${PAGADORA_UM} 16/11`,
      },
      {
        dia: "2026-11-16",
        instante: null,
        centavos: -1500,
        descricao: "TRANSFERENCIA PIX 1400201 · DES: Loja Ficticia 16/11",
      },
      {
        dia: "2026-11-16",
        instante: null,
        centavos: -5000,
        descricao: "PAGTO ELETRON COBRANCA 0001",
      },
      {
        dia: "2026-11-17",
        instante: null,
        centavos: 123456,
        descricao: `PIX QR CODE DINAMICO 1400300 · REM: ${PAGADOR_DOIS} 17/11`,
      },
    ]);
    expect(lido(TEXTO_TABELA).semHora).toBe(true);
  });

  it("sem as tabulações (colado como texto), o primeiro valor da linha e o sinal pelas palavras (DES: é saída)", () => {
    const semTabs = TEXTO_TABELA.split("\n")
      .slice(1)
      .map((linha) => linha.replaceAll("\t", " "))
      .join("\n");
    // O saldo anterior vira um lançamento com "SALDO" na descrição: o filtro do Pix o põe de lado (lancamentos.test.ts).
    expect(
      lido(semTabs).lancamentos.map((item) => [item.centavos, item.descricao]),
    ).toEqual([
      [100000, "SALDO ANTERIOR"],
      [2000, `TRANSFERENCIA PIX 1400200 · REM: ${PAGADORA_UM} 16/11`],
      [-1500, "TRANSFERENCIA PIX 1400201 · DES: Loja Ficticia 16/11"],
      [-5000, "PAGTO ELETRON COBRANCA 0001"],
      [123456, `PIX QR CODE DINAMICO 1400300 · REM: ${PAGADOR_DOIS} 17/11`],
    ]);
  });
});

describe("formato 2: uma linha por lançamento, com hora, R$ e sinal", () => {
  it("lê a data (com e sem o século), a hora, o valor com o sinal escrito e a descrição", () => {
    expect(resumo(TEXTO_LINHAS)).toEqual([
      {
        dia: "2026-11-16",
        instante: belem("2026-11-16T10:05:00"),
        centavos: 2000,
        descricao: `PIX RECEBIDO ${PAGADORA_UM}`,
      },
      {
        dia: "2026-11-16",
        instante: belem("2026-11-16T11:30:00"),
        centavos: -1500,
        descricao: "PIX ENVIADO LOJA FICTICIA",
      },
      {
        dia: "2026-11-16",
        instante: belem("2026-11-16T14:00:00"),
        centavos: 30000,
        descricao: "TED RECEBIDA EMPRESA FICTICIA",
      },
      {
        dia: "2026-11-16",
        instante: belem("2026-11-16T18:00:00"),
        centavos: 130500,
        descricao: "SALDO DO DIA",
      },
      {
        dia: "2026-11-17",
        instante: belem("2026-11-17T09:12:45"),
        centavos: 123456,
        descricao: `Pix recebido - ${PAGADOR_DOIS}`,
      },
    ]);
  });
});

describe("formato 3: a data numa linha só (o jeito dos apps)", () => {
  it("a linha da data vale para as de baixo; o ano que falta vem de hoje; − e C são o sinal", () => {
    expect(resumo(TEXTO_APP)).toEqual([
      {
        dia: "2026-11-16",
        instante: belem("2026-11-16T10:05:00"),
        centavos: 2000,
        descricao: `Transferência recebida pelo Pix ${PAGADORA_UM}`,
      },
      {
        dia: "2026-11-16",
        instante: belem("2026-11-16T11:30:00"),
        centavos: -1500,
        descricao: "Pix enviado Loja Ficticia",
      },
      {
        dia: "2026-11-17",
        instante: belem("2026-11-17T09:12:00"),
        centavos: 123456,
        descricao: `Pix recebido ${PAGADOR_DOIS}`,
      },
    ]);
  });

  it("“Hoje” e “Ontem” valem como a data", () => {
    const hojeOntem = lido(
      ["Ontem", "PIX RECEBIDO 20,00", "Hoje", "PIX RECEBIDO 30,00"].join("\n"),
    );
    expect(
      hojeOntem.lancamentos.map((item) => [item.dia, item.centavos]),
    ).toEqual([
      ["2026-11-17", 2000],
      ["2026-11-18", 3000],
    ]);
  });

  it("um extrato de dezembro lido em janeiro fica no ano passado", () => {
    const janeiro = lerTextoColado("30/12 PIX RECEBIDO 20,00", {
      ...CONTEXTO,
      agora: Date.parse("2027-01-05T12:00:00Z"),
    });
    expect(janeiro.ok && janeiro.lancamentos[0].dia).toBe("2026-12-30");
  });
});

describe("valores, datas e o que fica de fora", () => {
  it("valores com e sem R$, com milhar, com o sinal antes, depois ou como letra", () => {
    const texto = [
      "16/11/2026 PIX A 20,00",
      "16/11/2026 PIX B R$20,00",
      "16/11/2026 PIX C R$ 1.234,56",
      "16/11/2026 PIX D 20,00-",
      "16/11/2026 PIX E 20,00 D",
      "16/11/2026 PIX F R$ -20,00",
      "16/11/2026 PIX G +20,00",
      "16/11/2026 PIX H 1234,56",
    ].join("\n");
    expect(lido(texto).lancamentos.map((item) => item.centavos)).toEqual([
      2000, 2000, 123456, -2000, -2000, -2000, 2000, 123456,
    ]);
  });

  it("datas em vários jeitos, com e sem hora", () => {
    const texto = [
      "16/11/2026 PIX 1,00",
      "16-11-2026 PIX 2,00",
      "2026-11-16 PIX 3,00",
      "16 nov 2026 PIX 4,00",
      "16/11/2026 às 10h05 PIX 5,00",
      "16/11/2026 10:05:30 PIX 6,00",
    ].join("\n");
    const lancamentos = lido(texto).lancamentos;
    expect(lancamentos.every((item) => item.dia === "2026-11-16")).toBe(true);
    expect(lancamentos.map((item) => item.instante)).toEqual([
      null,
      null,
      null,
      null,
      belem("2026-11-16T10:05:00"),
      belem("2026-11-16T10:05:30"),
    ]);
  });

  it("um nome que começa como um mês não é data (“2 MARCOS” não é março)", () => {
    const texto = ["16/11/2026", "PIX RECEBIDO 2 MARCOS SILVA 20,00"].join(
      "\n",
    );
    expect(lido(texto).lancamentos[0].dia).toBe("2026-11-16");
  });

  it("sem data nenhuma acima, o valor fica ilegível; títulos sem valor são ignorados", () => {
    const resultado = lido(
      [
        "Extrato de conta",
        "PIX RECEBIDO 20,00",
        "16/11/2026 PIX RECEBIDO 30,00",
      ].join("\n"),
    );
    expect(resultado.ilegiveis).toBe(1);
    expect(resultado.lancamentos.map((item) => item.centavos)).toEqual([3000]);
  });

  it("um texto sem lançamentos falha com a explicação", () => {
    const resultado = lerTextoColado("Olá\nnada aqui", CONTEXTO);
    expect(resultado.ok).toBe(false);
  });
});
