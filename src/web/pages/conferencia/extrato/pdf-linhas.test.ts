// RIFA-068: o montador das linhas do PDF (pdf-linhas.ts), com pedaços de texto SINTÉTICOS (sem o pdf.js): o y agrupa a
// linha, o x ordena, as colunas do cabeçalho viram células com tabulação (as vazias no lugar), o vão grande e a troca
// de página viram uma linha em branco. O PDF de verdade, pelo pdf.js, está em pdf.test.ts.
import { describe, expect, it } from "vitest";
import { temTexto, textoDasPaginas } from "./pdf-linhas";
import { lerTextoColado } from "./texto-colado";
import { CONTEXTO } from "./teste-apoio";
import { pedaco } from "./teste-apoio-pdf";

/** O cabeçalho do Bradesco em y = 700: Data, Histórico, Docto. e os valores (Crédito, Débito, Saldo). */
const cabecalho = (y = 700) => [
  pedaco("Data", 30, y),
  pedaco("Histórico", 80, y),
  pedaco("Docto.", 270, y),
  pedaco("Crédito (R$)", 345, y),
  pedaco("Débito (R$)", 420, y),
  pedaco("Saldo (R$)", 500, y),
];

describe("as linhas pela posição", () => {
  it("o y agrupa (com uma tolerância), o x ordena, a palavra quebrada se junta e o vão pequeno vira espaço", () => {
    const rece = pedaco("PIX RECE", 100, 700.6);
    const bido = pedaco("BIDO", rece.x + rece.largura, 700); // colado: a mesma palavra
    const fulano = pedaco("Fulano", bido.x + bido.largura + 2.2, 700); // um espaço
    const texto = textoDasPaginas([
      [
        // Fora de ordem, como o PDF pode desenhar; a mesma linha com menos de 1 ponto de diferença na base.
        pedaco("R$ 20,00", 220, 699.2),
        fulano,
        pedaco("16/11/2026", 40, 700),
        bido,
        rece,
        pedaco("REM: Pagadora Ficticia", 100, 689),
      ],
    ]);
    expect(texto.split("\n")).toEqual([
      "16/11/2026 PIX RECEBIDO Fulano R$ 20,00",
      "REM: Pagadora Ficticia",
    ]);
  });

  it("pedaços vazios ou só com espaço não contam; sem nenhum texto, o PDF é uma imagem", () => {
    expect(temTexto([[pedaco(" ", 10, 10), pedaco("", 20, 10)], []])).toBe(
      false,
    );
    expect(temTexto([[], [pedaco("x", 10, 10)]])).toBe(true);
    expect(textoDasPaginas([[pedaco("  ", 10, 10)]])).toBe("");
  });

  it("um vão vertical grande (o rodapé) e a troca de página viram uma linha em branco", () => {
    const texto = textoDasPaginas([
      [
        pedaco("16/11/2026 PIX 20,00", 40, 700),
        pedaco("REM: Fulana", 40, 690),
        pedaco("Página 1 de 2", 40, 60),
      ],
      [pedaco("17/11/2026 PIX 30,00", 40, 780)],
    ]);
    expect(texto.split("\n")).toEqual([
      "16/11/2026 PIX 20,00",
      "REM: Fulana",
      "",
      "Página 1 de 2",
      "",
      "17/11/2026 PIX 30,00",
    ]);
  });
});

