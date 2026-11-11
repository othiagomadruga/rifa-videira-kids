// Leitura do CSV da Rifei NO NAVEGADOR (RIFA-012, ciclo 2): o arquivo inteiro (separadores, BOM, linhas
// em branco, limites e CSV malicioso) e o corpo compacto que vai à API, só com as colunas mapeadas que não
// são de dado pessoal. Os CSVs e os dados pessoais são fictícios; o corpo é varrido atrás deles.
import { describe, expect, it } from "vitest";
import {
  LIMITE_CARACTERES_CSV_RECONCILIACAO,
  LIMITE_COLUNAS_CSV_RECONCILIACAO,
  LIMITE_CORPO_CONFERENCIA_BYTES,
  LIMITE_LINHAS_CSV_RECONCILIACAO,
  validarCorpoConferencia,
  type MapeamentoReconciliacao,
} from "../contracts/conferencia";
import { lerCsv } from "../csv";
import { mapeamentoVazio } from "./colunas";
import {
  corpoGrandeDemais,
  lerArquivoConferencia,
  montarCorpo,
  type ArquivoConferencia,
  type FalhaDaLeitura,
} from "./leitura";
import {
  CABECALHO_DO_CENARIO,
  DADOS_PESSOAIS,
  LINHAS_DO_CENARIO,
  MAPEAMENTO_DO_CENARIO,
  csvDoCenario,
  montarCsv,
  textosPessoaisEm,
} from "./teste-csv";

const FUSO = "America/Belem";
const SHA = "a".repeat(64);

function lido(texto: string): ArquivoConferencia {
  const leitura = lerArquivoConferencia(texto);
  if (!leitura.ok) throw new Error(`esperava leitura: ${leitura.motivo}`);
  return leitura;
}

function falhaDe(texto: string): FalhaDaLeitura {
  const leitura = lerArquivoConferencia(texto);
  if (leitura.ok) throw new Error("esperava falha");
  return leitura;
}

function corpoDe(texto: string, mapeamento?: MapeamentoReconciliacao) {
  const arquivo = lido(texto);
  const montagem = montarCorpo(
    arquivo,
    mapeamento ?? arquivo.mapeamentoDetectado,
    { fuso: FUSO, arquivoSha256: SHA },
  );
  if (!montagem.ok) throw new Error(JSON.stringify(montagem.problemas));
  return montagem;
}

