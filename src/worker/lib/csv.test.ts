// CA3: leitor de CSV robusto (separadores, aspas, BOM, fins de linha, acentos, linhas em branco).
import { describe, expect, it } from "vitest";
import { detectarSeparador, lerCsv, lerTabelaCsv } from "./csv";

function registros(texto: string) {
  const leitura = lerCsv(texto);
  if (!leitura.ok) throw new Error(`leitura falhou: ${leitura.mensagem}`);
  return leitura.registros;
}

describe("CA3: lerCsv", () => {
  it("lê o mesmo conteúdo separado por vírgula e por ponto e vírgula", () => {
    const esperado = [
      { linha: 1, campos: ["rede", "divisao", "celula"] },
      { linha: 2, campos: ["Rede Jovem", "jovens", "Célula 01"] },
    ];
    expect(lerCsv("rede,divisao,celula\nRede Jovem,jovens,Célula 01")).toEqual({
      ok: true,
      separador: ",",
      registros: esperado,
    });
    expect(lerCsv("rede;divisao;celula\nRede Jovem;jovens;Célula 01")).toEqual({
      ok: true,
      separador: ";",
      registros: esperado,
    });
  });

  it("detecta o separador no cabeçalho, sem contar o que está entre aspas", () => {
    expect(detectarSeparador('"rede;divisao",celula,qtd\nA;B;C;D;E')).toBe(",");
    expect(detectarSeparador('"rede,divisao";celula;qtd\nA,B,C,D,E')).toBe(";");
    expect(detectarSeparador("\n\n  \nrede;divisao\n")).toBe(";");
    expect(detectarSeparador("rede\nA;B")).toBe(",");
  });

  it("aceita campo entre aspas com o separador, aspas escapadas e quebra de linha", () => {
    const texto =
      'celula;lider;obs\r\n"Célula Esperança; Centro";"Maria ""Tia Ma"" Souza";"linha 1\r\nlinha 2"\r\nCélula 02;Líder;\r\n';

    expect(registros(texto)).toEqual([
      { linha: 1, campos: ["celula", "lider", "obs"] },
      {
        linha: 2,
        campos: [
          "Célula Esperança; Centro",
          'Maria "Tia Ma" Souza',
          "linha 1\nlinha 2",
        ],
      },
      // A quebra dentro das aspas não abre linha nova: esta é a linha 3 da planilha.
      { linha: 3, campos: ["Célula 02", "Líder", ""] },
    ]);
  });

  it("descarta o BOM UTF-8 e aceita CRLF, LF e CR", () => {
    expect(registros("\uFEFFa,b\r\n1,2\n3,4\r5,6")).toEqual([
      { linha: 1, campos: ["a", "b"] },
      { linha: 2, campos: ["1", "2"] },
      { linha: 3, campos: ["3", "4"] },
      { linha: 4, campos: ["5", "6"] },
    ]);
  });

  it("ignora linhas em branco (no meio e no fim), que continuam contando na numeração", () => {
    const texto = "a;b\r\n1;2\r\n\r\n;\r\n   \r\n3;4\r\n\r\n;;\r\n \t \r\n";

    expect(registros(texto)).toEqual([
      { linha: 1, campos: ["a", "b"] },
      { linha: 2, campos: ["1", "2"] },
      { linha: 6, campos: ["3", "4"] },
    ]);
  });

  it("mantém acentos, cedilha e espaços do conteúdo (quem limpa é o schema)", () => {
    expect(
      registros("nome;lider\nCélula Ação e Graça; João da Conceição \n")[1],
    ).toEqual({
      linha: 2,
      campos: ["Célula Ação e Graça", " João da Conceição "],
    });
  });

  it("tolera espaços antes da aspa de abertura, texto depois da de fechamento e aspa no meio do campo", () => {
    expect(registros('x,y,z\na, "b, c" ,d\nTia "Ma",2,3')).toEqual([
      { linha: 1, campos: ["x", "y", "z"] },
      { linha: 2, campos: ["a", "b, c ", "d"] },
      { linha: 3, campos: ['Tia "Ma"', "2", "3"] },
    ]);
  });

  it("lê a última linha sem quebra de linha no fim e o arquivo vazio", () => {
    expect(registros("a,b\n1,2")).toEqual([
      { linha: 1, campos: ["a", "b"] },
      { linha: 2, campos: ["1", "2"] },
    ]);
    expect(registros("")).toEqual([]);
    expect(registros('a,b\n1,""')).toEqual([
      { linha: 1, campos: ["a", "b"] },
      { linha: 2, campos: ["1", ""] },
    ]);
  });

  it("aspas não fechadas: falha com a linha onde foram abertas", () => {
    expect(lerCsv('a,b\r\n1,2\r\n"3,4\r\n5,6\r\n')).toEqual({
      ok: false,
      linha: 3,
      mensagem: "As aspas abertas na linha 3 não foram fechadas",
    });
  });
});