describe("a tabela pelas colunas do cabeçalho", () => {
  it("cada linha vira as células do cabeçalho, com as vazias no lugar; o título de cima fica como texto", () => {
    const texto = textoDasPaginas([
      [
        pedaco("Extrato Mensal / Por Período", 30, 760),
        pedaco("Período: 16/11/2026 a 17/11/2026", 30, 748),
        ...cabecalho(),
        pedaco("16/11/2026", 30, 689),
        pedaco("TRANSFERENCIA PIX", 80, 689),
        pedaco("1400200", 270, 689),
        pedaco("20,00", 370, 689), // à direita, sob Crédito
        pedaco("1.020,00", 510, 689),
        pedaco("REM: Fulana Ficticia 16/11", 80, 678),
        pedaco("TARIFA BANCARIA", 80, 667),
        pedaco("9,90", 443, 667), // sob Débito, sem sinal
        pedaco("1.010,10", 510, 667),
      ],
    ]);
    expect(texto.split("\n")).toEqual([
      "Extrato Mensal / Por Período",
      "Período: 16/11/2026 a 17/11/2026",
      "", // o vão entre o título e a tabela
      "Data\tHistórico\tDocto.\tCrédito (R$)\tDébito (R$)\tSaldo (R$)",
      "16/11/2026\tTRANSFERENCIA PIX\t1400200\t20,00\t\t1.020,00",
      "\tREM: Fulana Ficticia 16/11\t\t\t\t",
      "\tTARIFA BANCARIA\t\t\t9,90\t1.010,10",
    ]);
    // O leitor do texto colado lê o crédito e o débito pelas colunas, e o saldo nunca é o valor.
    const lido = lerTextoColado(texto, CONTEXTO);
    if (!lido.ok) throw new Error(lido.mensagem);
    expect(
      lido.lancamentos.map((item) => [item.centavos, item.descricao]),
    ).toEqual([
      [2000, "TRANSFERENCIA PIX 1400200 · REM: Fulana Ficticia 16/11"],
      [-990, "TARIFA BANCARIA"],
    ]);
  });

  it("o valor que passa da borda da coluna fica na de maior sobreposição; sem nenhuma, na mais próxima", () => {
    const texto = textoDasPaginas([
      [
        ...cabecalho(),
        pedaco("17/11/2026", 30, 689),
        pedaco("PIX", 80, 689),
        pedaco("1.234.567,89", 340, 689), // começa antes do Crédito (R$), mas é dele
        pedaco("0,01", 466, 689), // entre o Débito e o Saldo, sem tocar: o mais perto é o Débito
      ],
    ]);
    expect(texto.split("\n").at(-1)).toBe(
      "17/11/2026\tPIX\t\t1.234.567,89\t0,01\t",
    );
  });

  it("a página com o cabeçalho troca as colunas; a página sem cabeçalho usa as da anterior", () => {
    const texto = textoDasPaginas([
      [...cabecalho(), pedaco("16/11/2026", 30, 689), pedaco("PIX", 80, 689)],
      // Sem cabeçalho: as colunas da página 1.
      [pedaco("PIX", 80, 780), pedaco("5,00", 375, 780)],
      // Com o cabeçalho noutra altura e o título acima dele, como texto.
      [
        pedaco("Extrato", 30, 800),
        ...cabecalho(760),
        pedaco("17/11/2026", 30, 749),
        pedaco("7,00", 446, 749),
      ],
    ]);
    expect(texto.split("\n")).toEqual([
      "Data\tHistórico\tDocto.\tCrédito (R$)\tDébito (R$)\tSaldo (R$)",
      "16/11/2026\tPIX\t\t\t\t",
      "",
      "\tPIX\t\t5,00\t\t",
      "",
      "Extrato",
      "",
      "Data\tHistórico\tDocto.\tCrédito (R$)\tDébito (R$)\tSaldo (R$)",
      "17/11/2026\t\t\t\t7,00\t",
    ]);
  });

  it("uma linha com Data e Valor também é cabeçalho; sem Crédito, Débito nem Valor, não", () => {
    expect(
      textoDasPaginas([
        [
          pedaco("Data", 30, 700),
          pedaco("Descrição", 100, 700),
          pedaco("Valor", 400, 700),
          pedaco("16/11/2026", 30, 689),
          pedaco("PIX RECEBIDO", 100, 689),
          pedaco("-20,00", 400, 689),
        ],
      ]).split("\n"),
    ).toEqual(["Data\tDescrição\tValor", "16/11/2026\tPIX RECEBIDO\t-20,00"]);
    expect(
      textoDasPaginas([
        [
          pedaco("Data", 30, 700),
          pedaco("Descrição", 100, 700),
          pedaco("Documento", 400, 700),
        ],
      ]),
    ).toBe("Data Descrição Documento");
  });
});