describe("o arquivo inteiro em várias formas", () => {
  it("vírgula, ponto e vírgula, BOM e LF dão o mesmo corpo", () => {
    const formas = [
      csvDoCenario(),
      csvDoCenario(undefined, { separador: ";" }),
      csvDoCenario(undefined, { separador: ";", bom: true }),
      csvDoCenario(undefined, { fimDeLinha: "\n", bom: true }),
    ].map((texto) => corpoDe(texto));
    for (const forma of formas.slice(1)) expect(forma).toEqual(formas[0]);
    expect(formas[0].corpo.linhas).toBe(17);
    expect(lido(csvDoCenario()).mapeamentoDetectado).toEqual(
      MAPEAMENTO_DO_CENARIO,
    );
  });

  it("linhas em branco são ignoradas e colunas extras não atrapalham", () => {
    const { corpo } = corpoDe(
      'Pedido,Status,Valor,Coluna nova da Rifei\r\n\r\nP1,Pago,"R$ 20,00",x\r\n,,,\r\nP2,Pago,10,y\r\n',
    );
    expect(corpo).toMatchObject({
      linhas: 2,
      vezes: [1, 1],
      pedido_id: ["P1", "P2"],
      status: ["aprovado", "aprovado"],
      valor: [2000, 1000],
    });
  });

  it("o corpo do cenário: uma lista por campo mapeado, uma posição por linha, nada de fora do mapeamento", () => {
    const { corpo } = corpoDe(csvDoCenario());
    expect(corpo.colunas).toEqual({
      pedido_id: "Pedido",
      status: "Status",
      qtd_bilhetes: "Quantidade de bilhetes",
      bilhetes: "Bilhetes",
      valor: "Valor",
      afiliado: "Afiliado",
      data: "Data do pagamento",
    });
    expect(Object.keys(corpo).sort()).toEqual(
      [
        "afiliado",
        "arquivo_sha256",
        "colunas",
        "dia",
        "instante",
        "linhas",
        "numeros",
        "pedido_id",
        "qtd_bilhetes",
        "status",
        "valor",
        "vezes",
      ].sort(),
    );
    expect(corpo.pedido_id?.slice(0, 2)).toEqual(["R-0001", "R-0002"]);
    expect(corpo.numeros?.slice(0, 3)).toEqual([3, 2, null]);
    expect(corpo.afiliado?.slice(8, 10)).toEqual([101, "lider.betel"]);
    expect(corpo.dia?.[9]).toBe("2026-11-28");
    expect(corpo.instante?.[9]).toBeNull();
    expect(corpo.instante?.[8]).toBe(Date.parse("2026-11-27T13:00:00.000Z"));
    // As linhas da fórmula e a sem código vão sem código (a API conta como ignoradas).
    expect(corpo.pedido_id?.slice(-2)).toEqual([null, null]);
    expect(validarCorpoConferencia(corpo).ok).toBe(true);
  });

  it("com outro mapeamento, só as colunas escolhidas são lidas e vão no corpo", () => {
    const { corpo } = corpoDe(csvDoCenario(), {
      ...mapeamentoVazio(),
      pedido_id: 0,
      valor: 8,
    });
    expect(corpo.colunas).toEqual({
      ...{
        pedido_id: null,
        status: null,
        qtd_bilhetes: null,
        bilhetes: null,
        valor: null,
        afiliado: null,
        data: null,
      },
      pedido_id: "Pedido",
      valor: "Valor",
    });
    expect(Object.keys(corpo).sort()).toEqual(
      [
        "arquivo_sha256",
        "colunas",
        "linhas",
        "pedido_id",
        "valor",
        "vezes",
      ].sort(),
    );
  });

  it("linhas iguais nas colunas mapeadas viram uma posição só (vezes), e os dados pessoais diferentes não contam", () => {
    const linhas = LINHAS_DO_CENARIO.slice(0, 2).flatMap((linha) => [
      { ...linha, bilhetes: "" },
      { ...linha, bilhetes: "" },
      { ...linha, bilhetes: "" },
    ]);
    const { corpo } = corpoDe(csvDoCenario(linhas));
    expect(corpo.linhas).toBe(6);
    expect(corpo.vezes).toEqual([3, 3]);
    expect(corpo.pedido_id).toEqual(["R-0001", "R-0002"]);
  });

  it("mapeamento com coluna pessoal, inexistente ou repetida é recusado (a tela nem oferece a pessoal)", () => {
    const arquivo = lido(csvDoCenario());
    const montagem = montarCorpo(
      arquivo,
      { ...MAPEAMENTO_DO_CENARIO, afiliado: 1, valor: 40, data: 0 },
      { fuso: FUSO, arquivoSha256: SHA },
    );
    expect(montagem).toEqual({
      ok: false,
      problemas: [
        expect.objectContaining({
          caminho: ["mapeamento", "valor"],
          codigo: "coluna_inexistente",
        }),
        expect.objectContaining({
          caminho: ["mapeamento", "afiliado"],
          codigo: "coluna_pessoal",
        }),
        expect.objectContaining({
          caminho: ["mapeamento", "data"],
          codigo: "coluna_repetida",
        }),
      ],
    });
  });

  it("D1: o corpo (o que sai do navegador) não tem nome, e-mail, telefone, CPF nem as colunas não mapeadas", () => {
    for (const texto of [
      csvDoCenario(),
      csvDoCenario(undefined, { separador: ";" }),
    ]) {
      const montagem = corpoDe(texto);
      const json = JSON.stringify(montagem);
      expect(textosPessoaisEm(json)).toEqual([]);
      expect(json).not.toContain("Entregar para");
      for (const nome of ["Nome", "E-mail", "Telefone", "CPF"])
        expect(Object.values(montagem.corpo.colunas)).not.toContain(nome);
    }
    // Nem com o mapeamento sem o código (modo agregado).
    const agregado = corpoDe(csvDoCenario(), {
      ...MAPEAMENTO_DO_CENARIO,
      pedido_id: null,
    });
    expect(textosPessoaisEm(JSON.stringify(agregado))).toEqual([]);
    expect(agregado.corpo.pedido_id).toBeUndefined();
  });

  it("os avisos da leitura: colunas pessoais, linhas sem código, código inválido e fórmula", () => {
    const { avisos } = corpoDe(csvDoCenario());
    expect(avisos.map((aviso) => [aviso.codigo, aviso.quantidade])).toEqual([
      ["colunas_pessoais_ignoradas", null],
      ["sem_id", 1],
      ["id_invalido", 1],
      ["formula_ignorada", 1],
    ]);
    expect(avisos[0].mensagem).toBe(
      "As colunas Nome, E-mail, Telefone, CPF e Observação interna têm dados pessoais e foram ignoradas: elas não saem do seu computador nem são guardadas.",
    );
    expect(textosPessoaisEm(JSON.stringify(avisos))).toEqual([]);
  });
});