describe("CA3: lerTabelaCsv", () => {
  const opcoes = {
    colunas: ["rede", "divisao", "celula", "lider_email"] as const,
    obrigatorias: ["rede", "divisao", "celula"] as const,
    limiteLinhas: 3,
  };

  it("acha as colunas pelo nome (maiúsculas, acentos e espaços não importam) e ignora as desconhecidas", () => {
    const tabela = lerTabelaCsv(
      "Observação;CÉLULA; Divisão ;Rede\nqualquer;Célula 01;jovens;Rede Jovem\nx;Célula 02\n",
      opcoes,
    );

    expect(tabela).toEqual({
      ok: true,
      colunas: new Set(["celula", "divisao", "rede"]),
      linhas: [
        {
          linha: 2,
          valores: {
            celula: "Célula 01",
            divisao: "jovens",
            rede: "Rede Jovem",
          },
        },
        // Campos que faltam no fim da linha vêm vazios.
        { linha: 3, valores: { celula: "Célula 02", divisao: "", rede: "" } },
      ],
    });
  });

  it("falha sem cabeçalho (arquivo vazio ou só com linhas em branco)", () => {
    for (const texto of ["", "\r\n\r\n", " ; ; \n\n"]) {
      expect(lerTabelaCsv(texto, opcoes)).toEqual({
        ok: false,
        mensagem:
          "O arquivo está vazio: a primeira linha precisa ser o cabeçalho com os nomes das colunas",
      });
    }
  });

  it("falha quando falta coluna obrigatória, com as colunas que faltam em detalhes", () => {
    expect(
      lerTabelaCsv("rede,lider_email\nRede Jovem,a@b.com\n", opcoes),
    ).toEqual({
      ok: false,
      mensagem:
        "Faltam colunas obrigatórias no cabeçalho (linha 1): divisao, celula",
      detalhes: ["divisao", "celula"],
    });
  });

  it("falha quando uma coluna conhecida aparece duas vezes", () => {
    expect(lerTabelaCsv("rede,divisao,celula,REDE\n", opcoes)).toEqual({
      ok: false,
      mensagem: 'A coluna "rede" aparece mais de uma vez no cabeçalho',
    });
  });

  it("respeita o limite de linhas de dados (linhas em branco não contam)", () => {
    const cabecalho = "rede,divisao,celula\n";
    const linha = "Rede,jovens,Célula\n";
    expect(
      lerTabelaCsv(cabecalho + linha.repeat(3) + "\n\n,,\n", opcoes),
    ).toMatchObject({
      ok: true,
    });
    expect(lerTabelaCsv(cabecalho + linha.repeat(4), opcoes)).toEqual({
      ok: false,
      mensagem:
        "O arquivo tem 4 linhas de dados; o limite é 3. Divida em mais de um arquivo.",
    });
  });

  it("falha quando o texto não veio de um arquivo UTF-8 (caractere de substituição)", () => {
    expect(
      lerTabelaCsv("rede,divisao,celula\nRede,jovens,C\uFFFDlula 01\n", opcoes),
    ).toEqual({
      ok: false,
      mensagem:
        'O arquivo não está em UTF-8 (caractere inválido na linha 2). No Excel, salve como "CSV UTF-8"; no Google Planilhas, use Arquivo > Fazer download > CSV.',
    });
  });

  it("falha com aspas não fechadas", () => {
    expect(
      lerTabelaCsv('rede,divisao,celula\n"Rede,jovens,C\n', opcoes),
    ).toEqual({
      ok: false,
      mensagem: "As aspas abertas na linha 2 não foram fechadas",
    });
  });
});