describe("limites e CSV malicioso", () => {
  it("vazio: sem cabeçalho; primeira linha de dados: sem_cabecalho, sem citar o conteúdo", () => {
    expect(falhaDe("").motivo).toBe("vazio");
    expect(falhaDe("\r\n ,, \r\n").motivo).toBe("vazio");
    for (const comDados of [
      "R-1,Maria Ficticia,maria@example.com\r\n",
      "R-1;Pago;3;R$ 60,00\r\n",
      "Pedido,23/11/2026\r\n",
      "Pedido,+5591988880001\r\n",
    ]) {
      const falha = falhaDe(comDados);
      expect(falha.motivo).toBe("sem_cabecalho");
      expect(falha.mensagem).toContain("não parece um cabeçalho");
      expect(textosPessoaisEm(JSON.stringify(falha))).toEqual([]);
    }
  });

  it("aspas abertas e fora de UTF-8: a falha diz a linha, sem citar o conteúdo", () => {
    const aspas = falhaDe(
      'Pedido,Nome\r\nP1,"Maria Ficticia Souza\r\nP2,Ana\r\n',
    );
    expect(aspas.motivo).toBe("aspas_abertas");
    expect(aspas.mensagem).toContain("linha 2");
    expect(textosPessoaisEm(JSON.stringify(aspas))).toEqual([]);
    const codificacao = falhaDe(
      `Pedido,Status\r\nP1,Pago\r\nP2,N${String.fromCharCode(0xfffd)}o pago\r\n`,
    );
    expect(codificacao.motivo).toBe("codificacao_invalida");
    expect(codificacao.mensagem).toContain("linha 3");
  });

  it("acima de 5 MB: arquivo_grande; mais linhas que o limite: linhas_demais, lendo só até o limite", () => {
    expect(
      falhaDe("x".repeat(LIMITE_CARACTERES_CSV_RECONCILIACAO + 1)).motivo,
    ).toBe("arquivo_grande");
    const linhas = "P,Pago\n".repeat(LIMITE_LINHAS_CSV_RECONCILIACAO + 1);
    const falha = falhaDe(`Pedido,Status\n${linhas}`);
    expect(falha.motivo).toBe("linhas_demais");
    expect(falha.mensagem).toContain("50.000");
    // O leitor para no limite: um arquivo enorme não é lido inteiro só para ser recusado.
    const enorme = "1\n".repeat(2_000_000);
    const parcial = lerCsv(enorme, { maximoRegistros: 10 });
    expect(parcial).toMatchObject({ ok: true, cortado: true });
    expect(parcial.ok && parcial.registros).toHaveLength(10);
  });

  it("colunas demais ficam de fora (com aviso); célula gigante na coluna pessoal ou nos bilhetes não quebra", () => {
    const cabecalho = [
      "Pedido",
      "Nome",
      "Bilhetes",
      ...Array.from({ length: 250 }, (_, i) => `Extra ${i}`),
    ];
    const gigante = `${DADOS_PESSOAIS.nomes[0]} `.repeat(50_000);
    const texto = montarCsv([
      cabecalho,
      [
        "P1",
        gigante,
        "1, ".repeat(70_000),
        ...Array.from({ length: 250 }, () => ""),
      ],
      ["P2", "Ana", "7, 8", ...Array.from({ length: 300 }, () => "z")],
    ]);
    const arquivo = lido(texto);
    expect(arquivo.colunas).toHaveLength(LIMITE_COLUNAS_CSV_RECONCILIACAO);
    expect(arquivo.colunasDemais).toBe(
      cabecalho.length - LIMITE_COLUNAS_CSV_RECONCILIACAO,
    );
    const montagem = corpoDe(texto);
    expect(montagem.corpo.numeros).toEqual([null, 2]);
    expect(montagem.avisos.map((aviso) => aviso.codigo)).toEqual([
      "colunas_pessoais_ignoradas",
      "colunas_demais",
      "quantidade_invalida",
    ]);
    expect(textosPessoaisEm(JSON.stringify(montagem))).toEqual([]);
  });

  it("fórmulas (=, +, -, @) nas colunas mapeadas viram célula ilegível, são contadas e não vão no corpo", () => {
    const texto = montarCsv([
      ["Pedido", "Status", "Quantidade", "Valor", "Afiliado", "Data"],
      [
        "=cmd|' /C calc'!A0",
        "=1+1",
        "=2*2",
        "+20",
        '=HYPERLINK("x")',
        "-HOJE()",
      ],
      ["P2", "Pago", "1", "20,00", "101", "23/11/2026"],
    ]);
    const { corpo, avisos } = corpoDe(texto);
    expect(corpo).toMatchObject({
      pedido_id: [null, "P2"],
      status: ["desconhecido", "aprovado"],
      qtd_bilhetes: [null, 1],
      valor: [null, 2000],
      afiliado: [false, 101],
      dia: [null, "2026-11-23"],
    });
    expect(
      Object.fromEntries(
        avisos.map((aviso) => [aviso.codigo, aviso.quantidade]),
      ),
    ).toMatchObject({
      id_invalido: 1,
      quantidade_invalida: 1,
      valor_invalido: 1,
      data_invalida: 1,
      formula_ignorada: 6,
    });
    expect(JSON.stringify(corpo)).not.toMatch(/cmd|HYPERLINK|HOJE|=/);
  });

  it("o corpo acima do teto (1 MiB) é recusado pela tela antes de enviar", () => {
    expect(corpoGrandeDemais("x".repeat(LIMITE_CORPO_CONFERENCIA_BYTES))).toBe(
      false,
    );
    expect(
      corpoGrandeDemais("x".repeat(LIMITE_CORPO_CONFERENCIA_BYTES + 1)),
    ).toBe(true);
    // Acentos ocupam 2 bytes em UTF-8: conta em bytes, não em caracteres.
    expect(
      corpoGrandeDemais("é".repeat(LIMITE_CORPO_CONFERENCIA_BYTES / 2 + 1)),
    ).toBe(true);
  });

  it("o cabeçalho do cenário marca as colunas pessoais (a tela não as oferece no mapeamento)", () => {
    const arquivo = lido(csvDoCenario());
    expect(
      arquivo.colunas
        .filter((coluna) => coluna.dado_pessoal)
        .map((coluna) => coluna.nome),
    ).toEqual(["Nome", "E-mail", "Telefone", "CPF", "Observação interna"]);
    expect(arquivo.colunas.map((coluna) => coluna.nome)).toEqual(
      CABECALHO_DO_CENARIO,
    );
  });
});
